import type { AuthoritativeSourceRecord } from './unifiedSourceModel';
import { getSingaporeDateString } from '../utils/dateUtils';

export type FreshnessStatus =
  | 'ACTIVE_CURRENT'
  | 'PENDING_EFFECTIVE'
  | 'HISTORICAL_SUPERSEDED'
  | 'AUDIT_OVERDUE';

export interface FreshnessReport {
  referenceDate: string;
  totalRecords: number;
  activeCurrentCount: number;
  pendingEffectiveCount: number;
  historicalSupersededCount: number;
  auditOverdueCount: number;
  recordsByStatus: Record<FreshnessStatus, AuthoritativeSourceRecord[]>;
}

export class SourceFreshnessManager {
  public static readonly DEFAULT_REFERENCE_DATE = getSingaporeDateString();
  public static readonly DEFAULT_AUDIT_CYCLE_DAYS = 365;

  /**
   * Evaluates the freshness status of a source record against an explicit reference date.
   * Disaggregates verification freshness (AUDIT_OVERDUE) from temporal legal validity
   * (ACTIVE_CURRENT, PENDING_EFFECTIVE, HISTORICAL_SUPERSEDED).
   */
  public evaluateSourceFreshness(
    record: AuthoritativeSourceRecord,
    referenceDate: string = SourceFreshnessManager.DEFAULT_REFERENCE_DATE
  ): FreshnessStatus {
    const ref = referenceDate.trim();

    // 1. Check Historical / Superseded:
    // If explicitly marked HISTORICAL, or if validTo exists and is strictly before referenceDate
    if (record.sourceStatus === 'HISTORICAL') {
      return 'HISTORICAL_SUPERSEDED';
    }
    if (record.validTo && record.validTo.trim().length > 0) {
      if (record.validTo.trim() < ref) {
        return 'HISTORICAL_SUPERSEDED';
      }
    }

    // 2. Check Pending Effective:
    // If validFrom exists and is strictly in the future relative to referenceDate
    if (record.validFrom && record.validFrom.trim().length > 0) {
      if (record.validFrom.trim() > ref) {
        return 'PENDING_EFFECTIVE';
      }
    }

    // 3. Check Verification Audit Overdue:
    // The provision is temporally in force (not historical, not future), but its audit cycle expired
    const auditDays = record.reviewAuditCycleDays ?? SourceFreshnessManager.DEFAULT_AUDIT_CYCLE_DAYS;
    if (!record.lastVerifiedDate || record.lastVerifiedDate.trim().length === 0) {
      return 'AUDIT_OVERDUE';
    }

    const lastVerTime = new Date(record.lastVerifiedDate).getTime();
    const refTime = new Date(ref).getTime();
    if (isNaN(lastVerTime) || isNaN(refTime)) {
      return 'AUDIT_OVERDUE';
    }

    const diffDays = Math.floor((refTime - lastVerTime) / (1000 * 60 * 60 * 24));
    if (diffDays > auditDays) {
      return 'AUDIT_OVERDUE';
    }

    // 4. Active & Currently Verified
    return 'ACTIVE_CURRENT';
  }

  /**
   * Resolves the provision temporally applicable to a specific target date.
   * Evaluates validFrom <= targetDate <= validTo (open-ended validTo indicates continuing validity).
   */
  public resolveApplicableRecord(
    records: AuthoritativeSourceRecord[],
    targetDate: string
  ): AuthoritativeSourceRecord | null {
    if (!records || records.length === 0) return null;
    const tDate = targetDate.trim();

    // Filter candidate records matching targetDate interval
    const candidates = records.filter((r) => {
      const fromMatch = !r.validFrom || r.validFrom <= tDate;
      const toMatch = !r.validTo || r.validTo >= tDate;
      return fromMatch && toMatch;
    });

    if (candidates.length === 0) return null;

    // If multiple matches, prioritize the most specific window (record with validTo or latest validFrom)
    candidates.sort((a, b) => {
      const aFrom = a.validFrom || '1900-01-01';
      const bFrom = b.validFrom || '1900-01-01';
      return bFrom.localeCompare(aFrom);
    });

    return candidates[0];
  }

  /**
   * Generates a comprehensive freshness report for an array of source records.
   */
  public generateFreshnessReport(
    records: AuthoritativeSourceRecord[],
    referenceDate: string = SourceFreshnessManager.DEFAULT_REFERENCE_DATE
  ): FreshnessReport {
    const report: FreshnessReport = {
      referenceDate,
      totalRecords: records.length,
      activeCurrentCount: 0,
      pendingEffectiveCount: 0,
      historicalSupersededCount: 0,
      auditOverdueCount: 0,
      recordsByStatus: {
        ACTIVE_CURRENT: [],
        PENDING_EFFECTIVE: [],
        HISTORICAL_SUPERSEDED: [],
        AUDIT_OVERDUE: []
      }
    };

    for (const record of records) {
      const status = this.evaluateSourceFreshness(record, referenceDate);
      report.recordsByStatus[status].push(record);
      switch (status) {
        case 'ACTIVE_CURRENT':
          report.activeCurrentCount++;
          break;
        case 'PENDING_EFFECTIVE':
          report.pendingEffectiveCount++;
          break;
        case 'HISTORICAL_SUPERSEDED':
          report.historicalSupersededCount++;
          break;
        case 'AUDIT_OVERDUE':
          report.auditOverdueCount++;
          break;
      }
    }

    return report;
  }
}

export const defaultSourceFreshnessManager = new SourceFreshnessManager();
