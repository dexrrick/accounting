export interface TargetDateResolution {
  targetDate?: string; // ISO format YYYY-MM-DD
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  source: 'EXPLICIT' | 'INFERRED' | 'NONE';
  rawMatchedText?: string;
  isHistorical?: boolean;
  /** A recognised input fact, rather than a request for the law in that period. */
  dateRole?: 'CURRENT_WORKFLOW_FACT';
}

import { getSingaporeDateString } from '../utils/dateUtils';
import { hasUnresolvedSection14NBasisPeriod } from './statutoryDateScope';

const MONTH_MAP: Record<string, string> = {
  jan: '01', january: '01',
  feb: '02', february: '02',
  mar: '03', march: '03',
  apr: '04', april: '04',
  may: '05',
  jun: '06', june: '06',
  jul: '07', july: '07',
  aug: '08', august: '08',
  sep: '09', sept: '09', september: '09',
  oct: '10', october: '10',
  nov: '11', november: '11',
  dec: '12', december: '12'
};

const EXPLICIT_DATE_PATTERN = String.raw`(?:\d{1,2}[/-]\d{1,2}[/-]20\d{2}|20\d{2}-\d{2}-\d{2}|\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+20\d{2})`;

function section13wDisposalDate(query: string): string | undefined {
  const candidates: Array<{ date: string; distance: number }> = [];
  for (const action of query.matchAll(/\b(?:dispos\w*|sold|sale)\b/gi)) {
    const after = query.slice(action.index! + action[0].length, action.index! + action[0].length + 75);
    const afterDate = new RegExp(EXPLICIT_DATE_PATTERN, 'i').exec(after);
    if (afterDate && !/\b(?:acquir\w*|purchas\w*|bought)\b/i.test(after.slice(0, afterDate.index))) {
      candidates.push({ date: afterDate[0], distance: afterDate.index });
    }
    const before = query.slice(Math.max(0, action.index! - 45), action.index);
    const beforeDates = [...before.matchAll(new RegExp(EXPLICIT_DATE_PATTERN, 'gi'))];
    const nearestBefore = beforeDates.at(-1);
    const beforeDistance = nearestBefore ? before.length - nearestBefore.index! - nearestBefore[0].length : Infinity;
    if (nearestBefore && beforeDistance <= 16 &&
      !/\b(?:and|then|acquir\w*|purchas\w*|bought)\b/i.test(before.slice(nearestBefore.index! + nearestBefore[0].length)) &&
      !/\b(?:acquir\w*|purchas\w*|bought)\b/i.test(before.slice(0, nearestBefore.index))) {
      candidates.push({ date: nearestBefore[0], distance: beforeDistance });
    }
  }
  candidates.sort((left, right) => left.distance - right.distance);
  if (new Set(candidates.map(candidate => candidate.date)).size !== 1) return undefined;
  return candidates[0].date;
}

function section13wDisposalYear(query: string): string | undefined {
  const years = new Set<string>();
  for (const action of query.matchAll(/\b(?:dispos\w*|sold|sale)\b/gi)) {
    const after = query.slice(action.index! + action[0].length, action.index! + action[0].length + 45);
    const match = /\b(?:on|in|during)\s+(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+)?(20\d{2})\b/i.exec(after);
    if (match && !/\b(?:acquir\w*|purchas\w*|bought)\b/i.test(after.slice(0, match.index))) {
      years.add(match[1]);
    }
  }
  if (years.size === 1) return [...years][0];
  if (years.size > 1 ||
      !/\b(?:dispos\w*|sold|sale)\b/i.test(query) ||
      /\b(?:ya|year of assessment)\s*20\d{2}\b/i.test(query) ||
      /\b(?:acquir\w*|purchas\w*|bought)\b/i.test(query)) return undefined;
  const mentionedYears = [...new Set([...query.matchAll(/\b20\d{2}\b/g)].map(match => match[0]))];
  return mentionedYears.length === 1 ? mentionedYears[0] : undefined;
}

export class TargetDateResolver {
  public static readonly CURRENT_SYSTEM_DATE = getSingaporeDateString();

  private static hasSingleExplicitDate(query: string): boolean {
    return [...query.matchAll(new RegExp(EXPLICIT_DATE_PATTERN, 'gi'))].length === 1;
  }

  private static dateHasNearbyRole(query: string, role: RegExp): boolean {
    const dates = [...query.matchAll(new RegExp(EXPLICIT_DATE_PATTERN, 'gi'))];
    if (dates.length !== 1) return false;
    const date = dates[0];
    const start = Math.max(0, date.index! - 90);
    const end = Math.min(query.length, date.index! + date[0].length + 70);
    return role.test(query.slice(start, end));
  }

