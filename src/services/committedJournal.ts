import type { AccountingScenarioState, AccountingStandard } from '../types/accounting';
import { calculateDoubleEntries } from '../engine/accountingEngine';
import { validateJournalGroups } from '../verification/journalIntegrity';

/** Keep the last complete, balanced journal available while an advisory answer is displayed. */
export function updateCommittedJournalScenario(
  previous: AccountingScenarioState | null,
  candidate: AccountingScenarioState | null,
  standard: AccountingStandard
): AccountingScenarioState | null {
  if (!candidate) return previous;

  const groups = calculateDoubleEntries(candidate, standard).groups;
  if (groups.length === 0 || !validateJournalGroups(groups).isValid) return previous;
  return candidate;
}
