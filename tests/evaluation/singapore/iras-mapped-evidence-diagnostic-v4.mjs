import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, open, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { classifyQuestion } from '../../../src/classification/questionClassifier.ts';
import { evaluateEvidenceQuality } from '../../../src/retrieval/evidenceQualityGate.ts';
import { ControlledWebRetriever } from '../../../src/retrieval/controlledWebRetriever.ts';
import { SourceCache } from '../../../src/retrieval/sourceCache.ts';
import { defaultAdvancedSourceRetriever } from '../../../src/retrieval/advancedSourceRetriever.ts';
import { IRAS_SOURCE_MAP_DEFINITIONS, getCoverageTopicsByIds } from '../../../src/standards/coverageRegistry.ts';
import { buildAuthorityWorkstreams, planAuthorityWorkstreams } from '../../../src/services/authorityWorkstreams.ts';
import { buildGroundedReasoningContext, resolveMappedOfficialSourceFallback } from '../../../src/services/groundingContextBuilder.ts';
import { renderIrasEvidenceResponse } from '../../../src/services/irasEvidencePolicy.ts';
import { getRequestedQuestionConcepts, reconcileQuestionUnderstanding, validateSemanticQuestionInterpretation } from '../../../src/services/semanticQuestionUnderstanding.ts';
import {
  REPOSITORY_ROOT,
  assertProtectedArtifactsUnchanged,
  createMappedOnlyTransport,
  fingerprintProtectedArtifacts
} from './iras-mapped-source-diagnostic-v3.mjs';
import { irasResolverCases } from '../../fixtures/irasResolverCases.mjs';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(scriptDirectory, '../../..');
assert.equal(ROOT, REPOSITORY_ROOT);

export const V4_OUTPUT_DIRECTORY = path.join(ROOT,
  'docs/evaluation/multi-authority-workstreams/iras-first-live-2026-10-02-v4');
export const V4_PLAN_FILENAME = 'iras-mapped-evidence-plan-v4.json';
export const V4_REPORT_FILENAME = 'iras-mapped-evidence-diagnostic-v4.json';
export const V4_CONSUMED_FILENAME = 'iras-mapped-evidence-live-v4-consumed.json';
export const V4_SELECTED_CASE_IDS = Object.freeze([
  'private-holiday-expense',
  'foreign-dividend-treatment',
  'company-residency-general',
  'wht-royalty-general-rule',
  'gst-input-tax-general-rule'
]);

const REFERENCE_DATE = '2026-10-02';
const FETCH_TIMEOUT_MS = 10_000;
const ALLOWED_IRAS_HOSTS = new Set(['www.iras.gov.sg', 'iras.gov.sg']);
const RESERVED_REASON_CODES = new Set([
  'APPLICATION_REQUIRES_FACTS_AND_DETERMINISTIC_ENGINE', 'APPLICATION_REQUIRES_DETERMINISTIC_ENGINE',
  'CLAIM_KIND_NOT_ALLOWED', 'CLAIM_FIELDS_MISSING', 'ELLIPSIS_NOT_ALLOWED', 'CLAIM_TEXT_MUST_EQUAL_QUOTE',
  'SOURCE_RECORD_NOT_FOUND', 'SOURCE_RECORD_ID_AMBIGUOUS', 'APPLICATION_SOURCE_NOT_ALLOWED',
  'SOURCE_RECORD_NOT_GROUNDING_ELIGIBLE', 'LOCAL_SOURCE_NOT_VERIFIED', 'LOCAL_SOURCE_NOT_ACTIVE',
  'LOCAL_SOURCE_REVIEW_PROVENANCE_MISSING', 'LOCAL_SOURCE_REVIEW_AUDIT_OVERDUE', 'LIVE_SOURCE_CANDIDATE_INCOMPLETE',
  'LIVE_HISTORICAL_PAGE_SCOPE_UNVERIFIED', 'SOURCE_PROVENANCE_NOT_ALLOWED', 'SOURCE_TEXT_MISSING',
  'SOURCE_URL_NOT_APPROVED_OR_CANONICAL', 'SOURCE_DATE_BOUNDS_INVALID', 'HISTORICAL_TARGET_DATE_REQUIRED',
  'HISTORICAL_DATE_BOUNDS_REQUIRED', 'SOURCE_NOT_IN_EFFECT_ON_TARGET_DATE', 'TARGET_DATE_UNBOUNDED',
  'CITATION_URL_MISMATCH', 'CITATION_URL_UNVERIFIED', 'QUOTE_OMITS_ATTACHED_QUALIFICATION',
  'QUOTE_NOT_WHOLE_SENTENCE_OR_PARAGRAPH', 'CLAIMS_NOT_ARRAY', 'CLAIM_NOT_OBJECT',
  'GOVERNMENT_EMPLOYMENT_SCOPE_NOT_ESTABLISHED'
]);
const ALLOWED_GAP_CODES = new Set([
  'NO_GOVERNING_AUTHORITY', 'EMPTY_ISSUE_PLAN', 'ISSUE_PLAN_HAS_UNMAPPED_RESIDUAL',
  'ISSUE_PLAN_COVERAGE_UNESTABLISHED', 'UNASSIGNED_QUERY_TOPIC', 'UNROUTED_MATERIAL_CONCEPT',
  'CANONICAL_AREA_UNRESOLVED', 'ISSUE_UNMAPPED', 'PROVIDER_UNAVAILABLE', 'PROVIDER_AUTHORITY_MISMATCH',
  'PROVIDER_ERROR', 'NO_CANDIDATE_EVIDENCE', 'CANDIDATE_REJECTED', 'NO_ADMITTED_EVIDENCE',
  'IRAS_SCOPE_NOT_COVERED', 'NO_VERIFIED_CLAIM', 'ISSUE_CONCEPT_UNCOVERED'
]);
const ALLOWED_ATTEMPT_STATUSES = new Set([
  'SUCCESS', 'TOPIC_MISMATCH', 'DOMAIN_MISMATCH', 'POPULATION_MISMATCH', 'HISTORICAL_SCOPE_UNVERIFIED',
  'UNAUTHORIZED_DOMAIN_ACCESS', 'NO_CANDIDATES', 'NETWORK_ERROR', 'TIMEOUT', 'INVALID_URL',
  'CONTENT_TYPE_REJECTED', 'HTTP_ERROR', 'REDIRECT_REJECTED', 'TRANSPORT_ERROR',
  'AUTOMATIC_REDIRECT_REJECTED'
]);

