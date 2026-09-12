import type { TransactionUnderstanding } from './transactionUnderstandingService';
import type { AccountingScenarioState } from '../types/accounting';

export type CanonicalScenarioRoute =
  | 'SHARE_CAPITAL'
  | 'PAYROLL'
  | 'LEASE'
  | 'CUSTOMER_RECEIVABLE'
  | 'SUPPLIER_PAYABLE'
  | 'DEBT'
  | 'EXTERNAL_INVESTMENT';

/**
 * Converts validated semantic facts into a compact routing decision. This is
 * deliberately based on canonical facts—not pronouns or raw query keywords.
 */
export function resolveSemanticScenario(
  understanding?: TransactionUnderstanding
): CanonicalScenarioRoute | undefined {
  if (!understanding || understanding.provenance.isFallback || understanding.confidence < 0.75) return undefined;

  if (understanding.ownershipContext === 'own_equity' || understanding.transactionType === 'share_capital_issuance') {
    return 'SHARE_CAPITAL';
  }
  if (understanding.transactionType === 'payroll_payment') return 'PAYROLL';
  if (understanding.transactionType === 'lease_contract' || understanding.transactionType === 'lease_payment') return 'LEASE';
  if (understanding.transactionType === 'customer_invoice' || understanding.instrument === 'accounts_receivable') return 'CUSTOMER_RECEIVABLE';
  if (understanding.instrument === 'accounts_payable') return 'SUPPLIER_PAYABLE';
  if (understanding.transactionType === 'debt_settlement' || understanding.instrument === 'debt_instrument') return 'DEBT';
  if (understanding.ownershipContext === 'external_investment' || understanding.transactionType === 'equity_investment_acquisition') {
    return 'EXTERNAL_INVESTMENT';
  }
  return undefined;
}

function deterministicRoute(scenario?: AccountingScenarioState | null): CanonicalScenarioRoute | undefined {
  if (!scenario) return undefined;
  if (scenario.scenarioType === 'PAYROLL_CPF_SALARY') return 'PAYROLL';
  if (scenario.scenarioType === 'LEASE_IFRS16' || scenario.scenarioType === 'COMMERCIAL_LEASE') return 'LEASE';
  if (scenario.scenarioType.startsWith('SHARE_CAPITAL')) return 'SHARE_CAPITAL';
  if (scenario.scenarioType === 'EQUITY_INVESTMENT_FX') return 'EXTERNAL_INVESTMENT';
  return undefined;
}

/** True only when validated AI semantics and deterministic routing disagree. */
export function hasSemanticRoutingConflict(
  scenario: AccountingScenarioState | null | undefined,
  understanding?: TransactionUnderstanding
): boolean {
  const semantic = resolveSemanticScenario(understanding);
  const deterministic = deterministicRoute(scenario);
  return Boolean(semantic && deterministic && semantic !== deterministic);
}
