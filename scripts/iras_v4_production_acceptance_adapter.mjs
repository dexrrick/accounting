// Production-path adapter for the API-free V4 case loop. The surrounding
// runner owns all transport authorization; this module only re-enters the
// production interpretation, routing, retrieval, admission, and verification
// paths with the supplied guarded transports.
import { createHash } from 'node:crypto';
import { classifyQuestion } from '../src/classification/questionClassifier.ts';
import { evaluateEvidenceQuality } from '../src/retrieval/evidenceQualityGate.ts';
import { OfficialSitemapDiscoveryAdapter } from '../src/retrieval/officialSitemapDiscovery.ts';
import { defaultAdvancedSourceRetriever } from '../src/retrieval/advancedSourceRetriever.ts';
import { getCoverageTopicById } from '../src/standards/coverageRegistry.ts';
import {
  getRequestedQuestionConcepts,
  interpretSemanticQuestion,
  reconcileQuestionUnderstanding
} from '../src/services/semanticQuestionUnderstanding.ts';
import { buildAuthorityWorkstreams } from '../src/services/authorityWorkstreams.ts';
import { findRecordEligibilityRejection, verifyEvidenceClaims } from '../src/verification/claimEvidenceVerifier.ts';
import {
  CASE_IDS,
  classifyLocalCapabilityV4,
  evaluateV4Stages,
  parseSemanticResponseSafelyV4,
  readV4Contract,
  scoreApplicationStatusV4,
  scoreGovernedEvidenceV4,
  scoreSemanticV4,
  scoreWorkstreamRoutingV4
} from '../tests/evaluation/singapore/iras-first-targeted-acceptance-v4.mjs';

const PROVIDER = Object.freeze({ activeProvider: 'gemini', gemini: Object.freeze({ model: 'gemini-3.5-flash-lite' }) });
const PROVIDER_CONFIGURATION = Object.freeze({
  activeProvider: 'gemini',
  gemini: Object.freeze({ model: 'gemini-3.5-flash-lite', apiKey: 'configured-placeholder-key-for-interpreter-only' })
});
const MAX_DIAGNOSTIC_ITEMS = 48;
const MAX_RESULT_BYTES = 1_500_000;
const SHA256_RE = /^[a-f\d]{64}$/i;

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function isIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function safeCode(value) {
  return typeof value === 'string' && /^[A-Z][A-Z0-9_]{0,79}$/.test(value) ? value : undefined;
}

function safeErrorCode(error) {
  return safeCode(typeof error?.message === 'string' ? error.message : undefined) || 'TRANSPORT_ERROR';
}

function urlIdentity(value) {
  if (typeof value !== 'string' || !value) return undefined;
  try {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password) return undefined;
    parsed.hash = '';
    if (parsed.pathname.length > 1 && parsed.pathname.endsWith('/')) parsed.pathname = parsed.pathname.slice(0, -1);
    return parsed.toString();
  } catch {
    return undefined;
  }
}

function uniqueRecords(groups, returnedSources = [], scopedTopicIds = []) {
  const scoped = new Set(scopedTopicIds);
  const records = new Map();
  const conflicts = new Set();
  const identity = record => JSON.stringify([
    record.sourceText, record.contentHash, record.documentHash, record.officialSourceUrl,
    record.canonicalSourceUrl, record.documentTitle, record.provenance, record.authority,
    record.domain, record.sourceStatus, [...(record.tags || [])].sort()
  ]);
  const add = record => {
    if (!record || typeof record.id !== 'string') return;
    const existing = records.get(record.id);
    if (!existing) records.set(record.id, record);
    else if (identity(existing) !== identity(record)) conflicts.add(record.id);
  };
  for (const group of groups) {
    if ((group.topicIds || []).some(topicId => scoped.has(topicId))) {
      for (const record of group.records || []) add(record);
    }
  }
  for (const record of returnedSources || []) add(record);
  for (const id of conflicts) records.delete(id);
  return { records: [...records.values()], conflicts: [...conflicts].sort() };
}

function createObservedRetriever(groups) {
  return {
    async retrieveSources(request) {
      const records = await defaultAdvancedSourceRetriever.retrieveSources(request);
      groups.push({ topicIds: [...(request.topicIds || [])], records });
      return records;
    },
    getSourceById(id) { return defaultAdvancedSourceRetriever.getSourceById(id); },
    findSourcesByStandardOrAct(code, section) {
      return defaultAdvancedSourceRetriever.findSourcesByStandardOrAct(code, section);
    }
  };
}

function semanticPairFor(caseContract, semanticVerdict, expectedIssueId) {
  return semanticVerdict?.pairs?.find(pair => pair.expectedIssueId === expectedIssueId);
}

function resolveObservedIssue(caseContract, semanticVerdict, interpretation, issuePlan, runtime, expectedIssueId) {
  const pair = semanticPairFor(caseContract, semanticVerdict, expectedIssueId);
  const expected = caseContract.semantic.expectedIssues.find(issue => issue.id === expectedIssueId);
  const semanticIssue = pair && interpretation?.issues?.[pair.actualIndex];
  if (!pair || !expected || !semanticIssue) return undefined;
  const planned = (issuePlan?.issues || []).filter(issue => issue.subject === semanticIssue.subject &&
    issue.domain === semanticIssue.domain && issue.population === semanticIssue.population &&
    issue.operation === semanticIssue.operation && expected.governingAuthorities.some(authority =>
      issue.governingAuthorities?.includes(authority)));
  if (planned.length !== 1) return undefined;
  const matches = (runtime?.workstreams || []).filter(stream => expected.governingAuthorities.includes(stream.authority))
    .flatMap(stream => (stream.issues || []).map(issue => ({ issue, authority: stream.authority })))
    .filter(({ issue, authority }) => authority === planned[0].governingAuthorities.find(value =>
      expected.governingAuthorities.includes(value)) && issue.subject === planned[0].subject &&
      issue.domain === planned[0].domain && issue.population === planned[0].population &&
      issue.operation === planned[0].operation);
  return matches.length === 1 ? { expected, semanticIssue, planned: planned[0], ...matches[0] } : undefined;
}

