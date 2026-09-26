/** A cost date in another calendar year does not, by itself, establish its Section 14N YA basis period. */
export function hasUnresolvedSection14NBasisPeriod(query: string): boolean {
  if (!/\b(?:renovat\w*|refurbish\w*|section\s*14n)\b/i.test(query)) return false;
  const ya = /\b(?:ya|year of assessment)\s*(20\d{2})\b/i.exec(query)?.[1];
  if (!ya) return false;
  const datedYears = [
    ...query.matchAll(/\b[0-3]?\d[/-][01]?\d[/-](20\d{2})\b/g),
    ...query.matchAll(/\b(20\d{2})-[01]\d-[0-3]\d\b/g),
    ...query.matchAll(/\b[0-3]?\d\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(20\d{2})\b/gi)
  ].map(match => match[1]);
  if (!datedYears.some(year => year !== ya)) return false;
  const basisYear = String(Number(ya) - 1);
  const calendarYearFye = new RegExp(`\\b(?:fye|financial\\s+year\\s+end)\\s*(?:is|was|on)?\\s*(?:31[/-]12[/-]${basisYear}|31\\s+dec(?:ember)?\\s+${basisYear})\\b`, 'i');
  const calendarYearBasis = new RegExp(`\\bbasis\\s+period\\s*(?:is|was|from|:)?\\s*(?:0?1[/-]0?1[/-]${basisYear}|1\\s+jan(?:uary)?\\s+${basisYear})\\s*(?:to|through|[-–—])\\s*(?:31[/-]12[/-]${basisYear}|31\\s+dec(?:ember)?\\s+${basisYear})\\b`, 'i');
  if ((calendarYearFye.test(query) || calendarYearBasis.test(query)) &&
      datedYears.every(year => year === basisYear)) return false;
  return true;
}