// These fixed hashes protect all V3 output artifacts and the source/configuration
// baseline that this prospective measurement is designed to compare with.
const PINNED_HISTORICAL_HASHES = Object.freeze({
  'docs/evaluation/multi-authority-workstreams/iras-first-live-2026-10-02-v3/iras-mapped-source-diagnostic-v3.json': '09c99fb5023807d186661d203a04e463f0f5a0dd14ef2ecda1a16f3fc624f075',
  'docs/evaluation/multi-authority-workstreams/iras-first-live-2026-10-02-v3/iras-mapped-source-plan-v3.json': 'a78c70a5805361dfc645230537fb01c66b1303451c37a7ee533c6307315011fe',
  'docs/evaluation/multi-authority-workstreams/iras-first-live-2026-10-02-v3/measurement-source-fingerprints-v3.json': '360638d0ea3b7cbdcc76202c6b8f9ad22835670ca8f58a56e10d1569b6208316',
  'docs/evaluation/multi-authority-workstreams/iras-first-live-2026-10-02-v3/supervisor-final-report.md': '60c23a22906bdc96853e8de53708200d883e8df8ca5d62dbc4466cdbc80becf8',
  'tests/evaluation/singapore/iras-mapped-source-diagnostic-v3.mjs': '7856e454cfca de1a1440a5618efa4943e1dbce3ddd954e50c84b7a8bcafa1fb2'.replaceAll(' ', ''),
  'tests/fixtures/irasResolverCases.mjs': '3f7b1d8f4e7af1bda05bb017b589b71fec8a65f95fbfde67350876d5af32e2f6',
  'docs/evaluation/multi-authority-workstreams/iras-first-local-2026-10-02-v4/synthetic-stage-trace-baseline-v3.json': '4175cecb9712eaf64eaf25fca57db596f8da13c72dafb4f04b40a6601d99f9fe'
});

const SOURCE_FINGERPRINT_PATHS = Object.freeze([
  'tests/evaluation/singapore/iras-mapped-evidence-diagnostic-v4.mjs',
  'tests/evaluation/singapore/iras-mapped-source-diagnostic-v3.mjs',
  'tests/fixtures/irasResolverCases.mjs',
  'src/classification/questionClassifier.ts',
  'src/standards/coverageRegistry.ts',
  'src/standards/approvedSourceRegistry.ts',
  'src/services/semanticQuestionUnderstanding.ts',
  'src/services/authorityWorkstreams.ts',
  'src/services/groundingContextBuilder.ts',
  'src/services/irasEvidencePolicy.ts',
  'src/retrieval/evidenceQualityGate.ts',
  'src/retrieval/advancedSourceRetriever.ts',
  'src/retrieval/controlledWebRetriever.ts',
  'src/retrieval/sourceCache.ts',
  'src/retrieval/externalSourceValidator.ts',
  'src/verification/claimEvidenceVerifier.ts'
]);

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function repositoryPath(relativePath) {
  const absolute = path.resolve(ROOT, ...relativePath.split(/[\\/]/));
  const relative = path.relative(ROOT, absolute);
  assert.ok(relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative),
    'Diagnostic artifact path must remain inside the repository');
  return absolute;
}

function outputPath(directory, filename) {
  const resolvedDirectory = path.resolve(directory);
  const relativeDirectory = path.relative(V4_OUTPUT_DIRECTORY, resolvedDirectory);
  assert.ok(relativeDirectory === '' || (relativeDirectory !== '..' &&
    !relativeDirectory.startsWith(`..${path.sep}`) && !path.isAbsolute(relativeDirectory)),
    'V4 diagnostic outputs must stay inside the V4 output directory');
  return path.join(resolvedDirectory, filename);
}

function canonicalJson(value) {
  const sort = item => {
    if (Array.isArray(item)) return item.map(sort);
    if (!item || typeof item !== 'object') return item;
    return Object.fromEntries(Object.keys(item).sort().map(key => [key, sort(item[key])]));
  };
  return JSON.stringify(sort(value));
}

async function sourceFingerprints() {
  const entries = await Promise.all(SOURCE_FINGERPRINT_PATHS.map(async relativePath => ({
    path: relativePath,
    sha256: sha256(await readFile(repositoryPath(relativePath)))
  })));
  return entries.sort((left, right) => left.path.localeCompare(right.path));
}