function recordsForPlan(groups, planned, issue) {
  return uniqueRecords(groups, issue?.sources || [], planned?.mappedTopicIds || []);
}

function sourceProjection(record) {
  const sourceText = typeof record.sourceText === 'string' ? record.sourceText : '';
  return {
    recordId: record.id,
    authority: record.authority,
    domain: record.domain,
    provenance: record.provenance,
    sourceStatus: record.sourceStatus,
    lifecycleState: record.lifecycleState,
    sourceTextSha256: sourceText ? sha256(sourceText) : undefined,
    sourceTextBytes: Buffer.byteLength(sourceText, 'utf8'),
    documentTitle: record.documentTitle,
    officialSourceUrl: record.officialSourceUrl,
    canonicalSourceUrl: record.canonicalSourceUrl,
    contentHash: record.contentHash,
    documentHash: record.documentHash,
    tags: (record.tags || []).slice(0, 20)
  };
}

function issueProjection(issue) {
  if (!issue) return undefined;
  return {
    issueId: issue.issueId,
    subject: issue.subject,
    authority: issue.governingAuthority,
    domain: issue.domain,
    population: issue.population,
    operation: issue.operation,
    lifecycle: issue.lifecycle,
    evidenceStatus: issue.evidenceStatus,
    applicationStatus: issue.applicationStatus,
    gaps: (issue.gaps || []).map(gap => gap.code).slice(0, 32),
    retrievalAttempts: (issue.retrievalTrace?.attempts || []).slice(0, MAX_DIAGNOSTIC_ITEMS).map(attempt => ({
      topicId: attempt.topicId,
      fetchStatus: attempt.fetchStatus,
      finalUrl: attempt.finalUrl,
      pageTitle: attempt.pageTitle,
      titleMatched: attempt.titleMatched,
      contentMatched: attempt.contentMatched
    })),
    verifiedClaims: (issue.verifiedClaims || []).slice(0, MAX_DIAGNOSTIC_ITEMS).map(claim => ({
      recordId: claim.recordId,
      quote: claim.quote
    })),
    sources: (issue.sources || []).slice(0, MAX_DIAGNOSTIC_ITEMS).map(source => ({
      recordId: source.id,
      sourceStatus: source.sourceStatus,
      provenance: source.provenance,
      documentTitle: source.documentTitle,
      officialSourceUrl: source.officialSourceUrl,
      contentHash: source.contentHash,
      documentHash: source.documentHash
    }))
  };
}