  /** Recognises fact dates only within one current compliance workflow. */
  private static isCurrentWorkflowFactDate(query: string, currentDate: string): boolean {
    if (/\b(?:historical|historic|back then|at that time|at that date|at the time|then|previous law|prior law|former rule|superseded|in force|governed|effective|as of|as at|which law|what law|rules? applied|requirements? applied|used to)\b/i.test(query)) return false;
    // These distinct requests must retain their date scope even without an authority acronym.
    if (/\b(?:gst|goods and services tax|withholding tax|wht|public holidays?|holiday pay|overtime|sick leave|annual leave|rates?|percentages?|journal|bookkeeping|ifrs|sfrs)\b/i.test(query)) return false;
    const years = [...new Set([...query.matchAll(/\b(?:19|20)\d{2}\b/g)].map(match => match[0]))];
    const dates = [...query.matchAll(new RegExp(EXPLICIT_DATE_PATTERN, 'gi'))];
    if (years.length !== 1) return false;
    if (dates.length === 0) {
      return Number(years[0]) <= Number(currentDate.slice(0, 4)) &&
        /\b(?:ya|year of assessment)\s*20\d{2}\b/i.test(query) &&
        /\b(?:company|corporate|business)\b/i.test(query) &&
        /\b(?:records?|documents?|books|record[- ]keeping)\b/i.test(query) &&
        /\b(?:retain|retention|keep|keeping|discard)\b/i.test(query) &&
        !/\b(?:acra|cpf|mom|mas|were|was|did)\b/i.test(query);
    }
    if (dates.length !== 1 || years[0] !== currentDate.slice(0, 4) ||
        (query.match(/\?/g) || []).length > 1) return false;
    const date = EXPLICIT_DATE_PATTERN;
    const nearDate = (role: string): boolean => new RegExp(`${role}[^.!?;\\n]{0,75}${date}`, 'i').test(query);
    const entityChange = /\b(?:acra|registered office|entity email|entity information|entity details)\b/i.test(query) &&
      nearDate(String.raw`\b(?:changed|updated|change occurred|date of (?:the )?change)\b`) &&
      !/\b(?:cpf|mom|mas|income tax|employment act|fund management)\b/i.test(query);
    const cpfRefund = /\b(?:cpf|central provident fund)\b/i.test(query) && /\brefund\w*\b/i.test(query) &&
      nearDate(String.raw`\b(?:paid|payment|payments received on|repayment|wages? repayable)\b`) &&
      !/\b(?:acra|mom|mas|income tax|employment act|fund management)\b/i.test(query);
    const payslip = /\b(?:itemi[sz]ed pay ?slips?|pay ?slips?)\b/i.test(query) &&
      nearDate(String.raw`\b(?:payment|paid|termination|dismissal|salary payment)\b`) &&
      !/\b(?:acra|cpf|mas|income tax|fund management)\b/i.test(query);
    const appointment = /\b(?:lfmc|licensed fund management company)\b/i.test(query) &&
      nearDate(String.raw`\b(?:appoint\w*|ceo|chief executive|director)\b`) &&
      !/\b(?:acra|cpf|mom|income tax|employment act)\b/i.test(query);
    return entityChange || cpfRefund || payslip || appointment;
  }