export async function assertPinnedHistoricalArtifactsUnchanged() {
  for (const [relativePath, expected] of Object.entries(PINNED_HISTORICAL_HASHES)) {
    assert.equal(sha256(await readFile(repositoryPath(relativePath))), expected,
      `Pinned V3 or local baseline artifact changed: ${relativePath}`);
  }
  return Object.entries(PINNED_HISTORICAL_HASHES).sort(([a], [b]) => a.localeCompare(b))
    .map(([artifactPath, hash]) => ({ path: artifactPath, sha256: hash }));
}

function syntheticInterpretation(testCase) {
  const singleIssue = testCase.issues.length === 1;
  const firstIssue = testCase.issues[0];
  const subjects = testCase.issues.map(issue => issue.subject);
  return {
    schemaVersion: 2,
    jurisdiction: ['Singapore'],
    authorityCandidates: singleIssue ? [firstIssue.authority] : ['UNKNOWN'],
    contextualAuthorities: [],
    domain: singleIssue ? firstIssue.domain : 'UNKNOWN',
    population: singleIssue ? firstIssue.population : 'UNKNOWN',
    primarySubject: subjects.join('; '),
    concepts: subjects.map((concept, index) => ({ concept, role: index === 0 ? 'PRIMARY' : 'RELATED' })),
    requestedOperation: singleIssue ? firstIssue.operation : 'OTHER',
    factsExplicitlyProvided: [],
    confidence: 0.96,
    issues: testCase.issues.map(issue => ({
      subject: issue.subject,
      population: issue.population,
      domain: issue.domain,
      governingAuthorities: [issue.authority],
      contextualAuthorities: [],
      operation: issue.operation,
      mappedTopicIds: [],
      evidenceRequirement: issue.facts ? 'AUTHORITATIVE_SOURCE_AND_CASE_FACTS' : 'AUTHORITATIVE_SOURCE',
      confidence: 0.96
    }))
  };
}

function casePlansWithMaps() {
  const mapsByTopic = new Map();
  const mapsById = new Map(IRAS_SOURCE_MAP_DEFINITIONS.map(item => [item.id, item]));
  for (const definition of IRAS_SOURCE_MAP_DEFINITIONS) {
    for (const topicId of definition.topicIds) {
      const current = mapsByTopic.get(topicId) || [];
      current.push(definition);
      mapsByTopic.set(topicId, current);
    }
  }
  const fixtureById = new Map(irasResolverCases.map(testCase => [testCase.id, testCase]));
  const cases = V4_SELECTED_CASE_IDS.map(caseId => {
    const testCase = fixtureById.get(caseId);
    assert.ok(testCase, `Fixed V4 fixture is missing: ${caseId}`);
    assert.equal(testCase.issues.length, 1, `${caseId}: the frozen synthetic contract must contain one issue`);
    const interpretation = syntheticInterpretation(testCase);
    assert.ok(validateSemanticQuestionInterpretation(interpretation, testCase.query),
      `${caseId}: fixed fixture-derived interpretation must validate`);
    const understanding = { mode: 'SEMANTIC_INTERPRETATION', interpretation };
    const classification = classifyQuestion(testCase.query);
    const reconciled = reconcileQuestionUnderstanding(testCase.query, classification, understanding);
    assert.equal(reconciled.issuePlan.source, 'SEMANTIC_ISSUES', `${caseId}: semantic issue contract must be used`);
    const plannedWorkstreams = planAuthorityWorkstreams(reconciled.issuePlan);
    const workstreamByIssueId = new Map(plannedWorkstreams.flatMap(workstream => workstream.authority === 'IRAS'
      ? workstream.issueIds.map(issueId => [issueId, workstream]) : []));
    const issuePlans = [];
    for (const [issueIndex, issue] of reconciled.issuePlan.issues.entries()) {
      if (!issue.governingAuthorities.includes('IRAS') || issue.unresolvedReason === 'UNASSIGNED_QUERY_TOPIC') continue;
      const plannedWorkstream = workstreamByIssueId.get(issue.id);
      if (!plannedWorkstream) continue;
      const topics = getCoverageTopicsByIds(issue.mappedTopicIds).filter(topic =>
        topic.domainId.startsWith('IRAS_') && !topic.routingOnly);
      const topicIds = [...new Set(topics.map(topic => topic.id))].sort();
      const definitionsById = new Map();
      for (const topicId of topicIds) {
        const topic = topics.find(candidate => candidate.id === topicId);
        for (const definition of mapsByTopic.get(topicId) || []) {
          if (definition.domainId === topic?.domainId) definitionsById.set(definition.id, mapsById.get(definition.id));
        }
      }
      const definitions = [...definitionsById.values()].filter(Boolean);
      const requestedConcepts = getRequestedQuestionConcepts(testCase.query, understanding)
        .filter(concept => concept.topicIds.some(topicId => topicIds.includes(topicId)));
      const sourceDomain = topics[0]?.domainId;
      const evidenceScope = sourceDomain ? {
        authority: 'IRAS',
        domain: plannedWorkstream.domain,
        topicIds,
        requestedConcepts,
        context: {
          domainId: sourceDomain,
          population: issue.population,
          primarySubject: issue.subject,
          concepts: [issue.subject],
          requestedOperation: issue.operation
        }
      } : undefined;
      assert.ok(evidenceScope && topicIds.length > 0 && definitions.length > 0,
        `${caseId}: each fixed issue must resolve to a mapped IRAS evidence scope`);
      issuePlans.push({ issueIndex, issue, plan: plannedWorkstream, topicIds, requestedConcepts, definitions, evidenceScope });
    }
    assert.equal(issuePlans.length, 1, `${caseId}: expected one resolved IRAS issue`);
    return { caseId, fixtureCaseId: testCase.id, testCase, understanding, reconciled, issuePlans };
  });

  const pagesByUrl = new Map();
  for (const casePlan of cases) {
    for (const issuePlan of casePlan.issuePlans) {
      for (const definition of issuePlan.definitions) {
        const page = pagesByUrl.get(definition.canonicalSourceUrl) || {
          canonicalUrl: definition.canonicalSourceUrl, mapIds: new Set(), topicIds: new Set()
        };
        page.mapIds.add(definition.id);
        for (const topicId of definition.topicIds) if (issuePlan.topicIds.includes(topicId)) page.topicIds.add(topicId);
        pagesByUrl.set(definition.canonicalSourceUrl, page);
      }
    }
  }
  const preregisteredPages = [...pagesByUrl.values()].map(page => {
    const parsed = new URL(page.canonicalUrl);
    assert.equal(parsed.protocol, 'https:');
    assert.ok(ALLOWED_IRAS_HOSTS.has(parsed.hostname.toLowerCase()));
    assert.equal(parsed.username, '');
    assert.equal(parsed.password, '');
    assert.equal(parsed.search, '');
    assert.equal(parsed.hash, '');
    return {
      canonicalUrl: parsed.toString(),
      host: parsed.hostname.toLowerCase(),
      mapIds: [...page.mapIds].sort(),
      topicIds: [...page.topicIds].sort()
    };
  }).sort((left, right) => left.canonicalUrl.localeCompare(right.canonicalUrl));
  assert.ok(preregisteredPages.length > 0);
  return { cases, preregisteredPages };
}

