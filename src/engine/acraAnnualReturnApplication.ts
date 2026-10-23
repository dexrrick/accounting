import type { AuthorityEvidenceStatus, AuthorityIssueLifecycle } from '../types/authorityEvidence';
import type { AcraFyeCohortApplicability, AuthoritativeSourceRecord } from '../standards/unifiedSourceModel';
import type { VerifiedEvidenceClaim } from '../verification/claimEvidenceVerifier';
import {
  deriveAcraFyeCohortApplicability,
  getAcraAnnualReturnDeadlineMonths,
  supportsAcraAnnualReturnDeadlineEvidence
} from '../retrieval/acraAnnualReturnFilingRule';
import { formatSingaporeDate, getSingaporeDateString } from '../utils/dateUtils';

export interface AcraAnnualReturnCompanyFacts {
  financialYearEnd?: string;
  listingStatus?: 'LISTED' | 'NON_LISTED';
  hasOverseasBranchRegister?: boolean;
  hasShareCapital?: boolean;
  unresolvedFacts: string[];
}

export interface AcraAnnualReturnApplicationEvidence {
  evidenceStatus: AuthorityEvidenceStatus;
  /** The exact date against which the source and claim were admitted. */
  targetDate?: string;
  lifecycle: Pick<AuthorityIssueLifecycle, 'admitted' | 'verified' | 'covered'>;
  sources: Array<Pick<AuthoritativeSourceRecord,
    'id' | 'sourceText' | 'validFrom' | 'validTo' | 'effectiveDate' | 'retrievedAt' | 'acraFyeCohortApplicability'>>;
  verifiedClaims: Array<Pick<VerifiedEvidenceClaim, 'recordId' | 'quote'>>;
}

export interface AcraAnnualReturnApplicationResult {
  applicationStatus: 'VERIFIED' | 'UNRESOLVED';
  applicationReason: string;
  deadlineDate?: string;
  monthCount?: number;
  facts: AcraAnnualReturnCompanyFacts;
}

const MONTH_NUMBERS = new Map([
  ['january', 1], ['february', 2], ['march', 3], ['april', 4], ['may', 5], ['june', 6],
  ['july', 7], ['august', 8], ['september', 9], ['october', 10], ['november', 11], ['december', 12]
]);
const DATE_TOKEN = String.raw`(?:\d{1,2}[/-]\d{1,2}[/-]\d{4}|\d{4}-\d{2}-\d{2}|\d{1,2}(?:st|nd|rd|th)?\s+[a-z]+\s+\d{4})`;
const UNASSERTED_FACT_CUE = /\b(?:do not assume|don't assume|not sure(?:\s+whether|\s+if)?|unsure|uncertain|unclear|cannot confirm|can't confirm|do not know|don't know|if|assuming|possibly|perhaps|unknown)\b|\b(?:may|might|could)\s+(?:possibly\s+)?(?:be|have|keep|maintain)\b/i;

function factClause(query: string, start: number, end: number): string {
  const before = query.slice(0, start);
  const precedingBoundaries = ['.', '?', '!', ';', '\n'].map(character => before.lastIndexOf(character));
  const clauseStart = Math.max(...precedingBoundaries) + 1;
  const after = query.slice(end);
  const followingBoundaries = ['.', '?', '!', ';', '\n'].map(character => {
    const index = after.indexOf(character);
    return index < 0 ? Number.POSITIVE_INFINITY : index;
  });
  const clauseEnd = end + Math.min(...followingBoundaries);
  return query.slice(clauseStart, clauseEnd);
}

function hasUnassertedFactMention(query: string, mentions: RegExp): boolean {
  return [...query.matchAll(mentions)].some(match => {
    const start = match.index ?? 0;
    return UNASSERTED_FACT_CUE.test(factClause(query, start, start + match[0].length));
  });
}

export function isAcraAnnualReturnApplicationQuestion(query: string, operation: string): boolean {
  if (!['EXPLAIN_RULE', 'FILING_REQUIREMENT', 'DETERMINE_TREATMENT', 'CALCULATE'].includes(operation)) return false;
  const fyeValue = new RegExp(
    String.raw`\b(?:financial\s+year\s+(?:end(?:ing)?|ends?)|fye)\b(?:\s+date)?\s*(?:(?:is|of|on|ending|ended)\s+)?[:,-]?\s*${DATE_TOKEN}`,
    'i'
  ).test(query);
  const firstPersonCompany = /\b(?:my|our)\s+(?:company|business)\b/i.test(query);
  const specificDateRequest = /\b(?:exact|specific|calendar)\s+date\b|\bas\s+dd\s*\/\s*mm\s*\/\s*yyyy\b/i.test(query);
  return fyeValue || firstPersonCompany || specificDateRequest;
}

function isCalendarDate(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || year < 1 || year > 9999 || !Number.isInteger(month) || month < 1 || month > 12 ||
      !Number.isInteger(day) || day < 1) return false;
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  return day <= daysInMonth;
}

