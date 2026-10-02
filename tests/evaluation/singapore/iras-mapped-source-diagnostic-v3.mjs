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
import { resolveMappedOfficialSourceFallback } from '../../../src/services/groundingContextBuilder.ts';
import { getRequestedQuestionConcepts, reconcileQuestionUnderstanding, validateSemanticQuestionInterpretation } from '../../../src/services/semanticQuestionUnderstanding.ts';
import { irasResolverCases } from '../../fixtures/irasResolverCases.mjs';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
export const REPOSITORY_ROOT = path.resolve(scriptDirectory, '../../..');
export const V3_OUTPUT_PATH = path.join(REPOSITORY_ROOT,
  'docs/evaluation/multi-authority-workstreams/iras-first-live-2026-10-02-v3/iras-mapped-source-diagnostic-v3.json');
export const V3_SELECTED_CASE_IDS = Object.freeze([
  'target-relief-entitlement',
  'target-relief-amount',
  'A-paraphrase-2',
  'private-expense-treatment',
  'foreign-dividend-receipt-treatment',
  'corporate-residency-general-rule',
  'wht-royalty-general-rule',
  'gst-input-tax-general-rule',
  'unsupported-sfrsi-6-exploration-evaluation'
]);

const REFERENCE_DATE = '2026-10-02';
const FETCH_TIMEOUT_MS = 10_000;
const ALLOWED_IRAS_HOSTS = new Set(['www.iras.gov.sg', 'iras.gov.sg']);
const protectedManifestPaths = [
  'docs/evaluation/multi-authority-workstreams/iras-first-live-2026-10-02-v1/historical-artifact-hashes.json',
  'docs/evaluation/multi-authority-workstreams/iras-first-live-2026-10-02-v2/historical-artifact-hashes.json'
];
const FIXED_PROFILE_TO_SOURCE_CASE_ID = Object.freeze({
  'private-expense-treatment': 'private-holiday-expense',
  'foreign-dividend-receipt-treatment': 'foreign-dividend-treatment',
  'corporate-residency-general-rule': 'company-residency-general'
});
const additionalProtectedPaths = [
  'docs/evaluation/multi-authority-workstreams/iras-first-live-2026-10-02-v1/supervisor-final-report.md',
  'docs/evaluation/multi-authority-workstreams/iras-first-live-2026-10-02-v1/release-contract.md',
  'docs/evaluation/multi-authority-workstreams/iras-first-live-2026-10-02-v1/local-validation-and-review.md',
  'docs/evaluation/multi-authority-workstreams/iras-first-live-2026-10-02-v1/iras-first-targeted-v1-live.md',
  'docs/evaluation/multi-authority-workstreams/iras-first-live-2026-10-02-v1/iras-first-targeted-v1-live.json',
  'docs/evaluation/multi-authority-workstreams/iras-first-live-2026-10-02-v1/benchmark-adjudications.md',
  'docs/evaluation/multi-authority-workstreams/iras-first-live-2026-10-02-v2/supervisor-final-report.md',
  'docs/evaluation/multi-authority-workstreams/iras-first-live-2026-10-02-v2/specificity-architecture.md',
  'docs/evaluation/multi-authority-workstreams/iras-first-live-2026-10-02-v2/iras-topic-mapping-audit.md',
  'docs/evaluation/multi-authority-workstreams/iras-first-live-2026-10-02-v2/iras-topic-source-path-v2.json',
  'docs/evaluation/multi-authority-workstreams/iras-first-live-2026-10-02-v2/semantic-structured-timeout-experiment-v2.md',
  'docs/evaluation/multi-authority-workstreams/iras-first-live-2026-10-02-v2/semantic-structured-timeout-experiment-v2.json',
  'tests/evaluation/singapore/iras-first-evaluation-config-v1.json',
  'tests/evaluation/singapore/iras-first-evaluation-config-v2.json',
  'tests/evaluation/singapore/authority-relief-targeted.json'
];

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function pathInsideRepository(relativePath) {
  const absolutePath = path.resolve(REPOSITORY_ROOT, ...relativePath.split(/[\\/]/));
  const relative = path.relative(REPOSITORY_ROOT, absolutePath);
  assert.ok(relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative),
    `Protected artifact path must remain inside the repository: ${relativePath}`);
  return absolutePath;
}