async function buildPreregistration({ readFingerprints = sourceFingerprints } = {}) {
  const historicV1V2 = await fingerprintProtectedArtifacts();
  const pinnedHistorical = await assertPinnedHistoricalArtifactsUnchanged();
  const { cases, preregisteredPages } = casePlansWithMaps();
  const files = await readFingerprints();
  return {
    schemaVersion: 1,
    profileVersion: 'iras-mapped-evidence-diagnostic-v4',
    referenceDate: REFERENCE_DATE,
    selection: {
      caseIds: [...V4_SELECTED_CASE_IDS],
      issueCount: cases.reduce((sum, item) => sum + item.issuePlans.length, 0),
      cases: cases.map(item => ({
        caseId: item.caseId,
        fixtureCaseId: item.fixtureCaseId,
        issues: item.issuePlans.map(issue => ({ issueIndex: issue.issueIndex, topicIds: issue.topicIds,
          mapIds: issue.definitions.map(definition => definition.id).sort() }))
      }))
    },
    sourceMaps: preregisteredPages,
    bounds: {
      modelRequests: 0,
      discoveryRequests: 0,
      searchRequests: 0,
      fetchTimeoutMs: FETCH_TIMEOUT_MS,
      allowedRedirectsPerUrl: 1,
      redirectPolicy: 'SAME_PATH_IRAS_PEER_HOST_ONLY',
      retries: 0,
      maximumActualGets: 2 * preregisteredPages.length,
      transportCache: 'ONE_SHARED_CACHE_ACROSS_DIRECT_PROBE_RENDER_AND_RUNTIME'
    },
    sourceFingerprints: files,
    historicalFingerprints: { v1v2: historicV1V2, pinnedV3AndBaseline: pinnedHistorical }
  };
}

function hashPreregistration(preregistration) {
  return sha256(canonicalJson(preregistration));
}

function safeError(error) {
  if (error?.code === 'EEXIST') return 'OUTPUT_OR_RUN_ALREADY_EXISTS';
  if (error?.code === 'ENOENT') return 'REQUIRED_PREREGISTRATION_MISSING';
  if (error?.code === 'RUN_CONSUMED') return 'LIVE_RUN_ALREADY_CONSUMED';
  if (error?.code === 'PREREGISTRATION_MISMATCH') return 'PREREGISTRATION_MISMATCH';
  if (error?.code === 'HISTORICAL_INTEGRITY_FAILURE') return 'HISTORICAL_INTEGRITY_FAILURE';
  return 'DIAGNOSTIC_RUN_FAILED';
}