function parseDateToken(value: string): string | undefined {
  const token = value.trim();
  let year: number;
  let month: number;
  let day: number;
  const iso = token.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const numeric = token.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  const named = token.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+)\s+(\d{4})$/i);
  if (iso) {
    year = Number(iso[1]);
    month = Number(iso[2]);
    day = Number(iso[3]);
  } else if (numeric) {
    day = Number(numeric[1]);
    month = Number(numeric[2]);
    year = Number(numeric[3]);
  } else if (named) {
    day = Number(named[1]);
    month = MONTH_NUMBERS.get(named[2].toLowerCase()) || 0;
    year = Number(named[3]);
  } else return undefined;
  if (!isCalendarDate(year, month, day)) return undefined;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function financialYearEnd(query: string): { value?: string; error?: string } {
  const marker = new RegExp(
    String.raw`\b(?:financial\s+year\s+(?:end(?:ing)?|ends?)|fye)\b(?:\s+date)?\s*(?:(?:is|of|on|ending|ended)\s+)?[:,-]?\s*(${DATE_TOKEN})`,
    'gi'
  );
  const factMatches = [...query.matchAll(marker)];
  if (factMatches.length === 0) return {};
  if (factMatches.some(match => {
    const start = match.index ?? 0;
    return UNASSERTED_FACT_CUE.test(factClause(query, start, start + match[0].length));
  })) return { error: 'financial year end (uncertain, conditional, or explicitly not assumed)' };
  const values = factMatches.map(match => parseDateToken(match[1]));
  if (values.some(value => !value)) return { error: 'financial year end (invalid calendar date)' };
  const unique = [...new Set(values as string[])];
  return unique.length === 1 ? { value: unique[0] } : { error: 'financial year end (conflicting dates)' };
}

function listingStatus(query: string): { value?: 'LISTED' | 'NON_LISTED'; error?: string } {
  if (hasUnassertedFactMention(query, /\b(?:non[\s-]?listed|unlisted|not\s+listed|listed)\b/gi)) {
    return { error: 'listing status (uncertain or explicitly not assumed)' };
  }
  const nonListed = /\b(?:non[\s-]?listed|unlisted|not\s+listed)\b/i.test(query);
  const withoutNegativeLabel = query.replace(/\b(?:non[\s-]?listed|unlisted|not\s+listed)\b/gi, ' ');
  const listed = /\blisted\b/i.test(withoutNegativeLabel);
  if (listed && nonListed) return { error: 'listing status (conflicting facts)' };
  if (listed) return { value: 'LISTED' };
  if (nonListed) return { value: 'NON_LISTED' };
  return {};
}

function branchRegisterStatus(query: string): { value?: boolean; error?: string } {
  if (hasUnassertedFactMention(query, /\boverseas\s+branch\s+register\b/gi)) {
    return { error: 'overseas branch register status (uncertain or explicitly not assumed)' };
  }
  const negative = /\b(?:no|without|not\s+having|does\s+not\s+have|has\s+no)\s+(?:(?:an?|the)\s+)?(?:overseas\s+)?branch\s+register\b/i.test(query);
  const withoutNegative = query.replace(/\b(?:no|without|not\s+having|does\s+not\s+have|has\s+no)\s+(?:(?:an?|the)\s+)?(?:overseas\s+)?branch\s+register\b/gi, ' ');
  const positive = /\b(?:with|has|have)\s+(?:(?:an?|the)\s+)?overseas\s+branch\s+register\b/i.test(withoutNegative) ||
    /\b(?:with|has|have)\s+(?:(?:an?)\s+)?share\s+capital\s+(?:and|[,;])\s+(?:(?:an?)\s+)?overseas\s+branch\s+register\b/i.test(withoutNegative);
  if (negative && positive) return { error: 'overseas branch register status (conflicting facts)' };
  if (negative) return { value: false };
  if (positive) return { value: true };
  return {};
}