async function protectedArtifacts() {
  const expectedHashes = new Map();
  for (const manifestPath of protectedManifestPaths) {
    const manifestBytes = await readFile(pathInsideRepository(manifestPath));
    const manifest = JSON.parse(manifestBytes.toString('utf8'));
    assert.ok(Array.isArray(manifest.artifacts), `${manifestPath}: protected artifact manifest is malformed`);
    expectedHashes.set(manifestPath, sha256(manifestBytes));
    for (const artifact of manifest.artifacts) {
      assert.equal(typeof artifact.path, 'string', `${manifestPath}: artifact path is missing`);
      assert.match(artifact.sha256, /^[a-f0-9]{64}$/i, `${manifestPath}: artifact hash is malformed`);
      expectedHashes.set(artifact.path, artifact.sha256.toLowerCase());
    }
  }
  for (const relativePath of additionalProtectedPaths) {
    const filePath = pathInsideRepository(relativePath);
    const fileInfo = await stat(filePath);
    assert.ok(fileInfo.isFile(), `${relativePath}: required protected profile artifact is not a file`);
    expectedHashes.set(relativePath, sha256(await readFile(filePath)));
  }
  return [...expectedHashes].sort(([left], [right]) => left.localeCompare(right));
}

export async function fingerprintProtectedArtifacts() {
  const artifacts = await protectedArtifacts();
  for (const [relativePath, expectedHash] of artifacts) {
    const actualHash = sha256(await readFile(pathInsideRepository(relativePath)));
    assert.equal(actualHash, expectedHash,
      `Protected historical artifact changed or no longer matches its manifest: ${relativePath}`);
  }
  return artifacts.map(([relativePath, hash]) => ({ path: relativePath.replaceAll('\\', '/'), sha256: hash }));
}

export async function assertProtectedArtifactsUnchanged(before) {
  const after = await fingerprintProtectedArtifacts();
  assert.deepEqual(after, before, 'Protected historical artifacts changed during the source diagnostic');
  return after;
}

function fixedCaseSet() {
  const sourceIds = new Set(V3_SELECTED_CASE_IDS.map(id => FIXED_PROFILE_TO_SOURCE_CASE_ID[id] || id));
  const casesById = new Map(irasResolverCases.filter(testCase => sourceIds.has(testCase.id)).map(testCase => [testCase.id, testCase]));
  const cases = V3_SELECTED_CASE_IDS.map(profileCaseId => {
    const fixtureCaseId = FIXED_PROFILE_TO_SOURCE_CASE_ID[profileCaseId] || profileCaseId;
    const testCase = casesById.get(fixtureCaseId);
    return testCase ? { profileCaseId, fixtureCaseId, testCase } : undefined;
  });
  assert.ok(cases.every(Boolean), 'The v3 source diagnostic requires its complete fixed nine-case selection');
  assert.equal(sourceIds.size, V3_SELECTED_CASE_IDS.length, 'Fixed fixture IDs must be unique');
  return cases;
}

