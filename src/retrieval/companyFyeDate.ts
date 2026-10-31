const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3,
  apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7,
  aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10,
  nov: 11, november: 11, dec: 12, december: 12
};

const EXPLICIT_DATE = String.raw`(?:\d{1,2}[/-]\d{1,2}[/-]20\d{2}|20\d{2}-\d{2}-\d{2}|\d{1,2}\s+(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+20\d{2})`;

/** Parse one unambiguous company-owned FYE date without normalizing invalid calendar dates. */
export function parseCompanyFyeDate(query: string): string | undefined {
  const fyePattern = new RegExp(String.raw`\b(?:(?:(?:our|this|the)\s+)?(?:(?:local|singapore|private|public|listed|non[- ]listed)\s+){0,2}company(?:['’]s)?\s+|(?:our|this|the)\s+)(?:fye|financial year end|financial year ended|year ended)\s*(?:(?:is|was|on|of|ended)\s*|:\s*)?(${EXPLICIT_DATE})\b`, 'gi');
  const matches = [...query.matchAll(fyePattern)];
  const dates = [...query.matchAll(new RegExp(EXPLICIT_DATE, 'gi'))];
  const years = [...query.matchAll(/\b(?:19|20)\d{2}\b/g)];
  if (matches.length !== 1 || dates.length !== 1 || years.length !== 1 || matches[0][1] !== dates[0][0]) return undefined;
  const precedingText = query.slice(0, matches[0].index);
  if (/\b(?:another|other|different|second|competitor)\s*$/i.test(precedingText)) return undefined;

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