function localOnlyObservations(caseContract, query, interpretation, issuePlan, runtime, groups, referenceDate) {
  const observations = [];
  const actualIssues = (runtime?.workstreams || []).flatMap(stream => stream.issues || []);
  const topicStates = {};
  const getTopicIssue = topicId => {
    const planned = (issuePlan?.issues || []).find(issue => issue.mappedTopicIds?.includes(topicId));
    return { planned, issue: planned && actualIssues.find(item => item.subject === planned.subject &&
      item.domain === planned.domain && item.population === planned.population && item.operation === planned.operation) };
  };

  for (const [topicId, expected] of Object.entries(caseContract.reviewedLocalCapability.expectedTopicStates || {})) {
    const topic = getCoverageTopicById(topicId);
    const { planned, issue } = getTopicIssue(topicId);
    const observed = uniqueRecords(groups, [], [topicId]);
    const records = observed.records;
    let quality;
    if (topic?.domainId.startsWith('IRAS_')) {
      const requestedConcepts = getRequestedQuestionConcepts(query, interpretation)
        .filter(concept => concept.topicIds.includes(topicId));
      quality = evaluateEvidenceQuality({
        query,
        topicIds: [topicId],
        records,
        missingFacts: [],
        referenceDate,
        authorities: ['IRAS'],
        requestedConcepts,
        ...(topic.legacyDomains.length === 1 ? { domain: topic.legacyDomains[0] } : {}),
        ...(planned ? { scopedSubject: planned.subject, scopedPopulation: planned.population } : {})
      });
    }
    const rejectionObserved = Boolean(issue?.gaps?.some(gap => gap.code === 'CANDIDATE_REJECTED'));
    const needsReviewCandidate = rejectionObserved && issue?.lifecycle?.evidenceFound === true &&
      records.some(record => topic?.sourceRecordIds?.includes(record.id) && record.sourceStatus === 'NEEDS_REVIEW');
    const topicCovered = quality
      ? quality.coveredTopicIds.includes(topicId) && !quality.uncoveredTopicIds.includes(topicId)
      : Boolean(issue?.lifecycle?.covered === true && records.some(record => topic?.sourceRecordIds?.includes(record.id) &&
        [record.tags, record.relatedTopicIds, record.sourceMapTopicIds, record.retrievalHints]
          .some(ids => ids?.includes(topicId))));
    const verifiedTopicClaim = issue?.lifecycle?.admitted === true && issue.lifecycle.verified === true && topicCovered &&
      (issue.verifiedClaims || []).some(claim => topic?.sourceRecordIds?.includes(claim.recordId) &&
        records.some(record => record.id === claim.recordId) &&
        (!quality || quality.eligibleRecords.some(record => record.id === claim.recordId)));
    const retrievalCompleted = issue?.lifecycle?.retrievalAttempted === true &&
      !(issue.gaps || []).some(gap => /^(?:RETRIEVAL|PROVIDER|TRANSPORT)_.*(?:FAILED|ERROR)$/.test(gap.code));
    const noEligibleCandidate = Boolean(planned && retrievalCompleted && records.length === 0 && issue?.lifecycle?.evidenceFound !== true);
    const substantiveScopeIncomplete = Boolean(planned && retrievalCompleted && !verifiedTopicClaim &&
      (records.length > 0 || issue?.lifecycle?.evidenceFound === true || issue?.lifecycle?.admitted === true));
    const actualState = needsReviewCandidate ? 'INVALID_LOCAL_EVIDENCE'
      : verifiedTopicClaim ? 'VERIFIED_LOCAL_RULE' : 'EXPECTED_LOCAL_GAP';
    const fields = {
      governedWorkstreamObserved: Boolean(issue),
      noGoverningWorkstream: !planned,
      retrievalCompleted,
      noEligibleCandidate,
      substantiveScopeIncomplete,
      admitted: issue?.lifecycle?.admitted === true,
      literalVerified: verifiedTopicClaim,
      topicCovered,
      needsReviewCandidate,
      candidateCount: records.length,
      state: actualState,
      expected
    };
    topicStates[topicId] = fields;
    observations.push({ topicId, localOnly: true, actualRuntime: true, ...fields });
  }

  const expectedIssueIds = Object.keys(caseContract.reviewedLocalCapability.expectedIssueStates || {});
  const issueStateById = new Map();
  for (const issueId of expectedIssueIds) {
    const pair = semanticPairFor(caseContract, caseContract._semanticVerdict, issueId);
    const semanticIssue = pair && interpretation?.issues?.[pair.actualIndex];
    const planned = semanticIssue && (issuePlan?.issues || []).find(item => item.subject === semanticIssue.subject &&
      item.domain === semanticIssue.domain && item.population === semanticIssue.population && item.operation === semanticIssue.operation);
    const issue = planned && actualIssues.find(item => item.subject === planned.subject && item.domain === planned.domain &&
      item.population === planned.population && item.operation === planned.operation);
    const scopedStates = (planned?.mappedTopicIds || []).map(topicId => topicStates[topicId]).filter(Boolean);
    const state = scopedStates.some(item => item.needsReviewCandidate) ? 'INVALID_LOCAL_EVIDENCE'
      : planned?.mappedTopicIds?.length && issue?.lifecycle?.retrievalAttempted !== true ? 'PIPELINE_FAILURE'
        : scopedStates.length > 0 && scopedStates.every(item => item.literalVerified) && issue?.lifecycle?.covered === true
          ? 'VERIFIED_LOCAL_RULE' : 'EXPECTED_LOCAL_GAP';
    const mappedTopicIds = planned?.mappedTopicIds || [];
    const retrievalCompleted = issue?.lifecycle?.retrievalAttempted === true &&
      !(issue.gaps || []).some(gap => /^(?:RETRIEVAL|PROVIDER|TRANSPORT)_.*(?:FAILED|ERROR)$/.test(gap.code));
    const needsReviewCandidate = scopedStates.some(item => item.needsReviewCandidate);
    const topicCovered = mappedTopicIds.length > 0 && mappedTopicIds.every(topicId => topicStates[topicId]?.topicCovered === true);
    const candidateCount = uniqueRecords(groups, [], mappedTopicIds).records.length;
    const fields = {
      state,
      mappedTopicIds,
      lifecycle: issue?.lifecycle,
      evidenceStatus: issue?.evidenceStatus,
      governedWorkstreamObserved: Boolean(issue && mappedTopicIds.length),
      noGoverningWorkstream: !planned || mappedTopicIds.length === 0,
      retrievalCompleted,
      needsReviewCandidate,
      admitted: issue?.lifecycle?.admitted === true,
      literalVerified: issue?.lifecycle?.verified === true && (issue.verifiedClaims || []).length > 0,
      topicCovered,
      noEligibleCandidate: Boolean(mappedTopicIds.length && retrievalCompleted && !issue?.lifecycle?.evidenceFound &&
        !issue?.lifecycle?.admitted && candidateCount === 0),
      substantiveScopeIncomplete: Boolean(mappedTopicIds.length && retrievalCompleted && !topicCovered &&
        (issue?.lifecycle?.evidenceFound === true || issue?.lifecycle?.admitted === true || candidateCount > 0))
    };
    issueStateById.set(issueId, fields);
    observations.push({ issueId, localOnly: true, actualRuntime: true, ...fields });
  }

  for (const authority of Object.keys(caseContract.reviewedLocalCapability.expectedAuthorityStates || {})) {
    const streams = (runtime?.workstreams || []).filter(stream => stream.authority === authority);
    const authorityIssues = streams.flatMap(stream => stream.issues || []);
    const ownedExpectedIds = expectedIssueIds.filter(issueId => {
      const pair = semanticPairFor(caseContract, caseContract._semanticVerdict, issueId);
      const semanticIssue = pair && interpretation?.issues?.[pair.actualIndex];
      const planned = semanticIssue && (issuePlan?.issues || []).find(item => item.subject === semanticIssue.subject);
      return planned?.governingAuthorities?.includes(authority);
    });
    const associatedIssues = ownedExpectedIds.map(issueId => issueStateById.get(issueId)).filter(Boolean);
    const mappedTopicIds = (issuePlan?.issues || []).filter(issue => issue.governingAuthorities?.includes(authority))
      .flatMap(issue => issue.mappedTopicIds || []);
    const authorityTopicStates = mappedTopicIds.map(topicId => topicStates[topicId]).filter(Boolean);
    const retrievalCompleted = authorityIssues.length === 0 || authorityIssues.every(issue => issue.lifecycle?.mapped !== true ||
      (issue.lifecycle?.retrievalAttempted === true && !(issue.gaps || []).some(gap =>
        /^(?:RETRIEVAL|PROVIDER|TRANSPORT)_.*(?:FAILED|ERROR)$/.test(gap.code))));
    const admitted = authorityIssues.length > 0 && authorityIssues.every(issue => issue.lifecycle?.admitted === true);
    const topicCoverageObserved = mappedTopicIds.length > 0 && authorityTopicStates.length === mappedTopicIds.length &&
      authorityTopicStates.every(item => item.topicCovered === true);
    const topicClaimsVerified = mappedTopicIds.length > 0 && authorityTopicStates.length === mappedTopicIds.length &&
      authorityTopicStates.every(item => item.literalVerified === true);
    const literalVerified = authorityIssues.length > 0 && authorityIssues.every(issue => issue.lifecycle?.admitted === true &&
      issue.lifecycle?.verified === true && issue.lifecycle?.covered === true && (issue.verifiedClaims || []).length > 0) &&
      topicClaimsVerified;
    const topicCovered = authorityIssues.length > 0 && authorityIssues.every(issue => issue.lifecycle?.covered === true) &&
      topicCoverageObserved;
    const needsReviewCandidate = authorityTopicStates.some(item => item.needsReviewCandidate);
    const candidateCount = uniqueRecords(groups, [], mappedTopicIds).records.length;
    const hasSubstantiveEvidence = authorityIssues.some(issue => issue.lifecycle?.evidenceFound === true ||
      issue.lifecycle?.admitted === true || (issue.verifiedClaims || []).length > 0) || candidateCount > 0;
    observations.push({
      authority,
      localOnly: true,
      actualRuntime: true,
      governedWorkstreamObserved: authorityIssues.length > 0,
      noGoverningWorkstream: authorityIssues.length === 0,
      retrievalCompleted,
      needsReviewCandidate,
      admitted,
      literalVerified,
      topicCovered,
      noEligibleCandidate: Boolean(authorityIssues.length && retrievalCompleted && !hasSubstantiveEvidence && candidateCount === 0),
      substantiveScopeIncomplete: Boolean(authorityIssues.length && retrievalCompleted && hasSubstantiveEvidence &&
        !(admitted && literalVerified && topicCovered)),
      issueStates: associatedIssues.map(item => item.state)
    });
  }

  return { observations, score: classifyLocalCapabilityV4(caseContract, observations), topicStates };
}

