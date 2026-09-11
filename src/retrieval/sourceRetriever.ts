import type { QueryDomain, StatutoryAuthority } from '../types/accounting';
import type { AuthoritativeSourceRecord } from '../standards/unifiedSourceModel';
import {
  UNIFIED_SOURCE_REGISTRY,
  getAllAuthoritativeSources
} from '../standards/unifiedSourceModel';
import { defaultTargetDateResolver } from './targetDateResolver';
import { defaultSourceFreshnessManager, SourceFreshnessManager } from '../standards/sourceFreshnessManager';

export interface SourceRetrievalQuery {
  query: string;
  domain?: QueryDomain;
  authorities?: StatutoryAuthority[];
  maxResults?: number;
  targetDate?: string;
  includeHistorical?: boolean;
  referenceDate?: string;
  enableLiveCheck?: boolean;
}

export interface ISourceRetriever {
  retrieveSources(query: SourceRetrievalQuery): Promise<AuthoritativeSourceRecord[]>;
  getSourceById(id: string): AuthoritativeSourceRecord | undefined;
  findSourcesByStandardOrAct(standardOrActCode: string, paragraphOrSection?: string): AuthoritativeSourceRecord[];
}

/**
 * Deterministic In-Memory Source Retriever.
 * Extensible for future vector or external API integrations without breaking consumers.
 */
export class InMemorySourceRetriever implements ISourceRetriever {
  private sources: AuthoritativeSourceRecord[];

  constructor(customSources?: AuthoritativeSourceRecord[]) {
    this.sources = customSources || getAllAuthoritativeSources();
  }

  /**
   * Retrieves sources by unique record ID
   */
  public getSourceById(id: string): AuthoritativeSourceRecord | undefined {
    return UNIFIED_SOURCE_REGISTRY[id] || this.sources.find((s) => s.id === id);
  }

  /**
   * Finds sources matching a standard or statute code (e.g. "ITA1947", "SFRS(I) 1-38")
   * and optional paragraph/section (e.g. "Section 14(1)", "§57").
   */
  public findSourcesByStandardOrAct(
    standardOrActCode: string,
    paragraphOrSection?: string
  ): AuthoritativeSourceRecord[] {
    const codeClean = standardOrActCode
      .toLowerCase()
      .replace(/\s*\((?:acra|mom|iras|cpf|mas|asc|sso|singapore)\)/gi, '')
      .replace(/[\s\-_()]/g, '');
    const secClean = paragraphOrSection
      ? paragraphOrSection
          .toLowerCase()
          .replace(/\b(?:section|sec|paragraph|para|regulation|reg|schedule|sch|clause)\b/gi, '')
          .replace(/[§\s\-_(),.&]/g, '')
      : null;

    return this.sources.filter((s) => {
      const sCodeClean = s.standardOrActCode.toLowerCase().replace(/[\s\-_()]/g, '');
      const sTitleClean = s.documentTitle.toLowerCase().replace(/[\s\-_()]/g, '');
      const sInstClean = (s.legalOrStandardInstrument || '').toLowerCase().replace(/[\s\-_()]/g, '');
      const codeMatches = 
        sCodeClean.includes(codeClean) || 
        codeClean.includes(sCodeClean) ||
        sTitleClean.includes(codeClean) || 
        codeClean.includes(sTitleClean) ||
        (sInstClean && (sInstClean.includes(codeClean) || codeClean.includes(sInstClean)));

      if (!codeMatches) return false;
      if (!secClean) return true;

      const sSecClean = s.paragraphOrSection
        .toLowerCase()
        .replace(/\b(?:section|sec|paragraph|para|regulation|reg|schedule|sch|clause)\b/gi, '')
        .replace(/[§\s\-_(),.&]/g, '');
      return sSecClean.includes(secClean) || secClean.includes(sSecClean);
    });
  }

