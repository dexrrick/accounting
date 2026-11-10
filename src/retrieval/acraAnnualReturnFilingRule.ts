import type { AcraFyeCohortApplicability } from '../standards/unifiedSourceModel';

function normalizeEvidenceText(value: string): string {
  return value.toLowerCase().normalize('NFKD').replace(/[^a-z0-9%]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export const ACRA_2022_ANNUAL_RETURN_TIMELINES_URL =
  'https://www.acra.gov.sg/news-events/news-announcements/665/';

/** Reads only the exact ACRA source-stated FYE cohort; it does not create a validity interval. */
export function deriveAcraFyeCohortApplicability(text: string): AcraFyeCohortApplicability | undefined {
  if (!/\bAll Singapore-incorporated companies are required to file their annual returns with ACRA\./i.test(text)) return undefined;
  const matches = [...text.matchAll(/\bThe timelines for companies with Financial Year End \(FYE\) on or after 31 Aug 2018 are as follows:/gi)];
  if (matches.length !== 1) return undefined;
  return {
    kind: 'ACRA_FYE_ON_OR_AFTER',
    fyeStartDate: '2018-08-31',
    sourceQuote: matches[0][0]
  };
}

export interface AcraAnnualReturnIssueScope {
  id: string;
  subject: string;
  population: string;
  domain: string;
  governingAuthorities: string[];
  mappedTopicIds: string[];
  status: string;
}

/** A mapped ACRA company deadline issue needs table evidence even if ownership is contested. */
export function requiresAcraAnnualReturnDeadlineEvidence(
  query: string,
  authority: string,
  issue: AcraAnnualReturnIssueScope
): boolean {
  return isAcraAnnualReturnDeadlineQuestion(query) && authority === 'ACRA' &&
    issue.domain === 'ACRA_CORPORATE' && (issue.population === 'COMPANY' || issue.population === 'UNKNOWN') &&
    issue.governingAuthorities.includes('ACRA') && issue.status === 'MAPPED' &&
    issue.mappedTopicIds.includes('acra_annual-returns');
}

/** Deadline questions need the deadline table; an annual-filing duty alone is insufficient. */
export function isAcraAnnualReturnDeadlineQuestion(query: string): boolean {
  const clauses = query.replace(/,\s*(?:and|but)\s+(?=(?:when|how|what\s+date|by\s+what\s+date)\b)/gi, '\n')
    .split(/[.!?;\n]+/).map(clause => normalizeEvidenceText(clause)).filter(Boolean);
  const asksForTiming = (clause: string) =>
    /\b(?:deadline|due date|filing date|filing time|timeframe|time frame|when|how many months?|how long|how soon|what date|by what date)\b/.test(clause) ||
    /\bwithin\b/.test(clause) || /\bmonths?\b.{0,30}\bafter\b|\bafter\b.{0,30}\bmonths?\b/.test(clause);
  if (clauses.some(clause => /\bannual returns?\b/.test(clause) && asksForTiming(clause))) return true;
  return clauses.some((clause, index) => index > 0 && asksForTiming(clause) &&
    /\b(?:it|they|these|those)\b/.test(clause) &&
    !/\b(?:income tax|gst|tax returns?|financial statements?)\b/.test(clause) &&
    /\bannual returns?\b/.test(clauses[index - 1]));
}

/**
 * Bind deadline concepts only to one mapped ACRA company issue. Mixed-authority
 * queries can still have a unique ACRA owner; competing ACRA issues remain open.
 */
export function isAcraAnnualReturnDeadlineIssue(
  query: string,
  authority: string,
  issue: AcraAnnualReturnIssueScope,
  candidateIssues: AcraAnnualReturnIssueScope[]
): boolean {
  if (!requiresAcraAnnualReturnDeadlineEvidence(query, authority, issue) ||
      issue.governingAuthorities.length !== 1 ||
      issue.governingAuthorities[0] !== 'ACRA') return false;
  const acraCompanyIssues = candidateIssues.filter(candidate => candidate.domain === 'ACRA_CORPORATE' &&
    candidate.governingAuthorities.includes('ACRA') &&
    (candidate.population === 'COMPANY' || candidate.population === 'UNKNOWN'));
  return acraCompanyIssues.length === 1 && acraCompanyIssues[0].id === issue.id;
}

/** True only when the text states an operative company annual-return filing duty. */
export function supportsAcraAnnualReturnFilingRule(text: string): boolean {
  const companySubject = String.raw`(?:(?:all|each|every|local|private|registered|incorporated|singapore(?:an)?)\s+)*(?:a\s+)?compan(?:y|ies)(?:\s+registered\s+in\s+singapore)?`;
  const obligation = String.raw`(?:must|shall|need to|needs to|have to|has to|are required to|is required to|are to|is to)`;
  const annualReturn = String.raw`(?:(?:the|an?|their|its)\s+)?annual returns?`;
  const activeFilingRule = new RegExp(String.raw`^${companySubject}(?:\s+in\s+singapore)?\s+${obligation}\s+(?:file|lodge|submit)\s+${annualReturn}\b`);
  const passiveFilingRule = new RegExp(String.raw`^${annualReturn}\s+(?:${obligation}\s+)?be\s+(?:filed|lodged|submitted)\s+by\s+${companySubject}\b`);
  return text.split(/(?<=[.!?;])\s+|[\r\n]+/).some(sentence => {
    const trimmed = sentence.trim();
    if (!trimmed || trimmed.endsWith('?')) return false;
    const normalized = normalizeEvidenceText(sentence);
    if (/\b(?:vccs?|variable capital compan(?:y|ies))\b/.test(normalized)) return false;
    return activeFilingRule.test(normalized) || passiveFilingRule.test(normalized);
  });
}

function deadlineTableRows(passage: string): string[][] | undefined {
  const oneToNine = 'one|two|three|four|five|six|seven|eight|nine';
  const unitWords = `(?:${oneToNine}|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen)`;
  const compoundNumberWords = `(?:twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:[- ](?:${oneToNine}))?`;
  const numberWords = `(?:zero|${unitWords}|${compoundNumberWords}|(?:${oneToNine}) hundred(?: and (?:${unitWords}|${compoundNumberWords}))?)`;
  const lines = passage.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const rows = lines.map(line => line.split('|').map(cell => cell.trim()));
  if (rows.some(row => row.some(cell => cell.includes('\n')))) return undefined;

  // Native ACRA matrix: the blank top-left heading and blank non-listed
  // overseas-branch cell are source data. Retain them as empty cells and do
  // not infer a numeric deadline for the latter.
  if (rows.length === 3 && rows.every(row => row.length === 3)) {
    const [header, allCompanies, branchCompanies] = rows;
    const numericDeadline = new RegExp(`^within\\s+(?:\\d+|${numberWords})\\s+months?\\s+after\\s+fye\\s*[.!]?\\s*$`, 'i');
    const isBranchCategory = normalizeEvidenceText(branchCompanies[0]) ===
      'companies having a share capital and keeping a branch register outside singapore';
    if (header[0] === '' && normalizeEvidenceText(header[1]) === 'listed companies' &&
        normalizeEvidenceText(header[2]) === 'non listed companies' &&
        normalizeEvidenceText(allCompanies[0]) === 'all companies' &&
        numericDeadline.test(allCompanies[1]) && numericDeadline.test(allCompanies[2]) &&
        isBranchCategory && numericDeadline.test(branchCompanies[1]) && branchCompanies[2] === '') return rows;
    return undefined;
  }

  if (rows.some(row => row.length !== 2 || row.some(cell => !cell))) return undefined;
  const [header, ...body] = rows;
  const numericDeadline = new RegExp(`^within\\s+(?:\\d+|${numberWords})\\s+months?\\s+after\\s+fye\\s*[.!]?\\s*$`, 'i');
  if (normalizeEvidenceText(header[0]) !== 'company type' || normalizeEvidenceText(header[1]) !== 'filing deadline' ||
      body.length !== 4 || body.some(([, deadline]) => !numericDeadline.test(deadline))) return undefined;

  const listedRows = body.filter(([category]) => /\blisted companies\b/i.test(category) && !/\bnon[ -]listed companies\b/i.test(category));
  const nonListedRows = body.filter(([category]) => /\bnon[ -]listed companies\b/i.test(category));
  const isBaseRow = (category: string, status: 'listed' | 'non-listed') => {
    const normalized = normalizeEvidenceText(category);
    return normalized === (status === 'listed' ? 'listed companies' : 'non listed companies');
  };
  const isQualifiedRow = (category: string) => {
    const normalized = normalizeEvidenceText(category);
    return /\bwith\b/.test(normalized) && /\bshare capital\b/.test(normalized) &&
      /\boverseas branch register\b/.test(normalized);
  };
  if (!listedRows.some(([category]) => isBaseRow(category, 'listed')) ||
      !listedRows.some(([category]) => isQualifiedRow(category)) ||
      !nonListedRows.some(([category]) => isBaseRow(category, 'non-listed')) ||
      !nonListedRows.some(([category]) => isQualifiedRow(category))) return undefined;
  return rows;
}

function parseDeadlineMonthCount(deadline: string): number | undefined {
  const match = deadline.match(/^within\s+(\d+|[a-z -]+)\s+months?\s+after\s+fye\s*[.!]?\s*$/i);
  if (!match) return undefined;
  if (/^\d+$/.test(match[1])) {
    const numeric = Number(match[1]);
    return Number.isSafeInteger(numeric) ? numeric : undefined;
  }

  const unitValues: Record<string, number> = {
    zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
    ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
    seventeen: 17, eighteen: 18, nineteen: 19
  };
  const tensValues: Record<string, number> = {
    twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90
  };
  const words = match[1].toLowerCase().replace(/-/g, ' ').split(/\s+/).filter(word => word !== 'and');
  let total = 0;
  let current = 0;
  for (const word of words) {
    if (Object.hasOwn(unitValues, word)) current += unitValues[word];
    else if (Object.hasOwn(tensValues, word)) current += tensValues[word];
    else if (word === 'hundred') current = (current || 1) * 100;
    else return undefined;
  }
  total += current;
  return Number.isSafeInteger(total) ? total : undefined;
}

/** Returns one entire, structurally linked ACRA deadline table block, if valid and unambiguous. */
export function getAcraAnnualReturnDeadlineTablePassage(text: string): string | undefined {
  const matchingPassages = text.split(/\r?\n[\t ]*\r?\n+/).map(passage => passage.trim()).filter(Boolean)
    .filter(passage => deadlineTableRows(passage) !== undefined);
  const uniquePassages = [...new Set(matchingPassages)];
  return uniquePassages.length === 1 ? uniquePassages[0] : undefined;
}

export function supportsAcraAnnualReturnDeadlineTable(text: string): boolean {
  return getAcraAnnualReturnDeadlineTablePassage(text) !== undefined;
}

/** Reads the explicit month count from the complete verified table row for the supplied company facts. */
export function getAcraAnnualReturnDeadlineMonths(
  text: string,
  facts: { listingStatus: 'LISTED' | 'NON_LISTED'; hasOverseasBranchRegister: boolean; hasShareCapital?: boolean }
): number | undefined {
  if (facts.hasOverseasBranchRegister && facts.hasShareCapital === undefined) return undefined;
  const passage = getAcraAnnualReturnDeadlineTablePassage(text);
  if (!passage) return undefined;
  const rows = deadlineTableRows(passage);
  if (!rows) return undefined;
  if (rows[0].length === 3) {
    const qualifiedBranchCompany = facts.hasOverseasBranchRegister && facts.hasShareCapital === true;
    const row = qualifiedBranchCompany ? rows[2] : rows[1];
    const deadlineColumn = facts.listingStatus === 'LISTED' ? 1 : 2;
    return parseDeadlineMonthCount(row[deadlineColumn]);
  }
  const qualifiedBranchCompany = facts.hasOverseasBranchRegister && facts.hasShareCapital === true;
  const expectedType = facts.listingStatus === 'LISTED' ? 'listed companies' : 'non listed companies';
  const matchingRows = rows.slice(1).filter(([companyType]) => {
    const normalized = normalizeEvidenceText(companyType);
    const isExpectedType = qualifiedBranchCompany
      ? normalized.startsWith(`${expectedType} with`) &&
        /\bshare capital\b/.test(normalized) && /\boverseas branch register\b/.test(normalized)
      : normalized === expectedType;
    return isExpectedType;
  });
  return matchingRows.length === 1 ? parseDeadlineMonthCount(matchingRows[0][1]) : undefined;
}

/** Same admitted source must contain both annual-return context and a complete qualified deadline table. */
export function supportsAcraAnnualReturnDeadlineEvidence(text: string): boolean {
  return supportsAcraAnnualReturnFilingRule(text) && supportsAcraAnnualReturnDeadlineTable(text);
}

export function supportsAcraAnnualReturnDeadlineConcept(text: string, conceptId: string): boolean {
  const table = getAcraAnnualReturnDeadlineTablePassage(text);
  if (!table) return false;
  const normalized = normalizeEvidenceText(table);
  switch (conceptId) {
    case 'acra_annual_return_filing_deadline':
      return /\bfiling deadline\b/.test(normalized) || /\bwithin\s+(?:\d+|[a-z -]+)\s+months?\s+after\s+fye\b/.test(normalized);
    case 'acra_annual_return_financial_year_end':
      return /\bfye\b|\bfinancial year end\b/.test(normalized);
    case 'acra_annual_return_listing_status':
      return /\b(?:listed|non listed) companies\b/.test(normalized);
    case 'acra_annual_return_branch_register_qualification':
      return /\boverseas branch register\b|\bbranch register outside singapore\b/.test(normalized);
    default:
      return false;
  }
}
