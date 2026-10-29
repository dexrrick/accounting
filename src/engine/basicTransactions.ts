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

function extractLabelledAmount(query: string, labelRegexA: RegExp, labelRegexB: RegExp): bigint | undefined {
  const matchesA = [...query.matchAll(labelRegexA)];
  const matchesB = [...query.matchAll(labelRegexB)];
  const allMatches = [...matchesA, ...matchesB];
  if (allMatches.length === 0) return undefined;

  // Deduplicate matches that point to the exact same amount token in the query
  const seenAmountIndices = new Set<number>();
  const uniqueMatches: RegExpMatchArray[] = [];
  for (const m of allMatches) {
    const amountOffset = m[0].search(/(?:\bSGD|S\$|\$)/i);
    const amountIndex = (m.index ?? 0) + (amountOffset >= 0 ? amountOffset : 0);
    if (!seenAmountIndices.has(amountIndex)) {
      seenAmountIndices.add(amountIndex);
      uniqueMatches.push(m);
    }
  }

  if (uniqueMatches.length !== 1) return undefined;
  const m = uniqueMatches[0];
  const whole = m[1].replace(/,/g, '');
  const frac = (m[2] || '').padEnd(2, '0');
  const cents = BigInt(whole) * 100n + BigInt(frac || '0');
  return cents > 0n ? cents : undefined;
}

