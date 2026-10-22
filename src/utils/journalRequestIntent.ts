const NEGATED_JOURNAL_DIRECTIVE = /\b(?:please\s+)?(?:do\s+not|don't|dont|never)\s+(?:(?:need|want)\s+to\s+)?(?:prepare|create|make|generate|produce|provide|post|record|draft|show|include)\s+(?:(?:me|the|a|an|any)\s+)*(?:double[ -]+entr(?:y|ies)(?:[ -]+journal(?:[ -]+entr(?:y|ies))?|journal(?:[ -]+entr(?:y|ies))?)?|journal(?:[ -]+entr(?:y|ies))?|accounting[ -]+entr(?:y|ies)?)\b/gi;
const COORDINATED_NEGATED_ACTION_AND_JOURNAL = /\b(?:do\s+not|don't|dont|never)\s+(?:(?:need|want)\s+to\s+)?(?:assume\s+(?:them|those facts|these facts)|calculat\w*\s+(?:(?:the|any)\s+)?(?:(?:(?:my|your|their)\s+)?(?:(?:personal|individual)\s+)?(?:income\s+)?tax(?:es)?|amounts?|totals?|values?))\s+or\s+(?:please\s+)?(?:prepare|create|make|generate|produce|provide|post|record|draft|show|include)\s+(?:(?:me|the|a|an|any)\s+)*(?:double[ -]+entr(?:y|ies)(?:[ -]+journal(?:[ -]+entr(?:y|ies))?|journal(?:[ -]+entr(?:y|ies))?)?|journal(?:[ -]+entr(?:y|ies))?|accounting[ -]+entr(?:y|ies)?)\b/gi;

/** Removes only explicit negative journal instructions for shared intent checks. */
export function removeNegatedJournalDirectives(query: string): string {
  return query
    .replace(COORDINATED_NEGATED_ACTION_AND_JOURNAL, ' ')
    .replace(NEGATED_JOURNAL_DIRECTIVE, ' ');
}