function createFetchObservationFacade(webRetriever, fetchObservations) {
  if (typeof webRetriever?.fetchOfficialSource !== 'function') throw new Error('CONTROLLED_WEB_RETRIEVER_REQUIRED');
  const original = webRetriever.fetchOfficialSource.bind(webRetriever);
  return Object.freeze({
    async fetchOfficialSource(url, options = {}) {
      try {
        const result = await original(url, options);
        const content = typeof result.content === 'string' ? result.content : '';
        const rawContentSha256 = content ? sha256(content) : undefined;
        fetchObservations.push({
          url: typeof url === 'string' ? url.slice(0, 2048) : undefined,
          sourceUrl: result.sourceUrl,
          finalUrl: result.finalUrl,
          status: result.status,
          pageTitle: result.pageTitle,
          contentHash: result.contentHash,
          rawContentSha256,
          rawContentBytes: Buffer.byteLength(content, 'utf8'),
          contentHashBoundToObservedBytes: Boolean(rawContentSha256 && result.contentHash === rawContentSha256),
          topicValidationPresent: Boolean(options.topicValidation && typeof options.topicValidation === 'object'),
          topicMatched: result.topicMatched === true,
          titleMatched: result.titleMatched === true,
          contentMatched: result.contentMatched === true
        });
        return result;
      } catch (error) {
        fetchObservations.push({
          url: typeof url === 'string' ? url.slice(0, 2048) : undefined,
          status: 'THREW',
          topicValidationPresent: Boolean(options.topicValidation && typeof options.topicValidation === 'object'),
          errorCode: safeErrorCode(error)
        });
        throw error;
      }
    }
  });
}

function bindLiveRecords(records, plannedTopicIds, retrievalAttempts, fetchObservations) {
  const liveRecords = records.filter(record => record.provenance === 'LIVE_EXTERNAL');
  const boundRecordIds = [];
  const attempts = [];
  const reasons = [];
  const successfulTopicIds = retrievalAttempts.filter(attempt => attempt.fetchStatus === 'SUCCESS')
    .map(attempt => attempt.topicId).filter(topicId => Boolean(getCoverageTopicById(topicId)));
  const scopedTopics = new Set([...plannedTopicIds, ...successfulTopicIds]
    .filter(topicId => Boolean(getCoverageTopicById(topicId))));

  for (const record of liveRecords) {
    const tags = [...new Set((record.tags || []).filter(topicId => scopedTopics.has(topicId)))];
    const official = urlIdentity(record.officialSourceUrl);
    const canonical = urlIdentity(record.canonicalSourceUrl);
    if (!tags.length || !official || official !== canonical || !record.documentTitle ||
        !SHA256_RE.test(record.contentHash || '') || !SHA256_RE.test(record.documentHash || '') ||
        record.contentHash.toLowerCase() !== record.documentHash.toLowerCase()) {
      reasons.push(`${record.id}:SOURCE_BINDING_FIELDS_INCOMPLETE`);
      continue;
    }
    const relevantFetches = fetchObservations.filter(observation => observation.status === 'SUCCESS' &&
      (observation.pageTitle === record.documentTitle || urlIdentity(observation.finalUrl) === official));
    const uniqueFetches = [...new Map(relevantFetches.map(observation => [JSON.stringify([
      urlIdentity(observation.url), urlIdentity(observation.sourceUrl), urlIdentity(observation.finalUrl),
      observation.pageTitle, observation.contentHash, observation.rawContentSha256
    ]), observation])).values()];
    if (uniqueFetches.length !== 1) {
      reasons.push(`${record.id}:VALIDATED_FETCH_ASSOCIATION_NOT_UNIQUE`);
      continue;
    }
    const fetch = uniqueFetches[0];
    const fetchRequest = urlIdentity(fetch.url);
    const fetchSource = urlIdentity(fetch.sourceUrl);
    const fetchFinal = urlIdentity(fetch.finalUrl);
    if (!fetchRequest || !fetchSource || !fetchFinal || fetch.pageTitle !== record.documentTitle ||
        fetchFinal !== official || fetchFinal !== canonical || fetch.contentHash !== record.contentHash ||
        fetchSource !== fetchFinal ||
        fetch.rawContentSha256 !== record.contentHash || fetch.contentHashBoundToObservedBytes !== true ||
        fetch.topicValidationPresent !== true || fetch.topicMatched !== true || fetch.titleMatched !== true ||
        fetch.contentMatched !== true) {
      reasons.push(`${record.id}:FETCH_CONTENT_TITLE_OR_URL_BINDING_FAILED`);
      continue;
    }
    let associated = 0;
    let validAssociations = true;
    for (const topicId of tags) {
      const topicAttempts = retrievalAttempts.filter(attempt => attempt.topicId === topicId &&
        attempt.fetchStatus === 'SUCCESS' && attempt.pageTitle === record.documentTitle);
      // authorityWorkstreams deliberately strips final URLs and validation
      // booleans from this runtime trace. Preserve that production boundary:
      // bind the single topic/title attempt to the separate observed fetch,
      // whose raw bytes, validation flags, title, content hash, and final URL
      // are retained below.
      if (topicAttempts.length > 1) {
        validAssociations = false;
        break;
      }
      if (topicAttempts.length === 1) {
        associated += 1;
        attempts.push({ topicId, fetchStatus: 'SUCCESS', finalUrl: fetch.finalUrl,
          pageTitle: fetch.pageTitle, titleMatched: true, contentMatched: true,
          associationBasis: 'sanitized_production_attempt_plus_unique_observed_validated_fetch' });
      }
    }
    if (!validAssociations || associated === 0) {
      reasons.push(`${record.id}:UNIQUE_TOPIC_ATTEMPT_BINDING_MISSING`);
      continue;
    }
    boundRecordIds.push(record.id);
  }
  const finalVerifiedUrls = [...new Set(attempts.map(attempt => attempt.finalUrl))];
  return {
    complete: boundRecordIds.length === liveRecords.length && reasons.length === 0,
    reasons,
    liveRecordIds: liveRecords.map(record => record.id),
    boundRecordIds: [...new Set(boundRecordIds)],
    trace: {
      path: 'production_through_call_unique_fetch_content_hash_binding',
      selectedRecordIds: [...new Set(boundRecordIds)],
      finalVerifiedUrls,
      attempts: attempts.slice(0, MAX_DIAGNOSTIC_ITEMS)
    }
  };
}

