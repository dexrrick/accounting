const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3,
  apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7,
  aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10,
  nov: 11, november: 11, dec: 12, december: 12
};

const EXPLICIT_DATE = String.raw`(?:\d{1,2}[/-]\d{1,2}[/-]20\d{2}|20\d{2}-\d{2}-\d{2}|\d{1,2}\s+(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+20\d{2})`;

const FILING_SUBJECT = String.raw`(?:annual[- ]returns?|annual general meeting|agm)`;

/** An owned FYE cannot answer a filing request for another or unidentified party. */
function hasUnrelatedFilingOwner(query: string): boolean {
  const text = query.replace(/\b(?:our|my|this|the)\s+(?:(?:local|singapore|private|public|listed|non[- ]listed)\s+){0,2}company(?:['’]s)?\b/gi, 'our company');
  if (new RegExp(String.raw`\b[\p{L}\p{N}&.-]+['’]s\s+(?:(?:next|first|usual)\s+)?${FILING_SUBJECT}\b`, 'iu').test(text) ||
      new RegExp(String.raw`\b(?:their|your|his|her)\s+${FILING_SUBJECT}\b`, 'i').test(text)) return true;

  const sameOwner = /^(?:(?:our|my|this|the)\s+company|we|us|it|ours)\b/i;
  const genericCompany = /^(?:(?:a|an|the)\s+)?(?:(?:local|singapore|private|public|listed|non[- ]listed)\s+){0,2}company\b/i;
  const filingFor = new RegExp(String.raw`\b${FILING_SUBJECT}\b[^.!?;]{0,80}?\b(?:for|of)\s+([^.!?;]+)`, 'gi');
  for (const match of text.matchAll(filingFor)) {
    if (!sameOwner.test(match[1]) && !genericCompany.test(match[1])) return true;
  }
  const filingAction = String.raw`(?:file|submit|hold|conduct)\b[^.!?;]{0,40}\b${FILING_SUBJECT}\b`;
  const questionActor = new RegExp(String.raw`\b(?:must|should|can|will|does)\s+([^.!?;]{1,60}?)\s+(?:(?:have|need)\s+to\s+)?${filingAction}`, 'gi');
  for (const match of text.matchAll(questionActor)) {
    if (!sameOwner.test(match[1])) return true;
  }
  const statementActor = new RegExp(String.raw`(?:^|[.!?;])\s*([^.!?;]{1,60}?)\s+(?:must|should|will|needs? to)\s+${filingAction}`, 'gi');
  for (const match of text.matchAll(statementActor)) {
    if (!sameOwner.test(match[1])) return true;
  }
  return false;
}

/** Parse listing status only when one explicitly owned FYE and company are in scope. */
export function parseCompanyFyeCompanyType(query: string): 'listed' | 'non-listed' | undefined {
  if (!parseCompanyFyeDate(query)) return undefined;
  const ownedFyeCompany = /\b(?:our|my|this|the)\s+((?:(?:local|singapore|non[- ]listed|private|public|listed)\s+){0,2})company(?:['’]s)?\s+(?:fye|financial year end|financial year ended|year ended)\b/i.exec(query);
  const ownerTypes = (ownedFyeCompany?.[1]?.match(/non[- ]listed|private|listed/gi) ?? [])
    .map(value => value.toLowerCase() === 'listed' ? 'listed' : 'non-listed');
  const sameOwnerStatement = /\b(?:our|my|this)\s+company\s+(?:is|was|remains)\s+(?:(?:a|an)\s+)?(non[- ]listed|private|listed)(?:\s+company)?\b/i.exec(query);
  const boundOwnerTypes = [...ownerTypes, ...(sameOwnerStatement?.[1] ? [sameOwnerStatement[1].toLowerCase()] : [])]
    .map(value => value === 'listed' ? 'listed' : 'non-listed');
  if (new Set(boundOwnerTypes).size > 1) return undefined;
  const hasOtherEntityCue = /\b(?:another|other|different|second|competitor|supplier|vendor|client|customer|subsidiary|parent|affiliate|partner)\b/i.test(query) ||
    /\b(?!(?:our|my|this|the|it|we|company)\b)[\p{L}][\p{L}\p{N}&.'’-]*\s+(?:is|operates|has)\s+(?:a|an)\s+(?:non[- ]listed|private|listed)\s+company\b/iu.test(query);
  const genericDeadlineType = /\bdue\s+for\s+(?:a\s+)?(non[- ]listed|private|listed)\s+company\b/i.exec(query)?.[1]?.toLowerCase();
  const genericType = genericDeadlineType ? genericDeadlineType === 'listed' ? 'listed' : 'non-listed' : undefined;
  if (hasOtherEntityCue) return undefined;
  if (boundOwnerTypes.length) {
    if (genericType && genericType !== boundOwnerTypes[0]) return undefined;
    return boundOwnerTypes[0];
  }
  return genericType;
}

/** Parse one unambiguous company-owned FYE date without normalizing invalid calendar dates. */
export function parseCompanyFyeDate(query: string): string | undefined {
  if (hasUnrelatedFilingOwner(query)) return undefined;
  const fyePattern = new RegExp(String.raw`\b(?:(?:(?:our|this|the)\s+)?(?:(?:local|singapore|private|public|listed|non[- ]listed)\s+){0,2}company(?:['’]s)?\s+|(?:our|this|the)\s+)(?:fye|financial year end|financial year ended|year ended)\s*(?:(?:is|was|on|of|ended)\s*|:\s*)?(${EXPLICIT_DATE})\b`, 'gi');
  const matches = [...query.matchAll(fyePattern)];
  const ownedFyePattern = new RegExp(
    "\\b(?:(?:our|my|this|the)\\s+)?(?:(?:(?:local|singapore|private|public|listed|non[- ]listed)\\s+){0,2}company(?:\\x27s|’s)?\\s+|(?:our|my|this|the)\\s+)(?:fye|financial year end|financial year ended|year ended)\\s*(?:(?:is|was|on|of|ended)\\s*|:\\s*)?(" + EXPLICIT_DATE + ")\\b",
    "gi"
  );
  const ownedMatches = [...query.matchAll(ownedFyePattern)];
  const dates = [...query.matchAll(new RegExp(EXPLICIT_DATE, 'gi'))];
  const years = [...query.matchAll(/\b(?:19|20)\d{2}\b/g)];
  if (matches.length !== 1 || ownedMatches.length !== 1 || dates.length !== 1 || years.length !== 1 ||
      matches[0][1] !== dates[0][0] || ownedMatches[0][1] !== matches[0][1]) return undefined;
  const precedingText = query.slice(0, matches[0].index);
  const fyeOwnerClause = precedingText.split(/[.!?;:]/).at(-1) || '';
  const namedPossessiveOwner = /(?:^|\s)[\p{Lu}][\p{L}\p{N}&.-]*(?:\s+[\p{Lu}][\p{L}\p{N}&.-]*){0,2}['’]s\s*$/u.test(fyeOwnerClause);
  const ownerMatch = ownedMatches[0][0];
  const vagueOwnerConflictsWithOurCompany = !/^(?:our|my|this)\b/i.test(ownerMatch) &&
    /\b(?:our|my)\b/i.test(query.slice(matches[0].index + matches[0][0].length));
  if (/\b(?:another|other|different|second|competitor|supplier|vendor|client|customer|subsidiary|parent|affiliate)\b/i.test(fyeOwnerClause)) {
    return undefined;
  }
  if (namedPossessiveOwner || vagueOwnerConflictsWithOurCompany) return undefined;

  const value = matches[0][1];
  let year: number, month: number, day: number;
  let dateMatch = /^(\d{1,2})[/-](\d{1,2})[/-](20\d{2})$/.exec(value);
  if (dateMatch) [, day, month, year] = dateMatch.map(Number);
  else if ((dateMatch = /^(20\d{2})-(\d{2})-(\d{2})$/.exec(value))) {
    [, year, month, day] = dateMatch.map(Number);
  } else if ((dateMatch = /^(\d{1,2})\s+([a-z]+)\s+(20\d{2})$/i.exec(value))) {
    day = Number(dateMatch[1]);
    month = MONTHS[dateMatch[2].toLowerCase()];
    year = Number(dateMatch[3]);
  } else return undefined;

  if (![year, month, day].every(Number.isInteger) || year !== Number(years[0][0])) return undefined;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return undefined;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
