export interface TargetDateResolution {
  targetDate?: string; // ISO format YYYY-MM-DD
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  source: 'EXPLICIT' | 'INFERRED' | 'NONE';
  rawMatchedText?: string;
  isHistorical?: boolean;
}

import { getSingaporeDateString } from '../utils/dateUtils';

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
