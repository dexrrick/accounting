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
  if (allAmounts.length !== 3 && allAmounts.length !== 4) return undefined;

  const erA = /\bemployer(?:'s|s')?\s+cpf(?:\s+(?:contribution|expense|portion|share))?\s*(?:of|is|was|:|-)?\s*(?:\bSGD\s*|S\$\s*|\$\s*)(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?(?![\d]|,\d|\.\d)/gi;
  const erB = /(?:\bSGD\s*|S\$\s*|\$\s*)(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?(?![\d]|,\d|\.\d)\s*(?:of|for)?\s*employer(?:'s|s')?\s+cpf(?:\s+(?:contribution|expense|portion|share))?\b/gi;
  const employerCpfCents = extractLabelledAmount(query, erA, erB);

  const eeA = /\bemployee(?:'s|s')?\s+cpf(?:\s+(?:contribution|deduction|portion|share))?\s*(?:of|is|was|:|-)?\s*(?:\bSGD\s*|S\$\s*|\$\s*)(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?(?![\d]|,\d|\.\d)/gi;
  const eeB = /(?:\bSGD\s*|S\$\s*|\$\s*)(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?(?![\d]|,\d|\.\d)\s*(?:of|for)?\s*employee(?:'s|s')?\s+cpf(?:\s+(?:contribution|deduction|portion|share))?\b/gi;
  const employeeCpfCents = extractLabelledAmount(query, eeA, eeB);

  const gA = /\b(?:gross\s+(?:salar(?:y|ies)|wages?|pay|payroll)|(?<!\bnet\s+)(?:salar(?:y|ies)|wages?))\s*(?:of|is|was|:|-)?\s*(?:\bSGD\s*|S\$\s*|\$\s*)(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?(?![\d]|,\d|\.\d)(?!\s+payable\b)/gi;
  const gB = /(?:\bSGD\s*|S\$\s*|\$\s*)(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?(?![\d]|,\d|\.\d)\s*(?:of|for)?\s*(?:gross\s+(?:salar(?:y|ies)|wages?|pay|payroll)|(?<!\bnet\s+)(?:salar(?:y|ies)|wages?))\b(?!\s+payable\b)/gi;
  const grossCents = extractLabelledAmount(query, gA, gB);

  if (!employerCpfCents || !employeeCpfCents || !grossCents) return undefined;
  if (grossCents <= 0n || employeeCpfCents <= 0n || employerCpfCents <= 0n || employeeCpfCents >= grossCents) return undefined;

  if (allAmounts.length === 4) {
    const netA = /\bnet\s+(?:pay|salar(?:y|ies)|wages?)\s*(?:of|is|was|:|-)?\s*(?:\bSGD\s*|S\$\s*|\$\s*)(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?(?![\d]|,\d|\.\d)/gi;
    const netB = /(?:\bSGD\s*|S\$\s*|\$\s*)(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?(?![\d]|,\d|\.\d)\s*(?:of|for)?\s*net\s+(?:pay|salar(?:y|ies)|wages?)\b/gi;
    const netCents = extractLabelledAmount(query, netA, netB);
    if (!netCents || netCents !== grossCents - employeeCpfCents) return undefined;
  }

  return { grossCents, employeeCpfCents, employerCpfCents };
}

function parseNumberWordOrDigits(val: string): number | undefined {
  if (!val) return undefined;
  const cleaned = val.trim().toLowerCase().replace(/-/g, ' ');
  if (/^\d+$/.test(cleaned)) return parseInt(cleaned, 10);
  const words: Record<string, number> = {
    a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5,
    six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11,
    twelve: 12, eighteen: 18, 'twenty four': 24
  };
  return words[cleaned];
}

const NUM_WORD_OR_DIGIT = '(?:\\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|eighteen|twenty[- ]four)';

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

function isSalaryAlreadyPaid(query: string): boolean {
  const hasPaidCue = /\b(?:paid|disburse[ds]?|settled)\b/i.test(query)
    || /\bpay(?:ing)?\s+(?:monthly\s+|staff\s+|employee\s+|our\s+)?(?:salar(?:y|ies)|wages?|payroll)\b/i.test(query)
    || /\b(?:salar(?:y|ies)|wages?|payroll|net\s+pay)\s+(?:were\s+|was\s+|have\s+been\s+|has\s+been\s+)?(?:paid|disbursed|transferred)\b/i.test(query);
  const isUnpaidOrAccrual = /\b(?:unpaid|not\s+(?:yet\s+)?paid|yet\s+to\s+be\s+paid|accrue[ds]?|accrual)\b/i.test(query);
  return hasPaidCue && !isUnpaidOrAccrual;
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
  return /\b(?:(?:current|corporate|company)\s+(?:income\s+)?tax(?:\s+payable|\s+liability|\s+assessment|\s+bill|\s+instalment)?|income\s+tax(?:\s+payable|\s+liability|\s+assessment|\s+bill|\s+instalment)?|iras\s+(?:corporate\s+|income\s+|current\s+)tax(?:\s+bill|\s+assessment|\s+payable)?|estimated\s+chargeable\s+income|\beci\b\s+(?:tax|instalment|assessment))\b/i.test(query);
}

function hasUnspecifiedIrasOrTaxPaymentTarget(query: string): boolean {
  return !hasExplicitIncomeTaxTarget(query) && getAllAmounts(query).length > 0 && /\b(?:(?:pay|paid|paying|remit(?:ted|ting)?|settle[ds]?|transferred)\s+(?:(?:\bSGD\s*|S\$\s*|\$\s*)[\d,.]+\s+)?(?:to\s+)?iras\b|iras\s+(?:tax\s+)?(?:bill|assessment|payment|payable)|(?<!\b(?:current|corporate|company|income|deferred|property|withholding|input|output)\s)tax\s+(?:payable|bill|assessment)(?:\s+to\s+iras)?)\b/i.test(query);
}

function isPayrollAccrual(query: string): boolean {
  if (/\b(?:calculat\w*|comput\w*|how\s+much|what\s+is\s+(?:his|her|the)\s+(?:cpf|salary|prorat\w*)|years?\s+old|\baged?\s+\d+|singaporean|citizen|permanent\s+resident|\bpr\b|foreigner|work\s+permit|employment\s+pass|\bs\s+pass\b|last\s+day|prorat\w*|resign\w*|incomplete\s+month|ordinary\s+wage|aw\s+ceiling|cpf\s+ceiling|cpf\s+rate|skills\s+development\s+levy|\bsdl\b)\b/i.test(query)) {
    return false;
  }
  return Boolean(extractPayrollAmounts(query));
}

function isPayrollNetPaySettlement(query: string): boolean {
  const paymentVerb = /\b(?:pay|paid|paying|settle[ds]?|settling|settlement|disburse[ds]?|transfer(?:red)?|remit(?:ted)?)\b/i.test(query);
  const target = /\b(?:net\s+(?:salar(?:y|ies)|wages?|pay|payroll)|salar(?:y|ies)\s+payable|wages?\s+payable|accrued\s+(?:salar(?:y|ies)|wages?)|staff\s+salaries\s+payable)\b/i.test(query);
  const notCpfOrCalc = !/\b(?:cpf|gross\s+(?:salar(?:y|ies)|wages?|pay)|calculat\w*|comput\w*|how\s+much|years?\s+old|singaporean|\bpr\b|last\s+day|prorat\w*|resign\w*|employment\s+act|salary\s+deadline)\b/i.test(query);
  return paymentVerb && target && notCpfOrCalc;
}

function isCpfRemittance(query: string): boolean {
  const paymentVerb = /\b(?:pay|paid|paying|remit(?:ted|ting|tance)?|settle[ds]?|settling|settlement|transfer(?:red)?)\b/i.test(query);
  const target = /\b(?:cpf\s+payable|cpf\s+contributions?|cpf\s+to\s+(?:the\s+)?cpf\s+board|(?:the\s+)?cpf\s+board)\b/i.test(query);
  const notAccrualOrCalc = !/\b(?:gross\s+(?:salar(?:y|ies)|wages?)|earning|earns|years?\s+old|singaporean|\bpr\b|last\s+day|prorat\w*|resign\w*|calculat\w*|comput\w*|how\s+much|cpf\s+ceiling|ordinary\s+wage|aw\s+ceiling|cpf\s+rate|senior\s+worker|deadline|late\s+payment)\b/i.test(query);
  return paymentVerb && target && notAccrualOrCalc;
}

function isPrepaidExpenseRecognition(query: string): boolean {
  const hasPrepaid = /\bprepaid\s+(?:rent|rental|insurance|expenses?|subscriptions?|maintenance|advertising|fees?)\b/i.test(query);
  if (!hasPrepaid) return false;
  const hasExpiryOrAdjustment = /\b(?:expir(?:ed|es|ing)|consum(?:ed|es|ing)|used(?:\s+up)?|elaps(?:ed|es)|amorti[sz](?:e|ed|es|ing)|releas(?:e|ed|es|ing)|adjust(?:ing|ment)|recogni[sz](?:e|ed|es|ing))\b/i.test(query)
    || /\b(?:for\s+the\s+(?:month|quarter|half[- ]year)|(?:for|over)\s+(?:\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(?:months?|quarters?|half[- ]years?|years?|weeks?|days?)|(?:quarterly|monthly|half[- ]yearly|semi[- ]annual)\s+(?:adjustment|recognition|charge|expense))\b/i.test(query);
  if (!hasExpiryOrAdjustment) return false;
  const isInitialPaymentWithoutAdjustment = /\b(?:by\s+bank|in\s+cash|from\s+(?:the\s+|our\s+)?bank|bank\s+transfer)\b/i.test(query)
    && !/\b(?:expir\w*|consum\w*|used(?:\s+up)?|elaps\w*|amorti[sz]\w*|releas\w*|adjust(?:ing|ment)|recogni[sz]\w*|record\w*)\b/i.test(query);
  return !isInitialPaymentWithoutAdjustment;
}

function isDepOrAmortOnPreviouslyAcquiredAsset(query: string): boolean {
  return /\b(?:record|recogni[sz]\w*|book|post|journal(?:\s+entry)?\s+for)\b[\s\S]*?\b(?:depreciat\w*|amorti[sz]\w*)\b[\s\S]*?\b(?:purchas\w*|bought|acquir\w*)\b/i.test(query)
    && !/\b(?:trade[- ]?in|by\s+bank|in\s+cash|on\s+credit|bank\s+transfer|list\s+price|trade\s+discount)\b/i.test(query);
}

function isDepreciationCharge(query: string): boolean {
  if (!/\bdepreciat(?:e|ed|ing|ion)\b/i.test(query)) return false;
  const hasBookingCue = /\b(?:record|recogni[sz](?:e|ed|ing)|book|post|charge[ds]?|expense|journal|double\s+entry|debit|credit|for\s+the\s+(?:year|month|quarter|period)|annual|monthly)\b/i.test(query);
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
  const hasPaymentVerb = /\b(?:pay|paid|paying|settle[ds]?|settling|settlement|remit(?:ted|ting)?|transferred)\b/i.test(query);
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

function resolveDeferredTaxAmount(query: string): { cents?: bigint; missing?: MissingFieldInfo } {
  const dtOverride = query.match(/\bstated\s+deferred\s+tax\s+amount\s+is\s+(?:\bSGD\s*|S\$\s*|\$\s*)(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?(?![\d]|,\d|\.\d)/i);
  if (dtOverride) {
    const w = dtOverride[1].replace(/,/g, '');
    const f = (dtOverride[2] || '').padEnd(2, '0');
    const cents = BigInt(w) * 100n + BigInt(f || '0');
    if (cents > 0n) return { cents };
  }

  const allAmounts = getAllAmounts(query);
  const taxMatchA = /(?:deferred\s+tax(?:\s+(?:liabilit(?:y|ies)|assets?|movement|adjustment))?|\bdtl\b|\bdta\b)\s+(?:in\s+profit\s+or\s+loss\s+)?(?:of\s+|is\s+|was\s+|by\s+)?(?:\bSGD\s*|S\$\s*|\$\s*)(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?(?![\d]|,\d|\.\d)/gi;
  const taxMatchB = /(?:\bSGD\s*|S\$\s*|\$\s*)(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?(?![\d]|,\d|\.\d)\s+(?:of\s+|for\s+|in\s+)?(?:deferred\s+tax(?:\s+(?:liabilit(?:y|ies)|assets?))?|\bdtl\b|\bdta\b)\b/gi;
  const labelledDtCents = extractLabelledAmount(query, taxMatchA, taxMatchB);
  if (labelledDtCents) {
    return { cents: labelledDtCents };
  }

  if (allAmounts.length === 1 && !/\btemporary\s+differences?\b/i.test(query) && !/\b\d+(?:\.\d+)?\s*%/.test(query)) {
    return { cents: allAmounts[0].cents };
  }

  return {
    missing: need('taxAmount', 'Deferred tax movement amount', 'What is the SGD deferred tax movement amount to recognise?')
  };
}

function resolvePeriodAdjustmentCharge(
  templateId: string,
  query: string
): { cents?: bigint; note?: string; missing?: MissingFieldInfo } {
  // Canonical follow-up override FIRST
  const periodicOverride = query.match(/\bstated\s+periodic\s+charge\s+is\s+(?:\bSGD\s*|S\$\s*|\$\s*)(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?(?![\d]|,\d|\.\d)/i);
  if (periodicOverride) {
    const w = periodicOverride[1].replace(/,/g, '');
    const f = (periodicOverride[2] || '').padEnd(2, '0');
    const cents = BigInt(w) * 100n + BigInt(f || '0');
    if (cents > 0n) {
      return { cents };
    }
  }

  const allAmounts = getAllAmounts(query);

  if (templateId === 'PREPAID_EXPENSE_RECOGNITION') {
    if (allAmounts.length === 0) {
      return { missing: need('amount', 'Prepaid amount', 'What is the prepaid amount in SGD?') };
    }
    if (allAmounts.length > 1) {
      return { missing: need('periodCharge', 'Prepaid expense amount', 'Multiple SGD amounts were stated; please provide the exact SGD prepaid expense amount to recognise for the period.') };
    }

    // Extract elapsed duration
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

    const covClause = new RegExp(`\\b(?:covering|covers|coverage\\s+of|for\\s+a\\s+period\\s+of|over\\s+a\\s+period\\s+of|for|over)\\s+(?:(semi[- ]annual|half\\s+a\\s+year)|(?:(${NUM_WORD_OR_DIGIT})\\s+)?(years?|quarters?|half[- ]years?|months?|weeks?|days?))\\b`, 'i');

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
        coverage = { family: 'MONTH', units: 6 };
      } else if (cc[3]) {
        coverage = parseDurationUnit(cc[2] || '1', cc[3]);
      }
    }

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
      const numerator = allAmounts[0].cents * BigInt(elapsed.units);
      const denom = BigInt(coverage.units);
      if (numerator % denom !== 0n) {
        return {
          missing: need('periodCharge', 'Exact period expense amount', 'The prepaid allocation does not divide into exact integer cents; please state the exact SGD expense amount to recognise for the period.')
        };
      }
      const chargeCents = numerator / denom;
      return {
        cents: chargeCents,
        note: ' Prepaid expense allocation: (SGD ' + (Number(allAmounts[0].cents) / 100).toFixed(2) + ' × ' + elapsed.units + ') ÷ ' + coverage.units + ' = SGD ' + (Number(chargeCents) / 100).toFixed(2) + '.'
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

  const hasFormulaCues = (Boolean(costM) || Boolean(resMatchA || resMatchB || isZeroRes)) && /\b\d+\s*(?:years?|months?)(?!\s+ago\b)/i.test(query);

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

    const yMatch = query.match(/\b(\d+)\s*years?(?!\s+ago\b)/i);
    const mMatch = query.match(/\b(\d+)\s*months?(?!\s+ago\b)/i);
    if (!yMatch && !mMatch) {
      return { missing: need('periodCharge', 'Useful life or period charge', 'Please state the useful life in years/months or provide the periodic charge in SGD.') };
    }

    let divisor: bigint;
    if (yMatch) {
      const y = BigInt(yMatch[1]);
      if (/\b(?:monthly|for\s+the\s+month|1\s+month|per\s+month)\b/i.test(query)) {
        divisor = y * 12n;
      } else {
        divisor = y;
      }
    } else {
      divisor = BigInt(mMatch![1]);
    }

    if (costCents <= residualCents || divisor <= 0n) {
      return { missing: need('periodCharge', 'Valid cost and useful life', 'Asset cost must exceed residual value and useful life must be positive.') };
    }

    const depreciableCents = costCents - residualCents;
    if (depreciableCents % divisor !== 0n) {
      return {
        missing: need('periodCharge', 'Exact period charge', 'The straight-line calculation does not divide into exact integer cents; please state the exact SGD charge to post.')
      };
    }

    const chargeCents = depreciableCents / divisor;
    return {
      cents: chargeCents,
      note: ' Straight-line calculation: (SGD ' + (Number(costCents) / 100).toFixed(2) + ' − SGD ' + (Number(residualCents) / 100).toFixed(2) + ') ÷ ' + divisor.toString() + ' = SGD ' + (Number(chargeCents) / 100).toFixed(2) + '.'
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
  return /\b(?:accrue[ds]?|accrual|incurred\s+but\s+(?:not\s+yet\s+(?:paid|billed)|unpaid|unbilled)|unpaid\s+at\s+(?:month|quarter|year|period)[- ]end)\b/i.test(query) &&
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
    debitAccount = /\brent\b/i.test(query) ? asset('Prepaid Rent', '1300') : asset('Prepaid Expenses', '1300');
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
      if (isSalaryAlreadyPaid(q)) {
        const cashPaid = /\b(?:in\s+cash|with\s+cash|by\s+cash|cash\s+payment|cash\s+paid|from\s+petty\s+cash|physical\s+cash)\b/i.test(q);
        const bankPaid = /\b(?:by\s+bank|via\s+bank|through\s+bank|from\s+(?:the\s+|our\s+)?bank|bank\s+transfer|bank\s+payment|bank\s+account|by\s+cheque|by\s+check|via\s+giro|by\s+giro|via\s+paynow|by\s+paynow|wire\s+transfer|paid\s+(?:online|electronically))\b/i.test(q);
        if (cashPaid === bankPaid) {
          return {
            debit: expense('Salaries and Wages Expense', '5100'),
            credit: liability('Salaries Payable', '2110'),
            missing: [need('paymentMethod', 'Salary payment method', 'Were the salaries paid in cash or from a bank account?')]
          };
        }
        return {
          debit: expense('Salaries and Wages Expense', '5100'),
          credit: cashPaid ? cash() : bank()
        };
      }
      return { debit: expense('Salaries and Wages Expense', '5100'), credit: liability('Salaries Payable', '2110') };
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
      const cashPaid = /\b(?:in\s+cash|with\s+cash|by\s+cash|cash\s+payment|cash\s+paid|from\s+petty\s+cash|physical\s+cash)\b/i.test(q);
      const bankPaid = /\b(?:by\s+bank|via\s+bank|through\s+bank|from\s+(?:the\s+|our\s+)?bank|bank\s+transfer|bank\s+payment|bank\s+account|by\s+cheque|by\s+check|via\s+giro|by\s+giro|via\s+paynow|by\s+paynow|wire\s+transfer|paid\s+(?:online|electronically))\b/i.test(q);
      if (cashPaid === bankPaid) {
        return {
          debit: liability('Salaries Payable', '2110'),
          missing: [need('paymentMethod', 'Payment method', 'Were the salaries paid in cash or from a bank account?')]
        };
      }
      return {
        debit: liability('Salaries Payable', '2110'),
        credit: cashPaid ? cash() : bank()
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
      /\b(?:accrue[ds]?|accrual|incurred\s+but\s+(?:not\s+yet\s+(?:paid|billed)|unpaid|unbilled)|unpaid\s+at\s+(?:month|quarter|year|period)[- ]end)\b/i
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
      /\b(?:cpf\s+payable|cpf\s+contributions?|cpf\s+to\s+(?:the\s+)?cpf\s+board|(?:the\s+)?cpf\s+board)\b/i
    ],
    accounts: () => ({ debit: liability('CPF Payable', '2120'), credit: bank() }),
    rationale: 'Remittance of accrued CPF contributions to CPF Board extinguishes the CPF Payable liability.'
  },
  {
    id: 'PREPAID_EXPENSE_RECOGNITION',
    title: 'Recognition of expired prepaid expense',
    patterns: [
      /\bprepaid\s+(?:rent|rental|insurance|expenses?|subscriptions?|maintenance|advertising|fees?)\b/i,
      /\b(?:expir(?:ed|es|ing)|consum(?:ed|es|ing)|used(?:\s+up)?|elaps(?:ed|es)|amorti[sz](?:e|ed|es|ing)|releas(?:e|ed|es|ing)|adjust(?:ing|ment)|recogni[sz](?:e|ed|es|ing)|for\s+the\s+(?:month|quarter|half[- ]year)|(?:for|over)\s+(?:\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(?:months?|quarters?|half[- ]years?|years?|weeks?|days?)|(?:quarterly|monthly|half[- ]yearly|semi[- ]annual)\s+(?:adjustment|recognition|charge|expense))\b/i
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
      /\b(?:record|recogni[sz](?:e|ed|ing)|book|post|charge[ds]?|expense|journal|double\s+entry|debit|credit|for\s+the\s+(?:year|month|quarter|period)|annual|monthly)\b/i
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
      /\b(?:pay|paid|paying|settle[ds]?|settling|settlement|remit(?:ted|ting)?|transferred)\b/i,
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
      if (/\b(?:revaluation(?:\s+surplus|\s+reserve|\s+gain)?|fvoci|fair\s+value\s+through\s+other\s+comprehensive\s+income|other\s+comprehensive\s+income|\boci\b|cash\s+flow\s+hedge)\b/i.test(q)) {
        return {
          missing: [need('deferredTaxRecognitionLocation', 'Deferred tax recognition outside profit or loss (SFRS(I) 1-12)', 'Deferred tax relating to items recognised in other comprehensive income (such as revaluation surplus or FVOCI investments) is recognised in OCI rather than profit or loss under SFRS(I) 1-12. Please clarify the OCI reserve account and whether a deferred tax liability or asset applies.')]
        };
      }
      const isDtl = /\bdeferred\s+tax\s+liabilit(?:y|ies)|\bdtl\b/i.test(q);
      const isDta = /\bdeferred\s+tax\s+assets?|\bdta\b/i.test(q);
      if ((!isDtl && !isDta) || (isDtl && isDta)) {
        return {
          missing: [need('deferredTaxType', 'Deferred tax asset or liability', 'Is this movement in a Deferred Tax Liability or a Deferred Tax Asset?')]
        };
      }

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
      /\b(?:pay|paid|prepaid|purchase|purchased|bought|payment|record|settle|settled|settling|settlement)\b/i,
      /\b(?:rent|office supplies|stationery|utilities|utility|electricity|water bill)\b|\b(?:refundable|security|rental)\s+deposit\b|\b(?:prepaid\s+(?:rent|insurance|expenses?)|(?:rent|insurance|expenses?)\s+in\s+advance)\b|\b(?:previously\s+accrued|accrued\s+(?:last|previous|prior)\s+(?:month|quarter|period|year)|(?:paid|pay|settle[ds]?|settling|clear(?:ed)?)\s+(?:the\s+|an?\s+|our\s+)?(?:previously\s+)?accrued\b|accrued\s+(?:[\w\s]{1,25}?)\s+(?:was|were)\s+(?:paid|settled))\b/i
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
  if (/\b(?:GST|share(?:s|holder)?|FVTPL|forex|foreign exchange|FX|lease|tenancy)\b/i.test(query) ||
      (/\bFVOCI\b/i.test(query) && !/\bdeferred\s+tax\b/i.test(query)) ||
      /\brental agreement\b/i.test(query) ||
      /\b(?:USD|EUR|GBP|AUD|MYR|JPY|CNY)\b/i.test(query) ||
      /\btransaction\s*[12]\b/i.test(query) ||
      /\b(?:bond|non[- ]?poci|poci|significant\s+increase\s+in\s+credit\s+risk|sppi|12-month\s+or\s+lifetime)\b/i.test(query)) return undefined;

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
      (item.id !== 'SALARY_PAYMENT' || (!hasStatutoryPayrollCalcCues(query) && /\b(?:paid|pay|disburse[ds]?)\b/i.test(query) && /\b(?:salar(?:y|ies)|wages?)\b/i.test(query) && !/\b(?:net\s+(?:salar(?:y|ies)|wages?|pay|payroll)|payable|accrue[ds]?|accrual|unpaid)\b/i.test(query))) &&
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

  // 7. Period adjustments (prepaid expense recognition, depreciation, amortisation)
  const isPeriodAdjustment =
    template.id === 'PREPAID_EXPENSE_RECOGNITION' ||
    template.id === 'DEPRECIATION_CHARGE' ||
    template.id === 'AMORTISATION_CHARGE';
  const periodAdjustment = isPeriodAdjustment ? resolvePeriodAdjustmentCharge(template.id, query) : undefined;

  // 8. Current tax provision
  const isCurrentTax = template.id === 'CURRENT_TAX_PROVISION';
  const currentTaxRes = isCurrentTax ? resolveCurrentTaxAmount(query) : undefined;

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
    !periodAdjustment?.cents &&
    !currentTaxRes?.cents &&
    !deferredTaxRes?.cents
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
    Boolean(payrollSplit) ||
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

  // Branch: Monthly payroll and CPF accrual
  if (payrollSplit) {
    const grossAmount = Number(payrollSplit.grossCents) / 100;
    const employerCpfAmount = Number(payrollSplit.employerCpfCents) / 100;
    const netPayCents = payrollSplit.grossCents - payrollSplit.employeeCpfCents;
    const netPayAmount = Number(netPayCents) / 100;
    const totalCpfCents = payrollSplit.employeeCpfCents + payrollSplit.employerCpfCents;
    const totalCpfAmount = Number(totalCpfCents) / 100;
    const totalCents = payrollSplit.grossCents + payrollSplit.employerCpfCents;
    const totalAmount = Number(totalCents) / 100;

    const salaryPaid = isSalaryAlreadyPaid(query);
    const payrollCashPaid = /\b(?:in\s+cash|with\s+cash|by\s+cash|cash\s+payment|cash\s+paid|from\s+petty\s+cash|physical\s+cash)\b/i.test(query);
    const isCpfAlsoPaid = /\b(?:remit(?:ted|ting)?\s+(?:the\s+)?cpf|cpf\s+(?:was\s+|were\s+|also\s+)?(?:paid|remitted|settled)|paid\s+(?:both\s+)?(?:salar(?:y|ies)|wages?|net\s+pay)\s+and\s+cpf)\b/i.test(query) && !/\bcpf\s+(?:is\s+|remains?\s+)?(?:unpaid|payable|to\s+be\s+(?:paid|remitted))\b/i.test(query);

    const title = salaryPaid
      ? (isCpfAlsoPaid ? 'Monthly payroll and CPF payment' : 'Monthly payroll payment and CPF accrual')
      : template.title;
    const rationale = salaryPaid
      ? (isCpfAlsoPaid
          ? 'Under SFRS(I) 1-19, short-term employee benefits (gross salaries and employer CPF contributions) are recognised as expenses when employees render service, with net salaries and CPF contributions paid from cash or bank.'
          : 'Under SFRS(I) 1-19, short-term employee benefits (gross salaries and employer CPF contributions) are recognised as expenses when employees render service, with net salaries paid from cash or bank and combined employee and employer CPF payable to CPF Board.')
      : template.rationale;

    let lines: JournalLine[] = [];
    if (isComplete) {
      if (salaryPaid) {
        const payAcct = payrollCashPaid ? cash() : bank();
        if (isCpfAlsoPaid) {
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
              accountCode: payAcct.code,
              accountName: payAcct.name,
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
              id: 'basic-payroll-payment',
              accountCode: payAcct.code,
              accountName: payAcct.name,
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
        }
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

    const groupId = salaryPaid
      ? (isCpfAlsoPaid ? 'basic-payroll_payment' : 'basic-payroll_payment_accrual')
      : 'basic-payroll_accrual';

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
      directGroups: isComplete ? [{
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
  const rationale = template.rationale + (periodAdjustment?.note ? periodAdjustment.note : '') + (skipGstSuffix
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
    const isCash = /^(?:(?:paid\s+)?in\s+cash|(?:with|by)\s+cash|cash|from\s+petty\s+cash|physical\s+cash)$/i.test(answer);
    const isBank = /^(?:(?:paid\s+)?(?:by|via|through)\s+(?:a\s+)?bank\s+transfer|bank\s+transfer|from\s+(?:the\s+|our\s+)?bank(?:\s+account)?|bank\s+account|from\s+bank|(?:by|via)\s+cheque|(?:by|via)\s+check|(?:via|by)\s+giro|(?:via|by)\s+paynow|by\s+wire|wire\s+transfer)$/i.test(answer);
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

  // periodCharge follow-up
  if (missingKeys.has('periodCharge')) {
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
      return matchBasicTransaction(`${baseQuery}; stated periodic charge is SGD ${digits}`);
    }

    if (isPrepaidExpenseRecognition(original)) {
      const elapsedReply = answer.match(/^(?:(\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(months?|quarters?|half[- ]years?|years?|weeks?|days?))(?:\s+(?:have\s+|has\s+)?(?:elapsed|expired|used|passed))?$/i);
      if (elapsedReply) {
        return matchBasicTransaction(`${baseQuery}; ${elapsedReply[1]} ${elapsedReply[2]} have elapsed`);
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