  /** Resolves dates for statutory evidence separately from accounting transaction dates. */
  public resolveAuthorityEvidenceDate(
    query: string,
    currentDate: string = TargetDateResolver.CURRENT_SYSTEM_DATE
  ): TargetDateResolution {
    const currentYear = currentDate.slice(0, 4);
    const years = [...new Set([...query.matchAll(/\b(?:19|20)\d{2}\b/g)].map(match => match[0]))];
    const versionContext = /\b(?:historical|historic|previous|prior|past|former|superseded|effective date|effective during|which law|which rules?|applicable law|year of assessment|\bya\s*20\d{2}|basis period|payroll year|rate table|legal|statutory|in force|governed|law|rules? applied|rate)\b/i.test(query);
    const otherAuthorityOrDomain = /\b(?:gst|goods and services tax|cpf|central provident fund|mom|ministry of manpower|acra|mas|monetary authority|income tax|corporate tax|tax relief|accounting|journal|balance sheet|ifrs|sfrs\s*\(?i\)?)\b/i.test(query);
    const unresolved = (): TargetDateResolution => ({ confidence: 'LOW', source: 'NONE', isHistorical: false });
    if (TargetDateResolver.isCurrentWorkflowFactDate(query, currentDate)) return { ...unresolved(), dateRole: 'CURRENT_WORKFLOW_FACT' };

    const asksWhtDeadline = /\b(?:wht|withholding tax)\b/i.test(query) &&
      /\b(?:filing|due date|deadline|when\b[^.!?;\n]{0,65}\b(?:file|filed|paid))\b/i.test(query) &&
      /\b(?:paid|pay|paying|payment)\b/i.test(query) &&
      TargetDateResolver.dateHasNearbyRole(query, /\b(?:paid|pay|paying|payment)\b/i) &&
      !/\b(?:rates?|tax rates?|percent(?:age)?s?|back then|at that time|at that date|used to)\b/i.test(query);
    if (asksWhtDeadline && years.length === 1 && years[0] === currentYear &&
        TargetDateResolver.hasSingleExplicitDate(query) && !versionContext && !otherAuthorityOrDomain) {
      return unresolved();
    }

    const asksPrContributionYearStart = /\b(?:permanent resident|spr|pr)\b/i.test(query) &&
      /\b(?:became|obtained|conversion|converted|granted)\b/i.test(query) &&
      TargetDateResolver.dateHasNearbyRole(query, /\b(?:became|obtained|conversion|converted|granted)\b/i) &&
      /\b(?:when|what date)\b[\s\S]{0,80}\b(?:first|second|third|1st|2nd|3rd)\s+(?:pr\s+)?contribution year\s+(?:begin|start)/i.test(query);
    if (asksPrContributionYearStart && years.length === 1 && TargetDateResolver.hasSingleExplicitDate(query) &&
        !versionContext && !otherAuthorityOrDomain &&
        !/\b(?:rates?|contributions? on wages|applicable to payroll|which table)\b/i.test(query)) {
      return unresolved();
    }

    const asksCurrentAcraOfficerChange = /\bannual[- ]return\b/i.test(query) &&
      new RegExp(`\\boctober\\s+${currentYear}\\b`, 'i').test(query) &&
      /\b(?:change|commenc\w*)\b/i.test(query) &&
      /\b(?:ceo|chief executive|officer particulars?)\b/i.test(query) &&
      years.length === 1 && years[0] === currentYear && !otherAuthorityOrDomain &&
      !/\b(?:file|filed|filing|submitted|lodged|our company|my company)\b/i.test(query) && !versionContext;
    if (asksCurrentAcraOfficerChange) return unresolved();

    return this.resolveTargetDate(query, currentDate);
  }

