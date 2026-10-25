import type {
  AuthorityPresentedIssue,
  AuthorityPresentedWorkstream,
  AuthorityPresentedSource
} from '../utils/authorityEvidencePresentation';

export type MomSalaryPaymentRuleKind = 'REGULAR_SALARY' | 'OVERTIME_SALARY';

export interface MomSalaryPaymentRuleEvidence {
  kind: MomSalaryPaymentRuleKind;
  title: string;
  officialUrl: string;
}

function requestedRule(query: string): MomSalaryPaymentRuleKind | undefined {
  if (/\b(?:19|20)\d{2}\b|\b(?:historical|previous|former|old|superseded|before\s+\d{4})\b/i.test(query) ||
      /\b(?:calculate|compute|estimate|how much|my salary|our salary|final salary|commission|tax clearance|termination|resignation)\b/i.test(query)) {
    return undefined;
  }
  const asksOvertimeDeadline = /\b(?:when|what(?:\s+is)?\s+the\s+deadline|how\s+soon)\b/i.test(query) &&
    /\bovertime\s+(?:salary|pay)\b/i.test(query) && /\bsalary\s+period\b/i.test(query);
  const asksRegularDeadline = /\b(?:how\s+often|frequency(?:\s+of)?)\b/i.test(query) &&
    /\b(?:regular\s+)?salary\b/i.test(query) &&
    /\b(?:when|due|payment\s+period|after\s+the\s+salary\s+period)\b/i.test(query);
  if (asksOvertimeDeadline && asksRegularDeadline) return undefined;
  if (asksRegularDeadline) return 'REGULAR_SALARY';
  if (asksOvertimeDeadline) return 'OVERTIME_SALARY';
  return undefined;
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

function hasConflictingGeneralSalaryDeadline(statements: readonly string[], expectedDays: number): boolean {
  return statements.some(statement => /\bwithin\s+(\d+)\s+days\s+after\s+the\s+end\s+of\s+the\s+salary\s+period\b/i.test(statement) &&
    !/\bovertime\b/i.test(statement) &&
    Number(statement.match(/\bwithin\s+(\d+)\s+days\s+after\s+the\s+end\s+of\s+the\s+salary\s+period\b/i)?.[1]) !== expectedDays);
}

function isCompleteSalaryPaymentEvidence(claimTexts: readonly string[], kind: MomSalaryPaymentRuleKind): boolean {
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
    const hasCompleteRegularRule = statements.some(statement => isPositiveEmploymentActMonthlySalaryRule(statement) &&
      regularDeadline.test(statement) && isPositive(statement));
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
  return kind ? isCompleteSalaryPaymentEvidence([sourceText], kind) : undefined;
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
      stream.evidenceStatus !== 'VERIFIED' || stream.applicationStatus === 'UNRESOLVED' ||
      issue.evidenceStatus !== 'VERIFIED' || issue.applicationStatus === 'UNRESOLVED' ||
      issue.operation !== 'EXPLAIN_RULE' || !['Employee', 'Employer'].includes(issue.population) ||
      !/\bsalary\b/i.test(issue.subject) || !/\b(?:payment|period|deadline)\b/i.test(issue.subject) ||
      /\b(?:final|commission|tax\s+clearance|resignation|termination|calculate|amount|historical|previous|former|old)\b/i.test(issue.subject)) return undefined;
  if (kind === 'REGULAR_SALARY' && !/\bregular\s+salary\b/i.test(issue.subject) ||
      kind === 'OVERTIME_SALARY' && !/\bovertime\s+(?:salary|pay)\b/i.test(issue.subject)) return undefined;

  // A single scoped issue must own the question; otherwise a deadline asked
  // about one salary category could be emitted beside a separate payroll issue.
  if (stream.issues.length !== 1 || stream.issues[0].id !== issue.id) return undefined;

  for (const source of stream.sources) {
    if (!momSalaryPaymentSource(source)) continue;
    const exactSupportingClaims = source.claims.filter(claim =>
      claim.issueIds.includes(issue.id) && claim.supportKind === 'EXACT_SOURCE_QUOTE' &&
      claim.provenance === 'LIVE_EXTERNAL' && !claim.validTo);
    if (isCompleteSalaryPaymentEvidence(exactSupportingClaims.map(claim => claim.text), kind)) {
      return { kind, title: source.title, officialUrl: source.officialUrl! };
    }
  }
  return undefined;
}
