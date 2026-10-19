const NEGATED_JOURNAL_DIRECTIVE = /\b(?:please\s+)?(?:do\s+not|don't|dont|never)\s+(?:(?:need|want)\s+to\s+)?(?:prepare|create|make|generate|produce|provide|post|record|draft|show|include)\s+(?:(?:me|the|a|an|any)\s+)*(?:double[ -]+entr(?:y|ies)(?:[ -]+journal(?:[ -]+entr(?:y|ies))?|journal(?:[ -]+entr(?:y|ies))?)?|journal(?:[ -]+entr(?:y|ies))?|accounting[ -]+entr(?:y|ies)?)\b/gi;

/** Removes only explicit negative journal instructions for shared intent checks. */
export function removeNegatedJournalDirectives(query: string): string {
  return query.replace(NEGATED_JOURNAL_DIRECTIVE, ' ');
}
