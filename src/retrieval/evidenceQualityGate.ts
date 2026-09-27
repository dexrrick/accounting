import type { QueryDomain, StatutoryAuthority } from '../types/accounting';
import { UNIFIED_SOURCE_REGISTRY, type AuthoritativeSourceRecord } from '../standards/unifiedSourceModel';
import { hasVerifiedSourceUrlProvenance, isApprovedSingaporeSourceUrl } from '../standards/approvedSourceRegistry';
import { getCoverageTopicById, getCoverageTopicsByIds } from '../standards/coverageRegistry';
import { SourceFreshnessManager } from '../standards/sourceFreshnessManager';
import { defaultTargetDateResolver } from './targetDateResolver';
import { findRecordEligibilityRejection } from '../verification/claimEvidenceVerifier';
import { hasUnresolvedSection14NBasisPeriod } from './statutoryDateScope';

export interface EvidenceQualityTraceAttempt {
  topicId: string;
  sourceMapId?: string;
  fetchStatus: string;
  finalUrl?: string;
  pageTitle?: string;
  titleMatched: boolean;
  contentMatched: boolean;
}

/** Minimal structural slice of the production map-retrieval trace. */
export interface EvidenceQualitySourceMapTrace {
  path?: string;
  sourceMapIds?: string[];
  selectedRecordIds?: string[];
  finalVerifiedUrls?: string[];
  attempts?: EvidenceQualityTraceAttempt[];
}

export interface EvidenceQualityInput {
  query: string;
  topicIds: string[];
  records: AuthoritativeSourceRecord[];
  missingFacts: string[];
  sourceMapFallbackTrace?: EvidenceQualitySourceMapTrace;
  /** Optional explicit date already resolved by the caller. */
  targetDate?: string;
  referenceDate?: string;
  /** Routing hints let a no-topic IRAS query fail closed. */
  domain?: QueryDomain;
  authorities?: StatutoryAuthority[];
}

export interface EvidenceQualityAssessment {
  status: 'LOCAL_SUFFICIENT' | 'RETRIEVED_SUFFICIENT' | 'LIMITED' | 'INSUFFICIENT';
  eligibleRecords: AuthoritativeSourceRecord[];
  rejectedRecords: Array<{ recordId: string; code: string; reason: string }>;
  coveredTopicIds: string[];
  uncoveredTopicIds: string[];
  missingFacts: string[];
  targetDate?: string;
  targetDateConfidence: 'HIGH' | 'MEDIUM' | 'LOW';
}

const GENERIC_TOPIC_WORDS = new Set([
  'about', 'account', 'accounts', 'agency', 'allowance', 'applicable', 'business', 'company', 'condition',
  'conditions', 'corporate', 'deductibility', 'deductible', 'deduction', 'deductions', 'expense', 'expenses',
  'exemption', 'exemptions', 'guidance', 'iras', 'income', 'inland', 'law', 'local', 'of', 'official', 'on',
  'or', 'payment', 'payments', 'relief', 'rules', 'rule', 'singapore', 'source', 'supplies', 'supply', 'tax',
  'taxes', 'the', 'treatment', 'under', 'with'
]);

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9%]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function words(value: string): string[] {
  return normalizeText(value).split(' ').filter(Boolean).map(word => {
    if (word.endsWith('ies') && word.length > 4) return `${word.slice(0, -3)}y`;
    if (/(?:sses|shes|ches|xes|zes)$/.test(word) && word.length > 5) return word.slice(0, -2);
    if (word.endsWith('s') && !word.endsWith('ss') && word.length > 4) return word.slice(0, -1);
    return word;
  });
}

function recordTopicAssociations(record: AuthoritativeSourceRecord): Set<string> {
  return new Set([
    ...(record.sourceMapTopicIds || []),
    ...(record.relatedTopicIds || []),
    ...(record.tags || []),
    ...(record.retrievalHints || [])
  ]);
}