function evidenceObservation(caseContract, expectedIssueId, resolved, groups, fetchObservations, referenceDate) {
  if (!resolved) return undefined;
  const { planned, issue, authority } = resolved;
  const gathered = recordsForPlan(groups, planned, issue);
  const records = gathered.records;
  const isIras = authority === 'IRAS';
  const attempts = issue.retrievalTrace?.attempts || [];
  const binding = isIras
    ? bindLiveRecords(records, planned.mappedTopicIds || [], attempts, fetchObservations)
    : undefined;
  const requestedConcepts = isIras
    ? getRequestedQuestionConcepts(caseContract.question, caseContract._understanding)
      .filter(concept => concept.topicIds.some(topicId => (planned.mappedTopicIds || []).includes(topicId)))
    : [];
  const evidenceQuality = isIras ? evaluateEvidenceQuality({
    query: caseContract.question,
    topicIds: planned.mappedTopicIds || [],
    records,
    missingFacts: [],
    referenceDate,
    authorities: ['IRAS'],
    requestedConcepts,
    scopedSubject: issue.subject,
    scopedPopulation: issue.population,
    sourceMapFallbackTrace: binding.trace
  }) : undefined;
  const qualityRecordIds = new Set(evidenceQuality?.eligibleRecords?.map(record => record.id) || []);
  const verifiedClaims = verifyEvidenceClaims((issue.verifiedClaims || [])
    .filter(claim => qualityRecordIds.has(claim.recordId))
    .map(claim => ({ kind: 'RULE', text: claim.text, quote: claim.quote, recordId: claim.recordId,
      ...(claim.canonicalUrl ? { citationUrl: claim.canonicalUrl } : {}) })),
  isIras ? evidenceQuality.eligibleRecords : records, { missingFacts: [] });
  const candidateDiagnostics = records.map(record => {
    const eligibilityGateResult = findRecordEligibilityRejection(record, undefined, referenceDate);
    return {
      recordId: record.id,
      sourceStatus: record.sourceStatus,
      provenance: record.provenance,
      eligibilityGateResult,
      baseEligible: eligibilityGateResult === undefined
    };
  });
  const requestedConceptCoverage = isIras
    ? issue.lifecycle?.covered === true && (planned.mappedTopicIds || []).length > 0 &&
      (planned.mappedTopicIds || []).every(topicId => evidenceQuality.coveredTopicIds?.includes(topicId)) &&
      (evidenceQuality.uncoveredConcepts?.length || 0) === 0 && (evidenceQuality.uncoveredTopicIds?.length || 0) === 0
    : issue.lifecycle?.covered === true;
  const providerError = gathered.conflicts.length > 0 || (issue.gaps || []).some(gap =>
    /^(?:RETRIEVAL|PROVIDER|TRANSPORT)_.*(?:FAILED|ERROR)$/.test(gap.code));
  return {
    issueId: expectedIssueId,
    authority,
    operation: issue.operation,
    ruleEvidenceStatus: issue.evidenceStatus,
    providerError,
    lifecycle: issue.lifecycle || {},
    gaps: (issue.gaps || []).map(gap => gap.code),
    candidateCount: records.length,
    candidateInventoryKind: isIras
      ? 'observed_through_call_records_plus_actual_returned_sources'
      : 'actual_through_call_records_plus_actual_returned_sources',
    candidateCountBasis: 'distinct observed record IDs from through-call retriever groups scoped to actual mapped topics and actual returned issue sources',
    observedRecordIds: records.map(record => record.id).slice(0, MAX_DIAGNOSTIC_ITEMS),
    eligibleRecordIds: [...qualityRecordIds].slice(0, MAX_DIAGNOSTIC_ITEMS),
    candidateRecordProvenanceCounts: Object.fromEntries([...new Set(records.map(record => record.provenance))]
      .map(provenance => [provenance, records.filter(record => record.provenance === provenance).length])),
    transportBinding: isIras ? {
      path: binding.trace.path,
      complete: binding.complete,
      reasons: binding.reasons,
      liveSourceIds: binding.liveRecordIds,
      boundSourceIds: binding.boundRecordIds,
      observedAttempts: binding.trace.attempts
    } : undefined,
    actualReturnedSourceCount: (issue.sources || []).length,
    rejectedCount: isIras ? evidenceQuality.rejectedRecords?.length || 0
      : candidateDiagnostics.filter(candidate => !candidate.baseEligible).length,
    rejectedCandidates: candidateDiagnostics.filter(candidate => !candidate.baseEligible).map(candidate => ({
      ...candidate,
      eligibilityRejectionCode: candidate.eligibilityGateResult
    })).slice(0, MAX_DIAGNOSTIC_ITEMS),
    verifiedClaimCount: verifiedClaims.accepted.length,
    verifiedClaims: verifiedClaims.accepted.map(claim => ({ recordId: claim.recordId, quote: claim.quote })),
    requestedConceptCoverage,
    evidenceQuality,
    recordDiagnostics: records.slice(0, MAX_DIAGNOSTIC_ITEMS).map(record => ({
      ...sourceProjection(record),
      eligibilityGateResult: findRecordEligibilityRejection(record, undefined, referenceDate)
    })),
    recordConflicts: gathered.conflicts
  };
}