function interpretationFor(testCase) {
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

function selectedCasesWithMappings() {
  const casePlans = [];
  const mapsById = new Map(IRAS_SOURCE_MAP_DEFINITIONS.map(definition => [definition.id, definition]));
  const mapsByTopic = new Map();
  for (const definition of IRAS_SOURCE_MAP_DEFINITIONS) {
    for (const topicId of definition.topicIds) {
      const current = mapsByTopic.get(topicId) || [];
      current.push(definition);
      mapsByTopic.set(topicId, current);
    }
  }

  for (const selection of fixedCaseSet()) {
    const { profileCaseId, fixtureCaseId, testCase } = selection;
    const interpretation = interpretationFor(testCase);
    assert.ok(validateSemanticQuestionInterpretation(interpretation, testCase.query),
      `${testCase.id}: fixed synthetic issue contract must validate`);
    const understanding = { mode: 'SEMANTIC_INTERPRETATION', interpretation };
    const classification = classifyQuestion(testCase.query);
    const reconciled = reconcileQuestionUnderstanding(testCase.query, classification, understanding);
    assert.equal(reconciled.issuePlan.source, 'SEMANTIC_ISSUES', `${testCase.id}: fixed semantic issue plan must be used`);
    const plans = planAuthorityWorkstreams(reconciled.issuePlan);
    const workstreamByIssueId = new Map(plans.flatMap(plan => plan.authority === 'IRAS'
      ? plan.issueIds.map(issueId => [issueId, plan]) : []));
    const issues = [];
    for (const [issueIndex, issue] of reconciled.issuePlan.issues.entries()) {
      if (!issue.governingAuthorities.includes('IRAS') || issue.unresolvedReason === 'UNASSIGNED_QUERY_TOPIC') continue;
      const plan = workstreamByIssueId.get(issue.id);
      if (!plan) continue;
      const topics = getCoverageTopicsByIds(issue.mappedTopicIds).filter(topic =>
        topic.domainId.startsWith('IRAS_') && !topic.routingOnly);
      const topicIds = [...new Set(topics.map(topic => topic.id))].sort();
      const definitionsById = new Map();
      for (const topicId of topicIds) {
        const topic = topics.find(item => item.id === topicId);
        for (const definition of mapsByTopic.get(topicId) || []) {
          if (definition.domainId === topic?.domainId) definitionsById.set(definition.id, definition);
        }
      }
      const definitions = [...definitionsById.values()].map(definition => mapsById.get(definition.id)).filter(Boolean);
      const requestedConcepts = getRequestedQuestionConcepts(testCase.query, understanding)
        .filter(concept => concept.topicIds.some(topicId => topicIds.includes(topicId)));
      const sourceDomain = topics[0]?.domainId;
      const evidenceScope = sourceDomain ? {
        authority: 'IRAS',
        domain: plan.domain,
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
      issues.push({ issueId: issue.id, issueIndex, issue, plan, understanding, topicIds, requestedConcepts, definitions, evidenceScope });
    }
    casePlans.push({ caseId: profileCaseId, fixtureCaseId, testCase, understanding, issuePlans: issues });
  }

  const definitionsByUrl = new Map();
  for (const { issuePlans } of casePlans) {
    for (const issuePlan of issuePlans) {
      for (const definition of issuePlan.definitions) {
        const entry = definitionsByUrl.get(definition.canonicalSourceUrl) || { canonicalUrl: definition.canonicalSourceUrl, mapIds: new Set(), topicIds: new Set() };
        entry.mapIds.add(definition.id);
        for (const topicId of definition.topicIds) {
          if (issuePlan.topicIds.includes(topicId)) entry.topicIds.add(topicId);
        }
        definitionsByUrl.set(definition.canonicalSourceUrl, entry);
      }
    }
  }
  const preregisteredPages = [...definitionsByUrl.values()].map(entry => {
    const parsed = new URL(entry.canonicalUrl);
    assert.equal(parsed.protocol, 'https:', 'Only HTTPS source-map URLs are preregistered');
    assert.ok(ALLOWED_IRAS_HOSTS.has(parsed.hostname.toLowerCase()), 'Every v3 source map must use an approved IRAS host');
    assert.equal(parsed.username, '', 'Mapped source URL cannot contain credentials');
    assert.equal(parsed.password, '', 'Mapped source URL cannot contain credentials');
    assert.equal(parsed.search, '', 'Mapped source URL cannot contain query facts');
    return {
      canonicalUrl: parsed.toString(),
      host: parsed.hostname.toLowerCase(),
      mapIds: [...entry.mapIds].sort(),
      topicIds: [...entry.topicIds].sort()
    };
  }).sort((left, right) => left.canonicalUrl.localeCompare(right.canonicalUrl));
  assert.ok(preregisteredPages.length > 0, 'The fixed selection must resolve to at least one IRAS source map');
  return { casePlans, preregisteredPages };
}

function approvedCanonicalPeerRedirect(sourceUrl, targetUrl) {
  let source;
  let target;
  try {
    source = new URL(sourceUrl);
    target = new URL(targetUrl, sourceUrl);
  } catch {
    return false;
  }
  const hostPair = new Set([source.hostname.toLowerCase(), target.hostname.toLowerCase()]);
  return source.protocol === 'https:' && target.protocol === 'https:' &&
    ALLOWED_IRAS_HOSTS.has(source.hostname.toLowerCase()) && ALLOWED_IRAS_HOSTS.has(target.hostname.toLowerCase()) &&
    source.port === '' && target.port === '' && source.username === '' && source.password === '' &&
    target.username === '' && target.password === '' && target.search === '' && target.hash === '' &&
    source.pathname === target.pathname && source.search === target.search && source.hash === target.hash &&
    hostPair.size === 2;
}

/**
 * A closed mapped-page transport. Only preregistered canonical URLs can start
 * a request; one same-path www/apex IRAS redirect can be followed after the
 * transport itself attests it through a manual 3xx Location response.
 */
export function createMappedOnlyTransport({ canonicalUrls, fetchImpl = globalThis.fetch, maxActualGets = canonicalUrls.length * 2, now = () => new Date().toISOString() }) {
  assert.equal(typeof fetchImpl, 'function', 'An explicit fetch transport is required');
  const mapPages = canonicalUrls.map(item => typeof item === 'string' ? { canonicalUrl: item, mapIds: [] } : item);
  const canonicalSet = new Set(mapPages.map(page => new URL(page.canonicalUrl).toString()));
  assert.ok(canonicalSet.size > 0, 'At least one mapped IRAS URL must be preregistered');
  assert.ok(Number.isInteger(maxActualGets) && maxActualGets > 0, 'Actual GET budget must be a positive integer');
  const responseCache = new Map();
  const authorizedRedirects = new Map();
  const events = [];
  let actualGetCount = 0;
  let cacheReuseCount = 0;
  let policyRejectionCount = 0;

  const materialize = cached => new Response(cached.body.slice(), {
    status: cached.status,
    statusText: cached.statusText,
    headers: cached.headers
  });
  const cacheTransportFailure = (url, fetchedAt) => {
    events.push({ host: new URL(url).hostname.toLowerCase(), status: 'TRANSPORT_ERROR', contentHash: null, fetchedAt,
      mapIds: mapIdsForUrl(url, mapPages) });
    const failedResponse = {
      body: new Uint8Array(),
      status: 599,
      statusText: 'Transport failure cached; retries disabled',
      headers: []
    };
    responseCache.set(url, failedResponse);
    return materialize(failedResponse);
  };

  async function guardedFetch(urlValue, init = {}) {
    let url;
    try { url = new URL(urlValue).toString(); } catch { policyRejectionCount += 1; throw new Error('MAPPED_PAGE_URL_REJECTED'); }
    const isCanonical = canonicalSet.has(url);
    const isAttestedRedirect = authorizedRedirects.has(url);
    if (!isCanonical && !isAttestedRedirect) {
      policyRejectionCount += 1;
      throw new Error('MAPPED_PAGE_URL_REJECTED');
    }
    if ((init.method || 'GET').toUpperCase() !== 'GET') {
      policyRejectionCount += 1;
      throw new Error('MAPPED_PAGE_METHOD_REJECTED');
    }
    if (responseCache.has(url)) {
      cacheReuseCount += 1;
      return materialize(responseCache.get(url));
    }
    if (actualGetCount >= maxActualGets) {
      policyRejectionCount += 1;
      throw new Error('MAPPED_PAGE_GET_BUDGET_EXCEEDED');
    }

    actualGetCount += 1;
    const fetchedAt = now();
    let response;
    let headers;
    let body;
    try {
      response = await fetchImpl(url, { ...init, method: 'GET', redirect: 'manual' });
      const reportedResponseUrl = response.url;
      if (reportedResponseUrl && reportedResponseUrl !== url) {
        policyRejectionCount += 1;
        events.push({ host: new URL(url).hostname.toLowerCase(), status: 'AUTOMATIC_REDIRECT_REJECTED', contentHash: null, fetchedAt,
          mapIds: mapIdsForUrl(url, mapPages) });
        const rejectedResponse = { body: new Uint8Array(), status: 502, statusText: 'Unattested redirect rejected', headers: [] };
        responseCache.set(url, rejectedResponse);
        return materialize(rejectedResponse);
      }
      headers = new Headers(response.headers);
      body = new Uint8Array(await response.arrayBuffer());
    } catch {
      return cacheTransportFailure(url, fetchedAt);
    }

    const contentHash = sha256(body);
    const status = response.status;
    const location = status >= 300 && status < 400 ? headers.get('location') : null;
    const associatedMapIds = mapIdsForUrl(url, mapPages);
    let safeStatus = `HTTP_${status}`;
    if (location) {
      let targetUrl;
      try { targetUrl = new URL(location, url).toString(); } catch { targetUrl = ''; }
      if (targetUrl && approvedCanonicalPeerRedirect(url, targetUrl)) {
        authorizedRedirects.set(targetUrl, { sourceUrl: url, mapIds: associatedMapIds });
        safeStatus = `REDIRECT_${status}`;
      } else {
        policyRejectionCount += 1;
        safeStatus = 'REDIRECT_REJECTED';
        response = new Response('', { status: 502, statusText: 'Unapproved mapped-source redirect rejected' });
      }
    }
    events.push({ host: new URL(url).hostname.toLowerCase(), status: safeStatus, contentHash,
      fetchedAt, mapIds: associatedMapIds });
    const cached = {
      body: new Uint8Array(body),
      status: response.status,
      statusText: response.statusText,
      headers: [...headers.entries()]
    };
    responseCache.set(url, cached);
    return materialize(cached);
  }

  return {
    fetch: guardedFetch,
    snapshot() {
      return {
        actualGetCount,
        cacheReuseCount,
        policyRejectionCount,
        events: events.map(event => ({ ...event, mapIds: [...event.mapIds] }))
      };
    }
  };
}

function mapIdsForUrl(url, canonicalUrls) {
  const exact = canonicalUrls.find(page => new URL(page.canonicalUrl).toString() === url);
  if (exact) return [...exact.mapIds];
  const decoded = canonicalizeRedirectUrl(url);
  const source = canonicalUrls.find(page => page.canonicalUrl === decoded);
  if (source) return [...source.mapIds];
  for (const page of canonicalUrls) {
    if (approvedCanonicalPeerRedirect(page.canonicalUrl, url)) return [...page.mapIds];
  }
  return [];
}

function canonicalizeRedirectUrl(urlValue) {
  try {
    const url = new URL(urlValue);
    if (url.hostname.toLowerCase() === 'iras.gov.sg') url.hostname = 'www.iras.gov.sg';
    return url.toString();
  } catch {
    return '';
  }
}

function emptyDiscoveryAdapters(counters) {
  return {
    discoveryAdapter: {
      async discoverOfficialSourceCandidates() { counters.sitemapAdapterCalls += 1; return []; },
      getLastFetchTrace() { return []; }
    },
    officialDomainSearchAdapter: {
      async searchOfficialDomainCandidates() { counters.searchAdapterCalls += 1; return []; },
      getLastSearchTrace() { return []; }
    }
  };
}

function toSafeAttemptStatuses(trace, topicId, sourceMapId) {
  return (trace?.attempts || []).filter(attempt => attempt.topicId === topicId && attempt.sourceMapId === sourceMapId)
    .map(attempt => ({ status: String(attempt.fetchStatus).slice(0, 64), stage: attempt.discoveryStage === 'MAPPED_SOURCE' ? 'MAPPED_SOURCE' : 'OTHER' }));
}

function safeIssueProjection(casePlan, issuePlan, directProbe, runtimeIssue) {
  const topicMetrics = issuePlan.topicIds.map(topicId => {
    const defs = issuePlan.definitions.filter(definition => definition.topicIds.includes(topicId));
    return {
      topicId,
      maps: defs.map(definition => {
        const mapAttempts = (directProbe?.trace?.attempts || []).filter(attempt =>
          attempt.topicId === topicId && attempt.sourceMapId === definition.id);
        const mappedFetchSucceeded = mapAttempts.some(attempt => attempt.fetchStatus === 'SUCCESS' &&
          canonicalizeRedirectUrl(attempt.finalUrl || attempt.candidateUrl || '') === definition.canonicalSourceUrl);
        return {
          mapId: definition.id,
          fetchAttempts: toSafeAttemptStatuses(directProbe?.trace, topicId, definition.id),
          candidateCount: mappedFetchSucceeded ? [...(directProbe?.records || [])].filter(record => {
            const sourceUrl = canonicalizeRedirectUrl(record.canonicalSourceUrl || record.officialSourceUrl || '');
            return sourceUrl === definition.canonicalSourceUrl && (record.tags?.includes(topicId) ||
              record.sourceMapTopicIds?.includes(topicId) || record.relatedTopicIds?.includes(topicId) || record.retrievalHints?.includes(topicId));
          }).length : 0,
          admittedCount: mappedFetchSucceeded ? [...(directProbe?.admittedRecords || [])].filter(record => {
            const sourceUrl = canonicalizeRedirectUrl(record.canonicalSourceUrl || record.officialSourceUrl || '');
            return sourceUrl === definition.canonicalSourceUrl && (record.tags?.includes(topicId) ||
              record.sourceMapTopicIds?.includes(topicId) || record.relatedTopicIds?.includes(topicId) || record.retrievalHints?.includes(topicId));
          }).length : 0
        };
      })
    };
  });
  return {
    caseId: casePlan.caseId,
    fixtureCaseId: casePlan.fixtureCaseId,
    issueIndex: issuePlan.issueIndex,
    authority: 'IRAS',
    domain: issuePlan.issue.domain,
    population: issuePlan.issue.population,
    operation: issuePlan.issue.operation,
    topics: topicMetrics,
    provider: runtimeIssue ? {
      retrievalAttempted: runtimeIssue.lifecycle.retrievalAttempted,
      candidateFound: runtimeIssue.lifecycle.evidenceFound,
      admitted: runtimeIssue.lifecycle.admitted,
      verified: runtimeIssue.lifecycle.verified,
      covered: runtimeIssue.lifecycle.covered,
      verifiedRuleClaimCount: runtimeIssue.verifiedClaims.length,
      verifiedSourceCount: runtimeIssue.sources.length,
      evidenceStatus: runtimeIssue.evidenceStatus,
      applicationStatus: runtimeIssue.applicationStatus,
      retrievalStages: (runtimeIssue.retrievalTrace?.stages || []).map(stage => ({ stage: stage.stage, status: stage.status })),
      gapCodes: [...new Set(runtimeIssue.gaps.map(gap => gap.code))].sort()
    } : null
  };
}

function assertSafeReportShape(value) {
  const forbiddenKeys = new Set(['query', 'subject', 'facts', 'factsExplicitlyProvided', 'sourceText', 'html', 'response', 'credential', 'credentials', 'token', 'password', 'apiKey', 'prompt']);
  const visit = (item, pathName = '$') => {
    if (Array.isArray(item)) {
      item.forEach((child, index) => visit(child, `${pathName}[${index}]`));
      return;
    }
    if (!item || typeof item !== 'object') return;
    for (const [key, child] of Object.entries(item)) {
      assert.ok(!forbiddenKeys.has(key), `Unsafe diagnostic key persisted at ${pathName}.${key}`);
      visit(child, `${pathName}.${key}`);
    }
  };
  visit(value);
  return value;
}

export async function writeFreshReport(report, outputPath = V3_OUTPUT_PATH) {
  const absoluteOutputPath = path.resolve(outputPath);
  const relative = path.relative(REPOSITORY_ROOT, absoluteOutputPath);
  assert.ok(relative && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative),
    'V3 output must remain inside the repository');
  assertSafeReportShape(report);
  await mkdir(path.dirname(absoluteOutputPath), { recursive: true });
  const file = await open(absoluteOutputPath, 'wx');
  try {
    await file.writeFile(`${JSON.stringify(report, null, 2)}\n`, 'utf8');
  } finally {
    await file.close();
  }
  return absoluteOutputPath;
}

async function reserveFreshOutput(outputPath) {
  if (!outputPath) return undefined;
  const absoluteOutputPath = path.resolve(outputPath);
  const relative = path.relative(REPOSITORY_ROOT, absoluteOutputPath);
  assert.ok(relative && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative),
    'V3 output must remain inside the repository');
  await mkdir(path.dirname(absoluteOutputPath), { recursive: true });
  try {
    await stat(absoluteOutputPath);
    throw Object.assign(new Error('Diagnostic output already exists; refusing to fetch or overwrite it.'), { code: 'EEXIST' });
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  const lockPath = `${absoluteOutputPath}.lock`;
  const lock = await open(lockPath, 'wx');
  await lock.close();
  try {
    await stat(absoluteOutputPath);
    throw Object.assign(new Error('Diagnostic output already exists; refusing to fetch or overwrite it.'), { code: 'EEXIST' });
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      await rm(lockPath, { force: true });
      throw error;
    }
  }
  return { outputPath: absoluteOutputPath, lockPath };
}

