export interface TargetDateResolution {
  targetDate?: string; // ISO format YYYY-MM-DD
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  source: 'EXPLICIT' | 'INFERRED' | 'NONE';
  rawMatchedText?: string;
  isHistorical?: boolean;
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
    const standaloneYearMatch = q.match(/\b(202[0-5])\b/);
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
