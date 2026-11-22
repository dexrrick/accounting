import type { TransactionUnderstanding } from './transactionUnderstandingService';
import type { AccountingScenarioState } from '../types/accounting';
import type { SemanticQuestionUnderstanding } from './semanticQuestionUnderstanding';
import { resolveActiveScenarioDomains } from './conversationBoundary';

export type CanonicalScenarioRoute =
  | 'SHARE_CAPITAL'
  | 'PAYROLL'
  | 'LEASE'
  | 'ASSET_PURCHASE'
  | 'EXPENSE'
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
  if (understanding.transactionType === 'asset_purchase' || understanding.transactionType === 'trade_discount_purchase') return 'ASSET_PURCHASE';
  if (understanding.transactionType === 'expense_payment') return 'EXPENSE';
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
  if (
    scenario.scenarioType === 'BUSINESS_EQUIPMENT_ACQUISITION' ||
    scenario.scenarioType === 'PPE_ASSET_PURCHASE' ||
    scenario.scenarioType === 'ASSET_PURCHASE_DISCOUNT'
  ) {
    return 'ASSET_PURCHASE';
  }
  if (scenario.scenarioType === 'GENERAL_EXPENSE') return 'EXPENSE';
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

const PAYROLL_OR_EMPLOYMENT_SUBJECT_PATTERN =
  /\b(?:payroll|salary|salaries|wages?|cpf|remuneration|employee\s+(?:pay|compensation|benefits?))\b/i;

function semanticIndicatesPayrollOrEmployment(
  questionUnderstanding?: SemanticQuestionUnderstanding
): boolean {
  if (questionUnderstanding?.mode !== 'SEMANTIC_INTERPRETATION' || !questionUnderstanding.interpretation) {
    return false;
  }
  const interp = questionUnderstanding.interpretation;
  return (
    interp.domain === 'CPF_PAYROLL' ||
    interp.domain === 'MOM_EMPLOYMENT' ||
    interp.authorityCandidates.some(a => a === 'CPF' || a === 'MOM') ||
    interp.contextualAuthorities.some(a => a === 'CPF' || a === 'MOM') ||
    PAYROLL_OR_EMPLOYMENT_SUBJECT_PATTERN.test(interp.primarySubject) ||
    Boolean(interp.issues?.some(issue =>
      issue.domain === 'CPF_PAYROLL' ||
      issue.domain === 'MOM_EMPLOYMENT' ||
      issue.governingAuthorities.some(a => a === 'CPF' || a === 'MOM') ||
      issue.contextualAuthorities.some(a => a === 'CPF' || a === 'MOM') ||
      PAYROLL_OR_EMPLOYMENT_SUBJECT_PATTERN.test(issue.subject)
    ))
  );
}

/** True when validated AI semantic interpretation clearly places the question outside payroll/employment. */
export function isSemanticallyNonPayroll(
  questionUnderstanding?: SemanticQuestionUnderstanding
): boolean {
  if (questionUnderstanding?.mode !== 'SEMANTIC_INTERPRETATION' || !questionUnderstanding.interpretation) {
    return false;
  }
  const interp = questionUnderstanding.interpretation;
  return interp.domain !== 'UNKNOWN' && !semanticIndicatesPayrollOrEmployment(questionUnderstanding);
}

/** True when validated AI semantic interpretation places a non-retained request in a domain disjoint from the active scenario. */
export function isSemanticUnderstandingDisjointFromScenario(
  questionUnderstanding: SemanticQuestionUnderstanding | undefined,
  activeScenario: AccountingScenarioState | null | undefined
): boolean {
  if (!activeScenario || questionUnderstanding?.mode !== 'SEMANTIC_INTERPRETATION' || !questionUnderstanding.interpretation) {
    return false;
  }
  const activeDomains = resolveActiveScenarioDomains(activeScenario);
  if (activeDomains.size === 0) return false;
  const interp = questionUnderstanding.interpretation;
  if (activeDomains.has('payroll') && activeDomains.size === 1) {
    return isSemanticallyNonPayroll(questionUnderstanding);
  }
  if (!activeDomains.has('payroll')) {
    const onlyPayrollOrEmployment =
      (interp.domain === 'CPF_PAYROLL' || interp.domain === 'MOM_EMPLOYMENT') &&
      !interp.issues?.some(issue =>
        issue.domain !== 'CPF_PAYROLL' && issue.domain !== 'MOM_EMPLOYMENT' && issue.domain !== 'UNKNOWN'
      );
    return onlyPayrollOrEmployment;
  }
  return false;
}
