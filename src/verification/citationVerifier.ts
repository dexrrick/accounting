import type { StandardCitation, StatutoryAuthority } from '../types/accounting';
import type { AuthoritativeSourceRecord } from '../standards/unifiedSourceModel';
import { defaultSourceRetriever, isAnswerGroundingEligibleSource, type ISourceRetriever } from '../retrieval/sourceRetriever';
import { SourceFreshnessManager } from '../standards/sourceFreshnessManager';
import { hasVerifiedSourceUrlProvenance, isApprovedSingaporeSourceUrl } from '../standards/approvedSourceRegistry';

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
  isStructurallyValid: boolean;
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
  private referenceDate: string;

  constructor(
    retriever: ISourceRetriever = defaultSourceRetriever,
    referenceDate: string = SourceFreshnessManager.DEFAULT_REFERENCE_DATE
  ) {
    this.retriever = retriever;
    this.referenceDate = referenceDate;
  }

  private normalizeSection(text: string): string {
    return text
      .toLowerCase()
      .replace(/\b(?:section|sec|paragraph|para|regulation|reg|schedule|sch|clause)\b/gi, '')
      .replace(/[§\s\-_(),.&]/g, '');
  }

  private normalizeExactUrl(urlStr: string): string {
    try {
      const parsed = new URL(urlStr.trim());
      if (parsed.username || parsed.password) return '';
      const path = parsed.pathname.replace(/%28/gi, '(').replace(/%29/gi, ')');
      return `${parsed.origin}${path}${parsed.search}${parsed.hash}`;
    } catch {
      return '';
    }
  }

  private isTopicSpecificSourceUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
      const path = parsed.pathname.toLowerCase().replace(/\/+$/, '');
      if (path === '' || path === '/irashome') return false;
      if (host === 'acra.gov.sg' && /\/accountancy\/accounting-standards$/.test(path)) return false;
      if (host === 'acra.gov.sg' && /\/accounting-standards$/.test(path)) return false;
      if (host === 'asc.acra.gov.sg' && /\/singapore-financial-reporting-standards-international(?:\/archives(?:\/.*)?)?$/.test(path)) return false;
      if (host === 'ifrs.org' && /\/issued-standards\/list-of-standards$/.test(path)) return false;
      return true;
    } catch {
      return false;
    }
  }

  private isQualifiedLiveEvidence(record: AuthoritativeSourceRecord): boolean {
    const metadata = record as unknown as { recordRole?: string; groundingEligible?: boolean; urlVerificationStatus?: string };
    return metadata.recordRole === 'DISCOVERED_EVIDENCE' &&
      metadata.groundingEligible === true &&
      metadata.urlVerificationStatus === 'VERIFIED' &&
      hasVerifiedSourceUrlProvenance(record) &&
      record.provenance === 'LIVE_EXTERNAL' &&
      record.lifecycleState === 'CANDIDATE' &&
      record.sourceStatus === 'NEEDS_REVIEW' &&
      record.verificationMethod === 'LIVE_OFFICIAL_TOPIC_VERIFIED' &&
      Boolean(record.officialSourceUrl);
  }

  private isRegisteredUrlVerified(record: AuthoritativeSourceRecord): boolean {
    return hasVerifiedSourceUrlProvenance(record);
  }

  private verifyLiveCandidateCitation(
    citation: StandardCitation,
    record: AuthoritativeSourceRecord,
    expectedAuthority?: StatutoryAuthority,
    retrievedEvidenceScope?: AuthoritativeSourceRecord[]
  ): CitationVerificationResult {
    const authorityMatches = !citation.authority || citation.authority === record.authority ||
      ((citation.authority === 'ASC' || citation.authority === 'ACRA') && record.authority === 'ACRA');
    const expectedMatches = !expectedAuthority || expectedAuthority === record.authority ||
      ((expectedAuthority === 'ASC' || expectedAuthority === 'ACRA') && record.authority === 'ACRA');
    const exactUrl = this.normalizeExactUrl(citation.officialSourceUrl || '') === this.normalizeExactUrl(record.officialSourceUrl);
    const inScope = Boolean(retrievedEvidenceScope?.includes(record));
    const urlApproved = isApprovedSingaporeSourceUrl(citation.officialSourceUrl) &&
      hasVerifiedSourceUrlProvenance(record);
    const topicSpecific = this.isTopicSpecificSourceUrl(record.officialSourceUrl);
    if (!authorityMatches || !expectedMatches) {
      return {
        citation,
        status: 'AUTHORITY_MISMATCH',
        isValid: false,
        isStructurallyValid: false,
        isAuthoritativePrimarySource: false,
        matchedRecord: record,
        reason: 'Live source authority does not match the citation authority.',
        structuralVerificationOnly: true
      };
    }
    if (!exactUrl || !urlApproved || !topicSpecific || !inScope) {
      return {
        citation,
        status: 'UNVERIFIED',
        isValid: false,
        isStructurallyValid: false,
        isAuthoritativePrimarySource: false,
        matchedRecord: record,
        reason: 'Live candidate citation must match the final approved URL and fetched, topic-verified evidence in this answer context.',
        structuralVerificationOnly: true
      };
    }
    return {
      citation,
      status: 'SOURCE_NEEDS_REVIEW',
      isValid: true,
      isStructurallyValid: true,
      isAuthoritativePrimarySource: false,
      matchedRecord: record,
      reason: `Official page ${record.documentTitle} was fetched and matched the mapped topic; it remains a CANDIDATE source and is not locally validated evidence.`,
      structuralVerificationOnly: true
    };
  }

  /**
   * Validates a single standard citation structurally against authoritative records.
   * When retrievedEvidenceScope is provided, validates that the citation is grounded
   * strictly in the retrieved evidence supplied to the model.
   */
  public verifyCitation(
    citation: StandardCitation,
    expectedAuthority?: StatutoryAuthority,
    retrievedEvidenceScope?: AuthoritativeSourceRecord[]
  ): CitationVerificationResult {
    const rawStd = citation.standard || '';
    const rawPara = citation.paragraph || '';
    const rawUrl = citation.officialSourceUrl || '';

    if (!rawUrl.trim()) {
      return {
        citation,
        status: 'NON_CANONICAL_URL',
        isValid: false,
        isStructurallyValid: false,
        isAuthoritativePrimarySource: false,
        reason: 'Citation has no source URL; citation URLs must come from a registered or live-verified source record.',
        structuralVerificationOnly: true
      };
    }

    // 1. Check if source standard or statute exists in verified repository
    const matchedRecords = this.retriever.findSourcesByStandardOrAct(rawStd).filter(isAnswerGroundingEligibleSource);
    const liveCandidates = (retrievedEvidenceScope || []).filter(record => this.isQualifiedLiveEvidence(record));
    const liveSectionMatch = liveCandidates.find(record => {
      const code = record.standardOrActCode.toLowerCase().replace(/[\s\-_()]/g, '');
      const requested = rawStd.toLowerCase().replace(/[\s\-_()]/g, '');
      const codeMatches = code.includes(requested) || requested.includes(code) || record.documentTitle.toLowerCase().includes(rawStd.toLowerCase());
      const paragraphMatches = this.normalizeSection(record.paragraphOrSection) === this.normalizeSection(rawPara);
      const sameUrl = this.normalizeExactUrl(record.officialSourceUrl) === this.normalizeExactUrl(rawUrl);
      return codeMatches && paragraphMatches && sameUrl;
    });
    if (liveSectionMatch) {
      return this.verifyLiveCandidateCitation(citation, liveSectionMatch, expectedAuthority, retrievedEvidenceScope);
    }
    if (!matchedRecords || matchedRecords.length === 0) {
      return {
        citation,
        status: 'SOURCE_NOT_FOUND',
        isValid: false,
        isStructurallyValid: false,
        isAuthoritativePrimarySource: false,
        reason: `Standard or statute '${rawStd}' is not found in the verified repository.`,
        structuralVerificationOnly: true
      };
    }

    // 2. Check if paragraph or section exists in the source record
    const paraClean = this.normalizeSection(rawPara);
    const sectionCandidates = matchedRecords.filter((r) => {
      const rSecClean = this.normalizeSection(r.paragraphOrSection);
      return rSecClean.includes(paraClean) || paraClean.includes(rSecClean);
    });

    if (sectionCandidates.length === 0) {
      return {
        citation,
        status: 'PARAGRAPH_NOT_FOUND',
        isValid: false,
        isStructurallyValid: false,
        isAuthoritativePrimarySource: false,
        reason: `Paragraph/Section '${rawPara}' does not exist in records for '${rawStd}'.`,
        structuralVerificationOnly: true
      };
    }

    // If multiple records match the same section (e.g. historical vs current rate amendments or CPF ceiling phases),
    // disambiguate using citation title/text, or default to the active current record.
    let matchedRecord = sectionCandidates[0];
    if (sectionCandidates.length > 1) {
      const citeText = `${citation.title || ''} ${citation.text || ''}`.toLowerCase();
      let bestScore = -1;
      let bestCandidate = matchedRecord;

      for (const cand of sectionCandidates) {
        let matchScore = 0;
        const candTitle = cand.principleSummary.toLowerCase();
        const candTokens = candTitle.split(/[\s,.;:!?/()]+/).filter((w) => w.length > 1);

        for (const token of candTokens) {
          if (citeText.includes(token)) {
            matchScore += token.match(/\d+/) ? 10 : 2;
          }
        }

        for (const tag of cand.tags) {
          if (citeText.includes(tag.toLowerCase())) {
            matchScore += 8;
          }
        }

        if (matchScore > bestScore) {
          bestScore = matchScore;
          bestCandidate = cand;
        }
      }

      if (bestScore > 0) {
        matchedRecord = bestCandidate;
      } else {
        const activeRecord = sectionCandidates.find((r) => r.sourceStatus === 'VERIFIED' && (!r.validTo || r.validTo >= this.referenceDate));
        if (activeRecord) {
          matchedRecord = activeRecord;
        }
      }
    }

    // 3. Authority alignment check (with ASC/ACRA merger compatibility)
    const authorityMatches =
      !citation.authority ||
      citation.authority === matchedRecord.authority ||
      (citation.authority === 'ASC' && matchedRecord.authority === 'ACRA') ||
      (citation.authority === 'ACRA' && matchedRecord.authority === 'ASC');

    if (!authorityMatches) {
      return {
        citation,
        status: 'AUTHORITY_MISMATCH',
        isValid: false,
        isStructurallyValid: false,
        isAuthoritativePrimarySource: false,
        matchedRecord,
        reason: `Authority mismatch: citation claims '${citation.authority}' but record is governed by '${matchedRecord.authority}'.`,
        structuralVerificationOnly: true
      };
    }

    if (expectedAuthority) {
      const expectedMatches =
        matchedRecord.authority === expectedAuthority ||
        (expectedAuthority === 'ASC' && matchedRecord.authority === 'ACRA') ||
        (expectedAuthority === 'ACRA' && matchedRecord.authority === 'ASC');

      if (!expectedMatches) {
        return {
          citation,
          status: 'AUTHORITY_MISMATCH',
          isValid: false,
          isStructurallyValid: false,
          isAuthoritativePrimarySource: false,
          matchedRecord,
          reason: `Authority mismatch: expected domain authority '${expectedAuthority}' but citation belongs to '${matchedRecord.authority}'.`,
          structuralVerificationOnly: true
        };
      }
    }

    // 4. Canonical URL verification
    if (rawUrl && !isApprovedSingaporeSourceUrl(rawUrl)) {
      return {
        citation,
        status: 'NON_CANONICAL_URL',
        isValid: false,
        isStructurallyValid: false,
        isAuthoritativePrimarySource: false,
        matchedRecord,
        reason: `URL '${rawUrl}' is not an approved Singapore government or standard-setter portal.`,
        structuralVerificationOnly: true
      };
    }

    // Canonical exact path comparison against matchedRecord.officialSourceUrl
    if (rawUrl && matchedRecord.officialSourceUrl) {
      const normCite = this.normalizeExactUrl(rawUrl);
      const normRec = this.normalizeExactUrl(matchedRecord.officialSourceUrl);
      if (normCite !== normRec) {
        return {
          citation,
          status: 'NON_CANONICAL_URL',
          isValid: false,
          isStructurallyValid: false,
          isAuthoritativePrimarySource: false,
          matchedRecord,
          reason: `Citation URL '${rawUrl}' does not match official record URL '${matchedRecord.officialSourceUrl}'.`,
          structuralVerificationOnly: true
        };
      }
    }

    if (!matchedRecord.officialSourceUrl || !this.isRegisteredUrlVerified(matchedRecord)) {
      return {
        citation,
        status: 'NON_CANONICAL_URL',
        isValid: false,
        isStructurallyValid: false,
        isAuthoritativePrimarySource: false,
        matchedRecord,
        reason: 'Matched source record has no independently verified URL provenance.',
        structuralVerificationOnly: true
      };
    }

    if (rawPara.trim() && !this.isTopicSpecificSourceUrl(matchedRecord.officialSourceUrl)) {
      return {
        citation,
        status: 'NON_CANONICAL_URL',
        isValid: false,
        isStructurallyValid: false,
        isAuthoritativePrimarySource: false,
        matchedRecord,
        reason: `Registered URL '${matchedRecord.officialSourceUrl}' is a generic portal and does not identify the cited topic or section.`,
        structuralVerificationOnly: true
      };
    }

    // 5. Retrieved Evidence Scope check: Citation must be supported by the retrieved evidence in context
    if (retrievedEvidenceScope !== undefined) {
      if (retrievedEvidenceScope.length === 0) {
        return {
          citation,
          status: 'UNVERIFIED',
          isValid: false,
          isStructurallyValid: true,
          isAuthoritativePrimarySource: false,
          matchedRecord,
          reason: 'No authoritative evidence was retrieved in context to support this citation.',
          structuralVerificationOnly: true
        };
      }

      const codeClean = rawStd.toLowerCase().replace(/[\s\-_()]/g, '');
      const inScopeRecord = retrievedEvidenceScope.find((r) => {
        const rCodeClean = r.standardOrActCode.toLowerCase().replace(/[\s\-_()]/g, '');
        const rTitleClean = r.documentTitle.toLowerCase().replace(/[\s\-_()]/g, '');
        const codeMatches = rCodeClean.includes(codeClean) || rTitleClean.includes(codeClean) || codeClean.includes(rCodeClean);
        if (!codeMatches) return false;
        if (!paraClean) return true;
        const rSecClean = this.normalizeSection(r.paragraphOrSection);
        return rSecClean.includes(paraClean) || paraClean.includes(rSecClean);
      });

      if (!inScopeRecord) {
        return {
          citation,
          status: 'UNVERIFIED',
          isValid: false,
          isStructurallyValid: true,
          isAuthoritativePrimarySource: false,
          matchedRecord,
          reason: `Citation '${rawStd} ${rawPara}' is structurally valid in law but was not retrieved in the evidence context for this query.`,
          structuralVerificationOnly: true
        };
      }
    }

    // 6. Verification passes - Strictly distinguish Primary Statutory Source vs Curated Summary
    const isVerifiedPrimary =
      matchedRecord.evidenceTier === 'PRIMARY_SOURCE' &&
      matchedRecord.sourceStatus === 'VERIFIED' &&
      matchedRecord.sourceType === 'AUTHORITATIVE_SOURCE' &&
      matchedRecord.isVerbatimText === true;

    const isNeedsReview = matchedRecord.sourceStatus === 'NEEDS_REVIEW';
    const isCuratedSummary = matchedRecord.evidenceTier === 'CURATED_SUMMARY' ||
      matchedRecord.sourceType === 'CURATED_SUMMARY';

    const isOfficialGuidance = matchedRecord.evidenceTier === 'OFFICIAL_GUIDANCE';

    const status: CitationVerificationStatus = isVerifiedPrimary
      ? 'VERIFIED_PRIMARY_SOURCE'
      : isNeedsReview
      ? 'SOURCE_NEEDS_REVIEW'
      : 'STRUCTURALLY_VERIFIED_SUMMARY';

    let reason: string;
    if (isVerifiedPrimary) {
      reason = `Citation structurally verified against primary statutory provision in ${matchedRecord.documentTitle} (${matchedRecord.paragraphOrSection}).`;
    } else if (isOfficialGuidance) {
      reason = `Citation is structurally valid against official agency guidance ${matchedRecord.documentTitle} (${matchedRecord.paragraphOrSection}); it is not a verified primary statutory provision.`;
    } else if (isNeedsReview) {
      reason = `Citation is structurally valid against ${matchedRecord.documentTitle} (${matchedRecord.paragraphOrSection}), but underlying record is a curated summary marked SOURCE_NEEDS_REVIEW.`;
    } else if (isCuratedSummary) {
      reason = `Citation is structurally valid against the reviewed curated summary ${matchedRecord.documentTitle} (${matchedRecord.paragraphOrSection}); the summary is not verbatim primary-source text.`;
    } else {
      reason = `Citation is structurally valid against ${matchedRecord.documentTitle} (${matchedRecord.paragraphOrSection}).`;
    }

    return {
      citation,
      status,
      isValid: true,
      isStructurallyValid: true,
      isAuthoritativePrimarySource: isVerifiedPrimary,
      matchedRecord,
      reason,
      structuralVerificationOnly: true
    };
  }

  /**
   * Batch verifies a list of citations and returns verified and rejected sets.
   */
  public verifyCitationBatch(
    citations: StandardCitation[],
    expectedAuthority?: StatutoryAuthority,
    retrievedEvidenceScope?: AuthoritativeSourceRecord[]
  ): {
    results: CitationVerificationResult[];
    allValid: boolean;
    validCitations: StandardCitation[];
    rejectedCitations: CitationVerificationResult[];
  } {
    const results = citations.map((c) => this.verifyCitation(c, expectedAuthority, retrievedEvidenceScope));
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