async function runDirectMappedProbe(casePlan, issuePlan, webRetriever, fetchOptions, adapters) {
  if (!issuePlan.topicIds.length || !issuePlan.evidenceScope) return undefined;
  const fallback = await resolveMappedOfficialSourceFallback(
    issuePlan.topicIds,
    casePlan.testCase.query,
    defaultAdvancedSourceRetriever,
    {
      webRetriever,
      fetchOptions,
      ...adapters,
      authorityLevelDiscovery: false,
      localOnly: false,
      referenceDate: REFERENCE_DATE,
      evidenceScope: issuePlan.evidenceScope,
      questionUnderstanding: casePlan.understanding
    }
  );
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
  return {
    trace: fallback.trace,
    records: fallback.records,
    admittedRecords: assessment.eligibleRecords,
    uncoveredTopicCount: assessment.uncoveredTopicIds.length
  };
}

/**
 * Runs only the fixed nine-case source diagnostic. Live-source mode is explicit,
 * uses no semantic/model request, and can fetch only the derived registered maps.
 */
export async function runMappedSourceDiagnostic({ mode = 'plan', fetchImpl, outputPath, now } = {}) {
  assert.ok(['plan', 'live-source', 'synthetic-test'].includes(mode), 'Unsupported diagnostic mode');
  const historyBefore = await fingerprintProtectedArtifacts();
  const { casePlans, preregisteredPages } = selectedCasesWithMappings();
  const effectiveOutputPath = mode === 'live-source' ? outputPath || V3_OUTPUT_PATH : outputPath;
  const outputReservation = await reserveFreshOutput(effectiveOutputPath);
  const actualGetLimit = preregisteredPages.length * 2;
  const planOnly = mode === 'plan';
  const counters = { sitemapAdapterCalls: 0, searchAdapterCalls: 0 };
  const transport = planOnly ? undefined : createMappedOnlyTransport({
    canonicalUrls: preregisteredPages,
    fetchImpl: mode === 'live-source' ? fetchImpl || globalThis.fetch : fetchImpl,
    maxActualGets: actualGetLimit,
    now
  });
  const webRetriever = transport ? new ControlledWebRetriever(undefined, new SourceCache()) : undefined;
  const fetchOptions = transport ? {
    timeoutMs: FETCH_TIMEOUT_MS,
    useCache: false,
    maxRedirects: 1,
    customFetch: transport.fetch
  } : undefined;
  const adapters = emptyDiscoveryAdapters(counters);
  const mappedProbes = [];
  const runtimeRows = [];
  try {
  if (!planOnly) {
    for (const casePlan of casePlans) {
      const directProbes = new Map();
      for (const issuePlan of casePlan.issuePlans) {
        const probe = await runDirectMappedProbe(casePlan, issuePlan, webRetriever, fetchOptions, adapters);
        directProbes.set(issuePlan.issueId, probe);
      }
      const runtime = await buildAuthorityWorkstreams(casePlan.testCase.query,
        reconcileQuestionUnderstanding(casePlan.testCase.query, classifyQuestion(casePlan.testCase.query),
          { mode: 'SEMANTIC_INTERPRETATION', interpretation: casePlan.understanding.interpretation }).issuePlan,
        {
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
      const runtimeByIssueId = new Map(runtime.workstreams.flatMap(stream => stream.issues.map(issue => [issue.issueId, issue])));
      for (const issuePlan of casePlan.issuePlans) {
        const runtimeIssue = runtimeByIssueId.get(issuePlan.issueId);
        mappedProbes.push(safeIssueProjection(casePlan, issuePlan, directProbes.get(issuePlan.issueId), runtimeIssue));
      }
      runtimeRows.push({ caseId: casePlan.caseId, fixtureCaseId: casePlan.fixtureCaseId, status: runtime.status,
        issueCount: runtime.workstreams.reduce((sum, stream) => sum + stream.issues.length, 0) });
    }
  }
  const transportSnapshot = transport?.snapshot() || { actualGetCount: 0, cacheReuseCount: 0, policyRejectionCount: 0, events: [] };
  assert.ok(transportSnapshot.actualGetCount <= actualGetLimit, 'Actual source GET count exceeded twice the preregistered unique URL count');
  assert.ok(transportSnapshot.events.every(event => event.mapIds.length > 0), 'Every actual request must map to a preregistered source-map ID');
  const pageFetches = preregisteredPages.map(page => {
    const events = transportSnapshot.events.filter(event => page.mapIds.some(mapId => event.mapIds.includes(mapId)));
    const statuses = [...new Set(events.map(event => event.status))];
    return {
      mapIds: page.mapIds,
      topicIds: page.topicIds,
      canonicalUrl: page.canonicalUrl,
      host: page.host,
      fetchStatus: statuses.length ? statuses.join('+') : 'NOT_FETCHED_BY_MAPPED_PROVIDER',
      contentHashes: [...new Set(events.map(event => event.contentHash).filter(Boolean))].sort(),
      fetchedAt: events.map(event => event.fetchedAt).sort(),
      actualGetCount: events.length
    };
  });
  const output = {
    schemaVersion: 1,
    profileVersion: 'iras-first-source-diagnostic-v3',
    mode,
    purpose: 'Fixed-case mapped IRAS source-path and admission diagnostics; questions, facts, fetched HTML, response text, and credentials are never persisted. Source-map URLs route retrieval only and never count as evidence.',
    syntheticContractSource: 'irasResolverCases fixed nine-case v2 selection; issue inputs are synthetic representatives from frozen contracts, not historical raw model subject text.',
    liveSourceLimitations: mode === 'live-source' ? [
      'A page fetch, candidate, or admission does not establish a verified statutory rule or answer.',
      'Case-specific application remains unresolved unless the existing runtime verifies the required facts.',
      'This diagnostic makes no model request and makes no completeness assertion.'
    ] : ['Synthetic test content is never evidence of actual IRAS pages or substantive tax guidance.'],
    selectedCaseIds: [...V3_SELECTED_CASE_IDS],
    selectedCaseCount: casePlans.length,
    selectedIrasIssueCount: casePlans.reduce((sum, item) => sum + item.issuePlans.length, 0),
    uniqueSourceMapCount: new Set(preregisteredPages.flatMap(page => page.mapIds)).size,
    uniqueSourceMapUrlCount: preregisteredPages.length,
    maximumActualGetCount: actualGetLimit,
    modelRequests: 0,
    preregisteredMapFetches: preregisteredPages,
    summary: {
      selectedCaseCount: casePlans.length,
      selectedIrasIssueCount: casePlans.reduce((sum, item) => sum + item.issuePlans.length, 0),
      mappedTopicCount: [...new Set(casePlans.flatMap(item => item.issuePlans.flatMap(issue => issue.topicIds)))].length,
      uniqueSourceMapCount: new Set(preregisteredPages.flatMap(page => page.mapIds)).size,
      uniqueSourceMapUrlCount: preregisteredPages.length,
      actualGetCount: transportSnapshot.actualGetCount,
      cacheReuseCount: transportSnapshot.cacheReuseCount,
      policyRejectionCount: transportSnapshot.policyRejectionCount,
      sitemapAdapterCalls: counters.sitemapAdapterCalls,
      searchAdapterCalls: counters.searchAdapterCalls,
      modelRequests: 0,
      networkMode: mode === 'live-source' ? 'LIVE_IRAS_MAPS_ONLY_NO_MODEL' : mode === 'synthetic-test' ? 'SYNTHETIC_TRANSPORT_NO_LIVE_NETWORK' : 'PLAN_ONLY_NO_NETWORK'
    },
    pageFetches,
    issues: mappedProbes,
    runtimeRows
  };
  assertSafeReportShape(output);
  await assertProtectedArtifactsUnchanged(historyBefore);
  if (outputReservation) {
    await writeFreshReport(output, outputReservation.outputPath);
  }
  await assertProtectedArtifactsUnchanged(historyBefore);
  return output;
  } finally {
    if (outputReservation) await rm(outputReservation.lockPath, { force: true });
  }
}

function printPlan(plan) {
  const report = {
    profileVersion: 'iras-first-source-diagnostic-v3',
    mode: 'PLAN_ONLY_NO_NETWORK',
    selectedCaseIds: V3_SELECTED_CASE_IDS,
    selectedCaseCount: plan.casePlans.length,
    selectedIrasIssueCount: plan.casePlans.reduce((sum, item) => sum + item.issuePlans.length, 0),
    uniqueSourceMapCount: new Set(plan.preregisteredPages.flatMap(page => page.mapIds)).size,
    uniqueSourceMapUrlCount: plan.preregisteredPages.length,
    maximumActualGetCount: 2 * plan.preregisteredPages.length,
    preregisteredMapFetches: plan.preregisteredPages,
    modelRequests: 0,
    liveInvocation: 'node --import tsx tests/evaluation/singapore/iras-mapped-source-diagnostic-v3.mjs --live-source'
  };
  assertSafeReportShape(report);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

async function main(args) {
  if (args.length === 0 || args[0] === '--plan') {
    const { casePlans, preregisteredPages } = selectedCasesWithMappings();
    printPlan({ casePlans, preregisteredPages });
    return;
  }
  if (args[0] === '--live-source' && args.length === 1) {
    await runMappedSourceDiagnostic({ mode: 'live-source' });
    return;
  }
  if (args[0] === '--live-source' && args.length === 2) {
    await runMappedSourceDiagnostic({ mode: 'live-source', outputPath: path.resolve(args[1]) });
    return;
  }
  throw new Error('Use no arguments or --plan for a no-network plan, or --live-source [fresh-output-path] for the fixed mapped-source diagnostic.');
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) await main(process.argv.slice(2));