  /**
   * Resolves target transaction, reporting, or statutory dates from user input text.
   * Employs strict confidence levels and never invents a historical date when none is supplied.
   */
  public resolveTargetDate(
    query: string,
    currentDate: string = TargetDateResolver.CURRENT_SYSTEM_DATE
  ): TargetDateResolution {
    const q = query.trim();
    if (!q) {
      return { confidence: 'LOW', source: 'NONE' };
    }

    if (/\b(?:section\s*)?13w\b/i.test(q)) {
      const disposalDate = section13wDisposalDate(q);
      if (disposalDate) return this.resolveTargetDate(disposalDate, currentDate);
      const disposalYear = section13wDisposalYear(q);
      if (disposalYear) {
        const iso = `${disposalYear}-06-30`;
        return { targetDate: iso, confidence: 'MEDIUM', source: 'INFERRED',
          rawMatchedText: disposalYear, isHistorical: iso < currentDate };
      }
      if (/\b20\d{2}\b/.test(q)) {
        return { confidence: 'LOW', source: 'NONE' };
      }
    }

    const section14NYa = /\b(?:ya|year of assessment)\s*(20\d{2})\b/i.exec(q)?.[1];
    if (section14NYa && /\b(?:renovat\w*|refurbish\w*|section\s*14n)\b/i.test(q) &&
        !hasUnresolvedSection14NBasisPeriod(q)) {
      const iso = `${section14NYa}-01-01`;
      return { targetDate: iso, confidence: 'MEDIUM', source: 'INFERRED',
        rawMatchedText: `YA ${section14NYa}`, isHistorical: iso < currentDate };
    }

    // 1. Explicit DD/MM/YYYY or DD-MM-YYYY (Singapore statutory standard)
    const sgDateMatch = q.match(/\b([0-3]?\d)[\/\-]([0-1]?\d)[\/\-](20\d{2})\b/);
    if (sgDateMatch) {
      const day = sgDateMatch[1].padStart(2, '0');
      const month = sgDateMatch[2].padStart(2, '0');
      const year = sgDateMatch[3];
      const iso = `${year}-${month}-${day}`;
      return {
        targetDate: iso,
        confidence: 'HIGH',
        source: 'EXPLICIT',
        rawMatchedText: sgDateMatch[0],
        isHistorical: iso < currentDate
      };
    }

    // 2. Explicit ISO format YYYY-MM-DD
    const isoDateMatch = q.match(/\b(20\d{2})-([0-1]\d)-([0-3]\d)\b/);
    if (isoDateMatch) {
      const iso = isoDateMatch[0];
      return {
        targetDate: iso,
        confidence: 'HIGH',
        source: 'EXPLICIT',
        rawMatchedText: iso,
        isHistorical: iso < currentDate
      };
    }

    // 3. Explicit named dates, e.g. "15 March 2023", "1 April 2026", "31 Dec 2025"
    const namedDateMatch = q.match(/\b([0-3]?\d)\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(20\d{2})\b/i);
    if (namedDateMatch) {
      const day = namedDateMatch[1].padStart(2, '0');
      const mStr = namedDateMatch[2].toLowerCase();
      const month = MONTH_MAP[mStr] || '01';
      const year = namedDateMatch[3];
      const iso = `${year}-${month}-${day}`;
      return {
        targetDate: iso,
        confidence: 'HIGH',
        source: 'EXPLICIT',
        rawMatchedText: namedDateMatch[0],
        isHistorical: iso < currentDate
      };
    }

    // 4. Reporting period references: "FYE 31 December 2025" or "as at 31 Dec 2024"
    const fyeMatch = q.match(/\b(?:fye|as at|ended|ending)\s+([0-3]?\d)\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(20\d{2})\b/i);
    if (fyeMatch) {
      const day = fyeMatch[1].padStart(2, '0');
      const mStr = fyeMatch[2].toLowerCase();
      const month = MONTH_MAP[mStr] || '12';
      const year = fyeMatch[3];
      const iso = `${year}-${month}-${day}`;
      return {
        targetDate: iso,
        confidence: 'HIGH',
        source: 'EXPLICIT',
        rawMatchedText: fyeMatch[0],
        isHistorical: iso < currentDate
      };
    }

    // 5. Tax Year of Assessment: "YA 2024", "for YA 2023"
    const yaMatch = q.match(/\b(?:ya|year of assessment)\s*(20\d{2})\b/i);
    if (yaMatch) {
      const yaYear = yaMatch[1];
      // YA YYYY evaluates rules applicable to that Year of Assessment (e.g. 1 Jan YYYY)
      const iso = `${yaYear}-01-01`;
      return {
        targetDate: iso,
        confidence: 'MEDIUM',
        source: 'INFERRED',
        rawMatchedText: yaMatch[0],
        isHistorical: iso < currentDate
      };
    }

    // 6. Year mentions: "in 2023", "during 2024", "in 2025"
    const inYearMatch = q.match(/\b(?:in|during|for|from|back in)\s+(20\d{2})\b/i);
    if (inYearMatch) {
      const year = inYearMatch[1];
      const iso = `${year}-06-30`; // Mid-year proxy for calendar year inquiries
      return {
        targetDate: iso,
        confidence: 'MEDIUM',
        source: 'INFERRED',
        rawMatchedText: inYearMatch[0],
        isHistorical: iso < currentDate
      };
    }

    // 7. Standalone historical years: "what was the 2023 gst rate" or "2024 cpf ceiling"
    // IID 04/2025 is an instrument identifier, not by itself a requested historical date.
    // Earlier explicit date steps still inspect the original text; only the standalone-year
    // fallback ignores this exact known identifier.
    const standaloneYearQuery = q.replace(/\b(?:(?:MAS\s+Circular\s+)?IID\s+04\s*\/\s*2025|MAS-IID-04-2025)\b/gi, ' ');
    const standaloneYearMatch = standaloneYearQuery.match(/\b(202[0-5])\b/);
    if (standaloneYearMatch) {
      const year = standaloneYearMatch[1];
      const iso = `${year}-06-30`;
      return {
        targetDate: iso,
        confidence: 'MEDIUM',
        source: 'INFERRED',
        rawMatchedText: standaloneYearMatch[0],
        isHistorical: true
      };
    }

    // Default: No date specified -> Do NOT invent a historical date
    return {
      targetDate: undefined,
      confidence: 'LOW',
      source: 'NONE',
      isHistorical: false
    };
  }
}

export const defaultTargetDateResolver = new TargetDateResolver();
