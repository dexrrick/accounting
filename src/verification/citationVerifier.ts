import type { StandardCitation, StatutoryAuthority } from '../types/accounting';
import type { AuthoritativeSourceRecord } from '../standards/unifiedSourceModel';
import { defaultSourceRetriever, type ISourceRetriever } from '../retrieval/sourceRetriever';

export type CitationVerificationStatus =
  | 'VERIFIED_PRIMARY_SOURCE'
  | 'STRUCTURALLY_VERIFIED_SUMMARY'
  | 'SOURCE_NEEDS_REVIEW'
  | 'UNVERIFIED'
  | 'SOURCE_NOT_FOUND'
  | 'PARAGRAPH_NOT_FOUND'
  | 'AUTHORITY_MISMATCH'
  | 'NON_CANONICAL_URL';

export interface CitationVerificationResult {
  citation: StandardCitation;
  status: CitationVerificationStatus;
  isValid: boolean;
  isAuthoritativePrimarySource: boolean;
  matchedRecord?: AuthoritativeSourceRecord;
  reason: string;
  /**
   * IMPORTANT LIMITATION:
   * Confirms that structural verification only validates the existence of the source,
   * section, authority, and canonical URL. It does NOT claim to prove semantic support.
   */
  structuralVerificationOnly: true;
}

export class CitationVerifier {
  private retriever: ISourceRetriever;

  constructor(retriever: ISourceRetriever = defaultSourceRetriever) {
    this.retriever = retriever;
  }

  private normalizeSection(text: string): string {
    return text.toLowerCase().replace(/[§\s\-_()]/g, '');
  }

  private normalizeUrlForComparison(urlStr: string): string {
    try {
      const parsed = new URL(urlStr.trim());
      const host = parsed.host.toLowerCase().replace(/^www\./, '');
      const pathname = parsed.pathname.toLowerCase().replace(/\/+$/, '');
      return `${host}${pathname}`;
    } catch {
      return urlStr.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '');
    }
  }

  /**
   * Validates a single standard citation structurally against authoritative records.
   */
  public verifyCitation(
    citation: StandardCitation,
    expectedAuthority?: StatutoryAuthority
  ): CitationVerificationResult {
    const rawStd = citation.standard || '';
    const rawPara = citation.paragraph || '';
    const rawUrl = citation.officialSourceUrl || '';

    // 1. Check if source standard or statute exists
    const matchedRecords = this.retriever.findSourcesByStandardOrAct(rawStd);
    if (!matchedRecords || matchedRecords.length === 0) {
      return {
        citation,
        status: 'SOURCE_NOT_FOUND',
        isValid: false,
        isAuthoritativePrimarySource: false,
        reason: `Standard or statute '${rawStd}' is not found in the verified repository.`,
        structuralVerificationOnly: true
      };
    }

    // 2. Check if paragraph or section exists in the source record
    const paraClean = this.normalizeSection(rawPara);
    const matchedRecord = matchedRecords.find((r) => {
      const rSecClean = this.normalizeSection(r.paragraphOrSection);
      return rSecClean.includes(paraClean) || paraClean.includes(rSecClean);
    });

    if (!matchedRecord) {
      return {
        citation,
        status: 'PARAGRAPH_NOT_FOUND',
        isValid: false,
        isAuthoritativePrimarySource: false,
        reason: `Paragraph/Section '${rawPara}' does not exist in records for '${rawStd}'.`,
        structuralVerificationOnly: true
      };
    }

    // 3. Authority alignment check
    if (citation.authority && citation.authority !== matchedRecord.authority) {
      return {
        citation,
        status: 'AUTHORITY_MISMATCH',
        isValid: false,
        isAuthoritativePrimarySource: false,
        matchedRecord,
        reason: `Authority mismatch: citation claims '${citation.authority}' but record is governed by '${matchedRecord.authority}'.`,
        structuralVerificationOnly: true
      };
    }

    if (expectedAuthority && matchedRecord.authority !== expectedAuthority) {
      return {
        citation,
        status: 'AUTHORITY_MISMATCH',
        isValid: false,
        isAuthoritativePrimarySource: false,
        matchedRecord,
        reason: `Authority mismatch: expected domain authority '${expectedAuthority}' but citation belongs to '${matchedRecord.authority}'.`,
        structuralVerificationOnly: true
      };
    }

    // 4. Canonical URL verification
    const isOfficialDomain =
      rawUrl.startsWith('https://sso.agc.gov.sg') ||
      rawUrl.startsWith('https://www.acra.gov.sg') ||
      rawUrl.startsWith('https://www.iras.gov.sg') ||
      rawUrl.startsWith('https://www.cpf.gov.sg') ||
      rawUrl.startsWith('https://www.mom.gov.sg') ||
      rawUrl.startsWith('https://www.mas.gov.sg') ||
      rawUrl.startsWith('https://www.ifrs.org');

    if (rawUrl && !isOfficialDomain) {
      return {
        citation,
        status: 'NON_CANONICAL_URL',
        isValid: false,
        isAuthoritativePrimarySource: false,
        matchedRecord,
        reason: `URL '${rawUrl}' is not an official Singapore government or standard-setter portal.`,
        structuralVerificationOnly: true
      };
    }

    // Canonical exact path comparison against matchedRecord.officialSourceUrl
    if (rawUrl && matchedRecord.officialSourceUrl) {
      const normCite = this.normalizeUrlForComparison(rawUrl);
      const normRec = this.normalizeUrlForComparison(matchedRecord.officialSourceUrl);
      if (normCite !== normRec) {
        return {
          citation,
          status: 'NON_CANONICAL_URL',
          isValid: false,
          isAuthoritativePrimarySource: false,
          matchedRecord,
          reason: `Citation URL '${rawUrl}' does not match official record URL '${matchedRecord.officialSourceUrl}'.`,
          structuralVerificationOnly: true
        };
      }
    }

    // 5. Verification passes - Strictly distinguish Primary Statutory Source vs Curated Summary
    const isVerifiedPrimary =
      matchedRecord.sourceStatus === 'VERIFIED' &&
      matchedRecord.sourceType === 'AUTHORITATIVE_SOURCE';

    return {
      citation,
      status: isVerifiedPrimary ? 'VERIFIED_PRIMARY_SOURCE' : 'STRUCTURALLY_VERIFIED_SUMMARY',
      isValid: true,
      isAuthoritativePrimarySource: isVerifiedPrimary,
      matchedRecord,
      reason: isVerifiedPrimary
        ? `Citation structurally verified against primary statutory provision in ${matchedRecord.documentTitle} (${matchedRecord.paragraphOrSection}).`
        : `Citation structurally matches curated summary record for ${matchedRecord.documentTitle} (${matchedRecord.paragraphOrSection}), pending primary source licensing.`,
      structuralVerificationOnly: true
    };
  }

  /**
   * Batch verifies a list of citations and returns verified and rejected sets.
   */
  public verifyCitationBatch(
    citations: StandardCitation[],
    expectedAuthority?: StatutoryAuthority
  ): {
    results: CitationVerificationResult[];
    allValid: boolean;
    validCitations: StandardCitation[];
    rejectedCitations: CitationVerificationResult[];
  } {
    const results = citations.map((c) => this.verifyCitation(c, expectedAuthority));
    const allValid = results.every((r) => r.isValid);
    const validCitations = results.filter((r) => r.isValid).map((r) => r.citation);
    const rejectedCitations = results.filter((r) => !r.isValid);

    return {
      results,
      allValid,
      validCitations,
      rejectedCitations
    };
  }
}

export const defaultCitationVerifier = new CitationVerifier();
