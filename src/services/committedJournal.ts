import type { AccountingScenarioState, AccountingStandard } from '../types/accounting';
import { calculateDoubleEntries } from '../engine/accountingEngine';
import { hasVerifiedNumericImageEvidence, validateJournalGroups } from '../verification/journalIntegrity';
import { classifyQuestion } from '../classification/questionClassifier';
import { isSingleMonthlySalaryAmendment, resolveFactAmendment } from './factAmendmentService';
import {
  assessConversationRelation,
  hasExplicitPriorFactReference,
  isJournalDisplayRequest,
  startsNewAccountingScenario
} from './conversationBoundary';
import { extractAccountingContext } from './conversationAccountingState';
import { defaultTransactionUnderstandingService } from './transactionUnderstandingService';

export interface JournalValidationContext {
  rawQuery?: string;
  evidenceTexts?: string[];
  hasPriorContextAmount?: boolean;
}

/** Returns true when a scenario carries verified positive numeric evidence from an attached image. */
export function hasVerifiedImageMonetaryEvidence(scenario?: AccountingScenarioState | null): boolean {
  if (!scenario) return false;
  return hasVerifiedNumericImageEvidence(scenario.imageEvidence, scenario.evidence);
}

function hasVerifiedPriorMonetaryFacts(scenario: AccountingScenarioState | null | undefined): boolean {
  if (!scenario) return false;
  if (typeof scenario.amount === 'number' && Number.isFinite(scenario.amount) && scenario.amount > 0) {
    return true;
  }
  const priorGroups = scenario.committedDirectGroups?.length
    ? scenario.committedDirectGroups
    : scenario.directGroups || [];
  if (
    priorGroups.some(group => typeof group.totalDebit === 'number' && Number.isFinite(group.totalDebit) && group.totalDebit > 0) &&
    validateJournalGroups(priorGroups).isValid
  ) {
    return true;
  }
  return hasVerifiedImageMonetaryEvidence(scenario);
}

function hasCumulativeGroupContinuation(
  prior: AccountingScenarioState,
  candidate: AccountingScenarioState
): boolean {
  const priorGroups = prior.committedDirectGroups?.length
    ? prior.committedDirectGroups
    : prior.directGroups || [];
  const candidateGroups = candidate.directGroups || [];
  if (priorGroups.length === 0 || candidateGroups.length <= priorGroups.length) return false;
  const candidateIds = new Set(candidateGroups.map(g => g.id).filter(Boolean));
  return priorGroups.every(g => Boolean(g.id && candidateIds.has(g.id)));
}

/**
 * Returns true only when `prior` exists, carries verified monetary facts,
 * and `candidate` is explicitly linked to or semantically continues the same
 * transaction rather than merely sharing a `scenarioType`.
 */
export function hasSameTransactionPriorMonetaryEvidence(
  prior: AccountingScenarioState | null | undefined,
  candidate: AccountingScenarioState,
  rawQuery?: string
): boolean {
  if (!prior || !hasVerifiedPriorMonetaryFacts(prior)) return false;

  // Conflicting explicit transactionIds are strictly separate transactions.
  if (prior.transactionId && candidate.transactionId) {
    return prior.transactionId === candidate.transactionId;
  }

  // Explicit targetTransactionId linkage from candidate groups to prior groups/transaction.
  const priorTxIds = new Set<string>();
  if (prior.transactionId) priorTxIds.add(prior.transactionId);
  for (const grp of [...(prior.committedDirectGroups || []), ...(prior.directGroups || [])]) {
    if (grp.transactionId) priorTxIds.add(grp.transactionId);
  }
  if (priorTxIds.size > 0) {
    const candidateTargetsPrior = (candidate.directGroups || []).some(
      grp => Boolean(grp.targetTransactionId && priorTxIds.has(grp.targetTransactionId))
    );
    if (candidateTargetsPrior) return true;
  }

  const effectiveQuery = (rawQuery ?? candidate.rawQuery ?? '').trim();
  if (effectiveQuery && startsNewAccountingScenario(effectiveQuery, prior)) return false;

  // Shared verified image evidence linkage.
  const priorImageIds = new Set((prior.imageEvidence || []).map(img => img.imageId).filter(Boolean));
  if (priorImageIds.size > 0 && hasVerifiedImageMonetaryEvidence(prior)) {
    const sharesImage = (candidate.imageEvidence || []).some(img => Boolean(img.imageId && priorImageIds.has(img.imageId)));
    if (sharesImage) return true;
  }

  if (!effectiveQuery) return false;
  if (isJournalDisplayRequest(effectiveQuery)) return true;

  const relation = assessConversationRelation(effectiveQuery, prior, prior);
  if (relation !== 'RELATED') return false;

  // 1. Completing a pending incomplete transaction via clarification reply.
  if (!prior.isComplete && (prior.missingFields?.length ?? 0) > 0) {
    return true;
  }

  // 2. Fact amendment or explicit reference to the prior transaction's facts.
  if (
    Boolean(candidate.factAmendments?.length) ||
    resolveFactAmendment(effectiveQuery, prior).intent === 'FACT_AMENDMENT' ||
    hasExplicitPriorFactReference(effectiveQuery, prior)
  ) {
    return true;
  }

  // 3. Semantic follow-up (settlement, partial settlement, hypothetical branch, reclassification).
  if (candidate.semanticUnderstanding?.followUpAnalysis?.isFollowUp) {
    return true;
  }
  const priorContext = extractAccountingContext(prior);
  const semanticFollowUp = defaultTransactionUnderstandingService.understandTransactionSync(
    effectiveQuery,
    prior.functionalCurrency || 'SGD',
    'SG',
    priorContext
  );
  if (semanticFollowUp.followUpAnalysis?.isFollowUp) {
    return true;
  }

  // 4. Cumulative event continuation (e.g. subsequent settlement appended to prior purchase groups).
  if (hasCumulativeGroupContinuation(prior, candidate)) {
    return true;
  }

  // 5. Payroll resignation/proration follow-up modifying the established employee's payroll.
  if (
    prior.scenarioType === 'PAYROLL_CPF_SALARY' &&
    candidate.scenarioType === 'PAYROLL_CPF_SALARY' &&
    /\b(?:resign(?:ed|ation)?|pro[ -]?rat(?:e|ed|ion)|last\s+day|incomplete\s+month)\b/i.test(effectiveQuery)
  ) {
    return true;
  }

  // 6. Explicit attribute modification targeting the established transaction (without starting a new one).
  if (/\b(?:change|update|adjust|revise|amend|modify|switch)\s+(?:the|his|her|their|our|this|that)\b/i.test(effectiveQuery)) {
    return true;
  }

  return false;
}

