type ParsedDate = { iso: string; raw: string; monthYearOnly?: boolean };

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9,
  sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12
};

function validIso(year: number, month: number, day: number): string | undefined {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return undefined;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function datesIn(query: string): ParsedDate[] | undefined {
  const matches: Array<{ start: number; end: number; value: ParsedDate }> = [];
  const patterns = [
    /\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/g,
    /\b(\d{1,2})[/-](\d{1,2})[/-](20\d{2})\b/g,
    /\b(\d{1,2})\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(20\d{2})\b/gi,
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:,)?\s+(20\d{2})\b/gi,
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(20\d{2})\b/gi
  ];
  for (const [index, pattern] of patterns.entries()) {
    for (const match of query.matchAll(pattern)) {
      let year: number; let month: number; let day: number | undefined;
      if (index === 0) { year = Number(match[1]); month = Number(match[2]); day = Number(match[3]); }
      else if (index === 1) { day = Number(match[1]); month = Number(match[2]); year = Number(match[3]); }
      else if (index === 2) { day = Number(match[1]); month = MONTHS[match[2].toLowerCase().slice(0, 4).replace(/^sept$/, 'sept')] ?? MONTHS[match[2].toLowerCase().slice(0, 3)]; year = Number(match[3]); }
      else if (index === 3) { month = MONTHS[match[1].toLowerCase().slice(0, 3)]; day = Number(match[2]); year = Number(match[3]); }
      else { month = MONTHS[match[1].toLowerCase().slice(0, 3)]; year = Number(match[2]); }
      const iso = day === undefined ? `${year}-${String(month).padStart(2, '0')}` : validIso(year, month, day);
      if (!iso) return undefined;
      matches.push({ start: match.index!, end: match.index! + match[0].length,
        value: { iso, raw: match[0], ...(day === undefined ? { monthYearOnly: true } : {}) } });
    }
  }
  // Full dates also match the shorter month/year pattern. Keep only the longest match at each position.
  const selected: typeof matches = [];
  for (const match of matches.sort((a, b) => a.start - b.start || b.end - a.end)) {
    if (selected.some(previous => match.start < previous.end && previous.start < match.end)) continue;
    selected.push(match);
  }
  const mentionedYears = [...query.matchAll(/\b(?:19|20)\d{2}\b/g)].map(match => Number(match[0]));
  const parsedYears = selected.map(({ value }) => Number(value.iso.slice(0, 4)));
  if (mentionedYears.some(year => !parsedYears.includes(year) && year !== 2026 && year !== 2027)) return undefined;
  return selected.map(({ value }) => value);
}

function hasSeparateRequest(query: string): boolean {
  return /\b(?:another question|separately|in addition|also,? (?:how|what|when|which)|and (?:also )?(?:how|what|when|which) (?:do|does|can|should|must|is|are|the company|we)\b|(?:renew|apply for|obtain|qualify for) (?:a |the )?(?:cms )?licen[cs]e|qdc|vcfm|venture capital fund manager|quarterly financial returns?)\b/i.test(query);
}

export interface AcraOfficerCommencementScope {
  filingDate?: string;
}

/** Recognizes only discussion of ACRA's 20 October 2026 annual-return officer/CEO change. */
export function acraOfficerCommencementScope(query: string): AcraOfficerCommencementScope | undefined {
  if (query.length > 2_000 || hasSeparateRequest(query) || /\b(?:mas|sfa\s*04|cpf|iras|mom|gst|income tax|xbrl|agm|annual general meeting|filing deadline|extension|penalt\w*)\b/i.test(query)) return undefined;
  const identifiesChange = /\b(?:annual[- ]return|annual filing|return)\b/i.test(query) &&
    /\b(?:officer[- ]confirm(?:ation)?|officer particulars?|ceo|chief executive(?: officer)?|director|secretar\w*|auditor)\b/i.test(query) &&
    /\b(?:change|commenc\w*|new question|additional question|already mandatory|mandatory|appl(?:y|ied)|govern(?:ed|ing)?|effective|takes? effect|from)\b/i.test(query);
  if (!identifiesChange) return undefined;
  const parsed = datesIn(query);
  if (!parsed || parsed.some(date => !date.iso.startsWith('2026-'))) return undefined;
  if ([...query.matchAll(/\b(?:19|20)\d{2}\b/g)].some(year => year[0] !== '2026')) return undefined;
  const explicitBoundary = /\b(?:20\s+october\s+2026|20\s+oct\s+2026|2026-10-20|20[/-]10[/-]2026)\b/i.test(query);
  const monthScope = /\b(?:october|oct)\s+2026\b/i.test(query);
  const filingMentions = parsed.filter(date => {
    const at = query.toLowerCase().indexOf(date.raw.toLowerCase());
    const before = query.slice(Math.max(0, at - 48), at);
    const after = query.slice(at + date.raw.length, Math.min(query.length, at + date.raw.length + 40));
    return /\b(?:filed|lodged|submitted|filing|return)\b[^.!?;]{0,32}$/i.test(before)
      || /^\s*(?:was\s+)?(?:filed|lodged|submitted)\b/i.test(after);
  });
  const filingPeriods = [...new Set(filingMentions.map(date => date.iso.slice(0, 7)))];
  if (filingPeriods.length > 1) return undefined;
  const filingDates = [...new Set(filingMentions.filter(date => !date.monthYearOnly).map(date => date.iso))];
  if (filingDates.length > 1) return undefined;
  const sourceBoundaryDates = parsed.filter(date => {
    if (date.iso !== '2026-10-20') return false;
    const at = query.toLowerCase().indexOf(date.raw.toLowerCase());
    const context = query.slice(Math.max(0, at - 55), Math.min(query.length, at + date.raw.length + 45));
    return /\b(?:commenc\w*|effective|new question|change|from)\b/i.test(context);
  });
  const otherDatedFacts = parsed.filter(date => !filingMentions.includes(date) && !sourceBoundaryDates.includes(date));
  if (otherDatedFacts.length > 0) return undefined;
  if (filingDates.some(date => date < '2026-10-20') &&
      !/\b(?:already|appl(?:y|ies|ied)|govern\w*|in effect|in force|mandatory|for (?:that|this) filing|to (?:that|this) filing)\b/i.test(query)) return undefined;
  if (!explicitBoundary && !monthScope && parsed.length === 0) return undefined;
  if (parsed.length === 0 && !monthScope) return undefined;
  return { ...(filingDates.length === 1 ? { filingDate: filingDates[0] } : {}) };
}