function extractPayrollAmounts(query: string): { grossCents: bigint; employeeCpfCents: bigint; employerCpfCents: bigint } | undefined {
  const allAmounts = getAllAmounts(query);
  if (allAmounts.length < 3 || allAmounts.length > 5) return undefined;

  const erA = /\bemployer(?:'s|s')?\s+cpf(?:\s+(?:contribution|expense|portion|share))?\s*(?:of|is|was|:|-)?\s*(?:\bSGD\s*|S\$\s*|\$\s*)(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?(?![\d]|,\d|\.\d)/gi;
  const erB = /(?:\bSGD\s*|S\$\s*|\$\s*)(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?(?![\d]|,\d|\.\d)\s*(?:of|for)?\s*employer(?:'s|s')?\s+cpf(?:\s+(?:contribution|expense|portion|share))?\b/gi;
  const employerCpfCents = extractLabelledAmount(query, erA, erB);

  const eeA = /\bemployee(?:'s|s')?\s+cpf(?:\s+(?:contribution|deduction|portion|share))?\s*(?:of|is|was|:|-)?\s*(?:\bSGD\s*|S\$\s*|\$\s*)(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?(?![\d]|,\d|\.\d)/gi;
  const eeB = /(?:\bSGD\s*|S\$\s*|\$\s*)(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?(?![\d]|,\d|\.\d)\s*(?:of|for)?\s*employee(?:'s|s')?\s+cpf(?:\s+(?:contribution|deduction|portion|share))?\b/gi;
  const employeeCpfCents = extractLabelledAmount(query, eeA, eeB);

  const gA = /\b(?:gross\s+(?:salar(?:y|ies)|wages?|pay|payroll)|gross\b|payroll\s+of|(?<!\bnet\s+)(?:salar(?:y|ies)|wages?))\s*(?:of|is|was|:|-)?\s*(?:\bSGD\s*|S\$\s*|\$\s*)(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?(?![\d]|,\d|\.\d)(?:\s+gross\b)?(?!\s+payable\b)/gi;
  const gB = /(?:\bSGD\s*|S\$\s*|\$\s*)(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?(?![\d]|,\d|\.\d)\s*(?:of\s+|for\s+)?(?:gross(?:\s+(?:salar(?:y|ies)|wages?|pay|payroll))?|(?<!\bnet\s+)(?:salar(?:y|ies)|wages?))\b(?!\s+payable\b)/gi;
  const grossCents = extractLabelledAmount(query, gA, gB);

  if (!employerCpfCents || !employeeCpfCents || !grossCents) return undefined;
  if (grossCents <= 0n || employeeCpfCents <= 0n || employerCpfCents <= 0n || employeeCpfCents >= grossCents) return undefined;

  const netA = /\bnet\s+(?:pay|salar(?:y|ies)|wages?)\s*(?:of|is|was|:|-)?\s*(?:\bSGD\s*|S\$\s*|\$\s*)(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?(?![\d]|,\d|\.\d)/gi;
  const netB = /(?:\bSGD\s*|S\$\s*|\$\s*)(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?(?![\d]|,\d|\.\d)\s*(?:of|for)?\s*net\s+(?:pay|salar(?:y|ies)|wages?)\b/gi;
  const netCents = extractLabelledAmount(query, netA, netB);

  const totCpfA = /(?:(?:\b(?:total|combined)\s+cpf)|(?<!\b(?:employee|employer)(?:'s|s')?\s+)\bcpf)(?:\s+(?:contributions?|payable))?\s*(?:of|is|was|:|-)?\s*(?:\bSGD\s*|S\$\s*|\$\s*)(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?(?![\d]|,\d|\.\d)/gi;
  const totCpfB = /(?:\bSGD\s*|S\$\s*|\$\s*)(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?(?![\d]|,\d|\.\d)\s*(?:of\s+|for\s+)?(?:(?:\b(?:total|combined)\s+cpf)|(?<!\b(?:employee|employer)(?:'s|s')?\s+)\bcpf)(?:\s+(?:contributions?|payable))?\b/gi;
  const totalCpfLabelled = extractLabelledAmount(query, totCpfA, totCpfB);

  if (allAmounts.length === 4) {
    const validNet = netCents !== undefined && netCents === grossCents - employeeCpfCents;
    const validCpf = totalCpfLabelled !== undefined && totalCpfLabelled === employeeCpfCents + employerCpfCents;
    if (!validNet && !validCpf) return undefined;
  } else if (allAmounts.length === 5) {
    const validNet = netCents !== undefined && netCents === grossCents - employeeCpfCents;
    const validCpf = totalCpfLabelled !== undefined && totalCpfLabelled === employeeCpfCents + employerCpfCents;
    if (!validNet || !validCpf) return undefined;
  }

  return { grossCents, employeeCpfCents, employerCpfCents };
}

function extractPayrollLiabilitySettlementAmounts(query: string): { salPayableCents: bigint; cpfPayableCents: bigint } | undefined {
  const allAmounts = getAllAmounts(query);
  if (allAmounts.length !== 2 && allAmounts.length !== 3) return undefined;

  const salA = /\b(?:salar(?:y|ies)\s+payable|wages?\s+payable|(?:accrued|previously\s+accrued)\s+(?:net\s+)?(?:salar(?:y|ies)|wages?|pay))\s*(?:of|is|was|:|-)?\s*(?:\bSGD\s*|S\$\s*|\$\s*)(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?(?![\d]|,\d|\.\d)/gi;
  const salB = /(?:\bSGD\s*|S\$\s*|\$\s*)(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?(?![\d]|,\d|\.\d)\s*(?:of\s+|for\s+)?(?:salar(?:y|ies)\s+payable|wages?\s+payable|(?:accrued|previously\s+accrued)\s+(?:net\s+)?(?:salar(?:y|ies)|wages?|pay))\b/gi;
  const salPayableCents = extractLabelledAmount(query, salA, salB);

  const cpfA = /\b(?:cpf\s+payable|(?:accrued|previously\s+accrued)\s+cpf(?:\s+contributions?)?)\s*(?:of|is|was|:|-)?\s*(?:\bSGD\s*|S\$\s*|\$\s*)(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?(?![\d]|,\d|\.\d)/gi;
  const cpfB = /(?:\bSGD\s*|S\$\s*|\$\s*)(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?(?![\d]|,\d|\.\d)\s*(?:of\s+|for\s+)?(?:cpf\s+payable|(?:accrued|previously\s+accrued)\s+cpf(?:\s+contributions?)?)\b/gi;
  const cpfPayableCents = extractLabelledAmount(query, cpfA, cpfB);

  if (!salPayableCents || !cpfPayableCents) return undefined;
  if (salPayableCents <= 0n || cpfPayableCents <= 0n) return undefined;

  if (allAmounts.length === 3) {
    const totalExpected = salPayableCents + cpfPayableCents;
    const hasTotal = allAmounts.some(a => a.cents === totalExpected);
    if (!hasTotal) return undefined;
  }

  return { salPayableCents, cpfPayableCents };
}

function hasAffirmativePayrollSettlementVerb(query: string): boolean {
  const clauses = query.split(/[;.]|\b(?:while|whereas|but|however)\b/i).map(c => c.trim()).filter(Boolean);
  const verbRegex = /\b(?:paid|(?<!\b(?:gross|net|basic|base|overtime|leave|holiday|sick|maternity|paternity|notice|severance|variable|fixed|monthly|staff|employee|total|take[- ]home)\s+)pay|paying|settle[ds]?|settling|settlements?|remit(?:ted|ting|tances?)?|disburse[ds]?|disbursements?|clear(?:ed|ing)?|transfer(?:red|s)?)\b/gi;

  for (const c of clauses) {
    verbRegex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = verbRegex.exec(c)) !== null) {
      const prefix = c.slice(0, match.index);
      const suffix = c.slice(match.index + match[0].length);

      // a) Nominal/determiner negation before match
      const nominalNegation = /\b(?:no|none|without|lack\s+of|absent|zero|non[- ]?)\s*(?:(?:any|further|actual|prior|subsequent|cash|bank|giro|payroll|salary|salaries|wage|wages|cpf|liability|liabilities|payment|payments|settlement|settlements|remittance|remittances|disbursement|disbursements|and|or)\s+){0,5}$/i.test(prefix);

      // b) Verbal/modal negation before match
      const verbalNegation = /\b(?:not|never|n't|cannot|yet\s+to|to\s+be|will|shall|pending|awaiting|before|prior\s+to|unpaid|unsettled)\s+(?:(?:yet|ever|even|actually|fully|partially|be|been|being|have|have\s+been)\s+){0,3}$/i.test(prefix);

      // c) Correlative/clause-leading negation
      const correlativeNegation = /\b(?:neither|nor)\b[\s\S]*$/i.test(prefix) || /^\s*(?:and\s+)?no\s+(?:[\w']+\s+){1,6}$/i.test(prefix);

      // d) Post-nominal negation after match
      const postNominalNegation = /^(?:\s+of\s+(?:the\s+|our\s+|both\s+)?(?:previously\s+|already\s+|last\s+month(?:'s)?\s+|prior[- ]month(?:'s)?\s+)?(?:accrued\s+|payable\s+)?(?:monthly\s+|staff\s+)?(?:payroll|salar(?:y|ies)|wages?|cpf|liabilit(?:y|ies))(?:\s+(?:payable\s+)?and\s+(?:cpf|salar(?:y|ies))(?:\s+payable)?)?)?\s+(?:was\s+not|were\s+not|is\s+not|are\s+not|has\s+not|have\s+not|had\s+not|was\s+never|were\s+never|has\s+never|have\s+never|not\s+(?:yet\s+)?(?:made|done|completed|effected|paid|settled|remitted)|never\s+(?:made|done|completed|paid|settled)|(?:is|are|was|were|remains?)\s+(?:still\s+)?(?:pending|outstanding|unpaid|unsettled))\b/i.test(suffix);

      if (!nominalNegation && !verbalNegation && !correlativeNegation && !postNominalNegation) {
        return true;
      }
    }
  }
  return false;
}

function hasPriorPayrollAccrualContext(query: string): boolean {
  return /\b(?:last\s+(?:month|period|quarter|week|year)(?:'s)?|prior[- ]\s*(?:month|period|quarter|week|year)(?:'s)?|previous\s+(?:month|period|quarter|week|year)(?:'s)?|previously|already|earlier)\b[^.;]*?\b(?:accrue[ds]?|accrual|recogni[sz]ed|recorded|booked)\b/i.test(query)
    || /\b(?:accrue[ds]?|accrual)\b[^.;]*?\b(?:last\s+(?:month|period|quarter|week|year)|in\s+the\s+(?:prior|previous)\s+(?:month|period|quarter|week|year)|previously|earlier)\b/i.test(query);
}

function isPriorPayrollAccrualSettlement(query: string): boolean {
  if (!hasAffirmativePayrollSettlementVerb(query)) return false;

  const directSettlementCue = /\b(?:paid|pay(?:ing)?|settle[ds]?|settling|settlement\s+of|remit(?:ted|ting)?|disburse[ds]?|clear(?:ed|ing)?)\s+(?:the\s+|our\s+|both\s+)?(?:previously\s+|prior[- ]month(?:'s)?\s+|last\s+month(?:'s)?\s+)?(?:accrued|payable)\s+(?:monthly\s+|staff\s+)?(?:payroll|salar(?:y|ies)|wages?|cpf)\b/i.test(query)
    || /\b(?:previously\s+|already\s+)?accrued\s+(?:monthly\s+|staff\s+)?(?:payroll|salar(?:y|ies)|wages?)\b[^.;]*?\b(?:was|were|has\s+been|have\s+been)\s+(?:paid|settled|disbursed|cleared)\b/i.test(query);

  const liabilityAmountsCue = Boolean(extractPayrollLiabilitySettlementAmounts(query));

  return hasPriorPayrollAccrualContext(query) || directSettlementCue || liabilityAmountsCue;
}

function parseNumberWordOrDigits(val: string): number | undefined {
  if (!val) return undefined;
  const cleaned = val.trim().toLowerCase().replace(/-/g, ' ');
  if (/^\d+$/.test(cleaned)) return parseInt(cleaned, 10);
  const words: Record<string, number> = {
    a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5,
    six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11,
    twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
    seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
    'twenty four': 24, thirty: 30, 'thirty six': 36,
    'forty eight': 48, sixty: 60
  };
  return words[cleaned];
}

const NUM_WORD_OR_DIGIT = '(?:\\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|twenty[- ]four|thirty|thirty[- ]six|forty[- ]eight|sixty)';

function parseDurationUnit(countStr: string | undefined, unitStr: string): { family: 'MONTH' | 'DAY'; units: number } | undefined {
  const count = countStr ? parseNumberWordOrDigits(countStr) : 1;
  if (!count || count <= 0) return undefined;
  const unit = unitStr.toLowerCase().replace(/[- ]/g, '');
  if (/^months?$/.test(unit)) return { family: 'MONTH', units: count * 1 };
  if (/^quarters?$/.test(unit)) return { family: 'MONTH', units: count * 3 };
  if (/^(?:halfyears?|semiannual)$/.test(unit)) return { family: 'MONTH', units: count * 6 };
  if (/^years?$/.test(unit)) return { family: 'MONTH', units: count * 12 };
  if (/^weeks?$/.test(unit)) return { family: 'DAY', units: count * 7 };
  if (/^days?$/.test(unit)) return { family: 'DAY', units: count * 1 };
  return undefined;
}

interface PayrollSettlementStatus {
  salaryPaid: boolean;
  cpfPaid: boolean;
  salaryPaymentMethod: 'CASH' | 'BANK' | 'AMBIGUOUS' | 'NONE';
  cpfPaymentMethod: 'CASH' | 'BANK' | 'AMBIGUOUS' | 'NONE';
  isPriorAccrualSettlement: boolean;
}

function mergePayMethod(
  cur: 'CASH' | 'BANK' | 'AMBIGUOUS' | 'NONE',
  next: 'CASH' | 'BANK' | 'AMBIGUOUS' | 'NONE'
): 'CASH' | 'BANK' | 'AMBIGUOUS' | 'NONE' {
  if (cur === 'NONE') return next;
  if (next === 'NONE' || cur === next) return cur;
  return 'AMBIGUOUS';
}

function detectPayMethodInText(text: string): 'CASH' | 'BANK' | 'AMBIGUOUS' | 'NONE' {
  const hasCash = /\b(?:in\s+cash|with\s+cash|by\s+cash|cash\s+payment|cash\s+paid|from\s+petty\s+cash|physical\s+cash)\b/i.test(text);
  const hasBank = /\b(?:by\s+bank|via\s+bank|through\s+bank|from\s+(?:the\s+|our\s+)?bank|bank\s+transfer|bank\s+payment|bank\s+account|by\s+cheque|by\s+check|via\s+giro|by\s+giro|via\s+paynow|by\s+paynow|wire\s+transfer|paid\s+(?:online|electronically))\b/i.test(text);
  if (hasCash && hasBank) return 'AMBIGUOUS';
  if (hasCash) return 'CASH';
  if (hasBank) return 'BANK';
  return 'NONE';
}

function resolvePayrollSettlementStatus(query: string): PayrollSettlementStatus {
  const isPriorAccrualSettlement = isPriorPayrollAccrualSettlement(query);

  let activeText = query;
  if (isPriorAccrualSettlement) {
    const sentences = query.split(/(?<=[.;])\s+/).map(s => s.trim()).filter(Boolean);
    const nonHistoricalSentences = sentences.filter(s => {
      const hasPriorTemporal = /\b(?:last\s+(?:month|period|quarter|week|year)|prior\s+(?:month|period|quarter|week|year)|previous\s+(?:month|period|quarter|week|year)|previously|already|earlier)\b/i.test(s);
      const hasAccrual = /\b(?:accrue[ds]?|accrual|recogni[sz]ed|recorded|booked)\b/i.test(s);
      const hasPayVerb = hasAffirmativePayrollSettlementVerb(s);
      if (hasAccrual && hasPriorTemporal && !hasPayVerb) return false;
      if (hasAccrual && !hasPayVerb) return false;
      return true;
    });
    if (nonHistoricalSentences.length > 0 && nonHistoricalSentences.length < sentences.length) {
      activeText = nonHistoricalSentences.join('; ');
    } else {
      activeText = query.replace(/(?<!\b(?:remains?|still|is|are|was|were)\s+)\b(?:previously\s+|already\s+)?accrued\b/gi, 'existing');
    }
  }

  // 1. Joint phrases
  const jointPaid = /(?<!\b(?:no|without|neither|nor|not|never|to|will|shall|must|should|can)\s+)\b(?:paid|pay(?:ing)?|disburse[ds]?|settle[ds]?|transfer(?:red)?)\s+(?:both\s+)?(?:(?:the|our|monthly|staff|employee|net|gross)\s+)*(?:salar(?:y|ies)|wages?|net\s+pay|payroll)(?:\s+(?:of\s+)?(?:\bSGD\s*|S\$\s*|\$\s*)[\d,.]+)?(?:\s+(?:payable))?(?:\s+(?:in|by|via|with|through)\s+\w+)?\s+and\s+(?:(?:the|our|monthly|employee\s+and\s+employer|combined|total)\s+)*cpf(?:\s+(?:contributions?|payable))?(?:\s+(?:of\s+)?(?:\bSGD\s*|S\$\s*|\$\s*)[\d,.]+)?(?:\s+(?:in|by|via|with|through)\s+\w+)?\b/i.test(activeText)
    || /\b(?:salar(?:y|ies)|wages?|net\s+pay|payroll)(?:\s+payable)?\s+and\s+cpf(?:\s+payable)?\s+(?:were\s+|was\s+|have\s+been\s+|has\s+been\s+|are\s+)?(?!(?:no|not|neither|nor)\b)(?:paid|disbursed|remitted|settled|transferred)\b/i.test(activeText);

  const jointUnpaid = isPriorAccrualSettlement
    ? /(?:(?:salar(?:y|ies)|wages?|net\s+pay|payroll)\s+and\s+cpf|cpf\s+and\s+(?:salar(?:y|ies)|wages?|net\s+pay|payroll))\s+(?:(?:is|are|was|were|remains?|still|have\s+been|has\s+been)\s+)*(?:still\s+)?(?:unpaid|not\s+(?:yet\s+)?(?:paid|settled|remitted)|yet\s+to\s+be\s+(?:paid|settled|remitted))\b/i.test(activeText)
    : (/(?:(?:salar(?:y|ies)|wages?|net\s+pay|payroll)\s+and\s+cpf|cpf\s+and\s+(?:salar(?:y|ies)|wages?|net\s+pay|payroll))\s+(?:(?:is|are|was|were|remains?|still|have\s+been|has\s+been)\s+)*(?:unpaid|outstanding|accrued|payable|owing|due|not\s+(?:yet\s+)?(?:paid|settled|remitted)|yet\s+to\s+be\s+(?:paid|settled|remitted))\b/i.test(activeText)
       || /\b(?:unpaid|outstanding|accrued|accrue|accruing)\s+(?:both\s+)?(?:salar(?:y|ies)|wages?|payroll)\s+and\s+cpf\b/i.test(activeText));

  // 2. Salary-specific status
  const salaryExplicitUnpaid = isPriorAccrualSettlement
    ? /\b(?:(?:monthly|staff|employee|net|gross)\s+)*(?:salar(?:y|ies)|wages?|net\s+pay)\b[^.;]*?\b(?:remains?\s+(?:still\s+)?(?:unpaid|payable|outstanding|accrued)|still\s+(?:unpaid|payable|outstanding|accrued)|not\s+(?:yet\s+)?(?:paid|disbursed|settled|transferred)|yet\s+to\s+be\s+(?:paid|disbursed|settled|transferred))\b/i.test(activeText)
    : (/\b(?:(?:monthly|staff|employee|net|gross)\s+)*(?:salar(?:y|ies)|wages?|net\s+pay)(?:\s+(?:of\s+)?(?:\bSGD\s*|S\$\s*|\$\s*)[\d,.]+)?\s+(?:(?:is|are|was|were|remains?|still|have\s+been|has\s+been)\s+)*(?:still\s+)?(?:unpaid|outstanding|accrued|payable|owing|due|not\s+(?:yet\s+)?(?:paid|disbursed|settled|transferred)|yet\s+to\s+be\s+(?:paid|disbursed|settled|transferred))\b/i.test(activeText)
       || /\b(?:unpaid|outstanding|accrued|accrue|accruing)\s+(?:(?:the|our|monthly|staff|employee|net|gross)\s+)*(?:salar(?:y|ies)|wages?|net\s+pay)\b/i.test(activeText));

  const salaryExplicitPaid = (/(?<!\b(?:no|without|neither|nor|not|never|to|will|shall|must|should|can)\s+)\b(?:paid|pay(?:ing)?|disburse[ds]?|settle[ds]?|transfer(?:red)?)\s+(?:(?:the|our|monthly|staff|employee|net|gross)\s+)*(?:salar(?:y|ies)|wages?|net\s+pay)(?:\s+payable)?\b/i.test(activeText)
    || /(?<!\b(?:no|without|neither|nor|not|never|unpaid|outstanding)\s+)\b(?:(?:monthly|staff|employee|net|gross)\s+)*(?:salar(?:y|ies)|wages?|net\s+pay)(?:\s+payable)?(?:\s+(?:of\s+)?(?:\bSGD\s*|S\$\s*|\$\s*)[\d,.]+)?\s+(?:(?:is|are|was|were|have\s+been|has\s+been|already|also)\s+)*(?!(?:no|not|neither|nor)\b)(?:paid|disbursed|settled|transferred)\b/i.test(activeText))
    && !salaryExplicitUnpaid;

  // 3. CPF-specific status
  const cpfExplicitUnpaid = isPriorAccrualSettlement
    ? /\bcpf\b[^.;]*?\b(?:remains?\s+(?:still\s+)?(?:unpaid|payable|outstanding|accrued)|still\s+(?:unpaid|payable|outstanding|accrued)|not\s+(?:yet\s+)?(?:paid|remitted|settled|transferred)|yet\s+to\s+be\s+(?:paid|remitted|settled|transferred)|to\s+be\s+(?:paid|remitted|settled)(?:\s+later|\s+next\s+\w+)?)\b/i.test(activeText)
    : (/\bcpf(?:\s+(?:contributions?|payable))?(?:\s+(?:of\s+)?(?:\bSGD\s*|S\$\s*|\$\s*)[\d,.]+)?\s+(?:(?:is|are|was|were|remains?|still|have\s+been|has\s+been)\s+)*(?:still\s+)?(?:unpaid|outstanding|accrued|payable|owing|due|not\s+(?:yet\s+)?(?:paid|remitted|settled|transferred)|yet\s+to\s+be\s+(?:paid|remitted|settled|transferred)|to\s+be\s+(?:paid|remitted|settled)(?:\s+later|\s+next\s+\w+)?)\b/i.test(activeText)
       || /\b(?:unpaid|outstanding|accrued|accrue|accruing)\s+(?:(?:the|our|monthly|employee\s+and\s+employer|combined|total)\s+)*cpf(?:\s+contributions?)?\b/i.test(activeText));

  const cpfExplicitPaid = (/(?<!\b(?:no|without|neither|nor|not|never|to|will|shall|must|should|can)\s+)\b(?:paid|pay(?:ing)?|remit(?:ted|ting)?|settle[ds]?|transfer(?:red)?)\s+(?:(?:the|our|monthly|employee\s+and\s+employer|combined|total|both)\s+)*cpf(?:\s+(?:contributions?|payable))?\b/i.test(activeText)
    || /(?<!\b(?:employee|employer)(?:'s|s')?\s+)\bcpf(?:\s+(?:contributions?|payable))?(?:\s+(?:of\s+)?(?:\bSGD\s*|S\$\s*|\$\s*)[\d,.]+)?\s+(?:(?:is|are|was|were|have\s+been|has\s+been|already|also)\s+)*(?!(?:no|not|neither|nor)\b)(?:paid|remitted|settled|transferred)\b/i.test(activeText))
    && !cpfExplicitUnpaid;

  // 4. General payroll status
  const generalPayrollPaid = /(?<!\b(?:no|without|neither|nor|not|never|to|will|shall|must|should|can)\s+)\b(?:paid|pay(?:ing)?|disburse[ds]?|settle[ds]?)\s+(?:the\s+|our\s+)?(?:previously\s+|prior[- ]month(?:'s)?\s+|last\s+month(?:'s)?\s+)?(?:monthly\s+|accrued\s+|existing\s+)?payroll\b/i.test(activeText)
    || /\bpayroll\s+(?:was\s+|were\s+|has\s+been\s+)?(?!(?:no|not|neither|nor)\b)(?:paid|disbursed|settled)\b/i.test(activeText);
  const generalPayrollUnpaid = /\b(?:accrue[ds]?|accrual|unpaid|outstanding)\s+(?:the\s+|our\s+)?(?:monthly\s+)?payroll\b/i.test(activeText)
    || /\bpayroll\s+(?:is\s+|was\s+|remains?\s+)?(?:unpaid|outstanding|accrued)\b/i.test(activeText);

  const hasLiabilitySettlementAmounts = Boolean(extractPayrollLiabilitySettlementAmounts(query));

  const salaryPaid = salaryExplicitUnpaid
    ? false
    : jointUnpaid
      ? false
      : salaryExplicitPaid
        ? true
        : jointPaid
          ? true
          : (isPriorAccrualSettlement && (hasLiabilitySettlementAmounts || generalPayrollPaid))
            ? true
            : generalPayrollUnpaid
              ? false
              : generalPayrollPaid
                ? true
                : false;

  const cpfPaid = cpfExplicitUnpaid
    ? false
    : jointUnpaid
      ? false
      : cpfExplicitPaid
        ? true
        : jointPaid
          ? true
          : (isPriorAccrualSettlement && (hasLiabilitySettlementAmounts || generalPayrollPaid))
            ? true
            : false;

  // 5. Clause-aware payment method
  const rawClauses = activeText.split(/;|\b(?:while|whereas|but)\b|:(?!\d)|\.(?!\d)/i).map(c => c.trim()).filter(Boolean);
  const clauses: string[] = [];
  const statusVerbRegex = /\b(?:paid|pay(?:ing)?|disburse[ds]?|remit(?:ted|ting)?|settle[ds]?|settling|transfer(?:red)?|clear(?:ed|ing)?|(?:is|are|was|were|remains?|still)\s+(?:still\s+)?(?:unpaid|outstanding|accrued|payable|owing|due)|not\s+(?:yet\s+)?(?:paid|settled|remitted))\b/i;

  const intermediateClauses: string[] = [];
  for (const c of rawClauses) {
    if (/,(?!\d)/.test(c)) {
      const commaParts = c.split(/,(?!\d)/).map(s => s.trim()).filter(Boolean);
      const isAmbiguousMethod = detectPayMethodInText(c) === 'AMBIGUOUS';
      const hasMultipleSideVerbs = commaParts.filter(p => statusVerbRegex.test(p)).length >= 2;
      const hasTrailingLegSpecificMethod = commaParts.slice(1).some(p => {
        if (detectPayMethodInText(p) === 'NONE') return false;
        const hasStandaloneCpf = /(?<!\b(?:employee|employer)(?:'s|s')?\s+)\bcpf\b/i.test(p);
        const hasStandaloneSalary = /(?<!\bgross\s+)\b(?:salar(?:y|ies)|wages?|net\s+pay)\b/i.test(p);
        return hasStandaloneCpf !== hasStandaloneSalary;
      });
      if (isAmbiguousMethod || hasMultipleSideVerbs || hasTrailingLegSpecificMethod) {
        intermediateClauses.push(...commaParts);
      } else {
        intermediateClauses.push(c);
      }
    } else {
      intermediateClauses.push(c);
    }
  }

  for (const c of intermediateClauses) {
    if (/\band\b/i.test(c)) {
      const parts = c.split(/\band\b/i).map(s => s.trim()).filter(Boolean);
      const isAmbiguousMethod = detectPayMethodInText(c) === 'AMBIGUOUS';
      const hasMultipleSideVerbs = parts.filter(p => statusVerbRegex.test(p)).length >= 2;
      if (isAmbiguousMethod || hasMultipleSideVerbs) {
        clauses.push(...parts);
      } else {
        clauses.push(c);
      }
    } else {
      clauses.push(c);
    }
  }

  let salaryPaymentMethod: 'CASH' | 'BANK' | 'AMBIGUOUS' | 'NONE' = 'NONE';
  let cpfPaymentMethod: 'CASH' | 'BANK' | 'AMBIGUOUS' | 'NONE' = 'NONE';

  for (const c of clauses) {
    const m = detectPayMethodInText(c);
    if (m === 'NONE') continue;

    const mentionsSalary = /\b(?:salar(?:y|ies)|wages?|net\s+pay)\b/i.test(c);
    const mentionsCpf = /\bcpf\b/i.test(c);
    const mentionsPayroll = /\bpayroll\b/i.test(c);
    const mentionsBoth = /\b(?:both|all)\b/i.test(c);

    if ((mentionsSalary || mentionsPayroll) && mentionsCpf) {
      if (salaryPaid) salaryPaymentMethod = mergePayMethod(salaryPaymentMethod, m);
      if (cpfPaid) cpfPaymentMethod = mergePayMethod(cpfPaymentMethod, m);
    } else if (mentionsSalary && !mentionsCpf) {
      if (salaryPaid) salaryPaymentMethod = mergePayMethod(salaryPaymentMethod, m);
    } else if (mentionsCpf && !mentionsSalary) {
      if (cpfPaid) cpfPaymentMethod = mergePayMethod(cpfPaymentMethod, m);
    } else if (mentionsBoth) {
      if (salaryPaid) salaryPaymentMethod = mergePayMethod(salaryPaymentMethod, m);
      if (cpfPaid) cpfPaymentMethod = mergePayMethod(cpfPaymentMethod, m);
    } else if (mentionsPayroll) {
      if (salaryPaid && cpfPaid && (jointPaid || generalPayrollPaid || hasLiabilitySettlementAmounts)) {
        salaryPaymentMethod = mergePayMethod(salaryPaymentMethod, m);
        cpfPaymentMethod = mergePayMethod(cpfPaymentMethod, m);
      } else if (salaryPaid && !cpfPaid) {
        salaryPaymentMethod = mergePayMethod(salaryPaymentMethod, m);
      } else if (cpfPaid && !salaryPaid) {
        cpfPaymentMethod = mergePayMethod(cpfPaymentMethod, m);
      }
    } else {
      // Unattached method clause (e.g. trailing ", by bank transfer")
      if (salaryPaid && !cpfPaid && salaryPaymentMethod === 'NONE') {
        salaryPaymentMethod = mergePayMethod(salaryPaymentMethod, m);
      } else if (cpfPaid && !salaryPaid && cpfPaymentMethod === 'NONE') {
        cpfPaymentMethod = mergePayMethod(cpfPaymentMethod, m);
      } else if (salaryPaid && cpfPaid && (jointPaid || generalPayrollPaid || hasLiabilitySettlementAmounts) && salaryPaymentMethod === 'NONE' && cpfPaymentMethod === 'NONE') {
        salaryPaymentMethod = mergePayMethod(salaryPaymentMethod, m);
        cpfPaymentMethod = mergePayMethod(cpfPaymentMethod, m);
      }
    }
  }

  if (cpfPaid && cpfPaymentMethod === 'NONE' && !salaryPaid && /\bcpf\s+board\b/i.test(activeText)) {
    cpfPaymentMethod = 'BANK';
  }

  return { salaryPaid, cpfPaid, salaryPaymentMethod, cpfPaymentMethod, isPriorAccrualSettlement };
}

function hasStatutoryPayrollCalcCues(query: string): boolean {
  return /\b(?:cpf|calculat\w*|comput\w*|how\s+much|what\s+is\s+(?:his|her|the)|years?\s+old|\baged?\s+\d+|singaporean|citizen|permanent\s+resident|\bpr\b|foreign\w*|work\s+permit|employment\s+pass|\bs\s+pass\b|\bep\s+holder\b|last\s+day|prorat\w*|resign\w*|incomplete\s+month|earning|earns|ordinary\s+wage|aw\s+ceiling|sdl|skills\s+development|employment\s+act|overtime|\bmom\b|\d+\s*k\s*(?:a\s+month|\/month|monthly|per\s+month))\b/i.test(query);
}

function isAccruedExpenseSettlement(query: string): boolean {
  return /\b(?:previously\s+accrued|accrued\s+(?:last|previous|prior)\s+(?:month|quarter|period|year)|(?:paid|pay|settle[ds]?|settling|clear(?:ed)?)\s+(?:the\s+|an?\s+|our\s+)?(?:previously\s+)?accrued\b|accrued\s+(?:[\w\s]{1,25}?)\s+(?:was|were)\s+(?:paid|settled))\b/i.test(query)
    && !/\b(?:salar(?:y|ies)|wages?|payroll|cpf)\b/i.test(query);
}

function isAssetValueAmount(query: string): boolean {
  const assetLabelPattern1 = /\b(?:cost(?:ing|s)?|carrying\s+(?:amount|value)|(?:net\s+)?book\s+value|\bnbv\b|\bwdv\b|written[- ]down\s+value|purchase\s+price|acquisition\s+(?:cost|price)|invoice\s+(?:price|value)|list\s+price|fair\s+value|market\s+value|valuation|valued(?:\s+at)?|worth|capitali[sz]ed(?:\s+at|\s+amount|\s+cost)?|(?:acquired|purchased|bought)(?:\s+[\w-]+){0,5}?\s+(?:for|at))\s*(?:of|is|was|at|:|=|-)?\s*(?:\bSGD\s*|S\$\s*|\$\s*)\d/i;
  const assetLabelPattern2 = /(?:\bSGD\s*|S\$\s*|\$\s*)\d[\d,.]*\s*(?:in\s+)?(?:cost|carrying\s+(?:amount|value)|(?:net\s+)?book\s+value|\bnbv\b|\bwdv\b|purchase\s+price|valuation)\b/i;
  if (assetLabelPattern1.test(query) || assetLabelPattern2.test(query)) {
    return true;
  }

  const amountBeforeAsset = /(?:\bSGD\s*|S\$\s*|\$\s*)\d[\d,.]*\s+(?:of\s+)?(?:machinery|machines?|equipment|office\s+equipment|computer\s+equipment|computers?|laptops?|servers?|motor\s+vehicles?|vehicles?|vans?|trucks?|lorr(?:y|ies)|furniture|fittings|ppe|plant|assets?|intangible\s+assets?|intangibles?|software(?:\s+licen[cs]es?)?|licen[cs]es?|patents?|trademarks?|copyrights?|franchises?)\b/i;
  if (amountBeforeAsset.test(query)) {
    return true;
  }

  const assetBeforeAmount = /\b(?:machinery|machines?|equipment|office\s+equipment|computer\s+equipment|computers?|laptops?|servers?|motor\s+vehicles?|vehicles?|vans?|trucks?|lorr(?:y|ies)|furniture|fittings|ppe|plant|intangible\s+assets?|software(?:\s+licen[cs]es?)?|licen[cs]es?|patents?|trademarks?|copyrights?|franchises?)\s*(?:of|is|was|at|:|-|\()\s*(?:\bSGD\s*|S\$\s*|\$\s*)\d/i.test(query)
    && !/\b(?:depreciation|amortisation|amortization)\s+(?:charge|expense)\b[\s\S]*?(?:\bSGD|S\$|\$)/i.test(query)
    && !/\b(?:depreciation|amortisation|amortization)\s+of\s+(?:[\w\s]+?\s+)?of\s+(?:\bSGD|S\$|\$)/i.test(query);
  if (assetBeforeAmount) {
    return true;
  }

  if (/\b\d+(?:\.\d+)?\s*%/.test(query) || /\b(?:residual|salvage|scrap|useful\s+life)\b/i.test(query)) {
    return true;
  }

  return false;
}

function hasExplicitIncomeTaxTarget(query: string): boolean {
  return /\b(?:(?:current|corporate|company)\s+(?:income\s+)?tax(?:\s+payable|\s+liability|\s+assessment|\s+bill|\s+instalment)?|income\s+tax(?:\s+payable|\s+liability|\s+assessment|\s+bill|\s+instalment)?|prepaid\s+(?:corporate\s+|current\s+|company\s+)?(?:income\s+)?tax|advance\s+(?:corporate\s+|current\s+|company\s+)?(?:income\s+)?tax|iras\s+(?:corporate\s+|income\s+|current\s+)tax(?:\s+bill|\s+assessment|\s+payable)?|estimated\s+chargeable\s+income|\beci\b(?:\s+(?:tax|instalment|payment|assessment))?)\b/i.test(query);
}

function hasUnspecifiedIrasOrTaxPaymentTarget(query: string): boolean {
  return !hasExplicitIncomeTaxTarget(query) && getAllAmounts(query).length > 0 && /\b(?:(?:pay|paid|paying|remit(?:ted|ting)?|settle[ds]?|transferred)\s+(?:(?:\bSGD\s*|S\$\s*|\$\s*)[\d,.]+\s+)?(?:to\s+)?iras\b|iras\s+(?:tax\s+)?(?:bill|assessment|payment|payable)|(?<!\b(?:current|corporate|company|income|deferred|property|withholding|input|output)\s)tax\s+(?:payable|bill|assessment)(?:\s+to\s+iras)?)\b/i.test(query);
}

function isPayrollAccrual(query: string): boolean {
  if (/\b(?:calculat\w*|comput\w*|how\s+much|what\s+is\s+(?:his|her|the)\s+(?:cpf|salary|prorat\w*)|years?\s+old|\baged?\s+\d+|singaporean|citizen|permanent\s+resident|\bpr\b|foreigner|work\s+permit|employment\s+pass|\bs\s+pass\b|last\s+day|prorat\w*|resign\w*|incomplete\s+month|ordinary\s+wage|aw\s+ceiling|cpf\s+ceiling|cpf\s+rate|skills\s+development\s+levy|\bsdl\b)\b/i.test(query)) {
    return false;
  }
  return Boolean(extractPayrollAmounts(query)) || Boolean(extractPayrollLiabilitySettlementAmounts(query));
}

function isPayrollNetPaySettlement(query: string): boolean {
  const paymentVerb = /\b(?:pay|paid|paying|settle[ds]?|settling|settlement|disburse[ds]?|transfer(?:red)?|remit(?:ted)?)\b/i.test(query);
  const target = /\b(?:net\s+(?:salar(?:y|ies)|wages?|pay|payroll)|salar(?:y|ies)\s+payable|wages?\s+payable|accrued\s+(?:salar(?:y|ies)|wages?)|staff\s+salaries\s+payable)\b/i.test(query);
  const notCpfOrCalc = !/\b(?:cpf|gross\s+(?:salar(?:y|ies)|wages?|pay)|calculat\w*|comput\w*|how\s+much|years?\s+old|singaporean|\bpr\b|last\s+day|prorat\w*|resign\w*|employment\s+act|salary\s+deadline)\b/i.test(query);
  return paymentVerb && target && notCpfOrCalc;
}

function isCpfRemittance(query: string): boolean {
  const paymentVerb = /\b(?:pay|paid|paying|remit(?:ted|ting|tance)?|settle[ds]?|settling|settlement|transfer(?:red)?)\b/i.test(query);
  const target = /\b(?:cpf\s+(?:payable|liability)|(?:accrued\s+)?cpf\s+(?:liability|contributions?|payable)|cpf\s+to\s+(?:the\s+)?cpf\s+board|(?:the\s+)?cpf\s+board)\b/i.test(query);
  const notAccrualOrCalc = !/\b(?:gross\s+(?:salar(?:y|ies)|wages?)|earning|earns|years?\s+old|singaporean|\bpr\b|last\s+day|prorat\w*|resign\w*|calculat\w*|comput\w*|how\s+much|cpf\s+ceiling|ordinary\s+wage|aw\s+ceiling|cpf\s+rate|senior\s+worker|deadline|late\s+payment)\b/i.test(query);
  return paymentVerb && target && notAccrualOrCalc;
}

function isPrepaidExpenseRecognition(query: string): boolean {
  const hasPrepaid = /\bprepaid\s+(?:rent|rental|insurance|expenses?|subscriptions?|maintenance|advertising|fees?)\b/i.test(query);
  if (!hasPrepaid) return false;

  const hasPaymentMethodOrPurchaseCue = /\b(?:in\s+cash|with\s+cash|by\s+cash|cash\s+payment|cash\s+paid|from\s+petty\s+cash|physical\s+cash|by\s+bank|via\s+bank|through\s+bank|from\s+(?:the\s+|our\s+)?bank|bank\s+transfer|bank\s+payment|bank\s+account|by\s+cheque|by\s+check|via\s+giro|by\s+giro|via\s+paynow|by\s+paynow|wire\s+transfer|paid\s+(?:online|electronically)|on\s+(?:(?:\d+\s*[-–]?\s*days?\s+)?credit|account))\b/i.test(query)
    || /\b(?:purchased?|bought|acquired?|(?:pay|paid|paying)(?:\s+for)?)\s+(?:an?\s+|the\s+|our\s+)?(?:annual\s+|yearly\s+|semi[- ]annual\s+|quarterly\s+|(?:\d+|one|two|three|six|twelve)[- ](?:month|year|quarter|week|day)\s+)?prepaid\b/i.test(query);

  const hasUnambiguousExpiryOrExpenseTarget = /\b(?:expir(?:ed|es|ing)|consum(?:ed|es|ing)|used(?:\s+up)?(?!\s+(?:for|in|by|at|on)\b)|elaps(?:ed|es)|amorti[sz](?:e|ed|es|ing|ation)|releas(?:e|ed|es|ing)|adjust(?:ing|ment))\b/i.test(query)
    || /\b(?:quarterly|monthly|half[- ]yearly|semi[- ]annual)\s+(?:adjustment|recognition|charge|expense)\b/i.test(query)
    || /\b(?:recogni[sz]\w*|record\w*|book\w*|post\w*|charg\w*)\s+(?:the\s+|an?\s+|our\s+)?(?:monthly\s+|quarterly\s+|annual\s+|periodic\s+)?(?:rent|rental|insurance|subscription|maintenance|advertising|operating)\s+expenses?\b/i.test(query)
    || /\b(?:recogni[sz]\w*|record\w*|book\w*|post\w*|releas\w*|transfer\w*)[\s\S]*?\bas\s+(?:an?\s+)?(?:[\w\s]+?\s+)?expense\b/i.test(query)
    || /\b(?:stated|clarified)\s+periodic\s+charge\s+is\b/i.test(query);

  return hasUnambiguousExpiryOrExpenseTarget || (!hasPaymentMethodOrPurchaseCue && /\bfor\s+the\s+(?:month|quarter|half[- ]year)\b/i.test(query));
}

function isDepOrAmortOnPreviouslyAcquiredAsset(query: string): boolean {
  return /\b(?:record|recogni[sz]\w*|book|post|journal(?:\s+entry)?\s+for)\b[\s\S]*?\b(?:depreciat\w*|amorti[sz]\w*)\b[\s\S]*?\b(?:purchas\w*|bought|acquir\w*)\b/i.test(query)
    && !/\b(?:trade[- ]?in|by\s+bank|in\s+cash|on\s+credit|bank\s+transfer|list\s+price|trade\s+discount)\b/i.test(query);
}

function isDepreciationCharge(query: string): boolean {
  if (!/\bdepreciat(?:e|ed|ing|ion)\b/i.test(query)) return false;
  const hasBookingCue = /\b(?:record|recogni[sz](?:e|ed|ing)|book|post|charge[ds]?|expense|journal|double\s+entry|debit|credit|for\s+the\s+(?:year|month|quarter|period)|annual|monthly|quarterly|half[- ]yearly|semi[- ]annual(?:ly)?|for\s+(?:the\s+)?(?:\d+|a|an|one|two|three|four|six|twelve)\s*[- ]?(?:years?|quarters?|half[- ]years?|months?))\b/i.test(query);
  if (!hasBookingCue) return false;
  const hasAcquisitionVerb = /\b(?:purchas\w*|bought|acquir\w*|acquisition)\b/i.test(query) && !isDepOrAmortOnPreviouslyAcquiredAsset(query);
  const isPpeOtherExclusions = /\b(?:trade[- ]?in|dispos\w*|derecogni\w*|sold|sale\s+of|scrapp\w*|rou\b|right[- ]of[- ]use|lease\w*|revalu\w*|impair\w*|capital\s+allowances?|section\s+19\w*|s[\s-]?plate|passenger\s+car|tax\s+depreciation|deferred\s+tax|add[- ]?back|tax\s+deduct\w*|deductible)\b/i.test(query);
  return !hasAcquisitionVerb && !isPpeOtherExclusions;
}

function isAmortisationCharge(query: string): boolean {
  if (!/\bamorti[sz](?:e|ed|ing|ation)\b/i.test(query)) return false;
  const hasIntangibleCue = /\b(?:intangible|software|licen[cs]es?|patents?|trademarks?|copyrights?|customer\s+lists?|franchises?|development\s+costs?)\b/i.test(query);
  if (!hasIntangibleCue) return false;
  const hasAcquisitionVerb = /\b(?:purchas\w*|bought|acquir\w*|acquisition)\b/i.test(query) && !isDepOrAmortOnPreviouslyAcquiredAsset(query);
  const isExcluded = /\b(?:prepaid|amorti[sz]ed\s+cost|loan|bond|lease|unexpired\s+interest|capitali[sz]\w*|dispos\w*|impair\w*|research\s+phase|section\s+14\w*|\beis\b)\b/i.test(query);
  return !hasAcquisitionVerb && !isExcluded;
}

function isCurrentTaxProvision(query: string): boolean {
  const hasBookingCue = /\b(?:record|recogni[sz](?:e|ed|ing)|book|post|make|create|prepare|journal|double\s+entry|debit|credit)\b/i.test(query);
  const hasTaxProvisionCue = /\b(?:provision\s+for\s+(?:income|corporate|current)\s+tax|(?:current|income|corporate)\s+tax\s+(?:provision|expense|charge)|tax\s+provision)\b/i.test(query);
  if (!hasBookingCue || !hasTaxProvisionCue) return false;
  const isExcluded = /\b(?:deferred\s+tax|gst|withholding|wht|property\s+tax|stamp\s+duty|form\s+c(?:-s|\b)|section\s+\d+|sute|pte|corporate\s+tax\s+rate|tax\s+deduct\w*|deductible|paid|settled|remitted)\b/i.test(query);
  return !isExcluded;
}

function isCurrentTaxPayment(query: string): boolean {
  const hasPaymentVerb = /\b(?:pay|paid|paying|prepaid|prepay(?:ing|ment)?|settle[ds]?|settling|settlement|remit(?:ted|ting)?|transferred)\b/i.test(query);
  if (!hasPaymentVerb) return false;
  if (!hasExplicitIncomeTaxTarget(query) && !hasUnspecifiedIrasOrTaxPaymentTarget(query)) return false;
  const isExcluded = /\b(?:gst|withholding|wht|property\s+tax|stamp\s+duty|deferred\s+tax|penalt\w*|fine|deadline|due\s+date|when\s+(?:must|is|should)|how\s+(?:do|to|is)|what\s+is|can\s+(?:i|we)|deduct\w*|section\s+\d+|form\s+c|provision\s+for)\b/i.test(query);
  return !isExcluded;
}

function isDeferredTaxMovement(query: string): boolean {
  const hasBookingCue = /\b(?:record|recogni[sz](?:e|ed|ing)|book|post|increase[ds]?|decreas(?:e|ed|ing)|revers(?:e|ed|ing|al)|reduc(?:e|ed|es|ing|tion)|write[- ]?down|derecogni[sz](?:e|ed|ing)|utili[sz](?:e|ed|ing|ation)|create|journal|double\s+entry|debit|credit|adjust(?:ment)?|movement)\b/i.test(query);
  const hasDeferredTaxCue = /\bdeferred\s+tax(?:\s+(?:liabilit(?:y|ies)|assets?))?\b/i.test(query);
  if (!hasBookingCue || !hasDeferredTaxCue) return false;
  const isExcluded = /\b(?:tax\s+depreciation|accelerated\s+depreciation|accelerated\s+write[- ]?off|capital\s+allowances?|section\s+19\w*|how\s+are|what\s+is|explain)\b/i.test(query);
  return !isExcluded;
}

function resolveCurrentTaxAmount(query: string): { cents?: bigint; missing?: MissingFieldInfo } {
  const currentTaxOverride = query.match(/\bstated\s+current\s+tax\s+amount\s+is\s+(?:\bSGD\s*|S\$\s*|\$\s*)(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?(?![\d]|,\d|\.\d)/i);
  if (currentTaxOverride) {
    const w = currentTaxOverride[1].replace(/,/g, '');
    const f = (currentTaxOverride[2] || '').padEnd(2, '0');
    const cents = BigInt(w) * 100n + BigInt(f || '0');
    if (cents > 0n) return { cents };
  }

  const allAmounts = getAllAmounts(query);
  const taxMatchA = /(?:provision\s+for\s+(?:income|corporate|current)\s+tax|(?:current|income|corporate)\s+tax(?:\s+(?:provision|expense|charge))?|tax\s+provision)\s+(?:for\s+the\s+year\s+)?(?:of\s+|is\s+|was\s+)?(?:\bSGD\s*|S\$\s*|\$\s*)(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?(?![\d]|,\d|\.\d)/gi;
  const taxMatchB = /(?:\bSGD\s*|S\$\s*|\$\s*)(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?(?![\d]|,\d|\.\d)\s+(?:for\s+)?(?:provision\s+for\s+(?:income|corporate|current)\s+tax|(?:current|income|corporate)\s+tax(?:\s+(?:provision|expense|charge))?|tax\s+provision)\b/gi;
  const labelledTaxCents = extractLabelledAmount(query, taxMatchA, taxMatchB);
  if (labelledTaxCents) {
    return { cents: labelledTaxCents };
  }

  if (allAmounts.length === 1 && !/\b(?:profit|pbt|chargeable\s+income|taxable\s+income|earnings|revenue)\b/i.test(query) && !/\b\d+(?:\.\d+)?\s*%/.test(query)) {
    return { cents: allAmounts[0].cents };
  }

  return {
    missing: need(
      'taxAmount',
      'Current tax amount',
      'What is the determined current income tax amount in SGD? Corporate income tax cannot be computed directly from accounting profit without statutory tax adjustments, capital allowances, and exemptions.'
    )
  };
}

function resolveCurrentTaxPaymentDetails(query: string): {
  isSplit?: boolean;
  paidCents?: bigint;
  liabilityCents?: bigint;
  prepaidAssetCents?: bigint;
  noExistingLiability?: boolean;
  advanceOrInstalmentCue?: boolean;
  existingLiabilityConfirmed?: boolean;
  cents?: bigint;
  missing?: MissingFieldInfo;
} {
  const noExistingLiability = /\b(?:no\s+(?:(?:existing|prior|current|recorded|recogni[sz]ed|accrued)\s+)?(?:(?:corporate|income|current|company)\s+)?tax\s+(?:liability|payable|provision|obligation)|without\s+(?:an?\s+)?(?:existing|prior)\s+(?:(?:corporate|income|current|company)\s+)?tax\s+(?:liability|payable|provision)|before\s+(?:any\s+)?(?:(?:corporate|income|current|company)\s+)?tax\s+(?:liability|provision)\s+(?:is\s+|has\s+been\s+)?(?:recogni[sz]ed|recorded|accrued)|(?:current\s+|existing\s+)?tax\s+(?:liability|payable)\s+is\s+(?:nil|zero|0))\b/i.test(query);

  const existingLiabilityConfirmed = /\b(?:settl(?:e[ds]?|ing)\s+(?:the\s+|an?\s+|our\s+)?(?:existing|accrued|recogni[sz]ed|recorded|assessed)\s+(?:(?:current|income|corporate|company)\s+)?tax(?:\s+(?:payable|liability|provision|assessment|bill))?|against\s+(?:an?\s+|the\s+)?(?:existing|accrued|recorded)\s+(?:(?:current|income|corporate|company)\s+)?tax\s+(?:payable|liability|provision))\b/i.test(query);

  const advanceOrInstalmentCue = /\b(?:advance\s+(?:payment|tax|(?:(?:corporate|income|current|company)\s+)+tax|instalment)|paid?\s+(?:[\w\s]{0,30}?\s+)?in\s+advance|prepaid\s+(?:(?:corporate|current|company)\s+)?(?:income\s+)?tax|prepay(?:ing|ment)?\s+(?:of\s+)?(?:(?:corporate|current|company)\s+)?(?:income\s+)?tax|estimated\s+chargeable\s+income|\beci\b(?:\s+(?:tax|instalment|payment|assessment))?|provisional\s+(?:tax|instalment))\b/i.test(query);

  const paidMatch = query.match(/\b(?:pay|paid|paying|remit(?:ted|ting)?|transferred|settle[ds]?)\s+(?:corporate\s+|income\s+|current\s+|company\s+)?(?:income\s+)?tax(?:\s+of)?\s*(?:\bSGD\s*|S\$\s*|\$\s*)(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?/i);
  const liabMatch = query.match(/\b(?:against\s+(?:an?\s+|the\s+)?(?:existing\s+)?(?:current\s+tax\s+payable|tax\s+payable|tax\s+liability)(?:\s+balance)?(?:\s+of)?|existing\s+(?:current\s+tax\s+payable|tax\s+payable|tax\s+liability)(?:\s+balance)?\s*(?:of|is|was|:|-)?)\s*(?:\bSGD\s*|S\$\s*|\$\s*)(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?/i);

  if (paidMatch && liabMatch) {
    const paidCents = BigInt(paidMatch[1].replace(/,/g, '')) * 100n + BigInt((paidMatch[2] || '').padEnd(2, '0'));
    const liabilityCents = BigInt(liabMatch[1].replace(/,/g, '')) * 100n + BigInt((liabMatch[2] || '').padEnd(2, '0'));

    if (paidCents > liabilityCents && liabilityCents > 0n) {
      return {
        isSplit: true,
        paidCents,
        liabilityCents,
        prepaidAssetCents: paidCents - liabilityCents
      };
    }
    if (paidCents <= liabilityCents && paidCents > 0n) {
      return { cents: paidCents };
    }
  }

  const resAmt = resolveCurrentTaxAmount(query);
  if (resAmt.missing) {
    return { missing: resAmt.missing };
  }

  return {
    cents: resAmt.cents,
    noExistingLiability,
    advanceOrInstalmentCue,
    existingLiabilityConfirmed
  };
}

function resolveDeferredTaxAmount(query: string): { cents?: bigint; missing?: MissingFieldInfo } {
  const dtOverride = query.match(/\bstated\s+deferred\s+tax\s+amount\s+is\s+(?:\bSGD\s*|S\$\s*|\$\s*)(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?(?![\d]|,\d|\.\d)/i);
  if (dtOverride) {
    const w = dtOverride[1].replace(/,/g, '');
    const f = (dtOverride[2] || '').padEnd(2, '0');
    const cents = BigInt(w) * 100n + BigInt(f || '0');
    if (cents > 0n) return { cents };
  }

  const allAmounts = getAllAmounts(query);
  const taxMatchA = /(?:deferred\s+tax(?:\s+(?:liabilit(?:y|ies)|assets?|movement|adjustment))?|\bdtl\b|\bdta\b)\s+(?:in\s+(?:profit\s+or\s+loss|equity|oci|other\s+comprehensive\s+income)\s+)?(?:of\s+|is\s+|was\s+|by\s+)?(?:\bSGD\s*|S\$\s*|\$\s*)(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?(?![\d]|,\d|\.\d)/gi;
  const taxMatchB = /(?:\bSGD\s*|S\$\s*|\$\s*)(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?(?![\d]|,\d|\.\d)\s+(?:of\s+|for\s+|in\s+)?(?:deferred\s+tax(?:\s+(?:liabilit(?:y|ies)|assets?))?|\bdtl\b|\bdta\b)\b/gi;
  const labelledDtCents = extractLabelledAmount(query, taxMatchA, taxMatchB);
  if (labelledDtCents) {
    return { cents: labelledDtCents };
  }

  if (
    allAmounts.length === 1 &&
    !/\btemporary\s+differences?\b/i.test(query) &&
    !/\b\d+(?:\.\d+)?\s*%/.test(query) &&
    !/(?:\b(?:revaluation(?:\s+surplus|\s+gain|\s+reserve)?|share\s+issu(?:e|ance)\s+costs?|equity\s+transaction\s+costs?|fair\s+value\s+(?:gain|loss|reserve)|convertible\s+(?:bond|debt|note)|opening\s+retained\s+earnings)\s+(?:of|is|was)\s+(?:\bSGD|S\$|\$))/i.test(query)
  ) {
    return { cents: allAmounts[0].cents };
  }

  return {
    missing: need('taxAmount', 'Deferred tax movement amount', 'What is the SGD deferred tax movement amount to recognise?')
  };
}

function extractDepAmortUsefulLifeAndPeriod(query: string): { usefulLifeMonths?: bigint; periodMonths?: bigint } {
  let usefulLifeMonths: bigint | undefined;
  let periodMonths: bigint | undefined;
  let maskedQuery = query;

  const ulPat1 = new RegExp('\\b(?:useful|economic|service|expected|estimated|licen[cs]e|patent|contract)\\s+(?:life|term|period)\\s+(?:of\\s+|is\\s+|was\\s+)?(' + NUM_WORD_OR_DIGIT + ')\\s*[- ]?\\s*(years?|quarters?|half[- ]years?|months?)(?!\\s+ago\\b)', 'i');
  const ulPat2 = new RegExp('(?<![\\w-])(' + NUM_WORD_OR_DIGIT + ')[- ](year|quarter|half[- ]year|month)s?\\s+(?:useful\\s+life|economic\\s+life|service\\s+life|life|term|software(?:\\s+licen[cs]e)?|licen[cs]e|patent|trademark|copyright|franchise|intangible(?:\\s+asset)?)(?!\\s+ago\\b)', 'i');
  const ulPat3 = new RegExp('\\b(?:depreciat\\w*|amorti[sz]\\w*)(?:\\s+straight[- ]line)?\\s+over\\s+(?:a\\s+|an\\s+|its\\s+)?(' + NUM_WORD_OR_DIGIT + ')\\s*[- ]?\\s*(years?|quarters?|half[- ]years?|months?)(?!\\s+ago\\b)', 'i');
  const ulPat4 = new RegExp('\\bover\\s+(?:a\\s+period\\s+of\\s+|an?\\s+)?(' + NUM_WORD_OR_DIGIT + ')\\s*[- ]?\\s*(years?|quarters?|half[- ]years?|months?)(?!\\s+ago\\b)', 'i');

  const m1 = query.match(ulPat1);
  const m2 = !m1 ? query.match(ulPat2) : null;
  const m3 = !m1 && !m2 ? query.match(ulPat3) : null;
  const m4 = !m1 && !m2 && !m3 ? query.match(ulPat4) : null;
  const ulMatch = m1 || m2 || m3 || m4;

  if (ulMatch) {
    const countStr = ulMatch[1];
    const unitStr = ulMatch[2];
    const parsed = parseDurationUnit(countStr, unitStr);
    if (parsed && parsed.family === 'MONTH') {
      usefulLifeMonths = BigInt(parsed.units);
      maskedQuery = query.replace(ulMatch[0], ' '.repeat(ulMatch[0].length));
    }
  } else {
    const fb = query.match(new RegExp('\\b(?:with|has|having)\\s+(?:a\\s+|an\\s+)?(' + NUM_WORD_OR_DIGIT + ')\\s*[- ]?\\s*(years?|quarters?|half[- ]years?|months?)\\s+(?:useful\\s+)?life\\b', 'i'));
    if (fb) {
      const parsed = parseDurationUnit(fb[1], fb[2]);
      if (parsed && parsed.family === 'MONTH') {
        usefulLifeMonths = BigInt(parsed.units);
        maskedQuery = query.replace(fb[0], ' '.repeat(fb[0].length));
      }
    }
  }

  // Step 2: period from maskedQuery
  const perPat1 = new RegExp('\\b(?:for|covering)\\s+(?:the\\s+(?:first|past|last|current|next)\\s+)?(' + NUM_WORD_OR_DIGIT + ')\\s*[- ]?\\s*(years?|quarters?|half[- ]years?|months?)(?!\\s+ago\\b)', 'i');
  const perPat2 = new RegExp('(?<![\\w-])(' + NUM_WORD_OR_DIGIT + ')[- ](year|quarter|half[- ]year|month)s?(?:\'s|s\')?(?:\\s+of)?\\s+(?:straight[- ]line\\s+)?(?:depreciation|amorti[sz]ation|charge|expense)\\b', 'i');

  const pm1 = maskedQuery.match(perPat1);
  const pm2 = !pm1 ? maskedQuery.match(perPat2) : null;
  const pMatch = pm1 || pm2;

  if (pMatch) {
    const parsed = parseDurationUnit(pMatch[1], pMatch[2]);
    if (parsed && parsed.family === 'MONTH') {
      periodMonths = BigInt(parsed.units);
    }
  }

  if (periodMonths === undefined) {
    if (/\b(?:half[- ]yearly|semi[- ]annual(?:ly)?|for\s+(?:a|an|one|1|the)\s+half[- ]year|six[- ]month|6[- ]month)\b/i.test(maskedQuery)) {
      periodMonths = 6n;
    } else if (/\b(?:annual(?:ly)?|(?<!half[- ])yearly|full[- ]year|per\s+(?:annum|year)|for\s+(?:a|an|one|1|the)\s+year|one[- ]year|1[- ]year)\b/i.test(maskedQuery)) {
      periodMonths = 12n;
    } else if (/\b(?:quarterly|per\s+quarter|for\s+(?:a|an|one|1|the)\s+quarter|one[- ]quarter|1[- ]quarter|(?:first|second|third|fourth|q[1-4])[- ]quarter)\b/i.test(maskedQuery)) {
      periodMonths = 3n;
    } else if (/\b(?:monthly|per\s+month|for\s+(?:a|an|one|1|the)\s+month|one[- ]month|1[- ]month)\b/i.test(maskedQuery)) {
      periodMonths = 1n;
    }
  }

  return { usefulLifeMonths, periodMonths };
}

function extractPrepaidElapsedAndCoverage(query: string): {
  elapsed?: { family: 'MONTH' | 'DAY'; units: number; matchStr?: string };
  coverage?: { family: 'MONTH' | 'DAY'; units: number };
} {
  let elapsed: { family: 'MONTH' | 'DAY'; units: number; matchStr?: string } | undefined;

  const elPat1 = new RegExp(`\\b(${NUM_WORD_OR_DIGIT})\\s+(months?|quarters?|half[- ]years?|years?|weeks?|days?)\\s+(?:have\\s+|has\\s+|had\\s+)?(?:elapsed|expired|been\\s+used|used|consumed|passed|completed)\\b`, 'i');
  const elPat2 = new RegExp(`\\b(?:after|following)\\s+(${NUM_WORD_OR_DIGIT})\\s+(months?|quarters?|half[- ]years?|years?|weeks?|days?)\\b`, 'i');
  const elPat3 = new RegExp(`\\b(?:recogni[sz]\\w*|record\\w*|post\\w*|book\\w*|amorti[sz]\\w*|charg\\w*|releas\\w*|adjust\\w*)(?:\\s+(?:the|an?|expired|prepaid|insurance|rent|rental|subscription|maintenance|advertising|operating|expense))*?\\s+(?:for|of)\\s+(?:the\\s+(?:first|past|last)\\s+)?(?:(${NUM_WORD_OR_DIGIT})\\s+)?(months?|quarters?|half[- ]years?|years?|weeks?|days?)\\b`, 'i');
  const elPat4 = /\b(monthly|one[- ]month|1[- ]month|quarterly|one[- ]quarter|1[- ]quarter|half[- ]yearly|semi[- ]annual)\s+(?:adjustment|recognition|amorti[sz]ation|charge|expense)\b/i;
  const elPat5 = /(?<!\b(?:paid|prepaid|covering|covers)\s+)for\s+the\s+(month|quarter|half[- ]year)\b/i;

  const m1 = query.match(elPat1);
  const m2 = query.match(elPat2);
  const m3 = query.match(elPat3);
  const m4 = query.match(elPat4);
  const m5 = query.match(elPat5);

  if (m1) {
    const parsed = parseDurationUnit(m1[1], m1[2]);
    if (parsed) elapsed = { ...parsed, matchStr: m1[0] };
  } else if (m2) {
    const parsed = parseDurationUnit(m2[1], m2[2]);
    if (parsed) elapsed = { ...parsed, matchStr: m2[0] };
  } else if (m3) {
    const parsed = parseDurationUnit(m3[1] || '1', m3[2]);
    if (parsed) elapsed = { ...parsed, matchStr: m3[0] };
  } else if (m4) {
    const mod = m4[1].toLowerCase().replace(/[- ]/g, '');
    const units = (/^monthly|1month|onemonth$/.test(mod)) ? 1 : (/^quarterly|1quarter|onequarter$/.test(mod) ? 3 : 6);
    elapsed = { family: 'MONTH', units, matchStr: m4[0] };
  } else if (m5) {
    const u = m5[1].toLowerCase().replace(/[- ]/g, '');
    const units = u === 'month' ? 1 : (u === 'quarter' ? 3 : 6);
    elapsed = { family: 'MONTH', units, matchStr: m5[0] };
  }

  // Mask/blank out the matched elapsed substring before matching coverage duration
  let maskedQuery = query;
  if (elapsed?.matchStr) {
    maskedQuery = query.replace(elapsed.matchStr, ' '.repeat(elapsed.matchStr.length));
  }

  // Extract coverage duration
  let coverage: { family: 'MONTH' | 'DAY'; units: number } | undefined;
  const ASSET_NOUNS = '(?:prepaid|insurance|rent|rental|policy|contract|subscription|maintenance|advertising|fees?|coverage)';

  const covPrefix1 = new RegExp(`(?<![\\w-])(?:annual|yearly|one[- ]year|1[- ]year)\\s+${ASSET_NOUNS}\\b`, 'i');
  const covPrefix2 = new RegExp(`(?<![\\w-])(${NUM_WORD_OR_DIGIT})[- ]year\\s+${ASSET_NOUNS}\\b`, 'i');
  const covPrefix3 = new RegExp(`(?<![\\w-])(?:semi[- ]annual|half[- ]year(?:ly)?)\\s+${ASSET_NOUNS}\\b`, 'i');
  const covPrefix4 = new RegExp(`(?<![\\w-])(?:quarterly|one[- ]quarter|1[- ]quarter)\\s+${ASSET_NOUNS}\\b`, 'i');
  const covPrefix5 = new RegExp(`(?<![\\w-])(${NUM_WORD_OR_DIGIT})[- ]quarter\\s+(?!adjustment|recognition)${ASSET_NOUNS}\\b`, 'i');
  const covPrefix6 = new RegExp(`(?<![\\w-])(${NUM_WORD_OR_DIGIT})[- ]month\\s+(?!adjustment|recognition)${ASSET_NOUNS}\\b`, 'i');
  const covPrefix7 = new RegExp(`(?<![\\w-])(${NUM_WORD_OR_DIGIT})[- ]week\\s+${ASSET_NOUNS}\\b`, 'i');
  const covPrefix8 = new RegExp(`(?<![\\w-])(${NUM_WORD_OR_DIGIT})[- ]day\\s+${ASSET_NOUNS}\\b`, 'i');

  const covClause = new RegExp(`\\b(?:covering|covers|coverage\\s+of|for\\s+a\\s+period\\s+of|over\\s+a\\s+period\\s+of|for|over)\\s+(?:(semi[- ]annual|half\\s+a\\s+year|annual|yearly|quarterly|one[- ]quarter|1[- ]quarter)|(?:(${NUM_WORD_OR_DIGIT})\\s+)?(years?|quarters?|half[- ]years?|months?|weeks?|days?))\\b`, 'i');

  const cp1 = maskedQuery.match(covPrefix1);
  const cp2 = maskedQuery.match(covPrefix2);
  const cp3 = maskedQuery.match(covPrefix3);
  const cp4 = maskedQuery.match(covPrefix4);
  const cp5 = maskedQuery.match(covPrefix5);
  const cp6 = maskedQuery.match(covPrefix6);
  const cp7 = maskedQuery.match(covPrefix7);
  const cp8 = maskedQuery.match(covPrefix8);
  const cc = maskedQuery.match(covClause);

  if (cp1) {
    coverage = { family: 'MONTH', units: 12 };
  } else if (cp2) {
    const count = parseNumberWordOrDigits(cp2[1]) || 1;
    coverage = { family: 'MONTH', units: count * 12 };
  } else if (cp3) {
    coverage = { family: 'MONTH', units: 6 };
  } else if (cp4) {
    coverage = { family: 'MONTH', units: 3 };
  } else if (cp5) {
    const count = parseNumberWordOrDigits(cp5[1]) || 1;
    coverage = { family: 'MONTH', units: count * 3 };
  } else if (cp6) {
    const count = parseNumberWordOrDigits(cp6[1]) || 1;
    coverage = { family: 'MONTH', units: count * 1 };
  } else if (cp7) {
    const count = parseNumberWordOrDigits(cp7[1]) || 1;
    coverage = { family: 'DAY', units: count * 7 };
  } else if (cp8) {
    const count = parseNumberWordOrDigits(cp8[1]) || 1;
    coverage = { family: 'DAY', units: count * 1 };
  } else if (cc) {
    if (cc[1]) {
      const u = cc[1].toLowerCase().replace(/[- ]/g, '');
      if (/^(?:annual|yearly)$/.test(u)) {
        coverage = { family: 'MONTH', units: 12 };
      } else if (/^(?:semiannual|halfayear)$/.test(u)) {
        coverage = { family: 'MONTH', units: 6 };
      } else if (/^(?:quarterly|onequarter|1quarter)$/.test(u)) {
        coverage = { family: 'MONTH', units: 3 };
      }
    } else if (cc[3]) {
      coverage = parseDurationUnit(cc[2] || '1', cc[3]);
    }
  }

  return { elapsed, coverage };
}

function isExplicitPrepaidPeriodCharge(query: string): boolean {
  if (/\b(?:stated|clarified)\s+periodic\s+charge\s+is\b/i.test(query)) {
    return true;
  }

  const p1 = /\b(?:expired|used(?:\s+up)?|consumed|elapsed|amorti[sz]ed|released)\s+(?:portion\s+of\s+)?(?:the\s+|our\s+)?prepaid\s+(?:rent|rental|insurance|expenses?|subscriptions?|maintenance|advertising|fees?)\s*(?:of|is|was|:|=|-)?\s*(?:\bSGD\s*|S\$\s*|\$\s*)\d/i.test(query);
  const p2 = /(?:\bSGD\s*|S\$\s*|\$\s*)\d[\d,.]*\s+(?:of\s+(?:the\s+|our\s+)?)?prepaid\s+(?:rent|rental|insurance|expenses?|subscriptions?|maintenance|advertising|fees?)\s+(?:has\s+|have\s+|had\s+|was\s+|were\s+)?(?:expired|elapsed|been\s+used|used(?:\s+up)?|been\s+consumed|consumed)\b/i.test(query);
  const p3 = /\b(?:releas\w*|amorti[sz]\w*|recogni[sz]\w*|record\w*|book\w*|post\w*)\s+(?:\bSGD\s*|S\$\s*|\$\s*)\d[\d,.]*\s+(?:of\s+(?:expired\s+)?|from\s+)(?:the\s+|our\s+)?prepaid\b/i.test(query);
  const p4 = /\b(?:adjustment|amorti[sz]ation|release|charge|(?<!\bprepaid\s)expense)\s*(?:of|is|was|:|=|-)\s*(?:\bSGD\s*|S\$\s*|\$\s*)\d/i.test(query);
  const p5 = /\b(?:amorti[sz]\w*|releas\w*|reduc\w*|adjust\w*)\s+(?:the\s+|our\s+)?prepaid\s+\w+(?:\s+\w+)?\s+by\s+(?:\bSGD\s*|S\$\s*|\$\s*)\d/i.test(query);
  const p6 = /\b(?:recogni[sz]\w*|record\w*|releas\w*|transfer\w*)\s+(?:the\s+|our\s+)?prepaid\s+\w+(?:\s+\w+)?\s+of\s+(?:\bSGD\s*|S\$\s*|\$\s*)\d[\d,.]*\s+(?:as|to)\s+(?:an?\s+)?(?:[\w\s]+?\s+)?expense\b/i.test(query);

  const isExplicit = p1 || p2 || p3 || p4 || p5 || p6;

  const isUnqualifiedBalance = /(?<!\b(?:expired|used|consumed|elapsed|amorti[sz]ed|released)\s+)prepaid\s+(?:rent|rental|insurance|expenses?|subscriptions?|maintenance|advertising|fees?)(?:\s+balance)?\s*(?:of|is|was|:|=|-)\s*(?:\bSGD\s*|S\$\s*|\$\s*)\d/i.test(query);
  if (isUnqualifiedBalance && !p1 && !p2 && !p3 && !p5 && !p6) {
    return false;
  }

  return isExplicit;
}

function parseCentsFromParts(wholeStr: string, fracStr: string | undefined): bigint {
  const whole = BigInt(wholeStr.replace(/,/g, ''));
  const frac = (fracStr || '').padEnd(2, '0').slice(0, 2);
  return whole * 100n + BigInt(frac);
}

function extractIdentifiablePrepaidBalanceCents(text: string): bigint | undefined {
  const m1 = text.match(/(?<!\b(?:expired|used(?:\s+up)?|consumed|elapsed|amorti[sz]ed|released|of)\s+(?:portion\s+of\s+)?(?:the\s+|our\s+)?)\b(?:(?:(?:annual|yearly|semi[- ]annual|quarterly|opening|initial|original|available|remaining|total|current)\s+)*prepaid\s+(?:rent|rental|insurance|expenses?|subscriptions?|maintenance|advertising|fees?)(?:\s+(?:balance|asset|account))?|balance\s+of\s+(?:(?:annual|yearly|semi[- ]annual|quarterly|opening|initial|original|available|remaining|total|current)\s+)*prepaid\s+(?:rent|rental|insurance|expenses?|subscriptions?|maintenance|advertising|fees?))\s*(?:of|is|was|:|=|-)\s*(?:\bSGD\s*|S\$\s*|\$\s*)(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?(?![\d]|,\d|\.\d)(?!\s+(?:as|to)\s+(?:an?\s+)?(?:[\w\s]+?\s+)?expense\b)(?!\s+(?:has\s+|have\s+|had\s+|was\s+|were\s+)?(?:expired|elapsed|been\s+used|used(?:\s+up)?|been\s+consumed|consumed)\b)/i);
  if (m1) {
    return parseCentsFromParts(m1[1], m1[2]);
  }
  const m2a = text.match(/(?:\bSGD\s*|S\$\s*|\$\s*)(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?(?![\d]|,\d|\.\d)\s+(?:in\s+|of\s+)?(?:(?:annual|yearly|semi[- ]annual|quarterly|opening|initial|original|available|remaining|total|current)\s+)*prepaid\s+(?:rent|rental|insurance|expenses?|subscriptions?|maintenance|advertising|fees?)\s+(?:balance|asset|account)\b/i);
  const m2b = text.match(/(?:\bfrom|\bout\s+of)\s+(?:an?\s+|the\s+|our\s+)?(?:\bSGD\s*|S\$\s*|\$\s*)(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?(?![\d]|,\d|\.\d)\s+(?:(?:annual|yearly|semi[- ]annual|quarterly|opening|initial|original|available|remaining|total|current)\s+)*prepaid\s+(?:rent|rental|insurance|expenses?|subscriptions?|maintenance|advertising|fees?)\b/i);
  const m2 = m2a || m2b;
  if (m2) {
    return parseCentsFromParts(m2[1], m2[2]);
  }
  const m3 = text.match(/\bprepaid\s+(?:rent|rental|insurance|expenses?|subscriptions?|maintenance|advertising|fees?)\b[^.;]*?\b(?:balance|standing\s+at)\s*(?:of|is|was|:|=|-)?\s*(?:\bSGD\s*|S\$\s*|\$\s*)(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?(?![\d]|,\d|\.\d)/i);
  if (m3) {
    return parseCentsFromParts(m3[1], m3[2]);
  }
  const all = getAllAmounts(text);
  if (all.length === 1 && !isExplicitPrepaidPeriodCharge(text)) {
    return all[0].cents;
  }
  return undefined;
}

function extractExplicitPrepaidExpiredAmountsCents(text: string): bigint[] {
  const centsList: bigint[] = [];

  const p1 = /(?:\bSGD\s*|S\$\s*|\$\s*)(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?(?![\d]|,\d|\.\d)\s+(?:of\s+(?:the\s+|our\s+)?)?(?:prepaid\s+(?:rent|rental|insurance|expenses?|subscriptions?|maintenance|advertising|fees?)\s+)?(?:has\s+|have\s+|had\s+|was\s+|were\s+)?(?:expired|elapsed|been\s+used|used(?:\s+up)?|been\s+consumed|consumed)\b/gi;
  let m: RegExpExecArray | null;
  while ((m = p1.exec(text)) !== null) {
    centsList.push(parseCentsFromParts(m[1], m[2]));
  }

  const p2 = /\b(?:expired|used(?:\s+up)?|consumed|elapsed|amorti[sz]ed|released)\s+(?:portion\s+of\s+|amount\s+of\s+)?(?:the\s+|our\s+)?(?:prepaid\s+)?(?:rent|rental|insurance|expenses?|subscriptions?|maintenance|advertising|fees?)?\s*(?:(?:expense|charge|amount|portion)\s+)?(?:of|is|was|:|=|-)\s*(?:\bSGD\s*|S\$\s*|\$\s*)(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?(?![\d]|,\d|\.\d)/gi;
  while ((m = p2.exec(text)) !== null) {
    centsList.push(parseCentsFromParts(m[1], m[2]));
  }

  const p3 = /\b(?:releas\w*|amorti[sz]\w*|recogni[sz]\w*|record\w*|book\w*|post\w*)\s+(?:\bSGD\s*|S\$\s*|\$\s*)(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?(?![\d]|,\d|\.\d)\s+(?:of\s+(?:expired\s+)?|from\s+)(?:the\s+|our\s+)?prepaid\b/gi;
  while ((m = p3.exec(text)) !== null) {
    centsList.push(parseCentsFromParts(m[1], m[2]));
  }

  const p4 = /\b(?:adjustment|amorti[sz]ation|release|charge|(?<!\bprepaid\s)expense)\s*(?:of|is|was|:|=|-)\s*(?:\bSGD\s*|S\$\s*|\$\s*)(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?(?![\d]|,\d|\.\d)/gi;
  while ((m = p4.exec(text)) !== null) {
    centsList.push(parseCentsFromParts(m[1], m[2]));
  }

  const p5 = /\b(?:amorti[sz]\w*|releas\w*|reduc\w*|adjust\w*)\s+(?:the\s+|our\s+)?prepaid\s+\w+(?:\s+\w+)?\s+by\s+(?:\bSGD\s*|S\$\s*|\$\s*)(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?(?![\d]|,\d|\.\d)/gi;
  while ((m = p5.exec(text)) !== null) {
    centsList.push(parseCentsFromParts(m[1], m[2]));
  }

  const p6 = /\b(?:recogni[sz]\w*|record\w*|releas\w*|transfer\w*)\s+(?:the\s+|our\s+)?prepaid\s+\w+(?:\s+\w+)?\s+of\s+(?:\bSGD\s*|S\$\s*|\$\s*)(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?(?![\d]|,\d|\.\d)\s+(?:as|to)\s+(?:an?\s+)?(?:[\w\s]+?\s+)?expense\b/gi;
  while ((m = p6.exec(text)) !== null) {
    centsList.push(parseCentsFromParts(m[1], m[2]));
  }

  const uniqueCents: bigint[] = [];
  for (const c of centsList) {
    if (!uniqueCents.includes(c)) {
      uniqueCents.push(c);
    }
  }
  return uniqueCents;
}

function resolvePeriodAdjustmentCharge(
  templateId: string,
  query: string
): { cents?: bigint; note?: string; missing?: MissingFieldInfo } {
  // Canonical follow-up override FIRST
  const overrideMatches = [...query.matchAll(/\b(stated|clarified)\s+periodic\s+charge\s+is\s+(?:\bSGD\s*|S\$\s*|\$\s*)(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?(?![\d]|,\d|\.\d)/gi)];
  const baseWithoutOverride = query.replace(/(?:[;,.]\s*)?\b(?:stated|clarified)\s+periodic\s+charge\s+is\s+(?:\bSGD\s*|S\$\s*|\$\s*)(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?(?![\d]|,\d|\.\d)/gi, '').trim();

  if (overrideMatches.length > 0) {
    const uniqueOverrides = [...new Set(overrideMatches.map(m => parseCentsFromParts(m[2], m[3])))];
    if (uniqueOverrides.length > 1) {
      return {
        missing: need(
          'periodCharge',
          'Conflicting periodic charges',
          'Multiple conflicting periodic charge overrides were stated; please clarify the exact SGD periodic charge.'
        )
      };
    }
    const overrideCents = uniqueOverrides[0];
    const isClarifiedFollowUp = overrideMatches.every(m => m[1].toLowerCase() === 'clarified');

    if (overrideCents > 0n) {
      if (templateId === 'PREPAID_EXPENSE_RECOGNITION') {
        const identifiableBal = extractIdentifiablePrepaidBalanceCents(baseWithoutOverride);
        if (identifiableBal !== undefined && overrideCents > identifiableBal) {
          return {
            missing: need(
              'periodCharge',
              'Valid expired prepaid expense amount',
              'The stated expired amount (SGD ' + (Number(overrideCents) / 100).toFixed(2) + ') exceeds the stated prepaid balance of SGD ' + (Number(identifiableBal) / 100).toFixed(2) + '. Please explain any additional prepaid balance or state a valid expired amount not exceeding SGD ' + (Number(identifiableBal) / 100).toFixed(2) + '.'
            )
          };
        }
        const baseExpired = extractExplicitPrepaidExpiredAmountsCents(baseWithoutOverride);
        if (!isClarifiedFollowUp && baseExpired.some(c => c !== overrideCents)) {
          return {
            missing: need(
              'periodCharge',
              'Conflicting expired prepaid amounts',
              'Conflicting expired prepaid expense amounts were stated; please clarify the exact SGD prepaid expense amount to recognise for the period.'
            )
          };
        }
      }
      if (templateId === 'DEPRECIATION_CHARGE' || templateId === 'AMORTISATION_CHARGE') {
        const baseAmounts = getAllAmounts(baseWithoutOverride);
        if (baseAmounts.length >= 1 && isAssetValueAmount(baseWithoutOverride)) {
          const maxAssetCents = baseAmounts.reduce((max, a) => (a.cents > max ? a.cents : max), 0n);
          if (overrideCents > maxAssetCents) {
            return {
              missing: need(
                'periodCharge',
                'Valid period charge amount',
                'The stated charge exceeds the stated asset cost or carrying amount. Please state a valid periodic charge in SGD.'
              )
            };
          }
        }
      }
      return { cents: overrideCents };
    }
  }

  const allAmounts = getAllAmounts(query);

  if (templateId === 'PREPAID_EXPENSE_RECOGNITION') {
    if (allAmounts.length === 0) {
      return { missing: need('amount', 'Prepaid amount', 'What is the prepaid amount in SGD?') };
    }

    const explicitExpiredCents = extractExplicitPrepaidExpiredAmountsCents(query);
    const identifiableBal = extractIdentifiablePrepaidBalanceCents(query);

    // 1. Conflicting explicit expired amounts
    if (explicitExpiredCents.length > 1) {
      return {
        missing: need(
          'periodCharge',
          'Prepaid expense amount',
          'Multiple conflicting expired prepaid expense amounts were stated; please provide the exact SGD prepaid expense amount to recognise for the period.'
        )
      };
    }

    // 2. Explicit expired amount exceeding identifiable balance
    if (explicitExpiredCents.length === 1 && identifiableBal !== undefined) {
      if (explicitExpiredCents[0] > identifiableBal) {
        return {
          missing: need(
            'periodCharge',
            'Valid expired prepaid expense amount',
            'The stated expired amount (SGD ' + (Number(explicitExpiredCents[0]) / 100).toFixed(2) + ') exceeds the stated prepaid balance of SGD ' + (Number(identifiableBal) / 100).toFixed(2) + '. Please explain any additional prepaid balance or state a valid expired amount not exceeding SGD ' + (Number(identifiableBal) / 100).toFixed(2) + '.'
          )
        };
      }
    }

    const { elapsed, coverage } = extractPrepaidElapsedAndCoverage(query);

    let calculatedCents: bigint | undefined;
    if (coverage) {
      if (!elapsed) {
        return {
          missing: need('periodCharge', 'Expired prepaid expense amount', 'How much of the prepaid coverage period has elapsed, or what is the exact SGD prepaid expense amount to recognise for the period?')
        };
      }
      if (coverage.family !== elapsed.family) {
        return {
          missing: need('periodCharge', 'Exact period expense amount', 'Coverage duration and elapsed period use incompatible calendar units; please state the exact SGD prepaid expense amount to recognise for the period.')
        };
      }
      if (elapsed.units <= 0 || elapsed.units > coverage.units) {
        return {
          missing: need('periodCharge', 'Expired prepaid expense amount', 'How much of the prepaid coverage period has elapsed, or what is the exact SGD prepaid expense amount to recognise for the period?')
        };
      }
      const baseForProRata = identifiableBal ?? allAmounts[0].cents;
      const numerator = baseForProRata * BigInt(elapsed.units);
      const denom = BigInt(coverage.units);
      if (numerator % denom !== 0n) {
        return {
          missing: need('periodCharge', 'Exact period expense amount', 'The prepaid allocation does not divide into exact integer cents; please state the exact SGD expense amount to recognise for the period.')
        };
      }
      calculatedCents = numerator / denom;
    }

    // 3. Conflict between explicit expired amount and formula pro-rata amount
    if (explicitExpiredCents.length === 1 && calculatedCents !== undefined) {
      if (explicitExpiredCents[0] !== calculatedCents) {
        return {
          missing: need(
            'periodCharge',
            'Prepaid expense amount',
            'The stated expired amount (SGD ' + (Number(explicitExpiredCents[0]) / 100).toFixed(2) + ') conflicts with the elapsed coverage calculation (SGD ' + (Number(calculatedCents) / 100).toFixed(2) + '); please clarify the exact SGD prepaid expense amount to recognise for the period.'
          )
        };
      }
      return {
        cents: explicitExpiredCents[0],
        note: ' Prepaid expense allocation: (SGD ' + (Number(identifiableBal ?? allAmounts[0].cents) / 100).toFixed(2) + ' × ' + elapsed!.units + ') ÷ ' + coverage!.units + ' = SGD ' + (Number(calculatedCents) / 100).toFixed(2) + '.'
      };
    }

    if (explicitExpiredCents.length === 1) {
      return { cents: explicitExpiredCents[0] };
    }

    if (calculatedCents !== undefined) {
      return {
        cents: calculatedCents,
        note: ' Prepaid expense allocation: (SGD ' + (Number(identifiableBal ?? allAmounts[0].cents) / 100).toFixed(2) + ' × ' + elapsed!.units + ') ÷ ' + coverage!.units + ' = SGD ' + (Number(calculatedCents) / 100).toFixed(2) + '.'
      };
    }

    if (allAmounts.length > 1) {
      return { missing: need('periodCharge', 'Prepaid expense amount', 'Multiple SGD amounts were stated; please provide the exact SGD prepaid expense amount to recognise for the period.') };
    }

    if (!isExplicitPrepaidPeriodCharge(query)) {
      return {
        missing: need(
          'periodCharge',
          'Original coverage period or expired prepaid amount',
          elapsed
            ? 'What is the original total coverage period of the prepayment, or what is the exact SGD expired prepaid expense amount to recognise for the period?'
            : 'What are the total coverage period and elapsed period of the prepayment, or what is the exact SGD expired prepaid expense amount to recognise for the period?'
        )
      };
    }

    return { cents: allAmounts[0].cents };
  }

  // DEPRECIATION_CHARGE and AMORTISATION_CHARGE
  if (/\b(?:reducing[- ]balance|diminishing[- ]balance|declining[- ]balance|double[- ]declining)\b/i.test(query)) {
    if (allAmounts.length === 1 && !isAssetValueAmount(query)) {
      return { cents: allAmounts[0].cents };
    }
    return {
      missing: need('periodCharge', 'Depreciation rate or period charge', 'Please state the SGD reducing-balance depreciation charge for the period.')
    };
  }

  const costMatchA = query.match(/\b(?:(?:original|historical|initial|asset|acquisition|capitali[sz]ed)\s+)?cost(?:ing|s)?\s*(?:is|of|was|:|=|-)?\s*(?:\bSGD\s*|S\$\s*|\$\s*)(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?(?![\d]|,\d|\.\d)/i);
  const costMatchB = query.match(/(?:\bSGD\s*|S\$\s*|\$\s*)(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?(?![\d]|,\d|\.\d)\s+(?:cost|in\s+cost)\b/i);
  const costMatchC = query.match(/\b(?:acquired|purchased|bought)(?:\s+[\w-]+){0,5}?\s+(?:for|at)\s*(?:\bSGD\s*|S\$\s*|\$\s*)(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?(?![\d]|,\d|\.\d)/i);
  const costM = costMatchA || costMatchB || costMatchC;

  const resMatchA = query.match(/\b(?:residual(?:\s+value)?|salvage(?:\s+value)?|scrap(?:\s+value)?)\s+(?:of\s+|is\s+|was\s+)?(?:\bSGD\s*|S\$\s*|\$\s*)(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?(?![\d]|,\d|\.\d)/i);
  const resMatchB = query.match(/(?:\bSGD\s*|S\$\s*|\$\s*)(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?(?![\d]|,\d|\.\d)\s+(?:residual|salvage|scrap)(?:\s+value)?\b/i);
  const isZeroRes = /\b(?:no\s+residual(?:\s+value)?|zero\s+residual(?:\s+value)?|nil\s+residual(?:\s+value)?|residual(?:\s+value)?\s+(?:is\s+|of\s+)?(?:nil|zero|0|sgd\s*0|\$0))\b/i.test(query);

  const { usefulLifeMonths, periodMonths } = extractDepAmortUsefulLifeAndPeriod(query);
  const hasFormulaCues = (Boolean(costM) || Boolean(resMatchA || resMatchB || isZeroRes)) && Boolean(usefulLifeMonths);

  if (hasFormulaCues) {
    let costCents: bigint | undefined;
    if (costM) {
      const w = costM[1].replace(/,/g, '');
      const f = (costM[2] || '').padEnd(2, '0');
      costCents = BigInt(w) * 100n + BigInt(f || '0');
    }

    let residualCents: bigint | undefined;
    if (resMatchA || resMatchB) {
      const rm = resMatchA || resMatchB!;
      const w = rm[1].replace(/,/g, '');
      const f = (rm[2] || '').padEnd(2, '0');
      residualCents = BigInt(w) * 100n + BigInt(f || '0');
    } else if (isZeroRes) {
      residualCents = 0n;
    }

    if (costCents === undefined || residualCents === undefined) {
      return {
        missing: need('periodCharge', 'Residual value or period charge', 'Please state the residual value (or confirm nil residual value) or provide the periodic charge in SGD.')
      };
    }

    if (costCents <= residualCents || usefulLifeMonths! <= 0n) {
      return { missing: need('periodCharge', 'Valid cost and useful life', 'Asset cost must exceed residual value and useful life must be positive.') };
    }

    if (!periodMonths) {
      return {
        missing: need('periodCharge', 'Accounting period for charge', 'Which reporting period is being recorded (monthly, quarterly, half-yearly, or annual), or what is the exact SGD charge for the period?')
      };
    }

    if (periodMonths <= 0n || periodMonths > usefulLifeMonths!) {
      return {
        missing: need('periodCharge', 'Valid accounting period', 'The requested period cannot exceed the asset useful life. Please state a valid period or exact SGD charge.')
      };
    }

    const depreciableCents = costCents - residualCents;
    const numerator = depreciableCents * periodMonths;
    if (numerator % usefulLifeMonths! !== 0n) {
      return {
        missing: need('periodCharge', 'Exact period charge', 'The straight-line calculation does not divide into exact integer cents; please state the exact SGD charge to post.')
      };
    }

    const chargeCents = numerator / usefulLifeMonths!;
    return {
      cents: chargeCents,
      note: ' Straight-line calculation: ((SGD ' + (Number(costCents) / 100).toFixed(2) + ' − SGD ' + (Number(residualCents) / 100).toFixed(2) + ') × ' + periodMonths.toString() + ' months) ÷ ' + usefulLifeMonths!.toString() + ' months = SGD ' + (Number(chargeCents) / 100).toFixed(2) + '.'
    };
  }

  if (allAmounts.length === 1 && !isAssetValueAmount(query)) {
    return { cents: allAmounts[0].cents };
  }

  return {
    missing: need('periodCharge', 'Period charge amount', 'What is the depreciation or amortisation charge in SGD for the period?')
  };
}

function isUnearnedRecognition(query: string): boolean {
  return /\b(?:unearned\s+revenue|deferred\s+revenue|customer\s+advance|advance\s+(?:payment\s+)?from\s+(?:a\s+|the\s+)?customer)\b/i.test(query) &&
    /\b(?:earn(?:ed|s|ing)?|recogni[sz](?:e|ed|es|ing)|releas(?:e|ed|es|ing)|satisf(?:y|ied|ies|ying)|deliver(?:ed|s|ing)|perform(?:ed|s|ing)|complet(?:e|ed|es|ing)|render(?:ed|s|ing))\b/i.test(query) &&
    !/\b(?:before\s+(?:delivery|delivering|performing|providing|completing)|to\s+be\s+(?:delivered|performed|provided|rendered)|not\s+yet\s+(?:delivered|performed|earned))\b/i.test(query);
}

function isExpenseAccrualRecognition(query: string): boolean {
  return /\b(?:accrue[ds]?|accrual|incurred\s+but\s+(?:not\s+yet\s+(?:paid|billed)|unpaid|outstanding|unbilled)|(?:unpaid|outstanding)\s+at\s+(?:month|quarter|year|period)[- ]end)\b/i.test(query) &&
    !isAccruedExpenseSettlement(query);
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
    debitAccount = /\b(?:rent|rental)\b/i.test(query)
      ? asset('Prepaid Rent', '1300')
      : /\binsurance\b/i.test(query)
        ? asset('Prepaid Insurance', '1300')
        : asset('Prepaid Expenses', '1300');
  } else if (isAccruedExpenseSettlement(query)) {
    debitAccount = liability('Accrued Expenses', '2100');
  } else {
    const kind = /\boffice supplies\b|\bstationery\b/i.test(query) ? 'Office Supplies Expense'
      : /\b(?:rent|rental payment)\b/i.test(query) ? 'Rent Expense'
      : /\b(?:utilities|utility|electricity|water bill)\b/i.test(query) ? 'Utilities Expense'
      : 'Operating Expense';
    debitAccount = expense(kind);
  }

  const isDeposit = /\b(?:refundable|security|rental)\s+deposit\b/i.test(query);
  const isAccrualSettlement = isAccruedExpenseSettlement(query);

  const onCredit = /\b(?:on\s+(?:(?:\d+\s*[-–]?\s*days?\s+)?credit|account)|\d+\s*[-–]?\s*days?\s+(?:credit|payment\s+terms?)|credit\s+terms?)\b/i.test(query) &&
    !/\b(?:paid|by\s+bank|in\s+cash|with\s+cash)\b/i.test(query);

  if (onCredit && !isDeposit && !isAccrualSettlement) {
    return { debit: debitAccount, credit: { name: 'Trade Payables', code: '2000', category: 'LIABILITY' } };
  }

  const cashPaid = /\b(?:in\s+cash|with\s+cash|by\s+cash|cash\s+payment|cash\s+paid|from\s+petty\s+cash|physical\s+cash)\b/i.test(query);
  const bankPaid = /\b(?:by\s+bank|via\s+bank|through\s+bank|from\s+(?:the\s+|our\s+)?bank|bank\s+transfer|bank\s+payment|bank\s+account|by\s+cheque|by\s+check|via\s+giro|by\s+giro|via\s+paynow|by\s+paynow|wire\s+transfer|paid\s+(?:online|electronically))\b/i.test(query);

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
    id: 'PAYROLL_ACCRUAL',
    title: 'Monthly payroll and CPF accrual',
    patterns: [/\b(?:payroll|salar(?:y|ies)|wages?)\b/i, /\bcpf\b/i],
    accounts: q => {
      const settlement = resolvePayrollSettlementStatus(q);
      const { salaryPaid, cpfPaid, salaryPaymentMethod, cpfPaymentMethod, isPriorAccrualSettlement } = settlement;
      const hasLiabilityOnly = !extractPayrollAmounts(q) && Boolean(extractPayrollLiabilitySettlementAmounts(q));
      const isPriorAccrual = isPriorAccrualSettlement || hasPriorPayrollAccrualContext(q) || hasLiabilityOnly;
      const missing: MissingFieldInfo[] = [];

      if (isPriorAccrual && !salaryPaid && !cpfPaid) {
        missing.push(need('payrollSettlementTarget', 'Accrued payroll liability settled', 'Which previously accrued liability was paid (salaries payable, CPF payable, or both)?'));
      }

      if (salaryPaid && (salaryPaymentMethod === 'NONE' || salaryPaymentMethod === 'AMBIGUOUS')) {
        missing.push(need('salaryPaymentMethod', 'Salary payment method', 'Were the salaries paid in cash or from a bank account?'));
      }
      if (cpfPaid && (cpfPaymentMethod === 'NONE' || cpfPaymentMethod === 'AMBIGUOUS')) {
        missing.push(need('cpfPaymentMethod', 'CPF payment method', 'Was the CPF payment made from a bank account or in cash?'));
      }

      let debit: Account;
      let credit: Account;

      if (isPriorAccrual) {
        if (!salaryPaid && cpfPaid) {
          debit = liability('CPF Payable', '2120');
          credit = cpfPaymentMethod === 'CASH' ? cash() : bank();
        } else {
          debit = liability('Salaries Payable', '2110');
          credit = salaryPaymentMethod === 'CASH' ? cash() : bank();
        }
      } else {
        debit = expense('Salaries and Wages Expense', '5100');
        credit = salaryPaid
          ? (salaryPaymentMethod === 'CASH' ? cash() : bank())
          : liability('Salaries Payable', '2110');
      }

      if (missing.length > 0) {
        return { debit, credit, missing };
      }
      return { debit, credit };
    },
    rationale: 'Under SFRS(I) 1-19, short-term employee benefits (gross salaries and employer CPF contributions) are recognised as expenses when employees render service, with net pay payable to employees and combined employee and employer CPF payable to CPF Board.'
  },
  {
    id: 'PAYROLL_NET_PAY_SETTLEMENT',
    title: 'Settlement of net salaries payable',
    patterns: [
      /\b(?:pay|paid|paying|settle[ds]?|settling|settlement|disburse[ds]?|transfer(?:red)?|remit(?:ted)?)\b/i,
      /\b(?:net\s+(?:salar(?:y|ies)|wages?|pay|payroll)|salar(?:y|ies)\s+payable|wages?\s+payable|accrued\s+(?:salar(?:y|ies)|wages?)|staff\s+salaries\s+payable)\b/i
    ],
    accounts: q => {
      const missing: MissingFieldInfo[] = [];
      if (!hasAffirmativePayrollSettlementVerb(q)) {
        missing.push(need('payrollSettlementTarget', 'Accrued payroll liability settled', 'Was this accrued salary liability actually settled?'));
      }
      const cashPaid = /\b(?:in\s+cash|with\s+cash|by\s+cash|cash\s+payment|cash\s+paid|from\s+petty\s+cash|physical\s+cash)\b/i.test(q);
      const bankPaid = /\b(?:by\s+bank|via\s+bank|through\s+bank|from\s+(?:the\s+|our\s+)?bank|bank\s+transfer|bank\s+payment|bank\s+account|by\s+cheque|by\s+check|via\s+giro|by\s+giro|via\s+paynow|by\s+paynow|wire\s+transfer|paid\s+(?:online|electronically))\b/i.test(q);
      if (cashPaid === bankPaid) {
        missing.push(need('paymentMethod', 'Payment method', 'Were the salaries paid in cash or from a bank account?'));
      }
      return {
        debit: liability('Salaries Payable', '2110'),
        credit: cashPaid ? cash() : bank(),
        ...(missing.length > 0 ? { missing } : {})
      };
    },
    rationale: 'Payment of net salaries to employees extinguishes the Salaries Payable liability.'
  },
  {
    id: 'SALARY_PAYMENT',
    title: 'Payment of salaries and wages',
    patterns: [
      /\b(?:paid|pay|disburse[ds]?)\b/i,
      /\b(?:salar(?:y|ies)|wages?)\b/i
    ],
    accounts: q => {
      const cashPaid = /\b(?:in\s+cash|with\s+cash|by\s+cash|cash\s+payment|cash\s+paid|from\s+petty\s+cash|physical\s+cash)\b/i.test(q);
      const bankPaid = /\b(?:by\s+bank|via\s+bank|through\s+bank|from\s+(?:the\s+|our\s+)?bank|bank\s+transfer|bank\s+payment|bank\s+account|by\s+cheque|by\s+check|via\s+giro|by\s+giro|via\s+paynow|by\s+paynow|wire\s+transfer|paid\s+(?:online|electronically))\b/i.test(q);
      if (cashPaid === bankPaid) {
        return {
          debit: expense('Salaries and Wages Expense', '5100'),
          missing: [need('paymentMethod', 'Payment method', 'Were the salaries paid in cash or from a bank account?')]
        };
      }
      return {
        debit: expense('Salaries and Wages Expense', '5100'),
        credit: cashPaid ? cash() : bank()
      };
    },
    rationale: 'Payment of salaries and wages directly recognizes the expense and outflow of cash or bank funds.'
  },
  {
    id: 'SALARY_ACCRUAL',
    title: 'Accrual of salaries and wages',
    patterns: [
      /\b(?:salar(?:y|ies)|wages?|payroll)\b/i,
      /\b(?:accrue[ds]?|accrual|incurred\s+but\s+(?:not\s+yet\s+(?:paid|billed)|unpaid|outstanding|unbilled)|(?:unpaid|outstanding)\s+at\s+(?:month|quarter|year|period)[- ]end)\b/i
    ],
    accounts: () => ({
      debit: expense('Salaries and Wages Expense', '5100'),
      credit: liability('Salaries Payable', '2110')
    }),
    rationale: 'Recognise accrued salaries and wages expense incurred in the period under SFRS(I) 1-19.'
  },
  {
    id: 'CPF_REMITTANCE',
    title: 'Remittance of CPF contributions to CPF Board',
    patterns: [
      /\b(?:pay|paid|paying|remit(?:ted|ting|tance)?|settle[ds]?|settling|settlement|transfer(?:red)?)\b/i,
      /\b(?:cpf\s+(?:payable|liability)|(?:accrued\s+)?cpf\s+(?:liability|contributions?|payable)|cpf\s+to\s+(?:the\s+)?cpf\s+board|(?:the\s+)?cpf\s+board)\b/i
    ],
    accounts: q => {
      const missing: MissingFieldInfo[] = [];
      if (!hasAffirmativePayrollSettlementVerb(q)) {
        missing.push(need('payrollSettlementTarget', 'Accrued payroll liability settled', 'Was this CPF liability remittance actually made?'));
      }
      return {
        debit: liability('CPF Payable', '2120'),
        credit: /\b(?:in\s+cash|with\s+cash|by\s+cash|physical\s+cash)\b/i.test(q) ? cash() : bank(),
        ...(missing.length > 0 ? { missing } : {})
      };
    },
    rationale: 'Remittance of accrued CPF contributions to CPF Board extinguishes the CPF Payable liability.'
  },
  {
    id: 'PREPAID_EXPENSE_RECOGNITION',
    title: 'Recognition of expired prepaid expense',
    patterns: [
      /\bprepaid\s+(?:rent|rental|insurance|expenses?|subscriptions?|maintenance|advertising|fees?)\b/i
    ],
    accounts: q => ({
      debit: /\b(?:rent|rental)\b/i.test(q)
        ? expense('Rent Expense')
        : /\binsurance\b/i.test(q)
          ? expense('Insurance Expense')
          : expense('Operating Expense'),
      credit: /\b(?:rent|rental)\b/i.test(q)
        ? asset('Prepaid Rent', '1300')
        : /\binsurance\b/i.test(q)
          ? asset('Prepaid Insurance', '1300')
          : asset('Prepaid Expenses', '1300')
    }),
    rationale: 'Recognise the expired portion of prepaid expenses as an operating expense in profit or loss and reduce the prepaid asset balance under the accrual basis (SFRS(I) 1-1).'
  },
  {
    id: 'DEPRECIATION_CHARGE',
    title: 'Depreciation charge on property, plant and equipment',
    patterns: [
      /\bdepreciat(?:e|ed|ing|ion)\b/i,
      /\b(?:record|recogni[sz](?:e|ed|ing)|book|post|charge[ds]?|expense|journal|double\s+entry|debit|credit|for\s+the\s+(?:year|month|quarter|period)|annual|monthly|quarterly|half[- ]yearly|semi[- ]annual(?:ly)?|for\s+(?:the\s+)?(?:\d+|a|an|one|two|three|four|six|twelve)\s*[- ]?(?:years?|quarters?|half[- ]years?|months?))\b/i
    ],
    accounts: q => {
      let assetClass = 'Property, Plant and Equipment';
      if (/\bmachinery|\bmachines?\b/i.test(q)) assetClass = 'Machinery';
      else if (/\bmotor\s+vehicles?|\bvehicles?|\bvans?|\blorr(?:y|ies)|\btrucks?\b/i.test(q)) assetClass = 'Motor Vehicles';
      else if (/\boffice\s+equipment\b/i.test(q)) assetClass = 'Office Equipment';
      else if (/\bcomputer\s+equipment|\bcomputers?|\blaptops?|\bservers?\b/i.test(q)) assetClass = 'Computer Equipment';
      else if (/\bfurniture(?:\s+and\s+fittings)?|\bfittings\b/i.test(q)) assetClass = 'Furniture and Fittings';
      else if (/\bequipment\b/i.test(q)) assetClass = 'Equipment';
      return {
        debit: expense('Depreciation Expense', '5700'),
        credit: asset('Accumulated Depreciation — ' + assetClass, '1750')
      };
    },
    rationale: 'Recognise periodic depreciation charge in profit or loss and credit accumulated depreciation contra-asset under SFRS(I) 1-16 §50.'
  },
  {
    id: 'AMORTISATION_CHARGE',
    title: 'Amortisation charge on intangible asset',
    patterns: [
      /\bamorti[sz](?:e|ed|ing|ation)\b/i,
      /\b(?:intangible|software|licen[cs]es?|patents?|trademarks?|copyrights?|customer\s+lists?|franchises?|development\s+costs?)\b/i
    ],
    accounts: q => {
      let intangibleClass = 'Intangible Assets';
      if (/\bsoftware\b/i.test(q)) intangibleClass = 'Software';
      else if (/\blicen[cs]es?\b/i.test(q)) intangibleClass = 'Licences';
      else if (/\bpatents?\b/i.test(q)) intangibleClass = 'Patents';
      else if (/\btrademarks?\b/i.test(q)) intangibleClass = 'Trademarks';
      else if (/\bcustomer\s+lists?\b/i.test(q)) intangibleClass = 'Customer Lists';
      return {
        debit: expense('Amortisation Expense', '5710'),
        credit: asset('Accumulated Amortisation — ' + intangibleClass, '1850')
      };
    },
    rationale: 'Recognise periodic amortisation of finite-lived intangible asset in profit or loss and credit accumulated amortisation contra-asset under SFRS(I) 1-38.'
  },
  {
    id: 'CURRENT_TAX_PROVISION',
    title: 'Current income tax provision',
    patterns: [
      /\b(?:record|recogni[sz](?:e|ed|ing)|book|post|make|create|prepare|journal|double\s+entry|debit|credit)\b/i,
      /\b(?:provision\s+for\s+(?:income|corporate|current)\s+tax|(?:current|income|corporate)\s+tax(?:\s+(?:provision|expense|charge))?|tax\s+provision)\b/i
    ],
    accounts: () => ({ debit: expense('Income Tax Expense', '5800'), credit: liability('Current Tax Payable', '2400') }),
    rationale: 'Under SFRS(I) 1-12, current tax for current and prior periods is, to the extent unpaid, recognised as a Current Tax Payable liability and Income Tax Expense in profit or loss.'
  },
  {
    id: 'CURRENT_TAX_PAYMENT',
    title: 'Settlement of current income tax payable',
    patterns: [
      /\b(?:pay|paid|paying|prepaid|prepay(?:ing|ment)?|settle[ds]?|settling|settlement|remit(?:ted|ting)?|transferred)\b/i,
      /\b(?:(?:current|corporate|company)\s+(?:income\s+)?tax|income\s+tax|iras|\btax\s+(?:payable|bill|assessment))\b/i
    ],
    accounts: q => {
      if (!hasExplicitIncomeTaxTarget(q)) {
        return {
          debit: liability('Current Tax Payable', '2400'),
          credit: /\b(?:in\s+cash|with\s+cash|by\s+cash|physical\s+cash)\b/i.test(q) ? cash() : bank(),
          missing: [need('taxType', 'Type of IRAS tax obligation', 'Which tax obligation is being paid to IRAS (for example, corporate income tax, GST, withholding tax, property tax, or stamp duty)?')]
        };
      }

      const details = resolveCurrentTaxPaymentDetails(q);
      if (details.missing) {
        return {
          debit: liability('Current Tax Payable', '2400'),
          credit: /\b(?:in\s+cash|with\s+cash|by\s+cash|physical\s+cash)\b/i.test(q) ? cash() : bank(),
          missing: [details.missing]
        };
      }

      if (details.noExistingLiability) {
        return {
          debit: asset('Prepaid Income Tax', '1400'),
          credit: /\b(?:in\s+cash|with\s+cash|by\s+cash|physical\s+cash)\b/i.test(q) ? cash() : bank()
        };
      }

      if (details.advanceOrInstalmentCue && !details.existingLiabilityConfirmed) {
        return {
          debit: liability('Current Tax Payable', '2400'),
          credit: /\b(?:in\s+cash|with\s+cash|by\s+cash|physical\s+cash)\b/i.test(q) ? cash() : bank(),
          missing: [need('taxLiabilityStatus', 'Existing current tax liability status', 'Does this advance or ECI tax payment settle an existing Current Tax Payable liability already recognised, or is there no existing tax liability (so it should be recognised as a Prepaid Income Tax asset under SFRS(I) 1-12 §12)?')]
        };
      }

      return {
        debit: liability('Current Tax Payable', '2400'),
        credit: /\b(?:in\s+cash|with\s+cash|by\s+cash|physical\s+cash)\b/i.test(q) ? cash() : bank()
      };
    },
    rationale: 'Payment of assessed corporate income tax to IRAS extinguishes the Current Tax Payable liability.'
  },
  {
    id: 'DEFERRED_TAX_MOVEMENT',
    title: 'Deferred tax movement (SFRS(I) 1-12)',
    patterns: [
      /\b(?:record|recogni[sz](?:e|ed|ing)|book|post|increase[ds]?|decreas(?:e|ed|ing)|revers(?:e|ed|ing|al)|reduc(?:e|ed|es|ing|tion)|write[- ]?down|derecogni[sz](?:e|ed|ing)|utili[sz](?:e|ed|ing|ation)|create|journal|double\s+entry|debit|credit|adjust(?:ment)?|movement)\b/i,
      /\bdeferred\s+tax(?:\s+(?:liabilit(?:y|ies)|assets?))?\b/i
    ],
    accounts: q => {
      const isEquityLocation = /\b(?:direct(?:ly)?\s+(?:in|to|through)\s+equity|(?:recogni[sz]ed|charged|credited|recorded|adjusted|accounted\s+for)\s+(?:direct(?:ly)?\s+)?(?:in|to)\s+(?:equity|share\s+capital|ordinary\s+share\s+capital|retained\s+earnings|opening\s+retained\s+earnings|capital\s+reserve)|share\s+issu(?:e|ance)\s+(?:transaction\s+)?costs?|equity\s+(?:transaction|issuance)\s+costs?|equity\s+component\s+of\s+(?:a\s+)?(?:convertible|compound)|compound\s+(?:financial\s+)?instrument|opening\s+retained\s+earnings|(?:retrospective\s+(?:adjustment|application|restatement)|change\s+in\s+accounting\s+policy|prior[- ]period\s+error)\b[\s\S]*?\b(?:equity|retained\s+earnings))\b/i.test(q);

      const isOciLocation = /\b(?:revaluation(?:\s+surplus|\s+reserve|\s+gain)?|fvoci|fair\s+value\s+through\s+other\s+comprehensive\s+income|other\s+comprehensive\s+income|\boci\b|cash\s+flow\s+hedge)\b/i.test(q);

      let specificEquityAccount: Account | undefined;
      if (/\b(?:share\s+capital|ordinary\s+share\s+capital|share\s+issu(?:e|ance)\s+(?:transaction\s+)?costs?|equity\s+(?:transaction|issuance)\s+costs?)\b/i.test(q)) {
        specificEquityAccount = equity('Share Capital', '3100');
      } else if (/\b(?:retained\s+earnings|opening\s+retained\s+earnings|change\s+in\s+accounting\s+policy|prior[- ]period\s+error|retrospective\s+(?:adjustment|application|restatement))\b/i.test(q)) {
        specificEquityAccount = equity('Retained Earnings', '3200');
      } else if (/\b(?:capital\s+reserve|convertible\s+(?:bond|debt|note|instrument)|compound\s+(?:financial\s+)?instrument)\b/i.test(q)) {
        specificEquityAccount = equity('Capital Reserve', '3300');
      }

      let specificOciAccount: Account | undefined;
      if (/\brevaluation(?:\s+surplus|\s+reserve|\s+gain)?\b/i.test(q)) {
        specificOciAccount = { name: 'OCI — Revaluation Surplus', code: '3400', category: 'OTHER_COMPREHENSIVE_INCOME' as AccountCategory };
      } else if (/\b(?:fvoci|fair\s+value\s+through\s+other\s+comprehensive\s+income|fair\s+value\s+reserve)\b/i.test(q)) {
        specificOciAccount = { name: 'OCI — Fair Value Reserve (FVOCI)', code: '3410', category: 'OTHER_COMPREHENSIVE_INCOME' as AccountCategory };
      } else if (/\bcash\s+flow\s+hedge\b/i.test(q)) {
        specificOciAccount = { name: 'OCI — Cash Flow Hedge Reserve', code: '3420', category: 'OTHER_COMPREHENSIVE_INCOME' as AccountCategory };
      }

      const isDtl = /\bdeferred\s+tax\s+liabilit(?:y|ies)|\bdtl\b/i.test(q);
      const isDta = /\bdeferred\s+tax\s+assets?|\bdta\b/i.test(q);

      const dirOverride = q.match(/\bdirection\s+is\s+an?\s+(increase|decrease)\b/i)?.[1]?.toLowerCase();
      let isIncrease = false;
      let isDecrease = false;
      if (dirOverride === 'increase') {
        isIncrease = true;
      } else if (dirOverride === 'decrease') {
        isDecrease = true;
      } else {
        const hasAmbiguousMovementNoun = /\b(?:movement|adjust(?:ment|ing|ed)?|change|variance)\b/i.test(q);
        isDecrease = /\b(?:decreas(?:e|ed|es|ing)|revers(?:e|ed|es|ing|al)|reduc(?:e|ed|es|ing|tion)|write[- ]?down|derecogni[sz](?:e|ed|ing)|utili[sz](?:e|ed|ing|ation)|downward)\b/i.test(q);
        isIncrease = /\b(?:increas(?:e|ed|es|ing)|additional|raise[ds]?|upward)\b/i.test(q)
          || (!isDecrease && !hasAmbiguousMovementNoun && /\b(?:recogni[sz](?:e|ed|ing)|initial\s+recognition|creat(?:e|ed|ing)|establish(?:ed|ing)?|arising)\b/i.test(q));
      }

      // OCI recognition
      if (isOciLocation && !isEquityLocation) {
        if (!specificOciAccount || (isDtl === isDta)) {
          return {
            missing: [need('deferredTaxRecognitionLocation', 'Deferred tax recognition outside profit or loss (SFRS(I) 1-12)', 'Deferred tax relating to items recognised in other comprehensive income (such as revaluation surplus or FVOCI investments) is recognised in OCI rather than profit or loss under SFRS(I) 1-12 §61A(a). Please clarify the OCI reserve account, whether a deferred tax liability or asset applies, and the deferred tax movement amount.')]
          };
        }
        if (isIncrease === isDecrease) {
          return {
            missing: [need('deferredTaxDirection', 'Direction of deferred tax movement', 'Is the deferred tax balance increasing (initial/additional recognition) or decreasing (reversal/reduction)?')]
          };
        }
        const targetCounterparty = specificOciAccount;
        if (isDtl) {
          return isDecrease
            ? { debit: liability('Deferred Tax Liability', '2410'), credit: targetCounterparty }
            : { debit: targetCounterparty, credit: liability('Deferred Tax Liability', '2410') };
        } else {
          return isDecrease
            ? { debit: targetCounterparty, credit: asset('Deferred Tax Asset', '1410') }
            : { debit: asset('Deferred Tax Asset', '1410'), credit: targetCounterparty };
        }
      }

      // Equity recognition
      if (isEquityLocation) {
        if (!specificEquityAccount) {
          return {
            missing: [need('deferredTaxRecognitionLocation', 'Equity account for deferred tax recognition (SFRS(I) 1-12)', 'Under SFRS(I) 1-12 §61A(b), deferred tax relating to items recognised directly in equity must be recognised directly in equity rather than profit or loss. Which equity account applies (Share Capital, Retained Earnings, or Capital Reserve)?')]
          };
        }
        if ((!isDtl && !isDta) || (isDtl && isDta)) {
          return {
            missing: [need('deferredTaxType', 'Deferred tax asset or liability', 'Is this movement in a Deferred Tax Liability or a Deferred Tax Asset?')]
          };
        }
        if (isIncrease === isDecrease) {
          return {
            missing: [need('deferredTaxDirection', 'Direction of deferred tax movement', 'Is the deferred tax balance increasing (initial/additional recognition) or decreasing (reversal/reduction)?')]
          };
        }
        const targetCounterparty = specificEquityAccount;
        if (isDtl) {
          return isDecrease
            ? { debit: liability('Deferred Tax Liability', '2410'), credit: targetCounterparty }
            : { debit: targetCounterparty, credit: liability('Deferred Tax Liability', '2410') };
        } else {
          return isDecrease
            ? { debit: targetCounterparty, credit: asset('Deferred Tax Asset', '1410') }
            : { debit: asset('Deferred Tax Asset', '1410'), credit: targetCounterparty };
        }
      }

      // Profit or loss recognition
      if ((!isDtl && !isDta) || (isDtl && isDta)) {
        return {
          missing: [need('deferredTaxType', 'Deferred tax asset or liability', 'Is this movement in a Deferred Tax Liability or a Deferred Tax Asset?')]
        };
      }

      if (isIncrease === isDecrease) {
        return {
          missing: [need('deferredTaxDirection', 'Direction of deferred tax movement', 'Is the deferred tax balance increasing (initial/additional recognition) or decreasing (reversal/reduction)?')]
        };
      }

      if (isDtl) {
        return isDecrease
          ? { debit: liability('Deferred Tax Liability', '2410'), credit: expense('Income Tax Expense', '5800') }
          : { debit: expense('Income Tax Expense', '5800'), credit: liability('Deferred Tax Liability', '2410') };
      } else {
        return isDecrease
          ? { debit: expense('Income Tax Expense', '5800'), credit: asset('Deferred Tax Asset', '1410') }
          : { debit: asset('Deferred Tax Asset', '1410'), credit: expense('Income Tax Expense', '5800') };
      }
    },
    rationale: 'Under SFRS(I) 1-12, movements in deferred tax liabilities and deferred tax assets arising from transactions recognised in profit or loss are recognised in Income Tax Expense.'
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
    id: 'EXPENSE_PAYMENT', title: 'Operating expense payment',
    patterns: [
      /\b(?:pay|paid|prepaid|purchase|purchased|bought|payment|record|settle|settled|settling|settlement|in\s+advance)\b/i,
      /\b(?:rent|office supplies|stationery|utilities|utility|electricity|water bill)\b|\b(?:refundable|security|rental)\s+deposit\b|\b(?:prepaid\s+(?:rent|rental|insurance|expenses?|subscriptions?|maintenance|advertising|fees?)|(?:rent|rental|insurance|expenses?|subscriptions?|maintenance|advertising|fees?)(?:\s+of\s+(?:\bSGD\s*|S\$\s*|\$\s*)[\d,.]+)?\s+(?:paid\s+)?in\s+advance)\b|\b(?:previously\s+accrued|accrued\s+(?:last|previous|prior)\s+(?:month|quarter|period|year)|(?:paid|pay|settle[ds]?|settling|clear(?:ed)?)\s+(?:the\s+|an?\s+|our\s+)?(?:previously\s+)?accrued\b|accrued\s+(?:[\w\s]{1,25}?)\s+(?:was|were)\s+(?:paid|settled))\b/i
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
  if (/\b(?:GST|FVTPL|forex|foreign exchange|FX|lease|tenancy)\b/i.test(query) ||
      (/\bshare(?:s|holder)?\b/i.test(query) && !/\bdeferred\s+tax\b/i.test(query)) ||
      (/\bFVOCI\b/i.test(query) && !/\bdeferred\s+tax\b/i.test(query)) ||
      /\brental agreement\b/i.test(query) ||
      /\b(?:USD|EUR|GBP|AUD|MYR|JPY|CNY)\b/i.test(query) ||
      /\btransaction\s*[12]\b/i.test(query) ||
      ((!/\bdeferred\s+tax\b/i.test(query) && /\bbond\b/i.test(query)) || /\b(?:non[- ]?poci|poci|significant\s+increase\s+in\s+credit\s+risk|sppi|12-month\s+or\s+lifetime)\b/i.test(query))) return undefined;

  const hasPayrollOrCpfTerms = /\b(?:CPF|payroll|salar(?:y|ies)|wages?)\b/i.test(query);
  const PAYROLL_TEMPLATE_IDS = new Set(['PAYROLL_ACCRUAL', 'PAYROLL_NET_PAY_SETTLEMENT', 'CPF_REMITTANCE', 'SALARY_ACCRUAL', 'SALARY_PAYMENT']);

  // Customer invoice settlements take priority over a generic "bank transfer".
  // A third-party payment is not a transfer between the entity's own accounts.
  const externalParty = /\b(?:customer|client|supplier|vendor|third.party)\b/i.test(query);
  const customerReceiptAllowed = customerReceiptDirection(query) && !customerPaymentOutflow(query);
  const template = (personalOwnerWithdrawal(query) && !hasPayrollOrCpfTerms) ? ownerDrawingsTemplate :
    templates.find(item => (!hasPayrollOrCpfTerms || PAYROLL_TEMPLATE_IDS.has(item.id)) &&
      (!externalParty || item.id !== 'BANK_TRANSFER') &&
      (item.id !== 'CUSTOMER_RECEIPT' || customerReceiptAllowed) &&
      (item.id !== 'BANK_TRANSFER' || isBankTransfer(query)) &&
      (item.id !== 'UNEARNED_REVENUE_RECOGNITION' || isUnearnedRecognition(query)) &&
      (item.id !== 'UNEARNED_REVENUE_RECEIPT' || (customerReceiptAllowed && !isUnearnedRecognition(query))) &&
      (item.id !== 'BAD_DEBT_ALLOWANCE' || !/\b(?:writ(?:e|ten|ing)\s+off|write-off)\b/i.test(query)) &&
      (item.id !== 'SUPPLIER_PAYMENT' || (!/\b(?:bought|purchased|purchase\s+of|acquired|incurred|return(?:ed|s)?|credit\s+note)\b/i.test(query))) &&
      (item.id !== 'PROVISION_RECOGNITION' || (!/\b(?:doubtful|bad\s+debt|receivables?|ecl|income\s+tax|corporate\s+tax|deferred\s+tax|mom|employment\s+act|overtime)\b/i.test(query) && !(/^should\s+we\b/i.test(query.trim()) && getAllAmounts(query).length === 0 && !/\b(?:journal|double\s+entry|debit|credit)\b/i.test(query)))) &&
      (item.id !== 'ACCRUED_EXPENSE_RECOGNITION' || isExpenseAccrualRecognition(query)) &&
      (item.id !== 'PAYROLL_ACCRUAL' || isPayrollAccrual(query)) &&
      (item.id !== 'PAYROLL_NET_PAY_SETTLEMENT' || isPayrollNetPaySettlement(query)) &&
      (item.id !== 'SALARY_ACCRUAL' || (!hasStatutoryPayrollCalcCues(query) && isExpenseAccrualRecognition(query) && /\b(?:salar(?:y|ies)|wages?|payroll)\b/i.test(query))) &&
      (item.id !== 'SALARY_PAYMENT' || (!hasStatutoryPayrollCalcCues(query) && /\b(?:paid|pay|disburse[ds]?)\b/i.test(query) && /\b(?:salar(?:y|ies)|wages?)\b/i.test(query) && !/\b(?:net\s+(?:salar(?:y|ies)|wages?|pay|payroll)|payable|accrue[ds]?|accrual|unpaid|outstanding)\b/i.test(query))) &&
      (item.id !== 'CPF_REMITTANCE' || isCpfRemittance(query)) &&
      (item.id !== 'PREPAID_EXPENSE_RECOGNITION' || isPrepaidExpenseRecognition(query)) &&
      (item.id !== 'DEPRECIATION_CHARGE' || isDepreciationCharge(query)) &&
      (item.id !== 'AMORTISATION_CHARGE' || isAmortisationCharge(query)) &&
      (item.id !== 'CURRENT_TAX_PROVISION' || isCurrentTaxProvision(query)) &&
      (item.id !== 'CURRENT_TAX_PAYMENT' || isCurrentTaxPayment(query)) &&
      (item.id !== 'DEFERRED_TAX_MOVEMENT' || isDeferredTaxMovement(query)) &&
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

  // 6. Monthly payroll and CPF accrual
  const isPayroll = template.id === 'PAYROLL_ACCRUAL';
  const payrollSplit = isPayroll ? extractPayrollAmounts(query) : undefined;
  const payrollLiabilitySplit = isPayroll ? extractPayrollLiabilitySettlementAmounts(query) : undefined;
  const payrollSettlementStatus = isPayroll ? resolvePayrollSettlementStatus(query) : undefined;

  // 7. Period adjustments (prepaid expense recognition, depreciation, amortisation)
  const isPeriodAdjustment =
    template.id === 'PREPAID_EXPENSE_RECOGNITION' ||
    template.id === 'DEPRECIATION_CHARGE' ||
    template.id === 'AMORTISATION_CHARGE';
  const periodAdjustment = isPeriodAdjustment ? resolvePeriodAdjustmentCharge(template.id, query) : undefined;

  // 8. Current tax
  const isCurrentTaxProv = template.id === 'CURRENT_TAX_PROVISION';
  const isCurrentTaxPay = template.id === 'CURRENT_TAX_PAYMENT';
  const currentTaxDetails = isCurrentTaxPay ? resolveCurrentTaxPaymentDetails(query) : undefined;
  const currentTaxRes = isCurrentTaxProv ? resolveCurrentTaxAmount(query) : currentTaxDetails;

  // 9. Deferred tax movement
  const isDeferredTax = template.id === 'DEFERRED_TAX_MOVEMENT';
  const deferredTaxRes = isDeferredTax ? resolveDeferredTaxAmount(query) : undefined;

  const missingFields: MissingFieldInfo[] = [];

  if (periodAdjustment?.missing) {
    missingFields.push(periodAdjustment.missing);
  } else if (currentTaxRes?.missing) {
    missingFields.push(currentTaxRes.missing);
  } else if (deferredTaxRes?.missing) {
    missingFields.push(deferredTaxRes.missing);
  } else if (allAmounts.length === 0) {
    missingFields.push(need('amount', 'Transaction amount', 'What is the transaction amount in SGD?'));
  } else if (
    allAmounts.length > 1 &&
    !loanSplit &&
    !saleAndCost &&
    !discountSplit &&
    !isCustomerDiscount &&
    !salesReturnAndCost &&
    !supplierDiscountSplit &&
    !isSupplierDiscount &&
    !payrollSplit &&
    !payrollLiabilitySplit &&
    !currentTaxDetails?.isSplit &&
    !periodAdjustment?.cents &&
    !currentTaxRes?.cents &&
    !deferredTaxRes?.cents
  ) {
    missingFields.push(need('amount', 'Transaction amount', 'Multiple SGD amounts were stated; please clarify which amount applies to each part of the transaction.'));
  }

  if (pair.missing) {
    missingFields.push(...pair.missing);
  }

  const isPriorAccrualPayroll = isPayroll && Boolean(
    payrollSettlementStatus?.isPriorAccrualSettlement ||
    hasPriorPayrollAccrualContext(query) ||
    (!payrollSplit && payrollLiabilitySplit)
  );
  const isPayrollComplete = Boolean(
    (payrollSplit || payrollLiabilitySplit) &&
    (isPriorAccrualPayroll
      ? Boolean(payrollSettlementStatus && (payrollSettlementStatus.salaryPaid || payrollSettlementStatus.cpfPaid))
      : Boolean(payrollSplit))
  );

  const isComplete = missingFields.length === 0 && (
    Boolean(loanSplit) ||
    Boolean(saleAndCost && pair.debit && pair.credit) ||
    Boolean(discountSplit && pair.debit && pair.credit) ||
    Boolean(salesReturnAndCost && pair.debit && pair.credit) ||
    Boolean(supplierDiscountSplit && pair.debit && pair.credit) ||
    isPayrollComplete ||
    Boolean(currentTaxDetails?.isSplit) ||
    Boolean(periodAdjustment?.cents && pair.debit && pair.credit) ||
    Boolean(currentTaxRes?.cents && pair.debit && pair.credit) ||
    Boolean(deferredTaxRes?.cents && pair.debit && pair.credit) ||
    (allAmounts.length === 1 && Boolean(pair.debit && pair.credit))
  );

  const eventDate = formatSingaporeDate(new Date());

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

  // Branch: Current tax payment with excess advance / prepaid tax asset
  if (currentTaxDetails?.isSplit && template.id === 'CURRENT_TAX_PAYMENT') {
    const paidAmount = Number(currentTaxDetails.paidCents!) / 100;
    const liabAmount = Number(currentTaxDetails.liabilityCents!) / 100;
    const prepAmount = Number(currentTaxDetails.prepaidAssetCents!) / 100;
    const title = 'Current tax payment with prepaid tax asset';
    const rationale = 'Settlement of existing current tax payable with excess payment recognized as a prepaid income tax asset under SFRS(I) 1-12 §12.';
    const creditAcct = pair.credit ?? bank();

    const lines: JournalLine[] = isComplete ? [
      {
        id: 'basic-tax-current-payable',
        accountCode: '2400',
        accountName: 'Current Tax Payable',
        category: 'LIABILITY',
        debit: liabAmount,
        credit: 0,
        lineExplanation: 'Settlement of existing current tax payable to IRAS under SFRS(I) 1-12.'
      },
      {
        id: 'basic-tax-prepaid-asset',
        accountCode: '1400',
        accountName: 'Prepaid Income Tax',
        category: 'ASSET',
        debit: prepAmount,
        credit: 0,
        lineExplanation: 'Recognition of excess tax paid as prepaid current tax asset under SFRS(I) 1-12 §12.'
      },
      {
        id: 'basic-tax-payment',
        accountCode: creditAcct.code,
        accountName: creditAcct.name,
        category: 'ASSET',
        debit: 0,
        credit: paidAmount,
        lineExplanation: 'Disbursement of tax payment to IRAS from bank/cash account.'
      }
    ] : [];

    return {
      scenarioType: 'BASIC_BOOKKEEPING',
      authorityStatus: isComplete ? 'DETERMINISTIC' : 'CONDITIONAL',
      queryIntent: 'TRANSACTION',
      primaryDomain: 'ACCOUNTING_SFRS',
      rawQuery: query,
      transactionTitle: title,
      functionalCurrency: 'SGD',
      transactionCurrency: 'SGD',
      amount: paidAmount,
      accountingTreatmentSummary: rationale,
      directGroups: isComplete ? [{
        id: 'basic-current_tax_split',
        eventDate,
        title,
        summary: title + ' — SGD ' + paidAmount.toFixed(2),
        lines,
        totalDebit: paidAmount,
        totalCredit: paidAmount,
        isBalanced: true,
        citations: [],
        rationalePoints: [rationale],
        authorityStatus: 'DETERMINISTIC'
      }] : [],
      isComplete,
      missingFields
    };
  }

  // Branch: Monthly payroll and CPF accrual or prior accrual settlement
  if (payrollSplit || payrollLiabilitySplit) {
    const settlement = payrollSettlementStatus ?? resolvePayrollSettlementStatus(query);
    const { salaryPaid, cpfPaid, salaryPaymentMethod, cpfPaymentMethod } = settlement;
    const isPriorAccrual = isPriorAccrualPayroll;
    const salaryPayAcct = salaryPaymentMethod === 'CASH' ? cash() : bank();
    const cpfPayAcct = cpfPaymentMethod === 'CASH' ? cash() : bank();

    let title: string;
    let rationale: string;
    let groupId: string;
    let totalAmount: number;
    let lines: JournalLine[] = [];

    if (isPriorAccrual) {
      const salPayableCents = payrollSplit
        ? (payrollSplit.grossCents - payrollSplit.employeeCpfCents)
        : (payrollLiabilitySplit?.salPayableCents ?? 0n);
      const cpfPayableCents = payrollSplit
        ? (payrollSplit.employeeCpfCents + payrollSplit.employerCpfCents)
        : (payrollLiabilitySplit?.cpfPayableCents ?? 0n);

      const salPayableAmount = Number(salPayableCents) / 100;
      const cpfPayableAmount = Number(cpfPayableCents) / 100;
      const totalSettlementCents = (salaryPaid ? salPayableCents : 0n) + (cpfPaid ? cpfPayableCents : 0n);
      totalAmount = Number(totalSettlementCents) / 100;

      title = 'Settlement of accrued payroll and CPF liabilities';
      groupId = 'basic-payroll_accrual_settlement';
      rationale = 'Settlement of previously accrued salaries and CPF liabilities extinguishes the respective liabilities without recognizing duplicate expense in the settlement period under SFRS(I) 1-19.';

      if (isComplete) {
        if (salaryPaid && cpfPaid) {
          if (salaryPayAcct.code === cpfPayAcct.code) {
            lines = [
              {
                id: 'basic-payroll-settle-salaries',
                accountCode: '2110',
                accountName: 'Salaries Payable',
                category: 'LIABILITY',
                debit: salPayableAmount,
                credit: 0,
                lineExplanation: 'Settlement of previously accrued salaries payable to employees.'
              },
              {
                id: 'basic-payroll-settle-cpf',
                accountCode: '2120',
                accountName: 'CPF Payable',
                category: 'LIABILITY',
                debit: cpfPayableAmount,
                credit: 0,
                lineExplanation: 'Settlement of previously accrued CPF contributions to CPF Board.'
              },
              {
                id: 'basic-payroll-settle-payment',
                accountCode: salaryPayAcct.code,
                accountName: salaryPayAcct.name,
                category: 'ASSET',
                debit: 0,
                credit: totalAmount,
                lineExplanation: 'Disbursement of accrued salaries and remittance of accrued CPF from bank/cash account.'
              }
            ];
          } else {
            lines = [
              {
                id: 'basic-payroll-settle-salaries',
                accountCode: '2110',
                accountName: 'Salaries Payable',
                category: 'LIABILITY',
                debit: salPayableAmount,
                credit: 0,
                lineExplanation: 'Settlement of previously accrued salaries payable to employees.'
              },
              {
                id: 'basic-payroll-settle-cpf',
                accountCode: '2120',
                accountName: 'CPF Payable',
                category: 'LIABILITY',
                debit: cpfPayableAmount,
                credit: 0,
                lineExplanation: 'Settlement of previously accrued CPF contributions to CPF Board.'
              },
              {
                id: 'basic-payroll-settle-sal-pay',
                accountCode: salaryPayAcct.code,
                accountName: salaryPayAcct.name,
                category: 'ASSET',
                debit: 0,
                credit: salPayableAmount,
                lineExplanation: 'Disbursement of accrued salaries from bank/cash account.'
              },
              {
                id: 'basic-payroll-settle-cpf-pay',
                accountCode: cpfPayAcct.code,
                accountName: cpfPayAcct.name,
                category: 'ASSET',
                debit: 0,
                credit: cpfPayableAmount,
                lineExplanation: 'Remittance of accrued CPF from bank/cash account.'
              }
            ];
          }
        } else if (salaryPaid && !cpfPaid) {
          lines = [
            {
              id: 'basic-payroll-settle-salaries',
              accountCode: '2110',
              accountName: 'Salaries Payable',
              category: 'LIABILITY',
              debit: salPayableAmount,
              credit: 0,
              lineExplanation: 'Settlement of previously accrued salaries payable to employees.'
            },
            {
              id: 'basic-payroll-settle-sal-pay',
              accountCode: salaryPayAcct.code,
              accountName: salaryPayAcct.name,
              category: 'ASSET',
              debit: 0,
              credit: salPayableAmount,
              lineExplanation: 'Disbursement of accrued salaries from bank/cash account.'
            }
          ];
        } else if (!salaryPaid && cpfPaid) {
          lines = [
            {
              id: 'basic-payroll-settle-cpf',
              accountCode: '2120',
              accountName: 'CPF Payable',
              category: 'LIABILITY',
              debit: cpfPayableAmount,
              credit: 0,
              lineExplanation: 'Settlement of previously accrued CPF contributions to CPF Board.'
            },
            {
              id: 'basic-payroll-settle-cpf-pay',
              accountCode: cpfPayAcct.code,
              accountName: cpfPayAcct.name,
              category: 'ASSET',
              debit: 0,
              credit: cpfPayableAmount,
              lineExplanation: 'Remittance of accrued CPF from bank/cash account.'
            }
          ];
        }
      }
    } else {
      const grossAmount = Number(payrollSplit!.grossCents) / 100;
      const employerCpfAmount = Number(payrollSplit!.employerCpfCents) / 100;
      const netPayCents = payrollSplit!.grossCents - payrollSplit!.employeeCpfCents;
      const netPayAmount = Number(netPayCents) / 100;
      const totalCpfCents = payrollSplit!.employeeCpfCents + payrollSplit!.employerCpfCents;
      const totalCpfAmount = Number(totalCpfCents) / 100;
      const totalCents = payrollSplit!.grossCents + payrollSplit!.employerCpfCents;
      totalAmount = Number(totalCents) / 100;

      if (salaryPaid && cpfPaid) {
        title = 'Monthly payroll and CPF payment';
        groupId = 'basic-payroll_payment';
        rationale = 'Under SFRS(I) 1-19, short-term employee benefits (gross salaries and employer CPF contributions) are recognised as expenses when employees render service, with net salaries and CPF contributions paid from cash or bank.';
      } else if (salaryPaid && !cpfPaid) {
        title = 'Monthly payroll payment and CPF accrual';
        groupId = 'basic-payroll_payment_accrual';
        rationale = 'Under SFRS(I) 1-19, short-term employee benefits (gross salaries and employer CPF contributions) are recognised as expenses when employees render service, with net salaries paid from cash or bank and combined employee and employer CPF payable to CPF Board.';
      } else if (!salaryPaid && cpfPaid) {
        title = 'Monthly payroll accrual and CPF payment';
        groupId = 'basic-payroll_accrual_cpf_payment';
        rationale = 'Under SFRS(I) 1-19, short-term employee benefits (gross salaries and employer CPF contributions) are recognised as expenses when employees render service, with combined employee and employer CPF contributions paid from cash or bank and net salaries payable to employees.';
      } else {
        title = template.title;
        groupId = 'basic-payroll_accrual';
        rationale = template.rationale;
      }

      if (isComplete) {
      if (salaryPaid && cpfPaid) {
        if (salaryPayAcct.code === cpfPayAcct.code) {
          lines = [
            {
              id: 'basic-payroll-salaries',
              accountCode: '5100',
              accountName: 'Salaries and Wages Expense',
              category: 'EXPENSE',
              debit: grossAmount,
              credit: 0,
              lineExplanation: 'Gross salaries and wages expense recognized under SFRS(I) 1-19.'
            },
            {
              id: 'basic-payroll-employer-cpf',
              accountCode: '5110',
              accountName: 'Employer CPF Contribution Expense',
              category: 'EXPENSE',
              debit: employerCpfAmount,
              credit: 0,
              lineExplanation: 'Employer CPF contribution expense recognized under SFRS(I) 1-19.'
            },
            {
              id: 'basic-payroll-payment',
              accountCode: salaryPayAcct.code,
              accountName: salaryPayAcct.name,
              category: 'ASSET',
              debit: 0,
              credit: totalAmount,
              lineExplanation: 'Disbursement of net salaries and remittance of CPF contributions from bank/cash account.'
            }
          ];
        } else {
          lines = [
            {
              id: 'basic-payroll-salaries',
              accountCode: '5100',
              accountName: 'Salaries and Wages Expense',
              category: 'EXPENSE',
              debit: grossAmount,
              credit: 0,
              lineExplanation: 'Gross salaries and wages expense recognized under SFRS(I) 1-19.'
            },
            {
              id: 'basic-payroll-employer-cpf',
              accountCode: '5110',
              accountName: 'Employer CPF Contribution Expense',
              category: 'EXPENSE',
              debit: employerCpfAmount,
              credit: 0,
              lineExplanation: 'Employer CPF contribution expense recognized under SFRS(I) 1-19.'
            },
            {
              id: 'basic-payroll-salaries-payment',
              accountCode: salaryPayAcct.code,
              accountName: salaryPayAcct.name,
              category: 'ASSET',
              debit: 0,
              credit: netPayAmount,
              lineExplanation: 'Net salary payment to employees from cash/bank account.'
            },
            {
              id: 'basic-payroll-cpf-payment',
              accountCode: cpfPayAcct.code,
              accountName: cpfPayAcct.name,
              category: 'ASSET',
              debit: 0,
              credit: totalCpfAmount,
              lineExplanation: 'Remittance of combined employee and employer CPF contributions from bank/cash account.'
            }
          ];
        }
      } else if (salaryPaid && !cpfPaid) {
        lines = [
          {
            id: 'basic-payroll-salaries',
            accountCode: '5100',
            accountName: 'Salaries and Wages Expense',
            category: 'EXPENSE',
            debit: grossAmount,
            credit: 0,
            lineExplanation: 'Gross salaries and wages expense recognized under SFRS(I) 1-19.'
          },
          {
            id: 'basic-payroll-employer-cpf',
            accountCode: '5110',
            accountName: 'Employer CPF Contribution Expense',
            category: 'EXPENSE',
            debit: employerCpfAmount,
            credit: 0,
            lineExplanation: 'Employer CPF contribution expense recognized under SFRS(I) 1-19.'
          },
          {
            id: 'basic-payroll-payment',
            accountCode: salaryPayAcct.code,
            accountName: salaryPayAcct.name,
            category: 'ASSET',
            debit: 0,
            credit: netPayAmount,
            lineExplanation: 'Net salary payment to employees from bank/cash account.'
          },
          {
            id: 'basic-payroll-cpf-payable',
            accountCode: '2120',
            accountName: 'CPF Payable',
            category: 'LIABILITY',
            debit: 0,
            credit: totalCpfAmount,
            lineExplanation: 'Combined employee and employer CPF contributions payable to CPF Board.'
          }
        ];
      } else if (!salaryPaid && cpfPaid) {
        lines = [
          {
            id: 'basic-payroll-salaries',
            accountCode: '5100',
            accountName: 'Salaries and Wages Expense',
            category: 'EXPENSE',
            debit: grossAmount,
            credit: 0,
            lineExplanation: 'Gross salaries and wages expense recognized under SFRS(I) 1-19.'
          },
          {
            id: 'basic-payroll-employer-cpf',
            accountCode: '5110',
            accountName: 'Employer CPF Contribution Expense',
            category: 'EXPENSE',
            debit: employerCpfAmount,
            credit: 0,
            lineExplanation: 'Employer CPF contribution expense recognized under SFRS(I) 1-19.'
          },
          {
            id: 'basic-payroll-net-pay',
            accountCode: '2110',
            accountName: 'Salaries Payable',
            category: 'LIABILITY',
            debit: 0,
            credit: netPayAmount,
            lineExplanation: 'Net salary payable to employees after employee CPF deduction.'
          },
          {
            id: 'basic-payroll-cpf-payment',
            accountCode: cpfPayAcct.code,
            accountName: cpfPayAcct.name,
            category: 'ASSET',
            debit: 0,
            credit: totalCpfAmount,
            lineExplanation: 'Remittance of combined employee and employer CPF contributions from bank/cash account.'
          }
        ];
      } else {
        lines = [
          {
            id: 'basic-payroll-salaries',
            accountCode: '5100',
            accountName: 'Salaries and Wages Expense',
            category: 'EXPENSE',
            debit: grossAmount,
            credit: 0,
            lineExplanation: 'Gross salaries and wages expense recognized under SFRS(I) 1-19.'
          },
          {
            id: 'basic-payroll-employer-cpf',
            accountCode: '5110',
            accountName: 'Employer CPF Contribution Expense',
            category: 'EXPENSE',
            debit: employerCpfAmount,
            credit: 0,
            lineExplanation: 'Employer CPF contribution expense recognized under SFRS(I) 1-19.'
          },
          {
            id: 'basic-payroll-net-pay',
            accountCode: '2110',
            accountName: 'Salaries Payable',
            category: 'LIABILITY',
            debit: 0,
            credit: netPayAmount,
            lineExplanation: 'Net salary payable to employees after employee CPF deduction.'
          },
          {
            id: 'basic-payroll-cpf-payable',
            accountCode: '2120',
            accountName: 'CPF Payable',
            category: 'LIABILITY',
            debit: 0,
            credit: totalCpfAmount,
            lineExplanation: 'Combined employee and employer CPF contributions payable to CPF Board.'
          }
        ];
      }
    }
  }

    return {
      scenarioType: 'BASIC_BOOKKEEPING',
      authorityStatus: isComplete ? 'DETERMINISTIC' : 'CONDITIONAL',
      queryIntent: 'TRANSACTION',
      primaryDomain: 'ACCOUNTING_SFRS',
      rawQuery: query,
      transactionTitle: title,
      functionalCurrency: 'SGD',
      transactionCurrency: 'SGD',
      amount: totalAmount,
      accountingTreatmentSummary: rationale,
      directGroups: (isComplete && (!isPriorAccrual || (salaryPaid || cpfPaid)) && lines.length > 0) ? [{
        id: groupId,
        eventDate,
        title,
        summary: title + ' — SGD ' + totalAmount.toFixed(2),
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

  // Branch D: Standard single-amount transaction
  const cents = periodAdjustment?.cents ?? currentTaxRes?.cents ?? deferredTaxRes?.cents ?? amountCents(query);
  const amount = cents ? Number(cents) / 100 : undefined;
  const skipGstSuffix = /(?:WITHDRAWAL|TRANSFER|PAYROLL|CPF|TAX|DEPRECIATION|AMORTISATION|PREPAID_EXPENSE_RECOGNITION)/.test(template.id);

  let dynamicTitle = template.title;
  let dynamicRationale = template.rationale;

  if (template.id === 'DEFERRED_TAX_MOVEMENT') {
    if (pair.debit?.category === 'OTHER_COMPREHENSIVE_INCOME' || pair.credit?.category === 'OTHER_COMPREHENSIVE_INCOME') {
      dynamicTitle = 'Deferred tax recognised in other comprehensive income';
      dynamicRationale = 'Under SFRS(I) 1-12 §61A(a), current and deferred tax relating to items recognised in other comprehensive income is recognised in other comprehensive income rather than profit or loss.';
    } else if (pair.debit?.category === 'EQUITY' || pair.credit?.category === 'EQUITY') {
      dynamicTitle = 'Deferred tax recognised directly in equity';
      dynamicRationale = 'Under SFRS(I) 1-12 §61A(b), current and deferred tax relating to items recognised directly in equity is recognised directly in equity rather than profit or loss.';
    }
  } else if (template.id === 'CURRENT_TAX_PAYMENT') {
    if (pair.debit?.name === 'Prepaid Income Tax') {
      dynamicTitle = 'Prepayment of current corporate income tax';
      dynamicRationale = 'Under SFRS(I) 1-12 §12, income tax paid in advance or where no current tax liability exists is recognized as a current tax asset (Prepaid Income Tax) until the tax liability is assessed.';
    }
  }

  const rationale = dynamicRationale + (periodAdjustment?.note ? periodAdjustment.note : '') + (skipGstSuffix
    ? '' : ' No GST has been recorded because GST registration and tax treatment were not established; assess GST separately if applicable.');

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
    transactionTitle: dynamicTitle,
    functionalCurrency: 'SGD',
    transactionCurrency: 'SGD',
    amount,
    accountingTreatmentSummary: rationale,
    directGroups: isComplete && amount !== undefined ? [{
      id: 'basic-' + template.id.toLowerCase(),
      eventDate,
      title: dynamicTitle,
      summary: dynamicTitle + ' — SGD ' + amount.toFixed(2),
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
    const isCash = /^(?:(?:paid\s+)?in\s+cash|(?:with|by)\s+cash|cash|from\s+petty\s+cash|physical\s+cash)$/i.test(answer);
    const isBank = /^(?:(?:paid\s+)?(?:by|via|through)\s+(?:a\s+)?bank(?:\s+transfer)?|bank\s+transfer|bank|from\s+(?:the\s+|our\s+)?bank(?:\s+account)?|(?:the\s+|our\s+)?bank(?:\s+account)?|from\s+bank|(?:by|via)\s+cheque|(?:by|via)\s+check|(?:via|by)\s+giro|(?:via|by)\s+paynow|by\s+wire|wire\s+transfer)$/i.test(answer);
    const isCredit = /^(?:on\s+credit|on\s+account|credit)$/i.test(answer);

    const hasPayrollOrCpfTerms = /\b(?:CPF|payroll|salar(?:y|ies)|wages?)\b/i.test(original);
    if (isCredit && (isAccruedExpenseSettlement(original) || hasPayrollOrCpfTerms)) {
      return { ...currentScenario, directGroups: [], isComplete: false };
    }

    let normalizedPhrase: string | undefined;
    if (isCash) normalizedPhrase = 'paid in cash';
    else if (isBank) normalizedPhrase = 'by bank transfer';
    else if (isCredit) normalizedPhrase = 'on credit';

    if (normalizedPhrase) {
      return matchBasicTransaction(`${baseQuery} ${normalizedPhrase}`);
    }
  }

  // salaryPaymentMethod / cpfPaymentMethod follow-up
  if (missingKeys.has('salaryPaymentMethod') || missingKeys.has('cpfPaymentMethod')) {
    if (/^(?:on\s+credit|on\s+account|credit)$/i.test(answer)) {
      return { ...currentScenario, directGroups: [], isComplete: false };
    }

    const isSnippetCash = (text: string) => /\b(?:in\s+cash|with\s+cash|by\s+cash|petty\s+cash|physical\s+cash|^cash$)\b/i.test(text.trim());
    const isSnippetBank = (text: string) => /\b(?:by\s+bank|via\s+bank|through\s+bank|bank\s+transfer|^bank$|from\s+(?:the\s+|our\s+)?bank(?:\s+account)?|(?:the\s+|our\s+)?bank(?:\s+account)?|from\s+bank|(?:by|via)\s+cheque|(?:by|via)\s+check|(?:via|by)\s+giro|(?:via|by)\s+paynow|by\s+wire|wire\s+transfer)\b/i.test(text.trim());

    // 2. Support compound two-leg answers (e.g., "salaries in cash, CPF by bank", "salaries paid in cash and CPF paid by bank transfer")
    const compoundParts = answer.split(/;|,|\band\b/i).map(s => s.trim()).filter(Boolean);
    let compoundSalaryMethod: 'cash' | 'bank' | null = null;
    let compoundCpfMethod: 'cash' | 'bank' | null = null;

    for (const p of compoundParts) {
      const mentionsSalary = /\b(?:salar(?:y|ies)|wages?|net\s+pay)\b/i.test(p);
      const mentionsCpf = /\bcpf\b/i.test(p);
      if (mentionsSalary && !mentionsCpf) {
        if (isSnippetCash(p)) compoundSalaryMethod = 'cash';
        else if (isSnippetBank(p)) compoundSalaryMethod = 'bank';
      } else if (mentionsCpf && !mentionsSalary) {
        if (isSnippetCash(p)) compoundCpfMethod = 'cash';
        else if (isSnippetBank(p)) compoundCpfMethod = 'bank';
      }
    }

    if (compoundSalaryMethod || compoundCpfMethod) {
      let suffixes = '';
      if (compoundSalaryMethod && missingKeys.has('salaryPaymentMethod')) {
        suffixes += compoundSalaryMethod === 'cash' ? '; salaries paid in cash' : '; salaries paid by bank transfer';
      }
      if (compoundCpfMethod && missingKeys.has('cpfPaymentMethod')) {
        suffixes += compoundCpfMethod === 'cash' ? '; cpf paid in cash' : '; cpf paid by bank transfer';
      }
      if (suffixes) {
        return matchBasicTransaction(`${baseQuery}${suffixes}`);
      }
    }

    // 3. Single-method answers
    const restrictsToSalary = /\b(?:salar(?:y|ies)|wages?|net\s+pay)\b/i.test(answer) && !/\bcpf\b/i.test(answer);
    const restrictsToCpf = /\bcpf\b/i.test(answer) && !/\b(?:salar(?:y|ies)|wages?|net\s+pay)\b/i.test(answer);

    const isCash = isSnippetCash(answer) || /^(?:(?:both\s+|salaries\s+|cpf\s+)?(?:paid\s+)?in\s+cash|(?:with|by)\s+cash|cash|from\s+petty\s+cash|physical\s+cash)$/i.test(answer);
    const isBank = isSnippetBank(answer) || /^(?:(?:both\s+|salaries\s+|cpf\s+)?(?:paid\s+)?(?:by|via|through)\s+(?:a\s+)?bank(?:\s+transfer)?|bank\s+transfer|bank|from\s+(?:the\s+|our\s+)?bank(?:\s+account)?|(?:the\s+|our\s+)?bank(?:\s+account)?|from\s+bank|(?:by|via)\s+cheque|(?:by|via)\s+check|(?:via|by)\s+giro|(?:via|by)\s+paynow|by\s+wire|wire\s+transfer)$/i.test(answer);

    if (isCash || isBank) {
      const chosen = isCash ? 'cash' : 'bank';
      if (restrictsToSalary && missingKeys.has('salaryPaymentMethod')) {
        return matchBasicTransaction(`${baseQuery}; salaries paid ${chosen === 'cash' ? 'in cash' : 'by bank transfer'}`);
      } else if (restrictsToCpf && missingKeys.has('cpfPaymentMethod')) {
        return matchBasicTransaction(`${baseQuery}; cpf paid ${chosen === 'cash' ? 'in cash' : 'by bank transfer'}`);
      } else if (missingKeys.has('salaryPaymentMethod') && missingKeys.has('cpfPaymentMethod')) {
        return matchBasicTransaction(`${baseQuery}; both salaries and CPF paid ${chosen === 'cash' ? 'in cash' : 'by bank transfer'}`);
      } else if (missingKeys.has('salaryPaymentMethod')) {
        return matchBasicTransaction(`${baseQuery}; salaries paid ${chosen === 'cash' ? 'in cash' : 'by bank transfer'}`);
      } else if (missingKeys.has('cpfPaymentMethod')) {
        return matchBasicTransaction(`${baseQuery}; cpf paid ${chosen === 'cash' ? 'in cash' : 'by bank transfer'}`);
      }
    }
  }

  // payrollSettlementTarget follow-up
  if (missingKeys.has('payrollSettlementTarget')) {
    if (/\b(?:no|none|neither|nor|not|never|without|unpaid|unsettled|pending)\b/i.test(answer)) {
      return { ...currentScenario, directGroups: [], isComplete: false };
    }
    const cleanedPayrollBase = baseQuery.replace(/(?:[;,.]\s*)?(?:no\s+(?:payment|settlement)[^.;]*|without\s+(?:any\s+)?(?:payment|settlement)[^.;]*|(?:payment|settlement)\s+was\s+not\s+made[^.;]*)/gi, '').trim();

    const isBoth = /\b(?:both|all|salaries\s+and\s+cpf|cpf\s+and\s+salaries)\b/i.test(answer);
    const isSalaries = !isBoth && /\b(?:salar(?:y|ies)|wages?|net\s+pay)\b/i.test(answer);
    const isCpf = !isBoth && /\bcpf\b/i.test(answer);
    const payMethodInAnswer = detectPayMethodInText(answer);
    const paySuffix = payMethodInAnswer === 'CASH' ? ' in cash' : payMethodInAnswer === 'BANK' ? ' by bank transfer' : '';

    if (isBoth) {
      return matchBasicTransaction(`${cleanedPayrollBase}; paid both salaries and CPF${paySuffix}`);
    } else if (isSalaries) {
      return matchBasicTransaction(`${cleanedPayrollBase}; paid salaries${paySuffix}; CPF remains unpaid`);
    } else if (isCpf) {
      return matchBasicTransaction(`${cleanedPayrollBase}; paid CPF${paySuffix}; salaries remain unpaid`);
    }
  }

  // periodCharge follow-up
  if (missingKeys.has('periodCharge')) {
    const cleanBaseQuery = baseQuery.replace(/;\s*(?:stated|clarified)\s+periodic\s+charge\s+is\s+(?:\bSGD\s*|S\$\s*|\$\s*)[\d,.]+/gi, '').trim();

    // Check nil residual or period follow-ups for dep/amort BEFORE chargeAmtMatch
    if (/^(?:nil|zero|no)\s+(?:residual(?:\s+value)?|salvage(?:\s+value)?)$/i.test(answer)) {
      return matchBasicTransaction(`${cleanBaseQuery}; with nil residual value`);
    }
    if (!isPrepaidExpenseRecognition(original) && /^(?:(?:over|for)\s+)?(?:a\s+useful\s+life\s+of\s+)?(\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten|twelve)\s+years?$/i.test(answer)) {
      return matchBasicTransaction(`${cleanBaseQuery}; useful life of ${answer.trim()}`);
    }
    if (!isPrepaidExpenseRecognition(original) && /^(?:annual(?:ly)?|yearly|monthly|quarterly|half[- ]year(?:ly)?|semi[- ]?annual(?:ly)?)$/i.test(answer)) {
      const normPeriod = /^(?:half[- ]year(?:ly)?|semi[- ]?annual(?:ly)?)$/i.test(answer)
        ? 'half-yearly'
        : /^annual(?:ly)?|yearly$/i.test(answer)
          ? 'annual'
          : answer.trim().toLowerCase();
      return matchBasicTransaction(`${cleanBaseQuery}; ${normPeriod} charge`);
    }

    const chargeAmtMatch = !/%/.test(answer)
      ? answer.match(/^(?:(?:it\s+is|the\s+(?:periodic\s+)?(?:depreciation\s+|amortisation\s+|amortization\s+|prepaid\s+)?(?:charge|expense|amount)\s+(?:is\s+)?|(?:periodic\s+)?(?:charge|expense)\s+(?:of\s+|is\s+)?))?(?:SGD\s*|S\$\s*|\$\s*)?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?(?:\s*SGD)?$/i)
      : null;
    if (chargeAmtMatch) {
      const w = chargeAmtMatch[1].replace(/,/g, '');
      const f = (chargeAmtMatch[2] || '').padEnd(2, '0');
      const cents = BigInt(w) * 100n + BigInt(f || '0');
      if (cents <= 0n) {
        return { ...currentScenario, directGroups: [], isComplete: false };
      }
      const digits = chargeAmtMatch[1].replace(/,/g, '') + (chargeAmtMatch[2] ? '.' + chargeAmtMatch[2] : '');
      return matchBasicTransaction(`${cleanBaseQuery}; clarified periodic charge is SGD ${digits}`);
    }

    if (isPrepaidExpenseRecognition(original)) {
      const { elapsed: origElapsed, coverage: origCoverage } = extractPrepaidElapsedAndCoverage(original);

      const durationMatch = answer.match(/^(?:(?:covering|covers|coverage\s+of|for\s+a\s+period\s+of|over\s+a\s+period\s+of|for|over)\s+)?(?:(semi[- ]annual|half\s+a\s+year|half[- ]year(?:ly)?|annual|yearly|one[- ]quarter|1[- ]quarter|quarterly)|(?:(\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+)(years?|quarters?|half[- ]years?|months?|weeks?|days?)|(years?|quarters?|half[- ]years?|months?|weeks?|days?))(?:\s+(?:have\s+|has\s+)?(elapsed|expired|used|passed))?$/i);

      if (durationMatch) {
        const isExplicitElapsed = Boolean(durationMatch[5]);
        const isExplicitCoveragePrefix = /^(?:covering|covers|coverage\s+of|for\s+a\s+period\s+of|over\s+a\s+period\s+of|for|over)\b/i.test(answer);

        if ((origElapsed && !origCoverage && !isExplicitElapsed) || isExplicitCoveragePrefix) {
          let cleanDur = answer
            .replace(/^(?:covering|covers|coverage\s+of|for\s+a\s+period\s+of|over\s+a\s+period\s+of|for|over)\s+/i, '')
            .replace(/\s+(?:have\s+|has\s+)?(?:elapsed|expired|used|passed)$/i, '')
            .trim();
          if (/^(?:annual|yearly)$/i.test(cleanDur)) {
            cleanDur = '12 months';
          } else if (/^(?:semi[- ]annual|half\s+a\s+year|half[- ]year(?:ly)?)$/i.test(cleanDur)) {
            cleanDur = '6 months';
          } else if (/^(?:quarterly|one[- ]quarter|1[- ]quarter)$/i.test(cleanDur)) {
            cleanDur = '3 months';
          }
          return matchBasicTransaction(`${cleanBaseQuery}; covering ${cleanDur}`);
        }

        if ((origCoverage && !origElapsed) || isExplicitElapsed) {
          let elapsedStr = durationMatch[1]
            || (durationMatch[2] ? `${durationMatch[2]} ${durationMatch[3]}` : (durationMatch[4] ? `1 ${durationMatch[4]}` : answer));
          if (/^(?:annual|yearly)$/i.test(elapsedStr)) {
            elapsedStr = '1 year';
          } else if (/^(?:semi[- ]annual|half\s+a\s+year|half[- ]year(?:ly)?)$/i.test(elapsedStr)) {
            elapsedStr = '6 months';
          } else if (/^(?:quarterly|one[- ]quarter|1[- ]quarter)$/i.test(elapsedStr)) {
            elapsedStr = '1 quarter';
          }
          return matchBasicTransaction(`${cleanBaseQuery}; ${elapsedStr} have elapsed`);
        }
      }
    }
  }

  // taxAmount follow-up
  if (missingKeys.has('taxAmount')) {
    const taxAmtMatch = !/%/.test(answer)
      ? answer.match(/^(?:(?:it\s+is|(?:the\s+)?(?:determined\s+)?(?:current\s+|corporate\s+|income\s+|deferred\s+)?tax(?:\s+(?:provision|amount|charge|movement))?\s+(?:is\s+|of\s+)?))?(?:SGD\s*|S\$\s*|\$\s*)?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?(?:\s*SGD)?$/i)
      : null;
    if (taxAmtMatch) {
      const w = taxAmtMatch[1].replace(/,/g, '');
      const f = (taxAmtMatch[2] || '').padEnd(2, '0');
      const cents = BigInt(w) * 100n + BigInt(f || '0');
      if (cents <= 0n) {
        return { ...currentScenario, directGroups: [], isComplete: false };
      }
      const digits = taxAmtMatch[1].replace(/,/g, '') + (taxAmtMatch[2] ? '.' + taxAmtMatch[2] : '');
      if (/\bdeferred\s+tax\b/i.test(original)) {
        return matchBasicTransaction(`${baseQuery}; stated deferred tax amount is SGD ${digits}`);
      }
      return matchBasicTransaction(`${baseQuery}; stated current tax amount is SGD ${digits}`);
    }
  }

  // deferredTaxDirection follow-up
  if (missingKeys.has('deferredTaxDirection')) {
    if (/^(?:an?\s+)?(?:increase|increasing|initial\s+recognition|additional(?:\s+recognition)?|upward)$/i.test(answer)) {
      return matchBasicTransaction(`${baseQuery}; direction is an increase`);
    }
    if (/^(?:a\s+)?(?:decrease|decreasing|reversal|reverse|reduction|reduce|write[- ]?down|downward)$/i.test(answer)) {
      return matchBasicTransaction(`${baseQuery}; direction is a decrease`);
    }
  }

  // taxType follow-up
  if (missingKeys.has('taxType')) {
    if (/^(?:(?:it\s+is|for)\s+)?(?:corporate\s+(?:income\s+)?tax|current\s+(?:income\s+)?tax|income\s+tax|company\s+tax)$/i.test(answer)) {
      return matchBasicTransaction(`${baseQuery} for corporate income tax`);
    }
  }

  // taxLiabilityStatus follow-up
  if (missingKeys.has('taxLiabilityStatus')) {
    if (/^(?:no\s+(?:existing|prior)\s+(?:tax\s+)?liability|prepaid(?:\s+income)?\s+tax|advance(?:\s+tax)?|no\s+prior\s+liability|no\s+liability)$/i.test(answer)) {
      return matchBasicTransaction(`${baseQuery}; with no existing tax liability`);
    }
    if (/^(?:settl(?:es?|ing)\s+(?:an?\s+|the\s+)?existing\s+(?:current\s+tax\s+payable|tax\s+payable|tax\s+liability)|existing\s+(?:current\s+tax\s+payable|tax\s+payable|tax\s+liability)|settl(?:es?|ing)\s+(?:an?\s+|the\s+)?existing\s+liability)$/i.test(answer)) {
      return matchBasicTransaction(`${baseQuery}; settling existing current tax payable`);
    }
  }

  // deferredTaxRecognitionLocation follow-up
  if (missingKeys.has('deferredTaxRecognitionLocation')) {
    if (/\b(?:share\s+capital|ordinary\s+share\s+capital|share\s+issue\s+costs?)\b/i.test(answer)) {
      return matchBasicTransaction(`${baseQuery}; recognised directly in Share Capital`);
    }
    if (/\b(?:retained\s+earnings|opening\s+retained\s+earnings)\b/i.test(answer)) {
      return matchBasicTransaction(`${baseQuery}; recognised directly in Retained Earnings`);
    }
    if (/\b(?:capital\s+reserve|convertible\s+bond)\b/i.test(answer)) {
      return matchBasicTransaction(`${baseQuery}; recognised directly in Capital Reserve`);
    }
    if (/\b(?:revaluation\s+surplus|oci|other\s+comprehensive\s+income)\b/i.test(answer)) {
      return matchBasicTransaction(`${baseQuery}; recognised in other comprehensive income on revaluation surplus`);
    }
  }

  // deferredTaxType follow-up
  if (missingKeys.has('deferredTaxType')) {
    if (/\b(?:deferred\s+tax\s+liability|\bdtl\b|liability)\b/i.test(answer)) {
      return matchBasicTransaction(`${baseQuery} for Deferred Tax Liability`);
    }
    if (/\b(?:deferred\s+tax\s+asset|\bdta\b|asset)\b/i.test(answer)) {
      return matchBasicTransaction(`${baseQuery} for Deferred Tax Asset`);
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
