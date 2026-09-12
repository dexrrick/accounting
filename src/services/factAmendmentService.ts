import type { AccountingScenarioState } from '../types/accounting';

export type FollowUpIntent = 'NEW_TRANSACTION' | 'SETTLEMENT' | 'HYPOTHETICAL_PROJECTION' | 'FACT_AMENDMENT' | 'QUESTION';

export interface FactAmendment {
  field: string;
  value: string | number | boolean | null;
  priorValue?: string | number | boolean | null;
  confidence: number;
  evidence: string;
  source: 'deterministic' | 'ai';
  timestamp: string;
}

export interface FollowUpResolution {
  intent: FollowUpIntent;
  amendments?: FactAmendment[];
  clarificationNeeded?: string;
}

const CORRECTION_MARKER = /\b(i mean|actually|correction|correct(?:ion|ed)?|rather|instead|not\s+\S+\s+but)\b/i;

function parseAmount(query: string): number | undefined {
  const match = query.match(/(?:sgd|usd|eur|gbp|\$)?\s*([\d,]+(?:\.\d+)?)\s*(k|m|million|thousand)?\s*(?:a\s*month|\/month|monthly|per\s*month)?/i);
  if (!match?.[1]) return undefined;
  let amount = Number(match[1].replace(/,/g, ''));
  const magnitude = match[2]?.toLowerCase();
  if (magnitude === 'k' || magnitude === 'thousand') amount *= 1000;
  if (magnitude === 'm' || magnitude === 'million') amount *= 1000000;
  return Number.isFinite(amount) && amount > 0 ? amount : undefined;
}

function primaryAmountField(scenario: AccountingScenarioState, query: string): string | undefined {
  const q = query.toLowerCase();
  switch (scenario.scenarioType) {
    case 'PAYROLL_CPF_SALARY': return 'monthlySalary';
    case 'LEASE_IFRS16':
    case 'COMMERCIAL_LEASE': return 'leasePaymentMonthly';
    case 'EQUITY_INVESTMENT_FX':
      if (q.includes('rate') || q.includes('fx')) return q.includes('sale') || q.includes('disposal') ? 'disposalFxRate' : 'acquisitionFxRate';
      return q.includes('sale') || q.includes('proceed') ? 'disposalAmount' : 'purchaseAmountForeign';
    case 'CUSTOMER_INVOICE': return q.includes('paid') || q.includes('settle') ? 'settlementAmount' : 'invoiceAmount';
    case 'SUPPLIER_INVOICE': return q.includes('paid') || q.includes('settle') ? 'settlementAmount' : 'invoiceAmount';
    case 'DEBT':
    case 'DEBT_SETTLEMENT': return q.includes('repay') || q.includes('paid') ? 'repaymentAmount' : 'principalAmount';
    default:
      // A scenario with one established amount can accept an explicit correction;
      // otherwise it must be clarified rather than guessed.
      return scenario.amount && scenario.amount > 0 ? 'amount' : undefined;
  }
}

export function resolveFactAmendment(query: string, scenario?: AccountingScenarioState | null): FollowUpResolution {
  if (!scenario || !CORRECTION_MARKER.test(query)) return { intent: 'QUESTION' };

  const amount = parseAmount(query);
  if (amount === undefined) {
    return {
      intent: 'FACT_AMENDMENT',
      clarificationNeeded: 'I recognised a correction, but could not identify the corrected value.'
    };
  }

  const field = primaryAmountField(scenario, query);
  if (!field) {
    return {
      intent: 'FACT_AMENDMENT',
      clarificationNeeded: 'Which existing amount should be replaced by this corrected value?'
    };
  }

  return {
    intent: 'FACT_AMENDMENT',
    amendments: [{
      field,
      value: amount,
      priorValue: scenario.amount,
      confidence: 0.92,
      evidence: query,
      source: 'deterministic',
      timestamp: new Date().toISOString()
    }]
  };
}

/** Applies a validated patch immutably; journal lines are never edited directly. */
export function applyFactAmendments(
  scenario: AccountingScenarioState,
  amendments: FactAmendment[]
): AccountingScenarioState {
  const next: AccountingScenarioState = { ...scenario, factAmendments: [...(scenario.factAmendments || []), ...amendments] };
  for (const amendment of amendments) {
    if (typeof amendment.value !== 'number') continue;
    switch (amendment.field) {
      case 'monthlySalary': next.amount = amendment.value; break;
      case 'leasePaymentMonthly': next.leasePaymentMonthly = amendment.value; break;
      case 'purchaseAmountForeign': next.purchaseAmountForeign = amendment.value; break;
      case 'disposalAmount': next.saleAmountForeign = amendment.value; break;
      case 'acquisitionFxRate': next.purchaseFxRate = amendment.value; break;
      case 'disposalFxRate': next.saleFxRate = amendment.value; break;
      case 'amount': next.amount = amendment.value; break;
    }
  }
  return next;
}

/** Supplies canonical wording plus prior facts to existing deterministic calculators. */
export function buildAmendedQuery(
  scenario: AccountingScenarioState,
  amendments: FactAmendment[]
): string {
  const phrases = amendments.map(({ field, value }) => {
    const amount = typeof value === 'number' ? `SGD ${value.toLocaleString()}` : String(value);
    switch (field) {
      case 'monthlySalary': return `Corrected monthly salary is ${amount}.`;
      case 'leasePaymentMonthly': return `Corrected monthly lease payment is ${amount}.`;
      case 'purchaseAmountForeign': return `Corrected investment purchase amount is ${amount}.`;
      case 'disposalAmount': return `Corrected investment disposal proceeds are ${amount}.`;
      case 'acquisitionFxRate': return `Corrected acquisition FX rate is ${value}.`;
      case 'disposalFxRate': return `Corrected disposal FX rate is ${value}.`;
      default: return `Corrected transaction amount is ${amount}.`;
    }
  });
  return `${phrases.join(' ')} Original transaction context: ${scenario.rawQuery}`;
}