export interface MasSfa04N24CommencementScope {
  refersTo2026Matter: boolean;
}

function masNoticeIds(query: string): string[] {
  return [...query.matchAll(/\b(?:sfa\s*0?4\s*[-– ]\s*n|faa\s*[-– ]\s*n)\s*(\d+)\b/gi)]
    .map(match => match[0].toLowerCase().replace(/[^a-z0-9]/g, ''));
}

/** Conflicting explicit notice numbers in the question cannot borrow N24 evidence. */
export function hasConflictingMasNoticeIdentity(query: string): boolean {
  return masNoticeIds(query).some(id => !/sfa04n24$/.test(id));
}

/** Recognizes only a bounded question about SFA 04-N24's declared commencement and scope. */
export function masSfa04N24CommencementScope(query: string): MasSfa04N24CommencementScope | undefined {
  if (query.length > 2_000 || hasSeparateRequest(query) || /\b(?:acra|iras|cpf|mom|gst|income tax|xbrl|annual return)\b/i.test(query)) return undefined;
  if (hasConflictingMasNoticeIdentity(query)) return undefined;
  const noticeIds = masNoticeIds(query);
  const namedNotice = noticeIds.some(id => /sfa04n24$/.test(id));
  const misconduct = /\b(?:misconduct|representatives?)\b/i.test(query);
  const initialReportRule = /\b(?:who (?:files?|must report)|initial report|reasonable grounds|reasonable-ground|21\s*(?:calendar[- ]?)?days?|reporting (?:rule|clock|deadline)|takes? effect|effective(?: date)?|govern|appl(?:y|ied)|transition(?:al)?|already govern)\b/i.test(query);
  const generalNamedNoticeRule = namedNotice &&
    /\b(?:what does|what are|explain|outline|describe)\b[\s\S]{0,100}\b(?:require|requires|requirements?|rule|obligation|scope)\b/i.test(query) &&
    /\b(?:from|effective|takes? effect|commenc\w*)\b/i.test(query);
  if ((!initialReportRule && !generalNamedNoticeRule) || (!misconduct && !namedNotice)) return undefined;
  const genericNamedByBoundary = /\b(?:misconduct|representative misconduct) notice\b/i.test(query) &&
    /\b(?:takes? effect|effective|commenc\w*)\b/i.test(query) &&
    /\b(?:1\s+(?:jan(?:uary)?)\s+2027|2027-01-01|01[/-]01[/-]2027)\b/i.test(query);
  if (!namedNotice && !genericNamedByBoundary) return undefined;
  const parsed = datesIn(query);
  if (!parsed || parsed.some(date => !(date.iso.startsWith('2026-') || date.iso === '2027-01-01' || date.iso.startsWith('2027-01')))) return undefined;
  const years = [...query.matchAll(/\b(?:19|20)\d{2}\b/g)].map(match => Number(match[0]));
  if (years.some(year => year !== 2026 && year !== 2027)) return undefined;
  const explicitlyDated2027 = parsed.some(date => date.iso === '2027-01-01') ||
    /\b2027\b/.test(query) && /\b(?:effective|takes? effect|commenc\w*|notice|sfa\s*0?4\s*[-– ]\s*n24)\b/i.test(query);
  const refersTo2026Matter = parsed.some(date => date.iso.startsWith('2026-')) ||
    /\b(?:october|oct|december|dec)\s+2026\b/i.test(query) || /\b2026\b/.test(query);
  const datesHaveNamedRoles = parsed.every(date => {
    const at = query.toLowerCase().indexOf(date.raw.toLowerCase());
    const context = query.slice(Math.max(0, at - 55), Math.min(query.length, at + date.raw.length + 55));
    return date.iso.startsWith('2027-01')
      ? /\b(?:effective|takes? effect|commenc\w*|notice|sfa\s*0?4\s*[-– ]\s*n24)\b/i.test(context)
      : /\b(?:report|misconduct|reasonable grounds|filed|due|suspect\w*|incident|transition|govern\w*|appl(?:y|ied))\b/i.test(context);
  });
  if (!datesHaveNamedRoles) return undefined;
  if (years.length > 0 && !explicitlyDated2027 && !refersTo2026Matter) return undefined;
  return { refersTo2026Matter };
}
