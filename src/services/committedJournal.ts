import type { AccountingScenarioState, AccountingStandard } from '../types/accounting';
import { calculateDoubleEntries } from '../engine/accountingEngine';
import { validateJournalGroups } from '../verification/journalIntegrity';
import { classifyQuestion } from '../classification/questionClassifier';
import { isSingleMonthlySalaryAmendment, resolveFactAmendment } from './factAmendmentService';
import { isJournalDisplayRequest } from './conversationBoundary';

/** Keep the last complete, balanced journal available while an advisory answer is displayed. */
export function updateCommittedJournalScenario(
  previous: AccountingScenarioState | null,
  candidate: AccountingScenarioState | null,
  standard: AccountingStandard,
  resetPrevious = false
): AccountingScenarioState | null {
  const priorScenario = resetPrevious ? null : previous;
  if (!candidate || !candidate.isComplete || candidate.isHypothetical) return priorScenario;

  const outputGroups = calculateDoubleEntries(candidate, standard).groups;
  if (candidate.directGroups?.some(group => group.isHypothetical) ||
      candidate.projectedGroups?.some(group => group.isHypothetical) ||
      outputGroups.some(group => group.isHypothetical || group.authorityStatus !== 'DETERMINISTIC')) return priorScenario;

  const groups = outputGroups;
  if (groups.length === 0 || !validateJournalGroups(groups).isValid) return priorScenario;
  return {
    ...candidate,
    directGroups: groups,
    committedDirectGroups: groups,
    projectedGroups: undefined,
    isHypothetical: false
  };
}

/** Returns the complete current result for display when it contains a valid AI proposal. */
export function getDisplayableUncommittedJournalGroups(
  candidate: AccountingScenarioState | null,
  standard: AccountingStandard
) {
  if (!candidate?.isComplete || candidate.isHypothetical) return [];
  const groups = calculateDoubleEntries(candidate, standard).groups;
  const validProposalExists = groups.some(group =>
    group.authorityStatus === 'AI_PROPOSED' &&
    !group.isHypothetical &&
    validateJournalGroups([group]).isValid
  );
  return validProposalExists
    ? groups.filter(group => !group.isHypothetical && validateJournalGroups([group]).isValid)
    : [];
}

/** Select prior accounting context only for an accounting operation that needs it. */
export function selectAccountingScenarioForRequest(
  query: string,
  activeScenario: AccountingScenarioState | null,
  committedScenario: AccountingScenarioState | null,
  separateAnalysis = false
): AccountingScenarioState | null {
  if (separateAnalysis) return null;
  if (isJournalDisplayRequest(query)) return committedScenario;
  if (!committedScenario) return activeScenario;

  const classification = classifyQuestion(query);
  const explicitJournalRequest = classification.journalEntryRequired;
  const amendments = resolveFactAmendment(query, committedScenario).amendments || [];
  const isNarrowPayrollSalaryAmendment = committedScenario.scenarioType === 'PAYROLL_CPF_SALARY' &&
    amendments.length === 1 && amendments[0].field === 'monthlySalary' && isSingleMonthlySalaryAmendment(query);
  const requestsSupportedAmendment = Boolean(amendments.length) &&
    ((!classification.taxAnalysisRequired && !classification.regulatoryAnalysisRequired) || isNarrowPayrollSalaryAmendment);
  if (!explicitJournalRequest && !requestsSupportedAmendment) return activeScenario;

  const activeHasActualJournal = activeScenario && !activeScenario.isHypothetical &&
    (activeScenario.committedDirectGroups?.length || activeScenario.directGroups?.some(group => !group.isHypothetical));
  return activeHasActualJournal ? activeScenario : committedScenario;
}