function metadataAssociatesRecord(record: AuthoritativeSourceRecord, topic: NonNullable<ReturnType<typeof getCoverageTopicById>>): boolean {
  if (topic.sourceRecordIds.includes(record.id)) return true;
  const associations = recordTopicAssociations(record);
  if (associations.has(topic.id) || (topic.relatedTopicIds || []).some(id => associations.has(id))) return true;

  // Some legacy, reviewed local records predate explicit topic IDs. Allow a
  // registry-backed tag connection, but never use it without content matching.
  const recordTagWords = new Set((record.tags || []).flatMap(words));
  const registryPhrases = [topic.title, ...topic.keywords, ...(topic.aliases || [])];
  const normalizedTags = new Set((record.tags || []).map(normalizeText));
  return registryPhrases.some(phrase => {
    if (normalizeText(phrase).length >= 8 && normalizedTags.has(normalizeText(phrase))) return true;
    const distinctive = words(phrase).filter(word => word.length >= 4 && !GENERIC_TOPIC_WORDS.has(word));
    return distinctive.length >= 2 && distinctive.filter(word => recordTagWords.has(word)).length >= 2;
  });
}

function matchesReviewedLocalRegistryRecord(record: AuthoritativeSourceRecord): boolean {
  const canonical = UNIFIED_SOURCE_REGISTRY[record.id];
  if (!canonical || canonical.provenance !== 'LOCAL_STATIC') return false;
  // A bound ID is an association only when the evidence payload is the reviewed
  // registry record. Compare all recorded authority, content, citation and
  // review metadata; freshnessStatus is recomputed for the request date.
  const candidateFields = record as unknown as Record<string, unknown>;
  const canonicalFields = canonical as unknown as Record<string, unknown>;
  const fields = new Set([...Object.keys(candidateFields), ...Object.keys(canonicalFields)]);
  fields.delete('freshnessStatus');
  return [...fields].every(field => JSON.stringify(candidateFields[field]) === JSON.stringify(canonicalFields[field]));
}

function distinctiveTextMatches(record: AuthoritativeSourceRecord, topic: NonNullable<ReturnType<typeof getCoverageTopicById>>): boolean {
  const text = normalizeText(record.sourceText || '');
  if (text.length < 24) return false;
  const textWords = new Set(words(text));
  const registryPhrases = [topic.title, ...topic.keywords, ...(topic.aliases || [])];
  for (const phrase of registryPhrases) {
    const normalizedPhrase = normalizeText(phrase);
    if (normalizedPhrase.length >= 9 && text.includes(normalizedPhrase)) return true;
    const phraseWords = [...new Set(words(phrase).filter(word => word.length > 2 && !['and', 'for', 'from', 'the', 'with'].includes(word)))];
    const distinctivePhraseWords = phraseWords.filter(word => !GENERIC_TOPIC_WORDS.has(word));
    if (distinctivePhraseWords.length > 0 && phraseWords.length >= 2 && phraseWords.every(word => textWords.has(word))) return true;
    const distinctive = [...new Set(words(phrase).filter(word => word.length >= 4 && !GENERIC_TOPIC_WORDS.has(word)))];
    const overlap = distinctive.filter(word => textWords.has(word));
    if (overlap.length >= 2 || overlap.some(word => word.length >= 8)) return true;
  }
  return false;
}

type IrasRequestHints = Pick<EvidenceQualityInput, 'domain' | 'authorities' | 'query'> & { topicIds?: string[] };

function isIrasRequest(input: IrasRequestHints): boolean {
  const topicIds = input.topicIds || [];
  const knownTopics = topicIds.map(id => getCoverageTopicById(id)).filter((topic): topic is NonNullable<typeof topic> => Boolean(topic));
  const hasIrasTopic = knownTopics.some(topic => topic.domainId.startsWith('IRAS_'));
  const hasNonIrasTopic = knownTopics.some(topic => !topic.domainId.startsWith('IRAS_'));
  const hasNonIrasAuthority = Boolean(input.authorities?.some(authority => authority !== 'IRAS'));

  // A mixed-authority or mixed-topic request must retain its non-IRAS
  // retrieval path. The evidence gate is for focused IRAS requests, not a
  // mechanism for discarding valid IFRS/MAS/ACRA records from a mixed query.
  if (hasNonIrasTopic || hasNonIrasAuthority) return false;
  if (input.domain) return input.domain.startsWith('IRAS_');
  if (input.authorities?.length) return input.authorities.length === 1 && input.authorities[0] === 'IRAS';
  if (hasIrasTopic) return true;
  return /\b(?:iras|gst|goods\s+and\s+services\s+tax|withholding\s+tax|\bwht\b|income\s+tax|section\s+14n|section\s+13w|\bir21\b|\beci\b)\b/i.test(input.query);
}

