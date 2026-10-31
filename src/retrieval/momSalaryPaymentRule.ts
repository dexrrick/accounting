import type {
  AuthorityPresentedIssue,
  AuthorityPresentedWorkstream,
  AuthorityPresentedSource
} from '../utils/authorityEvidencePresentation';
import { groupExactIssueClaimsByDocument } from '../utils/authorityEvidencePresentation';

export type MomSalaryPaymentRuleKind = 'REGULAR_SALARY' | 'OVERTIME_SALARY' | 'FINAL_SALARY';

export interface MomSalaryPaymentRuleEvidence {
  kind: MomSalaryPaymentRuleKind;
  title: string;
  officialUrl: string;
}

function requestedRule(query: string): MomSalaryPaymentRuleKind | undefined {
  if (/\b(?:19|20)\d{2}\b|\b(?:historical|previous|former|old|superseded|before\s+\d{4})\b/i.test(query) ||
      /\b(?:calculate|compute|estimate|how much|my salary|our salary|commission|tax clearance|deduct(?:ion|ions|ed|ing)?)\b/i.test(query)) {
    return undefined;
  }
  const hasPaymentTimingIntent = /\b(?:when|how soon|due|deadline|timing|what date|by what date)\b/i.test(query);
  const mentionsSalary = /\b(?:salary|salaries|pay|wage|wages)\b/i.test(query);
  const asksFinalSalaryTiming = hasPaymentTimingIntent && mentionsSalary &&
    (/\b(?:final|last)\s+(?:salary|pay(?:ment)?)\b/i.test(query) ||
      /\b(?:resign\w*|dismiss\w*|terminat\w*)\b/i.test(query));
  if (asksFinalSalaryTiming) return 'FINAL_SALARY';

  const asksOvertimeDeadline = /\b(?:when|what(?:\s+is)?\s+the\s+deadline|how\s+soon)\b/i.test(query) &&
    /\bovertime\s+(?:salary|pay)\b/i.test(query) && /\bsalary\s+period\b/i.test(query);
  const hasOvertimeContext = /\bovertime\b/i.test(query);
  const explicitlyRegularSalary = /\b(?:regular|normal|monthly)\s+(?:salary|salaries|pay|wages?)\b/i.test(query);
  const asksBareSalaryPeriodDeadline = /\b(?:when|due|deadline|how soon|what date|by what date)\b/i.test(query) &&
    /\bsalary\b/i.test(query) && /\b(?:salary|pay)\s+period\b/i.test(query);
  const asksRegularFrequency = (
    /\b(?:how\s+often|frequency(?:\s+of)?)\b/i.test(query) ||
    /\b(?:pay|paying|payment)\b[^.!?;]{0,55}\bevery\s+(?:one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+months?\b/i.test(query)
  ) && /\b(?:(?:regular\s+)?salar(?:y|ies)|wages?)\b/i.test(query) &&
    /\b(?:pay|paid|payment|paying)\b/i.test(query) &&
    (!hasOvertimeContext || explicitlyRegularSalary);
  const asksRegularDate = /\b(?:when|due|deadline|how\s+soon|what date|by what date|can|may|is it permissible|is it okay)\b/i.test(query) &&
    (/\b(?:(?:regular|normal|monthly)\s+(?:salar(?:y|ies)|pay|wages?)|regular\s+pay)\b/i.test(query) || asksBareSalaryPeriodDeadline) &&
    /\b(?:pay|paid|payment|payable|salary\s+period|pay\s+period|wage\s+period)\b/i.test(query) &&
    (!hasOvertimeContext || explicitlyRegularSalary);
  const asksRegularDeadline = asksRegularFrequency || asksRegularDate;
  if (asksOvertimeDeadline && asksRegularDeadline) return undefined;
  if (asksRegularDeadline) return 'REGULAR_SALARY';
  if (asksOvertimeDeadline) return 'OVERTIME_SALARY';
  return undefined;
}

type FinalSalaryScenario = 'SERVED_NOTICE' | 'WITHOUT_NOTICE' | 'EMPLOYER_TERMINATION';

function requestedFinalSalaryScenario(query: string): FinalSalaryScenario | undefined {
  const scenarios = new Set<FinalSalaryScenario>();
  if (/\b(?:serve\w*|after serving)\b[^.!?]{0,55}\b(?:full|required|contractual)?\s*notice(?:\s+period)?\b/i.test(query) ||
      /\b(?:full|required|contractual)\s+notice(?:\s+period)?\b/i.test(query)) scenarios.add('SERVED_NOTICE');
  if (/\bwithout\s+notice\b|\bno\s+notice\b/i.test(query)) scenarios.add('WITHOUT_NOTICE');
  if (/\b(?:employer\s+(?:termination|dismissal|terminat\w*|dismiss\w*)|termination\s+by\s+(?:the\s+)?employer|dismissal)\b/i.test(query)) {
    scenarios.add('EMPLOYER_TERMINATION');
  }
  return scenarios.size === 1 ? [...scenarios][0] : undefined;
}

function momSalaryPaymentSource(source: AuthorityPresentedSource): boolean {
  if (source.provenance !== 'LIVE_EXTERNAL' || source.validTo) return false;
  try {
    const url = new URL(source.officialUrl || '');
    return url.protocol === 'https:' && ['www.mom.gov.sg', 'mom.gov.sg'].includes(url.hostname) &&
      /^\/employment-practices\/salary\/paying-salary\/?$/i.test(url.pathname);
  } catch {
    return false;
  }
}

function sourceStatements(text: string): string[] {
  return text.split(/\r?\n+|(?<=[.!?])\s+(?=[A-Z])/).map(statement => statement.trim()).filter(Boolean);
}

function isPositiveEmploymentActMonthlySalaryRule(statement: string): boolean {
  return /\b(?:if\s+you\s+are\s+covered\s+by|in\s+accordance\s+with)\s+the\s+employment\s+act\b[^.!?]{0,180}\b(?:your\s+)?employer\s+must\s+pay\s+(?:your\s+)?salary\b[^.!?]{0,100}\bat\s+least\s+once\s+a\s+month\b/i.test(statement);
}

function isPositive(statement: string): boolean {
  return !/\b(?:not|never|cannot|must\s+not|does\s+not|do\s+not|is\s+not|are\s+not|isn't|aren't)\b/i.test(statement);
}

function hasFullSourceTaxClearanceCaveat(text: string): boolean {
  return /\bforeign[ -]employees?\b/i.test(text) && /\btax[ -]clearance\b/i.test(text) &&
    /\b(?:up to\s+)?30 days\b/i.test(text) && /\bnotice to (?:the )?comptroller\b/i.test(text);
}

function isCompleteFinalSalaryEvidence(
  claimTexts: readonly string[],
  query: string,
  requireFullSourceCaveat: boolean
): boolean {
  const scenario = requestedFinalSalaryScenario(query);
  if (!scenario) return false;
  const statements = claimTexts.flatMap(sourceStatements);
  if (requireFullSourceCaveat && !hasFullSourceTaxClearanceCaveat(claimTexts.join(' '))) return false;

  if (scenario === 'SERVED_NOTICE') {
    return statements.some(statement => isPositive(statement) &&
      /\bresign\w*\b[^.!?]{0,80}\bafter serving\b[^.!?]{0,50}\b(?:full|required|contractual)?\s*notice\b/i.test(statement) &&
      /\b(?:final\s+salary|salary)\b[^.!?]{0,80}\b(?:due|payable|paid)\b[^.!?]{0,60}\blast (?:day of )?(?:employment|work)\b/i.test(statement));
  }
  if (scenario === 'WITHOUT_NOTICE') {
    return statements.some(statement => isPositive(statement) &&
      /\bresign\w*\b[^.!?]{0,60}\bwithout\s+notice\b/i.test(statement) &&
      /\bwithin\s+7\s+days\b[^.!?]{0,60}\blast (?:day of )?(?:employment|work)\b/i.test(statement));
  }
  return statements.some(statement => isPositive(statement) &&
    /\b(?:employer\s+(?:termination|dismissal|terminat\w*|dismiss\w*)|termination\s+by\s+(?:the\s+)?employer|dismissal)\b/i.test(statement) &&
    /\blast day\b[^.!?]{0,80}\bif (?:that is )?not possible\b[^.!?]{0,50}\bwithin\s+3\s+working\s+days\b/i.test(statement));
}

function hasConflictingGeneralSalaryDeadline(statements: readonly string[], expectedDays: number): boolean {
  return statements.some(statement => /\bwithin\s+(\d+)\s+days\s+after\s+the\s+end\s+of\s+the\s+salary\s+period\b/i.test(statement) &&
    !/\bovertime\b/i.test(statement) &&
    Number(statement.match(/\bwithin\s+(\d+)\s+days\s+after\s+the\s+end\s+of\s+the\s+salary\s+period\b/i)?.[1]) !== expectedDays);
}

function isCompleteSalaryPaymentEvidence(
  claimTexts: readonly string[],
  kind: MomSalaryPaymentRuleKind,
  query: string,
  requireFullSourceCaveat = false
): boolean {
  if (kind === 'FINAL_SALARY') return isCompleteFinalSalaryEvidence(claimTexts, query, requireFullSourceCaveat);
  const statements = claimTexts.flatMap(sourceStatements);
  const hasNegatedSalaryDeadlineHeading = claimTexts.some(claim =>
    /\bsalary\s+(?:must\s+not|should\s+not|mustn['’]t)\s+be\s+paid\s*:/i.test(claim) &&
    /\bwithin\s+\d+\s+days\s+after\s+the\s+end\s+of\s+the\s+salary\s+period\b/i.test(claim));
  if (hasNegatedSalaryDeadlineHeading) return false;
  const monthlyPremiseMentions = statements.filter(statement =>
    /\b(?:if\s+you\s+are\s+covered\s+by|in\s+accordance\s+with)\s+the\s+employment\s+act\b/i.test(statement) &&
    /\b(?:salary|salaries)\b[^.!?]{0,160}\bat\s+least\s+once\s+a\s+month\b/i.test(statement));
  if (!monthlyPremiseMentions.some(isPositiveEmploymentActMonthlySalaryRule) ||
      monthlyPremiseMentions.some(statement => !isPositive(statement))) return false;
  if (kind === 'REGULAR_SALARY') {
    const regularDeadline = /\bwithin\s+7\s+days\s+after\s+the\s+end\s+of\s+the\s+salary\s+period\b/i;
    const hasCompleteRegularRule = statements.some(statement => isPositiveEmploymentActMonthlySalaryRule(statement)) &&
      statements.some(statement => regularDeadline.test(statement) && isPositive(statement));
    const hasNegatedGeneralDeadline = statements.some(statement =>
      /\bwithin\s+\d+\s+days\s+after\s+the\s+end\s+of\s+the\s+salary\s+period\b/i.test(statement) &&
      !/\bovertime\b/i.test(statement) && !isPositive(statement));
    return hasCompleteRegularRule && !hasNegatedGeneralDeadline && !hasConflictingGeneralSalaryDeadline(statements, 7);
  }
  const overtimeDeadline = /\bfor\s+overtime\s+(?:work|pay|salary)\b[^.!?]{0,90}\bwithin\s+14\s+days\s+after\s+the\s+end\s+of\s+the\s+salary\s+period\b/i;
  const hasOvertimeDeadline = statements.some(statement => overtimeDeadline.test(statement) && isPositive(statement));
  const overtimeDeadlineMention = /\bfor\s+overtime\s+(?:work|pay|salary)\b[^.!?]{0,90}\bwithin\s+(\d+)\s+days\s+after\s+the\s+end\s+of\s+the\s+salary\s+period\b/i;
  const hasConflictingOvertimeDeadline = statements.some(statement => {
    const match = overtimeDeadlineMention.exec(statement);
    return Boolean(match && (Number(match[1]) !== 14 || !isPositive(statement)));
  });
  return hasOvertimeDeadline && !hasConflictingOvertimeDeadline;
}

/**
 * Checks the full fetched MOM salary page before excerpt selection. An
 * unrecognized query is outside this narrow proof and returns undefined.
 */
export function provesMomSalaryPaymentSource(query: string, sourceText: string): boolean | undefined {
  const kind = requestedRule(query);
  return kind ? isCompleteSalaryPaymentEvidence([sourceText], kind, query, kind === 'FINAL_SALARY') : undefined;
}

/**
 * Selects one exact contiguous source span for ordinary salary timing when
 * the monthly-payment premise and the ordinary seven-day deadline are in
 * separate paragraphs or list items. Intervening source wording is retained
 * so the quote stays a literal source span, not a stitched summary.
 */
export function selectMomSalaryPaymentRuleQuote(query: string, sourceText: string): string | undefined {
  if (requestedRule(query) !== 'REGULAR_SALARY' ||
      !isCompleteSalaryPaymentEvidence([sourceText], 'REGULAR_SALARY', query)) return undefined;

  const monthlyRule = /\b(?:if\s+you\s+are\s+covered\s+by|in\s+accordance\s+with)\s+the\s+employment\s+act\b[^.!?]{0,180}\b(?:your\s+)?employer\s+must\s+pay\s+(?:your\s+)?salary\b[^.!?]{0,100}\bat\s+least\s+once\s+a\s+month\b[.!?]/i;
  const regularDeadline = /\bsalary\s+must\s+be\s+paid\s*:\s*(?:[-•◦▪*]\s*)?within\s+7\s+days\s+after\s+the\s+end\s+of\s+the\s+salary\s+period\.?/i;
  const monthlyMatch = monthlyRule.exec(sourceText);
  const deadlineMatch = regularDeadline.exec(sourceText);
  if (!monthlyMatch || monthlyMatch.index === undefined || !deadlineMatch || deadlineMatch.index === undefined) return undefined;

  const start = Math.min(monthlyMatch.index, deadlineMatch.index);
  const end = Math.max(monthlyMatch.index + monthlyMatch[0].length, deadlineMatch.index + deadlineMatch[0].length);
  const quote = sourceText.slice(start, end).trim();
  return quote.length > 0 && quote.length <= 4_000 ? quote : undefined;
}

function normalizedSalaryConcept(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

function isCompatibleSalaryIssueSubject(query: string, subject: string, kind: MomSalaryPaymentRuleKind): boolean {
  if (!/\bsalary\b/i.test(subject) || !/\b(?:payment|period|deadline|timing|due)\b/i.test(subject)) return false;
  if (kind === 'FINAL_SALARY') return Boolean(requestedFinalSalaryScenario(query));
  if (/\b(?:final|commission|tax\s+clearance|resignation|termination|calculate|amount|historical|previous|former|old)\b/i.test(subject)) return false;
  if (kind === 'OVERTIME_SALARY') return /\bovertime\s+(?:salary|pay)\b/i.test(subject);
  return /\bregular\s+salary\b/i.test(subject) ||
    /\bsalary\s+payment\s+frequency\s+and\s+(?:statutory\s+)?(?:due\s+dates?|deadlines?)\b/i.test(subject) &&
    (/\bregular\s+salary\b/i.test(query) ||
      /\b(?:pay|paying|payment)\b[^.!?;]{0,55}\bevery\s+(?:one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+months?\b/i.test(query));
}

/**
 * Supports only the current, general regular/overtime salary timing rules.
 * A recognized request with an incompatible issue label or incomplete source
 * quote fails closed; unrelated queries remain outside this helper.
 */
export function supportMomSalaryPaymentIssue(query: string, subject: string, sourceText: string): boolean | undefined {
  const kind = requestedRule(query);
  if (!kind) return undefined;
  if (!isCompatibleSalaryIssueSubject(query, subject, kind)) return false;
  return isCompleteSalaryPaymentEvidence([sourceText], kind, query);
}

/** Restricts topicless semantic labels to the concepts covered by the proof above. */
export function supportMomSalaryPaymentConcept(
  query: string,
  subject: string,
  conceptLabel: string,
  conceptTerms: readonly string[],
  sourceText: string
): boolean | undefined {
  const kind = requestedRule(query);
  if (!kind) return undefined;
  if (!isCompatibleSalaryIssueSubject(query, subject, kind)) return false;
  const label = normalizedSalaryConcept(conceptLabel);
  const supportedConcepts = kind === 'FINAL_SALARY'
    ? new Set([
        'final salary deadline',
        'final salary payment deadline',
        'final salary due date',
        'final salary payment due date',
        'last salary payment deadline',
        'last salary due date',
        'final pay deadline',
        'final pay due date'
      ])
    : kind === 'REGULAR_SALARY'
    ? new Set([
        'salary period',
        'salary payment frequency',
        'salary due date',
        'salary due dates',
        'salary payment deadline',
        'regular salary due date',
        'regular salary payment deadline',
        'regular salary payment period and deadline',
        'salary payment period and regular salary deadline',
        'salary payment frequency and due date',
        'salary payment frequency and due dates'
      ])
    : new Set([
        'overtime salary payment due date',
        'overtime salary due date',
        'overtime salary payment period deadline',
        'overtime payment due date',
        'overtime payment deadline'
      ]);
  if (!supportedConcepts.has(label)) return false;
  if (conceptTerms.some(term => !supportedConcepts.has(normalizedSalaryConcept(term)))) return false;
  return isCompleteSalaryPaymentEvidence([sourceText], kind, query);
}

/**
 * Enables two narrow general MOM salary explanations only when exact verified
 * quotes bound to this issue and one admitted source establish every premise.
 */
export function getMomSalaryPaymentRuleEvidence(
  query: string,
  stream: AuthorityPresentedWorkstream,
  issue: AuthorityPresentedIssue
): MomSalaryPaymentRuleEvidence | undefined {
  const kind = requestedRule(query);
  if (!kind || stream.authority !== 'MOM' || stream.domain !== 'MOM_EMPLOYMENT' ||
      kind === 'FINAL_SALARY' ||
      stream.evidenceStatus !== 'VERIFIED' || stream.applicationStatus === 'UNRESOLVED' ||
      issue.evidenceStatus !== 'VERIFIED' || issue.applicationStatus === 'UNRESOLVED' ||
      issue.operation !== 'EXPLAIN_RULE' || !['Employee', 'Employer'].includes(issue.population) ||
      !isCompatibleSalaryIssueSubject(query, issue.subject, kind)) return undefined;

  // A single scoped issue must own the question; otherwise a deadline asked
  // about one salary category could be emitted beside a separate payroll issue.
  if (stream.issues.length !== 1 || stream.issues[0].id !== issue.id) return undefined;

  for (const source of stream.sources) {
    if (!momSalaryPaymentSource(source)) continue;
    for (const exactSupportingClaims of groupExactIssueClaimsByDocument(source, issue.id)) {
      if (isCompleteSalaryPaymentEvidence(exactSupportingClaims.map(claim => claim.text), kind, query)) {
        return { kind, title: source.title, officialUrl: source.officialUrl! };
      }
    }
  }
  return undefined;
}