async function assertFreshPath(filePath) {
  try {
    await stat(filePath);
    throw Object.assign(new Error('Output already exists'), { code: 'EEXIST' });
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

async function writeJsonExclusive(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const handle = await open(filePath, 'wx');
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
  } finally {
    await handle.close();
  }
}

export async function writeV4Plan({ outputDirectory = V4_OUTPUT_DIRECTORY } = {}) {
  const planPath = outputPath(outputDirectory, V4_PLAN_FILENAME);
  await assertFreshPath(planPath);
  const preregistration = await buildPreregistration();
  const envelope = { preregistration, preregistrationSha256: hashPreregistration(preregistration) };
  await writeJsonExclusive(planPath, envelope);
  return envelope;
}

function normalizeAttemptStatus(value) {
  if (ALLOWED_ATTEMPT_STATUSES.has(value)) return value;
  if (/^HTTP_\d{3}$/.test(value || '')) return 'HTTP_STATUS';
  if (/^REDIRECT_\d{3}$/.test(value || '')) return 'REDIRECT_STATUS';
  return 'OTHER_STATUS';
}

function canonicalizeUrl(value) {
  try {
    const url = new URL(value);
    if (url.hostname.toLowerCase() === 'iras.gov.sg') url.hostname = 'www.iras.gov.sg';
    return url.toString();
  } catch {
    return '';
  }
}

function mapsToRecord(record, mapDefinition, topicId) {
  return canonicalizeUrl(record.canonicalSourceUrl || record.officialSourceUrl || '') === mapDefinition.canonicalSourceUrl &&
    (record.tags?.includes(topicId) || record.sourceMapTopicIds?.includes(topicId) ||
      record.relatedTopicIds?.includes(topicId) || record.retrievalHints?.includes(topicId));
}

function fixedConceptFlags(text) {
  return {
    company: /\b(?:company|companies|corporate|corporation|business)\b/i.test(text),
    tax: /\b(?:tax|taxation|taxable|deduct\w*)\b/i.test(text),
    residency: /\b(?:residen\w*|resident)\b/i.test(text),
    dividend: /\bdividend\w*\b/i.test(text),
    inputTax: /\b(?:input[ -]tax|goods and services tax|\bgst\b)/i.test(text)
  };
}

function combineConceptFlags(records) {
  const flags = records.map(record => fixedConceptFlags(record.sourceText || ''));
  return Object.fromEntries(['company', 'tax', 'residency', 'dividend', 'inputTax'].map(key =>
    [key, flags.some(value => value[key])]));
}

function sourceBlockSummary(sourceText) {
  const blocks = sourceText.split(/\r?\n[\t ]*\r?\n+/).map(value => value.trim()).filter(Boolean);
  const colonIndex = blocks.findIndex(value => /:\s*$/.test(value));
  const listMarker = value => /^(?:\|\s*)*[•◦▪](?:\s|$)/.test(value || '');
  const navigation = value => /^(?:on this page|share)\s*:?$/i.test(value.trim());
  const prose = value => !navigation(value) && !listMarker(value) && !/^\d+[.)]\s/.test(value) && /[.!?]["')\]]?$/.test(value);
  const endBefore = colonIndex < 0 ? blocks.length : colonIndex;
  const afterStart = colonIndex < 0 ? blocks.length : colonIndex + 1;
  const nextHasList = colonIndex >= 0 && listMarker(blocks[colonIndex + 1]);
  return {
    sourceBlockCount: blocks.length,
    firstColonEndedBlockIndex: colonIndex < 0 ? null : colonIndex,
    nextBlockHasVisibleListMarker: nextHasList,
    completeProseBlockCountBeforeFirstColon: blocks.slice(0, endBefore).filter(prose).length,
    completeProseBlockCountAfterFirstColon: blocks.slice(afterStart).filter(prose).length,
    knownNavigationBlockCountBeforeFirstColon: blocks.slice(0, endBefore).filter(navigation).length,
    firstColonBlockWouldStopSelectionByShape: colonIndex >= 0 && !navigation(blocks[colonIndex]) && !nextHasList
  };
}

function safeSourceRecordProjection(record, mapId) {
  return {
    mapId,
    conceptFlags: fixedConceptFlags(record.sourceText || ''),
    sourceBlocks: sourceBlockSummary(record.sourceText || '')
  };
}

function projectDirectProbe(casePlan, issuePlan, fallback, assessment) {
  const topicRows = issuePlan.topicIds.map(topicId => {
    const maps = issuePlan.definitions.filter(definition => definition.topicIds.includes(topicId));
    return {
      topicId,
      maps: maps.map(definition => {
        const attempts = (fallback.trace?.attempts || []).filter(attempt =>
          attempt.topicId === topicId && attempt.sourceMapId === definition.id);
        const mappedFetchSucceeded = attempts.some(attempt => attempt.fetchStatus === 'SUCCESS' &&
          canonicalizeUrl(attempt.finalUrl || attempt.candidateUrl || '') === definition.canonicalSourceUrl);
        const candidates = mappedFetchSucceeded ? fallback.records.filter(record => mapsToRecord(record, definition, topicId)) : [];
        const admitted = mappedFetchSucceeded ? assessment.eligibleRecords.filter(record => mapsToRecord(record, definition, topicId)) : [];
        const recordRows = candidates.map(record => safeSourceRecordProjection(record, definition.id));
        return {
          mapId: definition.id,
          attemptStatuses: attempts.map(attempt => normalizeAttemptStatus(attempt.fetchStatus)),
          candidateCount: candidates.length,
          admittedCount: admitted.length,
          candidateConceptFlags: combineConceptFlags(candidates),
          admittedConceptFlags: combineConceptFlags(admitted),
          sourceBlockSummaries: recordRows
        };
      })
    };
  });
  return {
    caseId: casePlan.caseId,
    issueIndex: issuePlan.issueIndex,
    topicRows,
    candidateCount: fallback.records.length,
    admittedCount: assessment.eligibleRecords.length,
    uncoveredTopicCount: assessment.uncoveredTopicIds.length
  };
}

function mapReasonCode(value) {
  return RESERVED_REASON_CODES.has(value) ? value : 'OTHER_REJECTION';
}

function safeReasonCounts(rejected) {
  const counts = {};
  for (const item of rejected || []) {
    const code = mapReasonCode(item.reason);
    counts[code] = (counts[code] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

function safeGapCodes(gaps) {
  return [...new Set((gaps || []).map(gap => ALLOWED_GAP_CODES.has(gap.code) ? gap.code : 'OTHER_GAP'))].sort();
}

function safeRenderProjection(casePlan, issuePlan, context, rendered, directProbe) {
  const accepted = rendered.claimVerification?.accepted || [];
  const rejected = rendered.claimVerification?.rejected || [];
  return {
    caseId: casePlan.caseId,
    issueIndex: issuePlan.issueIndex,
    acceptedClaimCount: accepted.length,
    rejectedClaimCount: rejected.length,
    rejectedReasonCounts: safeReasonCounts(rejected),
    answerPath: ['VALIDATED_LOCAL', 'VERIFIED_PROVIDER_QUOTES', 'BLOCKED', 'PROVIDER_FAILURE', 'PROVIDER_NO_CLAIMS', 'PROVIDER_CLAIMS_REJECTED'].includes(rendered.answerPath)
      ? rendered.answerPath : 'OTHER_PATH',
    uncoveredTopicIds: [...(context.evidenceQuality?.uncoveredTopicIds || [])].filter(topicId => issuePlan.topicIds.includes(topicId)).sort(),
    directProbeCandidateConceptFlags: combineConceptFlags(directProbe?.fallback?.records || []),
    renderContextAdmittedConceptFlags: combineConceptFlags(context.evidenceQuality?.eligibleRecords || [])
  };
}

function inferredStage(renderProjection, runtimeIssue) {
  const submitted = renderProjection.acceptedClaimCount + renderProjection.rejectedClaimCount;
  if (submitted === 0) return 'NO_RENDERED_CLAIMS_OBSERVED';
  if (renderProjection.acceptedClaimCount === 0 && renderProjection.rejectedClaimCount > 0) return 'RENDERED_CLAIMS_NOT_ACCEPTED';
  if (renderProjection.acceptedClaimCount > 0 && (runtimeIssue?.verifiedClaims?.length || 0) === 0) return 'FINAL_RUNTIME_ZERO_VERIFIED';
  if ((runtimeIssue?.verifiedClaims?.length || 0) > 0) return 'FINAL_RUNTIME_HAS_VERIFIED_CLAIMS';
  return 'STAGE_UNRESOLVED';
}

function emptyDiscoveryAdapters(counters) {
  return {
    discoveryAdapter: {
      async discoverOfficialSourceCandidates() { counters.suppressedDiscoveryAdapterInvocations += 1; return []; },
      getLastFetchTrace() { return []; }
    },
    officialDomainSearchAdapter: {
      async searchOfficialDomainCandidates() { counters.suppressedSearchAdapterInvocations += 1; return []; },
      getLastSearchTrace() { return []; }
    }
  };
}

async function runDirectProbe(casePlan, issuePlan, webRetriever, fetchOptions, adapters) {
  const fallback = await resolveMappedOfficialSourceFallback(issuePlan.topicIds, casePlan.testCase.query,
    defaultAdvancedSourceRetriever, {
      webRetriever, fetchOptions, ...adapters,
      authorityLevelDiscovery: false,
      localOnly: false,
      referenceDate: REFERENCE_DATE,
      evidenceScope: issuePlan.evidenceScope,
      questionUnderstanding: casePlan.understanding
    });
  const assessment = evaluateEvidenceQuality({
    query: casePlan.testCase.query,
    topicIds: issuePlan.topicIds,
    records: fallback.records,
    missingFacts: [],
    requestedConcepts: issuePlan.requestedConcepts,
    authorities: ['IRAS'],
    referenceDate: REFERENCE_DATE,
    sourceMapFallbackTrace: fallback.trace
  });
  return { fallback, assessment, projection: projectDirectProbe(casePlan, issuePlan, fallback, assessment) };
}

function safeTransportStatus(value) {
  return normalizeAttemptStatus(value);
}

function assertSafeReport(report) {
  const forbiddenKeys = new Set([
    'query', 'question', 'subject', 'facts', 'factsExplicitlyProvided', 'sourceText', 'html', 'response',
    'credential', 'credentials', 'token', 'password', 'apiKey', 'prompt', 'errorMessage', 'rawError'
  ]);
  const visit = (value, pathName = '$') => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, `${pathName}[${index}]`));
      return;
    }
    if (!value || typeof value !== 'object') return;
    for (const [key, item] of Object.entries(value)) {
      assert.ok(!forbiddenKeys.has(key), `Unsafe diagnostic key at ${pathName}.${key}`);
      visit(item, `${pathName}.${key}`);
    }
  };
  visit(report);
  return report;
}