function hasIrasAssessmentScope(input: IrasRequestHints): boolean {
  const knownTopics = (input.topicIds || []).map(id => getCoverageTopicById(id))
    .filter((topic): topic is NonNullable<typeof topic> => Boolean(topic));
  return knownTopics.some(topic => topic.domainId.startsWith('IRAS_')) ||
    Boolean(input.domain?.startsWith('IRAS_')) ||
    Boolean(input.authorities?.includes('IRAS')) ||
    /\b(?:iras|gst|goods\s+and\s+services\s+tax|withholding\s+tax|\bwht\b|income\s+tax|section\s+14n|section\s+13w|\bir21\b|\beci\b)\b/i.test(input.query);
}

function isIrasEvidenceRecord(record: AuthoritativeSourceRecord): boolean {
  return record.authority === 'IRAS' || record.sourceAuthority === 'IRAS' || record.domain.startsWith('IRAS_');
}

function isUntouchedRecordEligible(record: AuthoritativeSourceRecord): boolean {
  return record.recordRole !== 'SOURCE_MAP_POINTER' && record.groundingEligible !== false &&
    record.lifecycleState !== 'CANDIDATE' && record.lifecycleState !== 'STAGED' && record.lifecycleState !== 'REJECTED' &&
    record.sourceType !== 'APPLICATION_RULE' && record.evidenceTier !== 'APPLICATION_RULE';
}

function isWithinTargetPeriod(record: AuthoritativeSourceRecord, targetDate: string): boolean {
  return (!record.validFrom || record.validFrom <= targetDate) && (!record.validTo || record.validTo >= targetDate);
}

function normalizeUrlIdentity(rawUrl: string | undefined): string | undefined {
  if (!rawUrl) return undefined;
  try {
    const url = new URL(rawUrl);
    url.hash = '';
    url.pathname = url.pathname.replace(/%28/gi, '(').replace(/%29/gi, ')').replace(/%27/gi, "'");
    return `${url.origin.toLowerCase()}${url.pathname}${url.search}`;
  } catch {
    return undefined;
  }
}

function traceProvesLiveRecord(
  record: AuthoritativeSourceRecord,
  topicId: string,
  trace?: EvidenceQualitySourceMapTrace
): boolean {
  const canonical = normalizeUrlIdentity(record.canonicalSourceUrl);
  const official = normalizeUrlIdentity(record.officialSourceUrl);
  if (!canonical || canonical !== official || record.urlVerificationStatus !== 'VERIFIED' ||
      !record.urlVerifiedDate || !hasVerifiedSourceUrlProvenance(record) ||
      !isApprovedSingaporeSourceUrl(record.officialSourceUrl) ||
      !trace?.selectedRecordIds?.includes(record.id) ||
      !trace.finalVerifiedUrls?.some(url => normalizeUrlIdentity(url) === canonical)) return false;

  return Boolean(trace.attempts?.some(attempt =>
    attempt.topicId === topicId && attempt.fetchStatus === 'SUCCESS' &&
    attempt.titleMatched === true && attempt.contentMatched === true &&
    normalizeUrlIdentity(attempt.finalUrl) === canonical
  ));
}

function isVerifiedLiveCandidate(record: AuthoritativeSourceRecord, topicId: string, targetDate: string | undefined, trace?: EvidenceQualitySourceMapTrace): boolean {
  return record.provenance === 'LIVE_EXTERNAL' &&
    record.lifecycleState === 'CANDIDATE' && (record.recordRole as string | undefined) === 'DISCOVERED_EVIDENCE' &&
    record.groundingEligible === true && record.sourceType !== 'APPLICATION_RULE' &&
    record.evidenceTier !== 'APPLICATION_RULE' && record.sourceAuthority === 'IRAS' &&
    (!targetDate || isWithinTargetPeriod(record, targetDate)) && traceProvesLiveRecord(record, topicId, trace) &&
    Boolean(record.sourceText?.trim());
}