function shareCapitalStatus(query: string): { value?: boolean; error?: string } {
  if (hasUnassertedFactMention(query, /\bshare\s+capital\b/gi)) {
    return { error: 'share capital status (uncertain or explicitly not assumed)' };
  }
  const negative = /\b(?:without|no|not\s+having|does\s+not\s+have|has\s+no)\s+(?:(?:an?)\s+)?share\s+capital\b/i.test(query);
  const withoutNegative = query.replace(/\b(?:without|no|not\s+having|does\s+not\s+have|has\s+no)\s+(?:(?:an?)\s+)?share\s+capital\b/gi, ' ');
  const positive = /\b(?:with|has|have)\s+(?:(?:an?)\s+)?share\s+capital\b/i.test(withoutNegative);
  if (negative && positive) return { error: 'share capital status (conflicting facts)' };
  if (negative) return { value: false };
  if (positive) return { value: true };
  return {};
}

export function identifyAcraAnnualReturnCompanyFacts(query: string): AcraAnnualReturnCompanyFacts {
  const fye = financialYearEnd(query);
  const listing = listingStatus(query);
  const branch = branchRegisterStatus(query);
  const shareCapital = shareCapitalStatus(query);
  const unresolvedFacts = [fye.error, listing.error, branch.error, shareCapital.error].filter((value): value is string => Boolean(value));
  if (!fye.error && !fye.value) unresolvedFacts.push('financial year end');
  if (!listing.error && !listing.value) unresolvedFacts.push('listing status');
  if (!branch.error && branch.value === undefined) unresolvedFacts.push('overseas branch register status');
  if (!shareCapital.error && branch.value === true && shareCapital.value === undefined) {
    unresolvedFacts.push('share capital status (for the overseas branch register qualification)');
  }
  return {
    ...(fye.value ? { financialYearEnd: fye.value } : {}),
    ...(listing.value ? { listingStatus: listing.value } : {}),
    ...(branch.value !== undefined ? { hasOverseasBranchRegister: branch.value } : {}),
    ...(shareCapital.value !== undefined ? { hasShareCapital: shareCapital.value } : {}),
    unresolvedFacts
  };
}

function addMonthsUtc(date: string, months: number): string | undefined {
  if (!Number.isSafeInteger(months) || months < 0) return undefined;
  const [year, month, day] = date.split('-').map(Number);
  const targetMonthIndex = month - 1 + months;
  const targetYear = year + Math.floor(targetMonthIndex / 12);
  const targetMonth = targetMonthIndex % 12 + 1;
  if (targetYear > 9999) return undefined;
  const leapYear = targetYear % 4 === 0 && (targetYear % 100 !== 0 || targetYear % 400 === 0);
  const lastDay = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][targetMonth - 1];
  const targetDay = Math.min(day, lastDay);
  return `${String(targetYear).padStart(4, '0')}-${String(targetMonth).padStart(2, '0')}-${String(targetDay).padStart(2, '0')}`;
}

function unresolved(applicationReason: string, facts: AcraAnnualReturnCompanyFacts): AcraAnnualReturnApplicationResult {
  return { applicationStatus: 'UNRESOLVED', applicationReason, facts };
}

