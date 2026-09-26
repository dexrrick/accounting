import type { AuthoritativeSourceRecord } from '../standards/unifiedSourceModel';
import { hasVerifiedSourceUrlProvenance, isApprovedSingaporeSourceUrl } from '../standards/approvedSourceRegistry';
import { defaultSourceFreshnessManager, SourceFreshnessManager } from '../standards/sourceFreshnessManager';

export type VerifiedEvidenceClaim = {
  text: string;
  recordId: string;
  quote: string;
  /** Present only when the record has independent, exact URL verification. */
  canonicalUrl?: string;
  supportKind: 'EXACT_SOURCE_QUOTE' | 'REVIEWED_EDITORIAL_SUMMARY';
};

export type RejectedEvidenceClaim = {
  text: string;
  reason: string;
};

export type EvidenceClaimsVerificationResult = {
  accepted: VerifiedEvidenceClaim[];
  rejected: RejectedEvidenceClaim[];
};

export interface VerifyEvidenceClaimsOptions {
  missingFacts: string[];
  targetDate?: string;
}

const APPLICATION_SOURCE_TYPES = new Set(['APPLICATION_RULE']);
const ATTACHED_QUALIFICATION_START = /^(?:however\b|except\b|provided\b|unless\b|but\b|subject to\b|notwithstanding\b|nevertheless\b|in contrast\b)/i;
const COMMON_ABBREVIATIONS = /\b(?:e\.g|i\.e|etc|mr|mrs|ms|dr|prof|no|nos|sec|secs|s|para|paras|art|arts|pt|ltd|pte|co)\.$/i;