  /**
   * Scores and retrieves relevant authoritative sources based on domain, authority, and query text.
   */
  public async retrieveSources(retrievalQuery: SourceRetrievalQuery): Promise<AuthoritativeSourceRecord[]> {
    const {
      query,
      domain,
      authorities,
      maxResults = 5,
      targetDate: explicitTargetDate,
      includeHistorical = false,
      referenceDate = SourceFreshnessManager.DEFAULT_REFERENCE_DATE
    } = retrievalQuery;
    const lowerQ = query.toLowerCase();
    const queryTokens = lowerQ.split(/[\s,.;:!?/()]+/).filter((t) => t.length > 2);

    // Resolve target date (either explicit or parsed from query)
    const resolvedDateInfo = explicitTargetDate
      ? { targetDate: explicitTargetDate, isHistorical: explicitTargetDate < referenceDate, confidence: 'HIGH' as const }
      : defaultTargetDateResolver.resolveTargetDate(query, referenceDate);

    const effectiveTargetDate = resolvedDateInfo.targetDate;
    const isHistoricalTarget = resolvedDateInfo.isHistorical || includeHistorical;

    const mentionsHistorical =
      isHistoricalTarget ||
      lowerQ.includes('historical') ||
      lowerQ.includes('prior to') ||
      lowerQ.includes('before') ||
      lowerQ.includes('old rate') ||
      lowerQ.includes('former') ||
      lowerQ.includes('previous') ||
      lowerQ.includes('superseded');

    const scored: Array<{ record: AuthoritativeSourceRecord; score: number }> = [];

    for (const record of this.sources) {
      let score = 0;

      // 1. Authority match
      if (authorities && authorities.length > 0) {
        if (authorities.includes(record.authority)) {
          score += 15;
        }
      }

      // 2. Domain match
      if (domain && record.domain === domain) {
        score += 12;
      }

      // 3. Exact Paragraph or Section mention
      const pClean = record.paragraphOrSection.toLowerCase().replace(/[§]/g, '').trim();
      if (pClean && lowerQ.includes(pClean)) {
        score += 30;
      }

      // 4. Exact Document Title or Act Code mention
      if (lowerQ.includes(record.standardOrActCode.toLowerCase()) || lowerQ.includes(record.documentTitle.toLowerCase())) {
        score += 25;
      }

      // 5. Tag matches
      for (const tag of record.tags) {
        if (lowerQ.includes(tag.toLowerCase())) {
          score += 8;
        }
      }

      // 6. Token overlap with principle summary and source text
      const summaryLower = record.principleSummary.toLowerCase();
      const textLower = record.sourceText.toLowerCase();

      for (const token of queryTokens) {
        if (summaryLower.includes(token)) score += 3;
        if (textLower.includes(token)) score += 2;
      }

      // 7. Temporal Freshness & Validity Alignment
      const freshness = defaultSourceFreshnessManager.evaluateSourceFreshness(record, referenceDate);

      if (effectiveTargetDate) {
        const fromMatch = !record.validFrom || record.validFrom <= effectiveTargetDate;
        const toMatch = !record.validTo || record.validTo >= effectiveTargetDate;
        if (fromMatch && toMatch) {
          // Provision in force during the specified target date
          score += 25;
          // When targetDate falls into a historical period, prioritize specifically bounded historical provisions
          if (record.validTo && record.validTo < referenceDate) {
            score += 15;
          }
        } else {
          // Outside requested target date window
          score -= 40;
        }
      } else {
        // Undated query:
        if (freshness === 'HISTORICAL_SUPERSEDED') {
          if (mentionsHistorical) {
            score += 10;
          } else {
            // Strong penalty so historical records do NOT displace current in-force provisions
            score -= 50;
          }
        } else if (freshness === 'ACTIVE_CURRENT') {
          score += 15;
        } else if (freshness === 'PENDING_EFFECTIVE') {
          score -= 10;
        }
      }

      if (score > 0) {
        scored.push({ record, score });
      }
    }

    // Sort descending by score
    scored.sort((a, b) => b.score - a.score);

    return scored.slice(0, maxResults).map((s) => s.record);
  }
}

/**
 * Default singleton instance of InMemorySourceRetriever
 */
export const defaultSourceRetriever = new InMemorySourceRetriever();