async function readAndValidatePreregistration(planPath, readFingerprints = sourceFingerprints) {
  const planBytes = await readFile(planPath);
  const envelope = JSON.parse(planBytes.toString('utf8'));
  assert.ok(envelope && typeof envelope === 'object' && envelope.preregistration &&
    typeof envelope.preregistrationSha256 === 'string', 'Malformed V4 preregistration');
  const actualHash = hashPreregistration(envelope.preregistration);
  if (actualHash !== envelope.preregistrationSha256) {
    throw Object.assign(new Error('Preregistration fingerprint mismatch'), { code: 'PREREGISTRATION_MISMATCH' });
  }
  const current = await buildPreregistration({ readFingerprints });
  if (canonicalJson(current) !== canonicalJson(envelope.preregistration)) {
    throw Object.assign(new Error('Preregistration no longer matches current sources'), { code: 'PREREGISTRATION_MISMATCH' });
  }
  return { envelope, planBytes, current };
}

async function assertRunIntegrity(expectedPreregistration, expectedPlanBytes, planPath, readFingerprints) {
  const actualPreregistration = await buildPreregistration({ readFingerprints });
  if (canonicalJson(actualPreregistration) !== canonicalJson(expectedPreregistration)) {
    throw Object.assign(new Error('Source or preregistration fingerprint changed during measurement'), {
      code: 'PREREGISTRATION_MISMATCH'
    });
  }
  const actualPlanBytes = await readFile(planPath);
  if (!actualPlanBytes.equals(expectedPlanBytes)) {
    throw Object.assign(new Error('Preregistration file changed during measurement'), { code: 'PREREGISTRATION_MISMATCH' });
  }
  return actualPreregistration;
}