function normalizeEvidenceText(value: string): string {
  return value.normalize('NFC').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizeApprovedHttpsUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  const raw = value.trim();
  const authority = raw.match(/^https:\/\/([^/?#]+)/i)?.[1];
  if (!authority || authority.includes('@') || authority.includes(':')) return undefined;

  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port ||
        !isApprovedSingaporeSourceUrl(raw)) return undefined;
    return parsed.href;
  } catch {
    return undefined;
  }
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function findDateRejection(
  record: AuthoritativeSourceRecord,
  targetDate: string | undefined
): string | undefined {
  if (targetDate !== undefined && !isIsoDate(targetDate)) return 'TARGET_DATE_INVALID';

  const validFrom = record.validFrom || record.effectiveDate;
  const validTo = record.validTo;
  if (validFrom !== undefined && !isIsoDate(validFrom)) return 'SOURCE_DATE_BOUNDS_INVALID';
  if (validTo !== undefined && !isIsoDate(validTo)) return 'SOURCE_DATE_BOUNDS_INVALID';

  if (record.sourceStatus === 'HISTORICAL') {
    if (!targetDate) return 'HISTORICAL_TARGET_DATE_REQUIRED';
    if (!validFrom || !validTo) return 'HISTORICAL_DATE_BOUNDS_REQUIRED';
  }
  if (!targetDate) return undefined;

  if (validFrom && targetDate < validFrom) return 'SOURCE_NOT_IN_EFFECT_ON_TARGET_DATE';
  if (validTo && targetDate > validTo) return 'SOURCE_NOT_IN_EFFECT_ON_TARGET_DATE';

  // A current source with no stated effective period cannot substantiate a
  // date earlier than the snapshot that was reviewed or retrieved.
  if (!validFrom) {
    const capturedDate = record.provenance === 'LIVE_EXTERNAL'
      ? record.retrievedAt?.slice(0, 10)
      : record.lastVerifiedDate;
    if (!isIsoDate(capturedDate) || targetDate < capturedDate) return 'TARGET_DATE_UNBOUNDED';
  }
  return undefined;
}

export function findRecordEligibilityRejection(record: AuthoritativeSourceRecord, targetDate?: string, referenceDate: string = SourceFreshnessManager.DEFAULT_REFERENCE_DATE): string | undefined {
  if (APPLICATION_SOURCE_TYPES.has(record.sourceType) || record.evidenceTier === 'APPLICATION_RULE') {
    return 'APPLICATION_SOURCE_NOT_ALLOWED';
  }
  if (record.lifecycleState === 'REJECTED' || record.lifecycleState === 'STAGED' ||
      record.recordRole === 'SOURCE_MAP_POINTER' || record.groundingEligible === false) {
    return 'SOURCE_RECORD_NOT_GROUNDING_ELIGIBLE';
  }

  if (record.provenance === 'LOCAL_STATIC') {
    if (record.sourceStatus !== 'VERIFIED' && record.sourceStatus !== 'HISTORICAL') return 'LOCAL_SOURCE_NOT_VERIFIED';
    if (record.lifecycleState !== 'ACTIVE') return 'LOCAL_SOURCE_NOT_ACTIVE';
    if (record.verificationMethod !== 'STATUTORY_LEGISLATION_AUDIT' &&
        record.verificationMethod !== 'CURATED_EDITORIAL_REVIEW') return 'LOCAL_SOURCE_REVIEW_PROVENANCE_MISSING';
    if (defaultSourceFreshnessManager.evaluateSourceFreshness(record, referenceDate) === 'AUDIT_OVERDUE') {
      return 'LOCAL_SOURCE_REVIEW_AUDIT_OVERDUE';
    }
  } else if (record.provenance === 'LIVE_EXTERNAL') {
    if (record.lifecycleState !== 'CANDIDATE' || record.sourceStatus !== 'NEEDS_REVIEW' ||
        record.verificationMethod !== 'LIVE_OFFICIAL_TOPIC_VERIFIED' ||
        record.urlVerificationStatus !== 'VERIFIED' ||
        !/^[a-f\d]{64}$/i.test(record.documentHash || '') ||
        !record.retrievedAt || !Number.isFinite(Date.parse(record.retrievedAt))) {
      return 'LIVE_SOURCE_CANDIDATE_INCOMPLETE';
    }
    // A source-map validity window is routing metadata. A freshly fetched page
    // cannot establish an older rule merely by inheriting that pointer's dates.
    if (targetDate && targetDate < record.retrievedAt.slice(0, 10)) {
      return 'LIVE_HISTORICAL_PAGE_SCOPE_UNVERIFIED';
    }
  } else {
    return 'SOURCE_PROVENANCE_NOT_ALLOWED';
  }

  if (!record.sourceText || normalizeEvidenceText(record.sourceText) === '') return 'SOURCE_TEXT_MISSING';

  const officialUrl = normalizeApprovedHttpsUrl(record.officialSourceUrl);
  const canonicalUrl = normalizeApprovedHttpsUrl(record.canonicalSourceUrl);
  if (!officialUrl || !canonicalUrl || officialUrl !== canonicalUrl) return 'SOURCE_URL_NOT_APPROVED_OR_CANONICAL';

  return findDateRejection(record, targetDate);
}

function splitParagraphIntoSentences(paragraph: string): string[] {
  const sentences: string[] = [];
  let segmentStart = 0;
  for (let index = 0; index < paragraph.length; index += 1) {
    const character = paragraph[index];
    if (!'.!?'.includes(character)) continue;
    const isDecimalPoint = character === '.' && /\d/.test(paragraph[index - 1] || '') && /\d/.test(paragraph[index + 1] || '');
    if (isDecimalPoint || (index + 1 < paragraph.length && !/\s/.test(paragraph[index + 1]))) continue;
    if (character === '.' && COMMON_ABBREVIATIONS.test(paragraph.slice(segmentStart, index + 1))) continue;

    const sentence = paragraph.slice(segmentStart, index + 1).trim();
    if (sentence) sentences.push(sentence);
    segmentStart = index + 1;
  }
  const remainder = paragraph.slice(segmentStart).trim();
  if (remainder) sentences.push(remainder);
  return sentences;
}

function quoteIsWholeSourceSpan(sourceText: string, quote: string): 'MATCH' | 'NO_MATCH' | 'OMITS_ATTACHED_QUALIFICATION' {
  const paragraphs = sourceText
    .normalize('NFC')
    .replace(/\u00a0/g, ' ')
    .split(/\r?\n[\t ]*\r?\n+/)
    .map(paragraph => paragraph.trim())
    .filter(Boolean);
  const normalizedQuote = normalizeEvidenceText(quote);

  for (let paragraphIndex = 0; paragraphIndex < paragraphs.length; paragraphIndex += 1) {
    const paragraph = paragraphs[paragraphIndex];
    if (normalizeEvidenceText(paragraph) === normalizedQuote) {
      const nextParagraph = paragraphs[paragraphIndex + 1];
      if (nextParagraph && ATTACHED_QUALIFICATION_START.test(normalizeEvidenceText(nextParagraph))) {
        return 'OMITS_ATTACHED_QUALIFICATION';
      }
      return 'MATCH';
    }

    const sentences = splitParagraphIntoSentences(paragraph);
    for (let start = 0; start < sentences.length; start += 1) {
      let span = '';
      for (let end = start; end < sentences.length; end += 1) {
        span = span ? `${span} ${sentences[end]}` : sentences[end];
        const normalizedSpan = normalizeEvidenceText(span);
        if (normalizedSpan === normalizedQuote) {
          const nextSentence = sentences[end + 1] || paragraphs[paragraphIndex + 1];
          if (nextSentence && ATTACHED_QUALIFICATION_START.test(normalizeEvidenceText(nextSentence))) {
            return 'OMITS_ATTACHED_QUALIFICATION';
          }
          return 'MATCH';
        }
        if (normalizedSpan.length > normalizedQuote.length) break;
      }
    }
  }
  return 'NO_MATCH';
}

function reject(text: string, reason: string): RejectedEvidenceClaim {
  return { text, reason };
}

/**
 * Verifies only literal source quotations. This does not infer entailment from
 * vocabulary overlap and does not verify application of a rule to facts.
 */
export function verifyEvidenceClaims(
  claims: unknown,
  records: AuthoritativeSourceRecord[],
  options: VerifyEvidenceClaimsOptions
): EvidenceClaimsVerificationResult {
  const accepted: VerifiedEvidenceClaim[] = [];
  const rejected: RejectedEvidenceClaim[] = [];
  const targetDate = options?.targetDate;

  if (!Array.isArray(claims)) {
    return { accepted, rejected: [reject('', 'CLAIMS_NOT_ARRAY')] };
  }

  for (const claimValue of claims) {
    if (!claimValue || typeof claimValue !== 'object' || Array.isArray(claimValue)) {
      rejected.push(reject('', 'CLAIM_NOT_OBJECT'));
      continue;
    }
    const claim = claimValue as Record<string, unknown>;
    const text = typeof claim.text === 'string' ? claim.text : '';
    if (claim.kind === 'APPLICATION') {
      rejected.push(reject(text, options?.missingFacts?.length ? 'APPLICATION_REQUIRES_FACTS_AND_DETERMINISTIC_ENGINE' : 'APPLICATION_REQUIRES_DETERMINISTIC_ENGINE'));
      continue;
    }
    if (claim.kind !== 'RULE') {
      rejected.push(reject(text, 'CLAIM_KIND_NOT_ALLOWED'));
      continue;
    }
    if (typeof claim.text !== 'string' || text.trim() === '' || typeof claim.quote !== 'string' ||
        claim.quote.trim() === '' || typeof claim.recordId !== 'string' || claim.recordId.trim() === '') {
      rejected.push(reject(text, 'CLAIM_FIELDS_MISSING'));
      continue;
    }

    const quote = claim.quote;
    if (/[.…]{3,}|…/u.test(quote)) {
      rejected.push(reject(text, 'ELLIPSIS_NOT_ALLOWED'));
      continue;
    }
    if (normalizeEvidenceText(text) !== normalizeEvidenceText(quote)) {
      rejected.push(reject(text, 'CLAIM_TEXT_MUST_EQUAL_QUOTE'));
      continue;
    }

    const matchingRecords = records.filter(record => record.id === claim.recordId);
    if (matchingRecords.length === 0) {
      rejected.push(reject(text, 'SOURCE_RECORD_NOT_FOUND'));
      continue;
    }
    if (matchingRecords.length !== 1) {
      rejected.push(reject(text, 'SOURCE_RECORD_ID_AMBIGUOUS'));
      continue;
    }
    const record = matchingRecords[0];
    const eligibilityRejection = findRecordEligibilityRejection(record, targetDate);
    if (eligibilityRejection) {
      rejected.push(reject(text, eligibilityRejection));
      continue;
    }

    const sourceUrl = normalizeApprovedHttpsUrl(record.canonicalSourceUrl);
    if (!sourceUrl) {
      rejected.push(reject(text, 'SOURCE_URL_NOT_APPROVED_OR_CANONICAL'));
      continue;
    }
    const canonicalUrl = hasVerifiedSourceUrlProvenance(record) ? sourceUrl : undefined;
    if (claim.citationUrl !== undefined) {
      const citationUrl = normalizeApprovedHttpsUrl(claim.citationUrl);
      if (!citationUrl || citationUrl !== sourceUrl) {
        rejected.push(reject(text, 'CITATION_URL_MISMATCH'));
        continue;
      }
      if (!canonicalUrl) {
        rejected.push(reject(text, 'CITATION_URL_UNVERIFIED'));
        continue;
      }
    }

    const quoteResult = quoteIsWholeSourceSpan(record.sourceText, quote);
    if (quoteResult === 'OMITS_ATTACHED_QUALIFICATION') {
      rejected.push(reject(text, 'QUOTE_OMITS_ATTACHED_QUALIFICATION'));
      continue;
    }
    if (quoteResult !== 'MATCH') {
      rejected.push(reject(text, 'QUOTE_NOT_WHOLE_SENTENCE_OR_PARAGRAPH'));
      continue;
    }

    accepted.push({
      text,
      recordId: record.id,
      quote,
      ...(canonicalUrl ? { canonicalUrl } : {}),
      supportKind: record.provenance === 'LOCAL_STATIC' &&
        (record.sourceType === 'CURATED_SUMMARY' || record.isVerbatimText === false)
        ? 'REVIEWED_EDITORIAL_SUMMARY' : 'EXACT_SOURCE_QUOTE'
    });
  }

  return { accepted, rejected };
}