function eligibilityRejectionMessage(code: string): string {
  switch (code) {
    case 'LOCAL_SOURCE_NOT_VERIFIED': return 'Local record is not marked VERIFIED or HISTORICAL.';
    case 'LOCAL_SOURCE_REVIEW_PROVENANCE_MISSING': return 'Local record lacks a recognized review method.';
    case 'LOCAL_SOURCE_REVIEW_AUDIT_OVERDUE': return 'Local record is overdue for its review audit.';
    case 'SOURCE_NOT_IN_EFFECT_ON_TARGET_DATE': return 'Local record is outside its effective date range for the target date.';
    case 'SOURCE_URL_NOT_APPROVED_OR_CANONICAL': return 'Local record URL is not an approved source URL or does not match its canonical URL.';
    case 'SOURCE_RECORD_NOT_GROUNDING_ELIGIBLE': return 'Local record is not active or eligible for evidence grounding.';
    case 'LIVE_SOURCE_CANDIDATE_INCOMPLETE': return 'Live source candidate is missing required retrieval or URL verification metadata.';
    case 'LIVE_HISTORICAL_PAGE_SCOPE_UNVERIFIED': return 'Current live page retrieval does not establish the requested historical date.';
    default: return `Evidence eligibility check rejected the record (${code}).`;
  }
}

function explicitGstRateTransitionYears(query: string): number[] {
  if (!/\b(?:gst|goods\s+and\s+services\s+tax)\b/i.test(query) ||
      !/\b(?:invoice|invoiced|payment|paid|time\s+of\s+supply)\b/i.test(query)) return [];
  const years = [...new Set((query.match(/\b20\d{2}\b/g) || []).map(Number))].sort((a, b) => a - b);
  return years.length === 2 && years[1] === years[0] + 1 ? years : [];
}

function isStandardGstRateContext(record: AuthoritativeSourceRecord, topic: NonNullable<ReturnType<typeof getCoverageTopicById>>, years: number[]): boolean {
  const topicVocabulary = normalizeText([topic.id, topic.title, ...topic.keywords].join(' '));
  const standardRateTopic = /standard rated|standard rate/.test(topicVocabulary);
  const recordTagText = normalizeText((record.tags || []).join(' '));
  const recordText = record.sourceText || '';
  const tagAssociatesRate = /(?:gst rate|standard rate)/.test(recordTagText);
  // A current rate may be stated as effective from its start date without
  // repeating the user's later year. The record's validated interval supplies
  // the temporal link; the text must still contain both the rate and a date.
  const textHasRateAndPeriod = /\b\d+(?:\.\d+)?\s*%/.test(recordText) && /\b20\d{2}\b/.test(recordText);
  const yearRelevant = years.some(year =>
    (!record.validFrom || record.validFrom <= `${year}-12-31`) && (!record.validTo || record.validTo >= `${year}-01-01`));
  return standardRateTopic && tagAssociatesRate && textHasRateAndPeriod && yearRelevant;
}

function isLinkedTransitionRecord(record: AuthoritativeSourceRecord, records: AuthoritativeSourceRecord[]): boolean {
  return records.some(other => other.id !== record.id && (
    record.supersededByRecordId === other.id || record.historicalPredecessorRecordId === other.id ||
    other.supersededByRecordId === record.id || other.historicalPredecessorRecordId === record.id
  ));
}

export function isIrasEvidenceRequest(input: IrasRequestHints): boolean {
  return isIrasRequest(input);
}

/**
 * Evaluates whether selected records are actually topical, temporally valid,
 * and eligible to support an IRAS answer. This is a relevance/provenance gate,
 * not a claim-level semantic proof.
 */