async function acquirePermanentConsumedMarker(markerPath, marker) {
  try {
    await writeJsonExclusive(markerPath, marker);
  } catch (error) {
    if (error?.code === 'EEXIST') throw Object.assign(new Error('Live run already consumed'), { code: 'RUN_CONSUMED' });
    throw error;
  }
}

export async function runIrasMappedEvidenceDiagnostic({
  mode = 'plan',
  outputDirectory = V4_OUTPUT_DIRECTORY,
  fetchImpl = globalThis.fetch,
  now = () => new Date().toISOString(),
  readFingerprints = sourceFingerprints
} = {}) {
  assert.ok(mode === 'plan' || mode === 'live-source', 'V4 mode must be plan or live-source');
  const planPath = outputPath(outputDirectory, V4_PLAN_FILENAME);
  const reportPath = outputPath(outputDirectory, V4_REPORT_FILENAME);
  const markerPath = outputPath(outputDirectory, V4_CONSUMED_FILENAME);

  if (mode === 'plan') return writeV4Plan({ outputDirectory });

  // Validate immutable history, current code/config, source-map selection, and
  // preregistration before reserving a live run or allowing any request.
  const protectedBefore = await fingerprintProtectedArtifacts();
  const pinnedBefore = await assertPinnedHistoricalArtifactsUnchanged();
  const { envelope, planBytes, current } = await readAndValidatePreregistration(planPath, readFingerprints);
  await assertFreshPath(reportPath);

  // Reserve the result name first so output collisions are rejected before any
  // request. The permanent consumed marker is then acquired atomically with wx.
  const outputLockPath = `${reportPath}.reservation`;
  const outputLock = await open(outputLockPath, 'wx');
  await outputLock.close();
  try {
    await assertFreshPath(reportPath);
    await acquirePermanentConsumedMarker(markerPath, {
      schemaVersion: 1,
      profileVersion: 'iras-mapped-evidence-diagnostic-v4',
      preregistrationSha256: envelope.preregistrationSha256,
      preregistrationFileSha256: sha256(planBytes),
      reservedAt: now(),
      status: 'CONSUMED_BEFORE_REQUEST'
    });
    await assertFreshPath(reportPath);

    const { cases, preregisteredPages } = casePlansWithMaps();
    const transport = createMappedOnlyTransport({
      canonicalUrls: preregisteredPages,
      fetchImpl,
      maxActualGets: current.bounds.maximumActualGets,
      now
    });
    const webRetriever = new ControlledWebRetriever(undefined, new SourceCache());
    const counters = { suppressedDiscoveryAdapterInvocations: 0, suppressedSearchAdapterInvocations: 0 };
    const adapters = emptyDiscoveryAdapters(counters);
    const fetchOptions = {
      timeoutMs: FETCH_TIMEOUT_MS,
      useCache: false,
      maxRedirects: 1,
      customFetch: transport.fetch
    };
    const directProbes = [];
    const renderedRows = [];
    const runtimeRows = [];

    // Direct map probes are deliberately first. One V3 transport/cache is
    // shared through render diagnostics and the normal default-provider call.
    for (const casePlan of cases) {
      const perIssue = new Map();
      for (const issuePlan of casePlan.issuePlans) {
        const probe = await runDirectProbe(casePlan, issuePlan, webRetriever, fetchOptions, adapters);
        perIssue.set(issuePlan.issue.id, probe);
        directProbes.push(probe.projection);
      }
      for (const issuePlan of casePlan.issuePlans) {
        const context = await buildGroundedReasoningContext(casePlan.testCase.query, null,
          defaultAdvancedSourceRetriever, undefined, {
            webRetriever,
            fetchOptions,
            ...adapters,
            localOnly: false,
            authorityLevelDiscovery: false,
            referenceDate: REFERENCE_DATE,
            questionUnderstanding: casePlan.understanding,
            evidenceScope: issuePlan.evidenceScope
          });
        const rendered = renderIrasEvidenceResponse({}, context, casePlan.testCase.query, null, 'SFRS_I', 'LOCAL');
        renderedRows.push(safeRenderProjection(casePlan, issuePlan, context, rendered,
          perIssue.get(issuePlan.issue.id)));
      }
      const runtime = await buildAuthorityWorkstreams(casePlan.testCase.query, casePlan.reconciled.issuePlan, {
        retriever: defaultAdvancedSourceRetriever,
        localOnly: false,
        referenceDate: REFERENCE_DATE,
        questionUnderstanding: casePlan.understanding,
        groundingOptions: {
          webRetriever,
          fetchOptions,
          ...adapters,
          localOnly: false,
          authorityLevelDiscovery: false,
          referenceDate: REFERENCE_DATE
        }
      });
      const runtimeIssueById = new Map(runtime.workstreams.flatMap(workstream =>
        workstream.issues.map(issue => [issue.issueId, issue])));
      for (const issuePlan of casePlan.issuePlans) {
        const runtimeIssue = runtimeIssueById.get(issuePlan.issue.id);
        const renderProjection = renderedRows.find(row => row.caseId === casePlan.caseId && row.issueIndex === issuePlan.issueIndex);
        runtimeRows.push({
          caseId: casePlan.caseId,
          issueIndex: issuePlan.issueIndex,
          overallStatus: ['VERIFIED', 'CONDITIONAL', 'INSUFFICIENT'].includes(runtime.status) ? runtime.status : 'OTHER_STATUS',
          evidenceStatus: ['VERIFIED', 'INSUFFICIENT'].includes(runtimeIssue?.evidenceStatus) ? runtimeIssue.evidenceStatus : 'OTHER_STATUS',
          applicationStatus: ['UNRESOLVED', 'NOT_REQUIRED'].includes(runtimeIssue?.applicationStatus) ? runtimeIssue.applicationStatus : 'OTHER_STATUS',
          finalVerifiedClaimCount: runtimeIssue?.verifiedClaims?.length || 0,
          finalSourceCount: runtimeIssue?.sources?.length || 0,
          gapCodes: safeGapCodes(runtimeIssue?.gaps),
          inferredStageFromCounts: inferredStage(renderProjection || {
            acceptedClaimCount: 0, rejectedClaimCount: 0
          }, runtimeIssue)
        });
      }
    }

    const snapshot = transport.snapshot();
    assert.ok(snapshot.actualGetCount <= current.bounds.maximumActualGets,
      'Mapped GET count exceeded the preregistered bound');
    assert.ok(snapshot.events.every(event => event.mapIds.length > 0), 'Every actual GET must map to a preregistered map ID');
    assert.equal(counters.suppressedDiscoveryAdapterInvocations >= 0, true);
    assert.equal(counters.suppressedSearchAdapterInvocations >= 0, true);
    const eventRows = snapshot.events.map(event => ({
      mapIds: [...event.mapIds].sort(),
      host: ALLOWED_IRAS_HOSTS.has(event.host) ? event.host : 'OTHER_HOST',
      status: safeTransportStatus(event.status),
      fetchedAt: event.fetchedAt
    }));
    const report = assertSafeReport({
      schemaVersion: 1,
      profileVersion: 'iras-mapped-evidence-diagnostic-v4',
      mode: 'LIVE_SOURCE_MAPPED_PAGES_ONLY_NO_MODEL',
      referenceDate: REFERENCE_DATE,
      selectedCaseIds: [...V4_SELECTED_CASE_IDS],
      sourceMaps: preregisteredPages,
      modelRequests: 0,
      discoveryRequests: 0,
      searchRequests: 0,
      suppressedDiscoveryAdapterInvocations: counters.suppressedDiscoveryAdapterInvocations,
      suppressedSearchAdapterInvocations: counters.suppressedSearchAdapterInvocations,
      maximumActualGets: current.bounds.maximumActualGets,
      actualGetCount: snapshot.actualGetCount,
      cacheReuseCount: snapshot.cacheReuseCount,
      policyRejectionCount: snapshot.policyRejectionCount,
      transportEvents: eventRows,
      directMapProbes: directProbes,
      renderedEvidence: renderedRows,
      runtimeIssues: runtimeRows,
      preregistrationSha256: envelope.preregistrationSha256,
      preregistrationFileSha256: sha256(planBytes),
      sourceFingerprintCount: current.sourceFingerprints.length,
      historicalFingerprintCount: current.historicalFingerprints.v1v2.length + current.historicalFingerprints.pinnedV3AndBaseline.length
    });
    await assertProtectedArtifactsUnchanged(protectedBefore);
    await assertPinnedHistoricalArtifactsUnchanged();
    await assertRunIntegrity(envelope.preregistration, planBytes, planPath, readFingerprints);
    await assertFreshPath(reportPath);
    await writeJsonExclusive(reportPath, report);
    await assertProtectedArtifactsUnchanged(protectedBefore);
    await assertPinnedHistoricalArtifactsUnchanged();
    await assertRunIntegrity(envelope.preregistration, planBytes, planPath, readFingerprints);
    return report;
  } catch (error) {
    // A post-reservation failure permanently consumes the preregistration.
    // Provider/error text is never serialized, and the marker is never removed.
    throw error;
  } finally {
    await rm(outputLockPath, { force: true });
  }
}

export async function readPreregistrationForTest(directory = V4_OUTPUT_DIRECTORY) {
  return JSON.parse((await readFile(outputPath(directory, V4_PLAN_FILENAME), 'utf8')));
}

async function main(args) {
  try {
    if (args.length === 1 && args[0] === '--plan') {
      const plan = await runIrasMappedEvidenceDiagnostic({ mode: 'plan' });
      process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
      return;
    }
    if (args.length === 1 && args[0] === '--live-source') {
      const report = await runIrasMappedEvidenceDiagnostic({ mode: 'live-source' });
      process.stdout.write(`${JSON.stringify({ profileVersion: report.profileVersion, actualGetCount: report.actualGetCount }, null, 2)}\n`);
      return;
    }
    process.stderr.write('Usage: node --import tsx tests/evaluation/singapore/iras-mapped-evidence-diagnostic-v4.mjs --plan|--live-source\n');
    process.exitCode = 2;
  } catch (error) {
    process.stderr.write(`${safeError(error)}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main(process.argv.slice(2));
}