function evidenceQualityProjection(quality) {
  if (!quality) return undefined;
  return {
    status: quality.status,
    eligibleRecordIds: (quality.eligibleRecords || []).map(record => record.id).slice(0, MAX_DIAGNOSTIC_ITEMS),
    rejectedRecords: (quality.rejectedRecords || []).map(record => ({ recordId: record.recordId, code: record.code }))
      .slice(0, MAX_DIAGNOSTIC_ITEMS),
    coveredTopicIds: (quality.coveredTopicIds || []).slice(0, MAX_DIAGNOSTIC_ITEMS),
    uncoveredTopicIds: (quality.uncoveredTopicIds || []).slice(0, MAX_DIAGNOSTIC_ITEMS),
    requestedConcepts: (quality.requestedConcepts || []).slice(0, MAX_DIAGNOSTIC_ITEMS),
    coveredConcepts: (quality.coveredConcepts || []).slice(0, MAX_DIAGNOSTIC_ITEMS),
    uncoveredConcepts: (quality.uncoveredConcepts || []).slice(0, MAX_DIAGNOSTIC_ITEMS)
  };
}

function governedDiagnostic(result, candidateGroups, fetchObservations, observations) {
  const workstreams = (result?.workstreams || []).map(stream => ({
    authority: stream.authority,
    domain: stream.domain,
    issueCount: stream.issues?.length || 0,
    issues: (stream.issues || []).map(issue => issueProjection(issue)).slice(0, MAX_DIAGNOSTIC_ITEMS)
  }));
  return {
    available: Boolean(result),
    status: result?.status,
    evidenceStatus: result?.evidenceStatus,
    applicationStatus: result?.applicationStatus,
    workstreams,
    topLevelGaps: (result?.gaps || []).filter(gap => gap.issueId === 'issue-plan').map(gap => gap.code).slice(0, 32),
    candidateGroupCount: candidateGroups.length,
    candidateGroupRecordCount: candidateGroups.reduce((sum, group) => sum + group.records.length, 0),
    fetchValidationObservations: fetchObservations.slice(0, MAX_DIAGNOSTIC_ITEMS),
    governedIssueObservations: observations.map(item => ({
      ...item,
      evidenceQuality: evidenceQualityProjection(item.evidenceQuality)
    })).slice(0, MAX_DIAGNOSTIC_ITEMS)
  };
}

function semanticInterpretationProjection(interpretation) {
  if (!interpretation) return undefined;
  return {
    jurisdiction: interpretation.jurisdiction,
    authorityCandidates: interpretation.authorityCandidates,
    contextualAuthorities: interpretation.contextualAuthorities,
    domain: interpretation.domain,
    population: interpretation.population,
    primarySubject: interpretation.primarySubject,
    concepts: interpretation.concepts,
    requestedOperation: interpretation.requestedOperation,
    requiresUserSpecificFacts: interpretation.requiresUserSpecificFacts,
    calculationRequested: interpretation.calculationRequested,
    factsExplicitlyProvided: interpretation.factsExplicitlyProvided,
    confidence: interpretation.confidence,
    issues: interpretation.issues?.slice(0, 12)
  };
}

function issuePlanProjection(issuePlan) {
  return {
    source: issuePlan.source,
    coverageEstablished: issuePlan.coverageEstablished,
    hasUnmappedResidual: issuePlan.hasUnmappedResidual,
    routingOwnershipFailure: issuePlan.routingOwnershipFailure,
    issues: (issuePlan.issues || []).slice(0, 16).map(issue => ({
      id: issue.id,
      subject: issue.subject,
      population: issue.population,
      domain: issue.domain,
      governingAuthorities: issue.governingAuthorities,
      contextualAuthorities: issue.contextualAuthorities,
      operation: issue.operation,
      mappedTopicIds: issue.mappedTopicIds,
      contextualTopicIds: issue.contextualTopicIds,
      routingTopicIds: issue.routingTopicIds,
      unresolvedReason: issue.unresolvedReason,
      status: issue.status
    }))
  };
}

function actualNoCoverageObservation(issuePlan, runtime, groups) {
  const plannedIras = (issuePlan?.issues || []).filter(issue => issue.governingAuthorities?.includes('IRAS'));
  const plannedIrasTopics = [...new Set(plannedIras.flatMap(issue => issue.mappedTopicIds || []))];
  const irasStreams = (runtime?.workstreams || []).filter(stream => stream.authority === 'IRAS');
  const irasIssues = irasStreams.flatMap(stream => stream.issues || []);
  const observed = uniqueRecords(groups, irasIssues.flatMap(issue => issue.sources || []), plannedIrasTopics);
  const claimCount = irasIssues.reduce((sum, issue) => sum + (issue.verifiedClaims?.length || 0), 0);
  const actualNoCoverage = Boolean(runtime && typeof runtime.status === 'string' &&
    Array.isArray(runtime.workstreams) && irasStreams.length === 0 && plannedIras.length === 0 && plannedIrasTopics.length === 0 &&
    observed.records.length === 0 && claimCount === 0 &&
    observed.conflicts.length === 0 &&
    (issuePlan?.issues || []).some(issue => issue.unresolvedReason === 'NO_COVERAGE_TOPIC'));
  return [{
    source: 'actual_issue_plan_and_governed_runtime',
    coverageStatus: actualNoCoverage ? 'NO_COVERAGE_TOPIC' : 'COVERAGE_TOPIC_PRESENT',
    irAsWorkstreamCount: irasStreams.length,
    plannedIrasIssueCount: plannedIras.length,
    plannedIrasTopicIds: plannedIrasTopics,
    candidateCount: observed.records.length,
    claimCount,
    observedRecordIds: observed.records.map(record => record.id).slice(0, MAX_DIAGNOSTIC_ITEMS),
    recordConflicts: observed.conflicts
  }];
}