/** Keep the last complete, balanced journal available while an advisory answer is displayed. */
export function updateCommittedJournalScenario(
  previous: AccountingScenarioState | null,
  candidate: AccountingScenarioState | null,
  standard: AccountingStandard,
  resetPrevious = false,
  validationContext?: JournalValidationContext
): AccountingScenarioState | null {
  const priorScenario = resetPrevious ? null : previous;
  if (!candidate || !candidate.isComplete || candidate.isHypothetical) return priorScenario;

  const outputGroups = calculateDoubleEntries(candidate, standard).groups;
  if (candidate.directGroups?.some(group => group.isHypothetical) ||
      candidate.projectedGroups?.some(group => group.isHypothetical) ||
      outputGroups.some(group => group.isHypothetical || group.authorityStatus !== 'DETERMINISTIC')) return priorScenario;

  const groups = outputGroups;
  const effectiveRawQuery = validationContext?.rawQuery ?? candidate.rawQuery;
  const sameTransactionPrior = !resetPrevious && hasSameTransactionPriorMonetaryEvidence(priorScenario, candidate, effectiveRawQuery);
  const hasImageEvidence = hasVerifiedImageMonetaryEvidence(candidate) ||
    (!resetPrevious && hasVerifiedImageMonetaryEvidence(priorScenario) && sameTransactionPrior);
  const hasPriorContextAmount = Boolean(
    validationContext?.hasPriorContextAmount ||
    sameTransactionPrior
  );
  const allowContextEvidenceTexts = !resetPrevious && (!priorScenario || sameTransactionPrior);
  const integrity = validateJournalGroups(groups, {
    rawQuery: effectiveRawQuery,
    hasPriorContextAmount,
    hasImageEvidence,
    evidenceTexts: allowContextEvidenceTexts ? validationContext?.evidenceTexts : undefined
  });
  if (groups.length === 0 || !integrity.isValid) return priorScenario;
  return {
    ...candidate,
    directGroups: groups,
    committedDirectGroups: groups,
    projectedGroups: undefined,
    isHypothetical: false
  };
}

/** Returns a complete, valid current result that is still proposed or conditional. */
export function getDisplayableUncommittedJournalGroups(
  candidate: AccountingScenarioState | null,
  standard: AccountingStandard,
  validationContext?: JournalValidationContext
) {
  if (!candidate?.isComplete || candidate.isHypothetical) return [];
  const groups = calculateDoubleEntries(candidate, standard).groups;
  const effectiveRawQuery = validationContext?.rawQuery ?? candidate.rawQuery;
  const hasImageEvidence = hasVerifiedImageMonetaryEvidence(candidate);
  const hasPriorContextAmount = Boolean(validationContext?.hasPriorContextAmount);
  const integrity = validateJournalGroups(groups, {
    rawQuery: effectiveRawQuery,
    hasPriorContextAmount,
    hasImageEvidence,
    evidenceTexts: validationContext?.evidenceTexts
  });
  if (groups.length === 0 || groups.some(group => group.isHypothetical) || !integrity.isValid) return [];
  return groups.some(group => group.authorityStatus === 'AI_PROPOSED' || group.authorityStatus === 'CONDITIONAL') ? groups : [];
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
  if (isNarrowPayrollSalaryAmendment) return committedScenario;
  const requestsSupportedAmendment = committedScenario.scenarioType !== 'PAYROLL_CPF_SALARY' &&
    Boolean(amendments.length) &&
    (!classification.taxAnalysisRequired && !classification.regulatoryAnalysisRequired);
  if (!explicitJournalRequest && !requestsSupportedAmendment) return activeScenario;

  const activeGroups = activeScenario?.committedDirectGroups?.length
    ? activeScenario.committedDirectGroups
    : activeScenario?.directGroups || [];
  const hasRetainedCommittedSnapshot = Boolean(activeScenario?.committedDirectGroups?.length);
  const activeHasActualJournal = activeScenario && !activeScenario.isHypothetical &&
    (hasRetainedCommittedSnapshot || activeScenario.isComplete) &&
    activeGroups.length > 0 && activeGroups.every(group =>
      group.authorityStatus === 'DETERMINISTIC' && !group.isHypothetical
    ) && validateJournalGroups(activeGroups).isValid;
  return activeHasActualJournal ? activeScenario : committedScenario;
}
