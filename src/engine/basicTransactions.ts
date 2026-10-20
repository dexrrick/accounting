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
  if (/\b(?:rent|rental|utilities|utility|electricity|water\s+bill|office\s+supplies|stationery|deposit|loan|principal|interest|invoice|bill|goods|products|services|merchandise|inventory|salary|salaries|wages|expense|purchase|purchased|bought|sold|sale)\b/i.test(query)) return false;
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
    id: 'CUSTOMER_RECEIPT', title: 'Receipt of outstanding customer invoice',
    patterns: [/\b(?:receipt|received|receives|receiving|receive|collect|collected|settling|settlement|paid)\b/i, /\b(?:customer|client)\b/i, /\b(?:invoice|receivable|outstanding)\b/i],
    accounts: q => {
      if (/\b(?:discount|rebate|less\s+\d+%)\b/i.test(q)) {
        return {
          missing: [need('discountBreakdown', 'Discount and gross invoice amounts', 'What is the gross receivable amount being settled and the discount allowed?')]
        };
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
  if (/\b(?:GST|CPF|payroll|salar(?:y|ies)|share(?:s|holder)?|FVTPL|FVOCI|forex|foreign exchange|FX|lease|tenancy)\b/i.test(query) ||
      /\brental agreement\b/i.test(query) ||
      /\b(?:USD|EUR|GBP|AUD|MYR|JPY|CNY)\b/i.test(query)) return undefined;

  // Customer invoice settlements take priority over a generic "bank transfer".
  // A third-party payment is not a transfer between the entity's own accounts.
  const externalParty = /\b(?:customer|client|supplier|vendor|third.party)\b/i.test(query);
  const customerReceiptAllowed = customerReceiptDirection(query) && !customerPaymentOutflow(query);
  const template = personalOwnerWithdrawal(query) ? ownerDrawingsTemplate :
    templates.find(item => (!externalParty || item.id !== 'BANK_TRANSFER') &&
      (item.id !== 'CUSTOMER_RECEIPT' || customerReceiptAllowed) &&
      (item.id !== 'BANK_TRANSFER' || isBankTransfer(query)) &&
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

  const missingFields: MissingFieldInfo[] = [];

  if (allAmounts.length === 0) {
    missingFields.push(need('amount', 'Transaction amount', 'What is the transaction amount in SGD?'));
  } else if (allAmounts.length > 1 && !loanSplit && !saleAndCost) {
    missingFields.push(need('amount', 'Transaction amount', 'Multiple SGD amounts were stated; please clarify which amount applies to each part of the transaction.'));
  }

  if (pair.missing) {
    missingFields.push(...pair.missing);
  }

  const isComplete = missingFields.length === 0 && (
    Boolean(loanSplit) ||
    Boolean(saleAndCost && pair.debit && pair.credit) ||
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

  // Branch C: Standard single-amount transaction
  const cents = amountCents(query);
  const amount = cents ? Number(cents) / 100 : undefined;
  const rationale = template.rationale + (/\b(?:WITHDRAWAL|TRANSFER)\b/.test(template.id)
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
    const amountMatch = answer.match(/^(?:SGD\s*|S\$\s*|\$\s*)(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/i)
      || answer.match(/^(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?\s*SGD$/i);
    if (amountMatch) {
      const digits = amountMatch[1] + (amountMatch[2] ? '.' + amountMatch[2] : '');
      return matchBasicTransaction(`${baseQuery} for SGD ${digits}`);
    }
  }

  return undefined;
}