function boundResultSize(result) {
  if (Buffer.byteLength(JSON.stringify(result), 'utf8') <= MAX_RESULT_BYTES) return result;
  result.productionDiagnostics.governed = {
    ...result.productionDiagnostics.governed,
    diagnosticTruncated: true,
    fetchValidationObservations: result.productionDiagnostics.governed.fetchValidationObservations?.slice(0, 12),
    governedIssueObservations: result.productionDiagnostics.governed.governedIssueObservations?.map(item => ({
      issueId: item.issueId,
      authority: item.authority,
      operation: item.operation,
      ruleEvidenceStatus: item.ruleEvidenceStatus,
      lifecycle: item.lifecycle,
      gaps: item.gaps,
      candidateCount: item.candidateCount,
      observedRecordIds: item.observedRecordIds?.slice(0, 16),
      eligibleRecordIds: item.eligibleRecordIds?.slice(0, 16),
      transportBinding: item.transportBinding,
      actualReturnedSourceCount: item.actualReturnedSourceCount,
      verifiedClaimCount: item.verifiedClaimCount,
      verifiedClaims: item.verifiedClaims,
      requestedConceptCoverage: item.requestedConceptCoverage,
      recordDiagnostics: item.recordDiagnostics?.slice(0, 16),
      evidenceQuality: evidenceQualityProjection(item.evidenceQuality)
    }))
  };
  result.productionDiagnostics.local = {
    ...result.productionDiagnostics.local,
    diagnosticTruncated: true,
    topicObservations: result.productionDiagnostics.local.topicObservations?.slice(0, 16),
    issues: result.productionDiagnostics.local.issues?.slice(0, 16)
  };
  if (Buffer.byteLength(JSON.stringify(result), 'utf8') <= MAX_RESULT_BYTES) return result;
  // The score is already computed from the complete observations. If verbose
  // labels still exceed the cap, retain verdicts and claim quotations while
  // dropping secondary transport/source rows.
  result.productionDiagnostics.governed = {
    available: result.productionDiagnostics.governed.available,
    reason: result.productionDiagnostics.governed.reason,
    status: result.productionDiagnostics.governed.status,
    evidenceStatus: result.productionDiagnostics.governed.evidenceStatus,
    applicationStatus: result.productionDiagnostics.governed.applicationStatus,
    diagnosticTruncated: true,
    governedIssueObservations: result.productionDiagnostics.governed.governedIssueObservations?.map(item => ({
      issueId: item.issueId,
      authority: item.authority,
      ruleEvidenceStatus: item.ruleEvidenceStatus,
      lifecycle: item.lifecycle,
      candidateCount: item.candidateCount,
      verifiedClaimCount: item.verifiedClaimCount,
      verifiedClaims: item.verifiedClaims,
      requestedConceptCoverage: item.requestedConceptCoverage
    }))
  };
  if (Buffer.byteLength(JSON.stringify(result), 'utf8') > MAX_RESULT_BYTES) {
    result.productionDiagnostics.governed.governedIssueObservations = [];
    result.productionDiagnostics.resultSizeBoundFallback = true;
  }
  return result;
}

