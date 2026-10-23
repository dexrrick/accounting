const NEGATED_JOURNAL_DIRECTIVE = /\b(?:please\s+)?(?:do\s+not|don't|dont|never)\s+(?:(?:need|want)\s+to\s+)?(?:prepare|create|make|generate|produce|provide|post|record|draft|show|include)\s+(?:(?:me|the|a|an|any)\s+)*(?:double[ -]+entr(?:y|ies)(?:[ -]+journal(?:[ -]+entr(?:y|ies))?|journal(?:[ -]+entr(?:y|ies))?)?|journal(?:[ -]+entr(?:y|ies))?|accounting[ -]+entr(?:y|ies)?)\b/gi;
const COORDINATED_NEGATED_ACTION_AND_JOURNAL = /\b(?:do\s+not|don't|dont|never)\s+(?:(?:need|want)\s+to\s+)?(?:assume\s+(?:them|those facts|these facts)|calculat\w*\s+(?:(?:the|any)\s+)?(?:(?:(?:my|your|their)\s+)?(?:(?:personal|individual)\s+)?(?:income\s+)?tax(?:es)?|amounts?|totals?|values?))\s+or\s+(?:please\s+)?(?:prepare|create|make|generate|produce|provide|post|record|draft|show|include)\s+(?:(?:me|the|a|an|any)\s+)*(?:double[ -]+entr(?:y|ies)(?:[ -]+journal(?:[ -]+entr(?:y|ies))?|journal(?:[ -]+entr(?:y|ies))?)?|journal(?:[ -]+entr(?:y|ies))?|accounting[ -]+entr(?:y|ies)?)\b/gi;

const NEGATION = String.raw`(?:do\s+not|don't|dont|never)`;
const NEGATED_CALCULATION_ACTION = String.raw`(?:calculate|compute|estimate|work\s+out|quantify)`;
const OUTPUT_MODIFIER = String.raw`(?!(?:but|instead|however|and|or|${NEGATED_CALCULATION_ACTION}|prepare|create|make|generate|produce|provide|post|record|draft|show|include)\b)[a-z][a-z-]*`;
const CALCULATION_OUTPUT = String.raw`(?:(?:${OUTPUT_MODIFIER}\s+){0,3})(?:tax(?:es)?(?:\s+payable)?|rates?|due\s+dates?|deadlines?(?:\s+date)?|amounts?|totals?|values?|figures?|numbers?|pay(?:roll)?|salar(?:y|ies)|wages?)`;
const JOURNAL_ACTION = String.raw`(?:prepare|create|make|generate|produce|provide|post|record|draft|show|include)`;
const JOURNAL_TARGET = String.raw`(?:(?:me|the|a|an|any)\s+)*(?:double[ -]+entr(?:y|ies)(?:[ -]+journal(?:[ -]+entr(?:y|ies))?|journal(?:[ -]+entr(?:y|ies))?)?|journal(?:[ -]+entr(?:y|ies))?|accounting[ -]+entr(?:y|ies)?)`;
const NEGATED_CALCULATION_WITH_JOURNAL = new RegExp(
  String.raw`\b(?:please\s+)?${NEGATION}\s+(?:(?:need|want)\s+to\s+)?${NEGATED_CALCULATION_ACTION}\s+${CALCULATION_OUTPUT}(?:\s+or\s+${CALCULATION_OUTPUT})*\s+or\s+(?:please\s+)?${JOURNAL_ACTION}\s+${JOURNAL_TARGET}\b`,
  'gi'
);
const NEGATED_CALCULATION_DIRECTIVE = new RegExp(
  String.raw`\b(?:please\s+)?${NEGATION}\s+(?:(?:need|want)\s+to\s+)?${NEGATED_CALCULATION_ACTION}\s+${CALCULATION_OUTPUT}(?:\s+or\s+${CALCULATION_OUTPUT})*\b`,
  'gi'
);
const NEGATED_BUSINESS_ASSESSMENT = new RegExp(
  String.raw`\b(?:please\s+)?${NEGATION}\s+(?:(?:need|want)\s+to\s+)?assess\s+(?:a\s+|the\s+|this\s+|any\s+)?(?:particular|specific)\s+business\b`,
  'gi'
);
const NEGATED_BUSINESS_ASSESSMENT_WITH_JOURNAL = new RegExp(
  String.raw`\b(?:please\s+)?${NEGATION}\s+(?:(?:need|want)\s+to\s+)?assess\s+(?:a\s+|the\s+|this\s+|any\s+)?(?:particular|specific)\s+business\s+or\s+(?:please\s+)?${JOURNAL_ACTION}\s+${JOURNAL_TARGET}\b`,
  'gi'
);

/** Removes only explicit negative journal instructions for shared intent checks. */
export function removeNegatedJournalDirectives(query: string): string {
  return query
    .replace(NEGATED_CALCULATION_WITH_JOURNAL, ' ')
    .replace(NEGATED_BUSINESS_ASSESSMENT_WITH_JOURNAL, ' ')
    .replace(COORDINATED_NEGATED_ACTION_AND_JOURNAL, ' ')
    .replace(NEGATED_JOURNAL_DIRECTIVE, ' ');
}

/** Removes bounded negative output instructions for intent and topic detection only. */
export function removeNegatedOutputDirectives(query: string): string {
  const withoutCalculationAndJournal = query
    .replace(NEGATED_CALCULATION_WITH_JOURNAL, ' ')
    .replace(NEGATED_BUSINESS_ASSESSMENT_WITH_JOURNAL, ' ')
    .replace(NEGATED_CALCULATION_DIRECTIVE, ' ')
    .replace(NEGATED_BUSINESS_ASSESSMENT, ' ');
  return removeNegatedJournalDirectives(withoutCalculationAndJournal);
}

/** Reports whether an explicitly negated calculation directive names a given output. */
export function hasNegatedCalculationOutput(query: string, outputPattern: RegExp): boolean {
  const directivePattern = new RegExp(NEGATED_CALCULATION_DIRECTIVE.source, 'gi');
  for (const match of query.matchAll(directivePattern)) {
    outputPattern.lastIndex = 0;
    if (outputPattern.test(match[0])) return true;
  }
  return false;
}