/** Applies only the complete matching row from evidence already admitted and verified for this issue's target date. */
export function applyAcraAnnualReturnDeadline(
  query: string,
  evidence?: AcraAnnualReturnApplicationEvidence
): AcraAnnualReturnApplicationResult {
  const facts = identifyAcraAnnualReturnCompanyFacts(query);
  if (facts.unresolvedFacts.length > 0) {
    return unresolved(`Company facts required to calculate the annual return deadline: ${facts.unresolvedFacts.join(', ')}. No due date has been calculated.`, facts);
  }

  if (!facts.financialYearEnd || !facts.listingStatus || facts.hasOverseasBranchRegister === undefined ||
      facts.hasOverseasBranchRegister && facts.hasShareCapital === undefined) {
    return unresolved('The required company facts are incomplete. No due date has been calculated.', facts);
  }
  const companyCategory: {
    listingStatus: 'LISTED' | 'NON_LISTED';
    hasOverseasBranchRegister: boolean;
    hasShareCapital?: boolean;
  } = {
    listingStatus: facts.listingStatus,
    hasOverseasBranchRegister: facts.hasOverseasBranchRegister,
    ...(facts.hasShareCapital !== undefined ? { hasShareCapital: facts.hasShareCapital } : {})
  };
  if (/\b(?:extensions?(?:\s+of\s+time)?|extended deadline|waivers?|waived|special orders?)\b/i.test(query)) {
    return unresolved('The query mentions an extension, waiver, or special order; this ordinary filing table does not establish a modified deadline. No date is calculated.', facts);
  }

  const eligibleEvidence = evidence?.evidenceStatus === 'VERIFIED' && evidence.lifecycle.admitted &&
    evidence.lifecycle.verified && evidence.lifecycle.covered;
  const verifiedRows: Array<{
    monthCount: number;
    validFrom?: string;
    validTo?: string;
    captureDate?: string;
    cohort?: AcraFyeCohortApplicability;
  }> = [];
  if (eligibleEvidence) {
    if (evidence.targetDate !== facts.financialYearEnd) {
      return unresolved('The admitted evidence was not verified against the stated financial year end; no date is calculated.', facts);
    }
    for (const claim of evidence.verifiedClaims) {
      const source = evidence.sources.find(candidate => candidate.id === claim.recordId);
      if (!source) continue;
      const sourceMonths = getAcraAnnualReturnDeadlineMonths(source.sourceText, companyCategory);
      const quoteMonths = getAcraAnnualReturnDeadlineMonths(claim.quote, companyCategory);
      const validFrom = source.validFrom || source.effectiveDate;
      const cohort = source.acraFyeCohortApplicability;
      if (cohort) {
        const derived = deriveAcraFyeCohortApplicability(source.sourceText);
        const captureDate = source.retrievedAt && Number.isFinite(Date.parse(source.retrievedAt))
          ? getSingaporeDateString(new Date(source.retrievedAt))
          : undefined;
        if (sourceMonths !== undefined && sourceMonths === quoteMonths &&
            JSON.stringify(cohort) === JSON.stringify(derived) && derived &&
            facts.financialYearEnd >= derived.fyeStartDate &&
            captureDate && supportsAcraAnnualReturnDeadlineEvidence(source.sourceText) && !validFrom && !source.validTo) {
          verifiedRows.push({ monthCount: sourceMonths, captureDate, cohort });
        }
      } else if (sourceMonths !== undefined && sourceMonths === quoteMonths &&
          (!validFrom || validFrom <= facts.financialYearEnd) &&
          (!source.validTo || source.validTo >= facts.financialYearEnd)) {
        verifiedRows.push({ monthCount: sourceMonths, validFrom, validTo: source.validTo });
      }
    }
  }
  const verifiedMonthCounts = new Set(verifiedRows.map(row => row.monthCount));
  if (!eligibleEvidence || verifiedMonthCounts.size !== 1) {
    const fye = formatSingaporeDate(facts.financialYearEnd);
    return unresolved(`No admitted and verified ACRA deadline table establishes historical applicability for financial year end ${fye}; no date is calculated.`, facts);
  }

  const monthCount = [...verifiedMonthCounts][0];
  const deadlineDate = addMonthsUtc(facts.financialYearEnd, monthCount);
  if (!deadlineDate) return unresolved('The verified ACRA deadline row did not produce a valid calendar date. No due date has been calculated.', facts);
  const deadlineApplicabilityRow = verifiedRows.find(row => row.monthCount === monthCount &&
      (row.cohort
        ? Boolean(row.captureDate && deadlineDate <= row.captureDate)
        : !row.validTo || row.validTo >= deadlineDate));
  if (!deadlineApplicabilityRow) {
    return unresolved('The admitted source period does not extend through the calculated filing deadline; no date is calculated.', facts);
  }
  const formattedFye = formatSingaporeDate(facts.financialYearEnd);
  const formattedDeadline = formatSingaporeDate(deadlineDate);
  const cohortDisclosure = deadlineApplicabilityRow.cohort && deadlineApplicabilityRow.captureDate
    ? ` The source states that its timeline applies to financial year ends on or after ${formatSingaporeDate(deadlineApplicabilityRow.cohort.fyeStartDate)} and was captured on ${formatSingaporeDate(deadlineApplicabilityRow.captureDate)}. This is a source-stated FYE cohort, not a general effective-date interval; the capture date does not establish whether the source changed afterward.`
    : '';
  return {
    applicationStatus: 'VERIFIED',
    applicationReason: `The verified ACRA table gives ${monthCount} month${monthCount === 1 ? '' : 's'} after FYE for the stated company category. Adding those months to FYE ${formattedFye} gives a filing deadline of ${formattedDeadline}.${cohortDisclosure}`,
    deadlineDate: formattedDeadline,
    monthCount,
    facts
  };
}