/** Run exactly one fixed V4 case through actual production interpretation and evidence paths. */
export async function runV4AcceptanceCase({
  caseId,
  sendSemantic,
  evidenceTransport,
  withEvidenceFamily,
  webRetriever,
  referenceDate
} = {}) {
  if (!CASE_IDS.includes(caseId)) throw new Error('V4_CASE_ID_NOT_IN_FIXED_CONTRACT');
  const contract = await readV4Contract();
  const caseContract = contract.cases.find(row => row.caseId === caseId);
  if (!caseContract) throw new Error('V4_CASE_CONTRACT_ROW_MISSING');

  let semanticSends = 0;
  let rawSemanticResponse;
  let semanticTransportError;
  const semanticUnderstanding = await interpretSemanticQuestion(caseContract.question, PROVIDER_CONFIGURATION,
    async (prompt, system, _configuredProvider, options) => {
      semanticSends += 1;
      if (semanticSends !== 1) throw new Error('V4_EXTRA_SEMANTIC_CALL_BLOCKED');
      if (typeof sendSemantic !== 'function') throw new Error('V4_SEMANTIC_TRANSPORT_MISSING');
      try {
        rawSemanticResponse = await sendSemantic({
          caseId,
          prompt,
          system,
          provider: PROVIDER,
          options: {
            jsonMode: options.jsonMode,
            responseJsonSchema: options.responseJsonSchema,
            timeoutMs: options.timeoutMs,
            temperature: options.temperature
          }
        });
        return rawSemanticResponse;
      } catch (error) {
        semanticTransportError = safeErrorCode(error);
        throw error;
      }
    });
  const semanticUnderstandingProjection = {
    mode: semanticUnderstanding.mode,
    failure: semanticUnderstanding.failure,
    failureReason: semanticUnderstanding.failureReason,
    providerStatus: semanticUnderstanding.providerStatus,
    sendCount: semanticSends,
    transportError: semanticTransportError,
    response: rawSemanticResponse === undefined ? undefined : (() => {
      const parsed = parseSemanticResponseSafelyV4(rawSemanticResponse, caseContract.question);
      return {
        parsed: parsed.parsed,
        valid: parsed.valid,
        responseSha256: parsed.responseSha256,
        responseBytes: Buffer.byteLength(String(rawSemanticResponse), 'utf8'),
        error: parsed.error
      };
    })()
  };
  const interpretation = semanticUnderstanding.interpretation;
  const classification = classifyQuestion(caseContract.question);
  const reconciled = reconcileQuestionUnderstanding(caseContract.question, classification, semanticUnderstanding);
  const issuePlan = reconciled.issuePlan;
  const semantic = scoreSemanticV4(caseContract, interpretation, issuePlan);
  const caseForScoring = { ...caseContract, _semanticVerdict: semantic, _understanding: semanticUnderstanding };
  const referenceDateValid = isIsoDate(referenceDate);
  const diagnostics = {
    local: { available: false, reason: referenceDateValid ? 'RUNTIME_NOT_RUN' : 'REFERENCE_DATE_MISSING_OR_INVALID' },
    governed: { available: false, reason: referenceDateValid ? 'CONTROLLED_EVIDENCE_TRANSPORT_MISSING' : 'REFERENCE_DATE_MISSING_OR_INVALID' }
  };
  let localRuntime;
  let localGroups = [];
  let localScore = classifyLocalCapabilityV4(caseContract, []);
  if (referenceDateValid) {
    localGroups = [];
    try {
      localRuntime = await buildAuthorityWorkstreams(caseContract.question, issuePlan, {
        retriever: createObservedRetriever(localGroups),
        questionUnderstanding: semanticUnderstanding,
        localOnly: true,
        referenceDate,
        groundingOptions: { localOnly: true, referenceDate }
      });
      const localResult = localOnlyObservations(caseForScoring, caseContract.question, interpretation,
        issuePlan, localRuntime, localGroups, referenceDate);
      localScore = localResult.score;
      diagnostics.local = {
        available: true,
        runtimeStatus: localRuntime.status,
        evidenceStatus: localRuntime.evidenceStatus,
        applicationStatus: localRuntime.applicationStatus,
        referenceDate,
        candidateGroupCount: localGroups.length,
        candidateGroupRecordCount: localGroups.reduce((sum, group) => sum + group.records.length, 0),
        topicObservations: Object.entries(localResult.topicStates).map(([topicId, row]) => ({ topicId, ...row })),
        issues: localRuntime.workstreams.flatMap(stream => stream.issues || []).map(issueProjection)
      };
    } catch (error) {
      diagnostics.local = { available: false, reason: safeErrorCode(error), referenceDate };
      localScore = classifyLocalCapabilityV4(caseContract, []);
    }
  }

  let governedRuntime;
  let governedGroups = [];
  let fetchObservations = [];
  let governedObservations = [];
  const controlledInputsPresent = referenceDateValid && typeof evidenceTransport === 'function' &&
    typeof withEvidenceFamily === 'function' && typeof webRetriever?.fetchOfficialSource === 'function';
  if (controlledInputsPresent) {
    const observedWebRetriever = createFetchObservationFacade(webRetriever, fetchObservations);
    try {
      const discoveryAdapter = new OfficialSitemapDiscoveryAdapter(observedWebRetriever, {
        customFetch: evidenceTransport,
        timeoutMs: 3_000
      });
      const disabledOfficialSearch = {
        async searchOfficialDomainCandidates() { return []; },
        getLastSearchTrace() { return []; }
      };
      governedRuntime = await buildAuthorityWorkstreams(caseContract.question, issuePlan, {
        retriever: createObservedRetriever(governedGroups),
        questionUnderstanding: semanticUnderstanding,
        localOnly: false,
        referenceDate,
        groundingOptions: {
          localOnly: false,
          referenceDate,
          webRetriever: observedWebRetriever,
          discoveryAdapter,
          officialDomainSearchAdapter: disabledOfficialSearch,
          fetchOptions: { customFetch: evidenceTransport, useCache: false, timeoutMs: 3_000 }
        }
      });
    } catch (error) {
      diagnostics.governed = { available: false, reason: safeErrorCode(error), referenceDate };
    }
  }

  const routing = scoreWorkstreamRoutingV4(caseContract, issuePlan, governedRuntime);
  const byIssue = {};
  for (const issueId of Object.keys(caseContract.application.expectedByIssue || {})) {
    const resolved = resolveObservedIssue(caseContract, semantic, interpretation, issuePlan, governedRuntime, issueId);
    if (resolved) byIssue[issueId] = resolved.issue.applicationStatus;
  }
  const application = scoreApplicationStatusV4(caseContract, {
    byIssue,
    overallStatus: governedRuntime?.status
  });

  let governed;
  if (caseContract.governedProductionEvidence.required) {
    for (const issueId of Object.keys(caseContract.governedProductionEvidence.expectedRuleEvidenceByIssue || {})) {
      const resolved = resolveObservedIssue(caseContract, semantic, interpretation, issuePlan, governedRuntime, issueId);
      const observation = evidenceObservation(caseForScoring, issueId, resolved, governedGroups, fetchObservations, referenceDate);
      if (observation) governedObservations.push(observation);
    }
  } else {
    governedObservations = actualNoCoverageObservation(issuePlan, governedRuntime, governedGroups);
  }
  governed = scoreGovernedEvidenceV4(caseContract, governedObservations);
  if (!caseContract.governedProductionEvidence.required &&
      (!controlledInputsPresent || !governedRuntime || governedObservations[0]?.recordConflicts?.length > 0)) {
    governed = {
      ...governed,
      stages: {
        GOVERNED_RETRIEVAL: false,
        EVIDENCE_ADMISSION: false,
        CLAIM_VERIFICATION: false,
        REQUESTED_CONCEPT_COVERAGE: false
      },
      expectedNoCoverageTopic: false,
      expectedNoClaims: false,
      observationFailure: !referenceDateValid ? 'REFERENCE_DATE_MISSING_OR_INVALID'
        : !controlledInputsPresent ? 'CONTROLLED_EVIDENCE_TRANSPORT_MISSING'
          : !governedRuntime ? 'GOVERNED_RUNTIME_MISSING' : 'OBSERVED_RECORD_CONFLICT'
    };
  }
  if (governedRuntime) {
    diagnostics.governed = governedDiagnostic(governedRuntime, governedGroups, fetchObservations, governedObservations);
  } else if (controlledInputsPresent) {
    diagnostics.governed = { ...diagnostics.governed, candidateGroupCount: governedGroups.length,
      fetchValidationObservations: fetchObservations.slice(0, MAX_DIAGNOSTIC_ITEMS) };
  }

  const stageResult = evaluateV4Stages({ semantic, routing, local: localScore, governed, application });
  return boundResultSize({
    caseId,
    interpretation: semanticInterpretationProjection(interpretation),
    issuePlan: issuePlanProjection(issuePlan),
    semanticUnderstanding: semanticUnderstandingProjection,
    layerVerdicts: { semantic, routing, local: localScore, governed, application },
    stageVerdicts: stageResult.stages,
    firstFailure: stageResult.earliestFailure,
    productionDiagnostics: diagnostics
  });
}