export function evaluateEvidenceQuality(input: EvidenceQualityInput): EvidenceQualityAssessment {
  const referenceDate = input.referenceDate || SourceFreshnessManager.DEFAULT_REFERENCE_DATE;
  const resolvedTarget = input.targetDate
    ? { targetDate: input.targetDate, confidence: 'HIGH' as const }
    : defaultTargetDateResolver.resolveTargetDate(input.query, referenceDate);
  const targetDate = resolvedTarget.targetDate;
  const relevanceDate = targetDate || referenceDate;
  const targetTopics = getCoverageTopicsByIds(input.topicIds || []).filter(topic => topic.domainId.startsWith('IRAS_'));
  const uniqueRecords = [...new Map((input.records || []).map(record => [record.id, record])).values()];
  const rejectedRecords: EvidenceQualityAssessment['rejectedRecords'] = [];
  const eligibleById = new Map<string, AuthoritativeSourceRecord>();
  const covered = new Set<string>();
  const localByTopic = new Set<string>();
  const liveByTopic = new Set<string>();
  const irasRequest = hasIrasAssessmentScope(input);
  const reject = (recordId: string, code: string, reason: string) => rejectedRecords.push({ recordId, code, reason });

  if (!irasRequest) {
    const untouchedRecords = uniqueRecords.filter(isUntouchedRecordEligible);
    return {
      status: input.missingFacts.length ? 'LIMITED' : 'LOCAL_SUFFICIENT',
      eligibleRecords: untouchedRecords,
      rejectedRecords: [],
      coveredTopicIds: [],
      uncoveredTopicIds: [],
      missingFacts: [...input.missingFacts],
      targetDate: resolvedTarget.targetDate,
      targetDateConfidence: resolvedTarget.confidence
    };
  }

  if (targetTopics.length === 0) {
    for (const record of uniqueRecords) reject(record.id, 'IRAS_TOPIC_UNRESOLVED', 'IRAS retrieval has no resolved IRAS topic; evidence scope is insufficient.');
    return {
      status: 'INSUFFICIENT',
      eligibleRecords: [],
      rejectedRecords,
      coveredTopicIds: [],
      uncoveredTopicIds: [],
      missingFacts: [...input.missingFacts],
      targetDate: resolvedTarget.targetDate,
      targetDateConfidence: resolvedTarget.confidence
    };
  }

  const transitionYears = explicitGstRateTransitionYears(input.query);
  const unresolvedRenovationBasisPeriod = hasUnresolvedSection14NBasisPeriod(input.query);
  for (const record of uniqueRecords) {
    if (unresolvedRenovationBasisPeriod && record.id.startsWith('ITA_SEC14N_RENOVATION_REFURBISHMENT')) {
      reject(record.id, 'SECTION14N_BASIS_PERIOD_UNRESOLVED',
        'An explicit calendar date and the stated YA differ; the company basis period must be established before choosing a Section 14N rule.');
      continue;
    }
    if (!isIrasEvidenceRecord(record)) {
      reject(record.id, 'EVIDENCE_OUTSIDE_IRAS_SCOPE', 'Non-IRAS record is outside the governed IRAS evidence scope.');
      continue;
    }
    if (record.recordRole === 'SOURCE_MAP_POINTER' || record.groundingEligible === false) {
      reject(record.id, 'SOURCE_MAP_POINTER_NOT_EVIDENCE', 'Source-map pointers are routing metadata, not answer evidence.');
      continue;
    }
    if (record.sourceType === 'APPLICATION_RULE' || record.evidenceTier === 'APPLICATION_RULE') {
      reject(record.id, 'APPLICATION_SOURCE_NOT_ALLOWED', 'Application rules are not authority evidence.');
      continue;
    }
    if (!record.sourceText?.trim()) {
      reject(record.id, 'SOURCE_TEXT_MISSING', 'Record has no substantive evidence text.');
      continue;
    }

    let accepted = false;
    let rejectedCode = 'TOPIC_ASSOCIATION_NOT_FOUND';
    let rejectedReason = 'No registry topic association with distinctive matching source text.';
    const eligibilityRejection = findRecordEligibilityRejection(record, targetDate, referenceDate);
    for (const topic of targetTopics) {
      const associated = metadataAssociatesRecord(record, topic);
      if (!associated) continue;
      const explicitlyBoundLocal = record.provenance === 'LOCAL_STATIC' && topic.sourceRecordIds.includes(record.id);
      if (explicitlyBoundLocal &&
          (!topic.authorities.includes(record.authority) || !topic.legacyDomains.includes(record.domain))) {
        rejectedCode = 'TOPIC_AUTHORITY_DOMAIN_MISMATCH';
        rejectedReason = 'Explicitly bound local evidence must still match the coverage topic authority and source domain.';
        continue;
      }
      const rateYears = transitionYears.length === 2 ? transitionYears : [Number(relevanceDate.slice(0, 4))];
      const transitionContext = transitionYears.length === 2 && record.sourceStatus !== 'NEEDS_REVIEW' &&
        record.provenance === 'LOCAL_STATIC' && isStandardGstRateContext(record, topic, transitionYears) &&
        isLinkedTransitionRecord(record, uniqueRecords);
      const transitionTargetDate = transitionContext
        ? transitionYears.map(year => `${year}-06-30`).find(date => isWithinTargetPeriod(record, date))
        : undefined;
      const transitionEligibilityRejection = transitionTargetDate
        ? findRecordEligibilityRejection(record, transitionTargetDate, referenceDate)
        : undefined;
      const local = record.provenance === 'LOCAL_STATIC' && !eligibilityRejection ||
        Boolean(record.provenance === 'LOCAL_STATIC' && transitionTargetDate && !transitionEligibilityRejection);
      const live = !local && !eligibilityRejection &&
        isVerifiedLiveCandidate(record, topic.id, targetDate, input.sourceMapFallbackTrace);
      const topicTextMatches = distinctiveTextMatches(record, topic) || explicitlyBoundLocal || transitionContext ||
        (topic.domainId === 'IRAS_GST' && isStandardGstRateContext(record, topic, rateYears));
      if (!local && !live) {
        rejectedCode = eligibilityRejection || transitionEligibilityRejection ||
          (record.provenance === 'LIVE_EXTERNAL' ? 'LIVE_RETRIEVAL_TRACE_NOT_VERIFIED' : 'SOURCE_NOT_ELIGIBLE');
        rejectedReason = eligibilityRejection || transitionEligibilityRejection
          ? eligibilityRejectionMessage(rejectedCode)
          : record.provenance === 'LIVE_EXTERNAL'
            ? 'Live candidate lacks a matching successful URL/topic/content retrieval trace or verified provenance.'
            : 'Record provenance or lifecycle is not eligible for IRAS evidence.';
        continue;
      }
      if (explicitlyBoundLocal && !matchesReviewedLocalRegistryRecord(record)) {
        rejectedCode = 'BOUND_LOCAL_RECORD_MISMATCH';
        rejectedReason = 'Explicit source-record binding requires the reviewed local registry content and provenance.';
        continue;
      }
      if (!topicTextMatches) {
        rejectedCode = 'TOPIC_TEXT_NOT_DISTINCTIVE';
        rejectedReason = 'Topic metadata alone is insufficient; source text lacks distinctive evidence for this topic.';
        continue;
      }
      accepted = true;
      eligibleById.set(record.id, record);
      covered.add(topic.id);
      if (local) localByTopic.add(topic.id);
      else liveByTopic.add(topic.id);
    }
    if (!accepted) reject(record.id, rejectedCode, rejectedReason);
  }

  // Keep a live candidate only for a gap not already covered by validated local
  // content. This mirrors the existing local-first/fallback source lifecycle.
  const relevantLiveOnlyForGap = [...eligibleById.values()].filter(record => {
    if (record.provenance !== 'LIVE_EXTERNAL') return true;
    const relatedTopics = targetTopics.filter(topic =>
      metadataAssociatesRecord(record, topic) && covered.has(topic.id) && !localByTopic.has(topic.id)
    );
    return relatedTopics.length > 0;
  });
  const eligibleRecords = [
    ...relevantLiveOnlyForGap.filter(record => record.provenance !== 'LIVE_EXTERNAL'),
    ...relevantLiveOnlyForGap.filter(record => record.provenance === 'LIVE_EXTERNAL')
  ];
  const uncoveredTopicIds = targetTopics.map(topic => topic.id).filter(id => !covered.has(id));
  const allCoveredLocally = uncoveredTopicIds.length === 0 && targetTopics.every(topic => localByTopic.has(topic.id));
  let status: EvidenceQualityAssessment['status'];
  if (eligibleRecords.length === 0) status = 'INSUFFICIENT';
  else if (input.missingFacts.length > 0 || uncoveredTopicIds.length > 0) status = 'LIMITED';
  else if (allCoveredLocally) status = 'LOCAL_SUFFICIENT';
  else status = 'RETRIEVED_SUFFICIENT';

  return {
    status,
    eligibleRecords,
    rejectedRecords,
    coveredTopicIds: targetTopics.map(topic => topic.id).filter(id => covered.has(id)),
    uncoveredTopicIds,
    missingFacts: [...input.missingFacts],
    targetDate: resolvedTarget.targetDate,
    targetDateConfidence: resolvedTarget.confidence
  };
}
