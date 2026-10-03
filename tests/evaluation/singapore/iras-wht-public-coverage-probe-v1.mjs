import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { classifyQuestion } from '../../../src/classification/questionClassifier.ts';
import { ControlledWebRetriever } from '../../../src/retrieval/controlledWebRetriever.ts';
import { SourceCache } from '../../../src/retrieval/sourceCache.ts';
import { defaultAdvancedSourceRetriever } from '../../../src/retrieval/advancedSourceRetriever.ts';
import { IRAS_SOURCE_MAP_DEFINITIONS, getCoverageTopicsByIds } from '../../../src/standards/coverageRegistry.ts';
import { buildAuthorityWorkstreams, planAuthorityWorkstreams } from '../../../src/services/authorityWorkstreams.ts';
import { buildGroundedReasoningContext, resolveMappedOfficialSourceFallback } from '../../../src/services/groundingContextBuilder.ts';
import { renderIrasEvidenceResponse } from '../../../src/services/irasEvidencePolicy.ts';
import { supportGeneralIrasRuleConcept } from '../../../src/retrieval/irasRuleConceptSupport.ts';
import { getRequestedQuestionConcepts, reconcileQuestionUnderstanding, validateSemanticQuestionInterpretation } from '../../../src/services/semanticQuestionUnderstanding.ts';
import { createMappedOnlyTransport } from './iras-mapped-source-diagnostic-v3.mjs';
import { irasResolverCases } from '../../fixtures/irasResolverCases.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const WHT_PUBLIC_PROBE_REPORT = path.join(ROOT,
  'docs/evaluation/multi-authority-workstreams/iras-first-local-2026-10-02-v6/wht-public-coverage-probe-v1.json');
const PUBLIC_EXCERPT_REPORT = path.join(ROOT,
  'docs/evaluation/multi-authority-workstreams/iras-public-excerpts-2026-10-03-v1/iras-public-rule-excerpts-report-v1.json');
const CASE_ID = 'wht-royalty-general-rule';
const OVERVIEW_MAP_ID = 'IRAS_WHT_OVERVIEW_SOURCE_MAP';
const FETCH_TIMEOUT_MS = 10_000;
const REFERENCE_DATE = '2026-10-02';
const GAP_CODES = new Set([
  'NO_GOVERNING_AUTHORITY', 'EMPTY_ISSUE_PLAN', 'ISSUE_PLAN_HAS_UNMAPPED_RESIDUAL',
  'ISSUE_PLAN_COVERAGE_UNESTABLISHED', 'UNASSIGNED_QUERY_TOPIC', 'UNROUTED_MATERIAL_CONCEPT',
  'CANONICAL_AREA_UNRESOLVED', 'ISSUE_UNMAPPED', 'PROVIDER_UNAVAILABLE', 'PROVIDER_AUTHORITY_MISMATCH',
  'PROVIDER_ERROR', 'NO_CANDIDATE_EVIDENCE', 'CANDIDATE_REJECTED', 'NO_ADMITTED_EVIDENCE',
  'IRAS_SCOPE_NOT_COVERED', 'NO_VERIFIED_CLAIM', 'ISSUE_CONCEPT_UNCOVERED'
]);

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function fixtureInterpretation(testCase) {
  const issue = testCase.issues[0];
  return {
    schemaVersion: 2,
    jurisdiction: ['Singapore'],
    authorityCandidates: [issue.authority],
    contextualAuthorities: [],
    domain: issue.domain,
    population: issue.population,
    primarySubject: issue.subject,
    concepts: [{ concept: issue.subject, role: 'PRIMARY' }],
    requestedOperation: issue.operation,
    factsExplicitlyProvided: [],
    confidence: 0.96,
    issues: [{
      subject: issue.subject,
      population: issue.population,
      domain: issue.domain,
      governingAuthorities: [issue.authority],
      contextualAuthorities: [],
      operation: issue.operation,
      mappedTopicIds: [],
      evidenceRequirement: 'AUTHORITATIVE_SOURCE',
      confidence: 0.96
    }]
  };
}

function topicBoundToRecordProjection(record, topic) {
  return topic.sourceRecordIds.includes(record.id) ||
    record.tags?.includes(topic.id) === true ||
    record.relatedTopicIds?.includes(topic.id) === true ||
    record.sourceMapTopicIds?.includes(topic.id) === true ||
    record.retrievalHints?.includes(topic.id) === true;
}

function htmlResponse(html, status = 200) {
  return new Response(html, { status, headers: { 'content-type': 'text/html; charset=utf-8' } });
}

function emptyDiscoveryAdapters(counters) {
  return {
    discoveryAdapter: {
      async discoverOfficialSourceCandidates() { counters.discoveryInvocations += 1; return []; },
      getLastFetchTrace() { return []; }
    },
    officialDomainSearchAdapter: {
      async searchOfficialDomainCandidates() { counters.searchInvocations += 1; return []; },
      getLastSearchTrace() { return []; }
    }
  };
}

function safeReportCheck(value) {
  const forbidden = new Set(['query', 'question', 'subject', 'facts', 'sourceText', 'html', 'prompt',
    'modelPayload', 'rawResponse', 'errorMessage', 'response', 'credentials', 'token', 'apiKey']);
  const visit = (item, at = '$') => {
    if (Array.isArray(item)) return item.forEach((child, index) => visit(child, `${at}[${index}]`));
    if (!item || typeof item !== 'object') return;
    for (const [key, child] of Object.entries(item)) {
      assert.ok(!forbidden.has(key), `Unsafe WHT probe report key at ${at}.${key}`);
      visit(child, `${at}.${key}`);
    }
  };
  visit(value);
  return value;
}

function gapCodes(gaps) {
  return [...new Set((gaps || []).map(gap => GAP_CODES.has(gap.code) ? gap.code : 'OTHER_GAP'))].sort();
}

async function fixedWhtIssue() {
  const testCase = irasResolverCases.find(candidate => candidate.id === CASE_ID);
  assert.ok(testCase && testCase.issues.length === 1, 'Frozen WHT fixture contract is unavailable');
  const interpretation = fixtureInterpretation(testCase);
  assert.ok(validateSemanticQuestionInterpretation(interpretation, testCase.query),
    'Frozen WHT synthetic semantic contract failed validation');
  const understanding = { mode: 'SEMANTIC_INTERPRETATION', interpretation };
  const classification = classifyQuestion(testCase.query);
  const reconciled = reconcileQuestionUnderstanding(testCase.query, classification, understanding);
  assert.equal(reconciled.issuePlan.source, 'SEMANTIC_ISSUES');
  const planned = planAuthorityWorkstreams(reconciled.issuePlan);
  const issue = reconciled.issuePlan.issues[0];
  const workstream = planned.find(candidate => candidate.authority === 'IRAS' && candidate.issueIds.includes(issue.id));
  assert.ok(workstream, 'Frozen WHT issue did not reconcile to an IRAS workstream');
  const topics = getCoverageTopicsByIds(issue.mappedTopicIds).filter(topic =>
    topic.domainId.startsWith('IRAS_') && !topic.routingOnly);
  const topicIds = [...new Set(topics.map(topic => topic.id))].sort();
  const mapsById = new Map(IRAS_SOURCE_MAP_DEFINITIONS.map(definition => [definition.id, definition]));
  const definitions = [...new Set(topics.flatMap(topic => IRAS_SOURCE_MAP_DEFINITIONS.filter(definition =>
    definition.domainId === topic.domainId && definition.topicIds.includes(topic.id))))]
    .map(definition => mapsById.get(definition.id)).filter(Boolean);
  const requestedConcepts = getRequestedQuestionConcepts(testCase.query, understanding).filter(concept =>
    concept.topicIds.length === 0 || concept.topicIds.some(topicId => topicIds.includes(topicId)));
  const domainId = topics[0]?.domainId;
  assert.ok(domainId && topicIds.length > 0 && definitions.length > 0);
  const evidenceScope = {
    authority: 'IRAS',
    domain: workstream.domain,
    topicIds,
    requestedConcepts,
    context: {
      domainId,
      population: issue.population,
      primarySubject: issue.subject,
      concepts: [issue.subject],
      requestedOperation: issue.operation
    }
  };
  return { testCase, understanding, reconciled, issue, topicIds, topics, definitions, requestedConcepts,
    evidenceScope, workstream };
}

export async function runWhtPublicCoverageProbe() {
  const reportEnvelope = JSON.parse(await readFile(PUBLIC_EXCERPT_REPORT, 'utf8'));
  const publicPage = reportEnvelope.results.find(page => page.mapId === OVERVIEW_MAP_ID);
  const overviewExcerpt = publicPage?.excerpts
    .find(excerpt => excerpt.blockIndex === 10);
  assert.ok(overviewExcerpt && typeof overviewExcerpt.text === 'string', 'Saved public overview block 10 is missing');
  const mapDefinition = IRAS_SOURCE_MAP_DEFINITIONS.find(item => item.id === OVERVIEW_MAP_ID);
  assert.ok(mapDefinition, 'Registered overview map is missing');

  const issuePlan = await fixedWhtIssue();
  const overviewUrl = mapDefinition.canonicalSourceUrl;
  const urlSet = new Set(issuePlan.definitions.map(definition => definition.canonicalSourceUrl));
  assert.ok(urlSet.has(overviewUrl), 'Overview map is outside the frozen WHT map selection');
  const canonicalUrls = [...urlSet].map(canonicalUrl => ({
    canonicalUrl,
    host: new URL(canonicalUrl).hostname.toLowerCase(),
    mapIds: issuePlan.definitions.filter(definition => definition.canonicalSourceUrl === canonicalUrl)
      .map(definition => definition.id).sort(),
    topicIds: issuePlan.topics.filter(topic => issuePlan.definitions.some(definition =>
      definition.canonicalSourceUrl === canonicalUrl && definition.topicIds.includes(topic.id)))
      .map(topic => topic.id).sort()
  }));
  const html = `<!doctype html><html><head><title>${mapDefinition.pageTitle} | IRAS</title></head><body><main>` +
    `<h1>${mapDefinition.pageTitle}</h1><p>${overviewExcerpt.text}</p></main></body></html>`;
  const syntheticFetchCounts = new Map();
  const transport = createMappedOnlyTransport({
    canonicalUrls,
    fetchImpl: async urlValue => {
      const url = new URL(urlValue).toString();
      syntheticFetchCounts.set(url, (syntheticFetchCounts.get(url) || 0) + 1);
      return url === overviewUrl ? htmlResponse(html) : htmlResponse('', 503);
    },
    maxActualGets: urlSet.size
  });
  const webRetriever = new ControlledWebRetriever(undefined, new SourceCache());
  const adapterCounters = { discoveryInvocations: 0, searchInvocations: 0 };
  const adapters = emptyDiscoveryAdapters(adapterCounters);
  const fetchOptions = { timeoutMs: FETCH_TIMEOUT_MS, useCache: false, maxRedirects: 1, customFetch: transport.fetch };
  const commonOptions = {
    webRetriever,
    fetchOptions,
    ...adapters,
    authorityLevelDiscovery: false,
    localOnly: false,
    referenceDate: REFERENCE_DATE,
    questionUnderstanding: issuePlan.understanding,
    evidenceScope: issuePlan.evidenceScope
  };

  const oldFetch = globalThis.fetch;
  let ambientFetchAttempts = 0;
  globalThis.fetch = async () => { ambientFetchAttempts += 1; throw new Error('AMBIENT_FETCH_BLOCKED'); };
  try {
    const fallback = await resolveMappedOfficialSourceFallback(issuePlan.topicIds, issuePlan.testCase.query,
      defaultAdvancedSourceRetriever, commonOptions);
    const overviewRecords = fallback.records.filter(record =>
      (record.canonicalSourceUrl || record.officialSourceUrl) === overviewUrl);
    const helperFlags = overviewRecords.map(record => Object.fromEntries(issuePlan.requestedConcepts.map(concept => {
      const result = supportGeneralIrasRuleConcept({
        sourceText: record.sourceText || '',
        domainId: issuePlan.evidenceScope.context.domainId,
        topicIds: issuePlan.topicIds,
        subject: issuePlan.issue.subject,
        population: issuePlan.issue.population,
        concepts: [concept]
      });
      return [concept.id, result === true];
    })));

    const context = await buildGroundedReasoningContext(issuePlan.testCase.query, null,
      defaultAdvancedSourceRetriever, null, commonOptions);
    const rendered = renderIrasEvidenceResponse({}, context, issuePlan.testCase.query, null, 'SFRS_I', 'LOCAL');
    const accepted = rendered.claimVerification?.accepted || [];
    const rejected = rendered.claimVerification?.rejected || [];
    const admittedRecords = context.evidenceQuality?.eligibleRecords || [];
    const renderTopicBindings = admittedRecords.map(record => Object.fromEntries(issuePlan.topicIds.map(topicId =>
      [topicId, issuePlan.topics.some(topic => topic.id === topicId && topicBoundToRecordProjection(record, topic))])));
    const renderConceptSupport = issuePlan.requestedConcepts.map(concept => ({
      conceptId: concept.id,
      supportedByOverview: overviewRecords.some(record => supportGeneralIrasRuleConcept({
        sourceText: record.sourceText || '',
        domainId: issuePlan.evidenceScope.context.domainId,
        topicIds: issuePlan.topicIds,
        subject: issuePlan.issue.subject,
        population: issuePlan.issue.population,
        concepts: [concept]
      }) === true)
    }));

    const runtime = await buildAuthorityWorkstreams(issuePlan.testCase.query, issuePlan.reconciled.issuePlan, {
      retriever: defaultAdvancedSourceRetriever,
      localOnly: false,
      referenceDate: REFERENCE_DATE,
      questionUnderstanding: issuePlan.understanding,
      groundingOptions: {
        webRetriever,
        fetchOptions,
        ...adapters,
        localOnly: false,
        authorityLevelDiscovery: false,
        referenceDate: REFERENCE_DATE
      }
    });
    const runtimeIssue = runtime.workstreams.flatMap(workstream => workstream.issues)
      .find(item => item.issueId === issuePlan.issue.id);
    assert.ok(runtimeIssue, 'Central workstream omitted the frozen WHT issue');
    const finalTopicBindings = (runtimeIssue.sources || []).map(record => Object.fromEntries(issuePlan.topicIds.map(topicId =>
      [topicId, issuePlan.topics.some(topic => topic.id === topicId && topicBoundToRecordProjection(record, topic))])));
    const finalVerifiedHelperSupport = (runtimeIssue.verifiedClaims || []).map(claim => ({
      recordBoundTopicIds: issuePlan.topicIds.filter(topicId => {
        const record = (runtimeIssue.sources || []).find(source => source.id === claim.recordId);
        return record && issuePlan.topics.some(topic => topic.id === topicId && topicBoundToRecordProjection(record, topic));
      }),
      conceptSupported: issuePlan.requestedConcepts.some(concept => supportGeneralIrasRuleConcept({
        sourceText: claim.quote || '',
        domainId: issuePlan.evidenceScope.context.domainId,
        topicIds: issuePlan.topicIds,
        subject: issuePlan.issue.subject,
        population: issuePlan.issue.population,
        concepts: [concept]
      }) === true)
    }));
    const transportSnapshot = transport.snapshot();
    const closedMapIds = issuePlan.definitions.filter(definition => definition.id !== OVERVIEW_MAP_ID)
      .map(definition => definition.id).sort();
    const overviewBoundTopicIds = issuePlan.topicIds.filter(topicId =>
      overviewRecords.some(record => issuePlan.topics.some(topic => topic.id === topicId && topicBoundToRecordProjection(record, topic))));
    const finalClaimBoundTopicIds = [...new Set(finalVerifiedHelperSupport.flatMap(item => item.recordBoundTopicIds))].sort();
    const uncoveredFinalTopicIds = issuePlan.topicIds.filter(topicId => !finalClaimBoundTopicIds.includes(topicId));
    const syntheticTransportSnapshot = transport.snapshot();
    assert.equal(syntheticTransportSnapshot.actualGetCount, syntheticFetchCounts.size,
      'Synthetic mapped transport unexpectedly bypassed its response stub');
    assert.equal(ambientFetchAttempts, 0,
      'No ambient fetch attempts are allowed outside the synthetic mapped transport');
    assert.equal(finalVerifiedHelperSupport.filter(item => item.conceptSupported).length, 1,
      'The final retained public quotation must retain WHT concept support');
    assert.ok(uncoveredFinalTopicIds.includes('iras-withholding-tax-interest-royalties'),
      'Final retained claim must leave the requested interest-and-royalties topic uncovered');
    assert.ok((runtimeIssue.gaps || []).some(gap => gap.code === 'ISSUE_CONCEPT_UNCOVERED'),
      'Central workstream must retain its topic-coverage gap');

    return safeReportCheck({
      schemaVersion: 1,
      diagnostic: 'API_FREE_SYNTHETIC_WHT_COVERAGE_PROBE',
      sourceComposition: 'SAVED_PUBLIC_OVERVIEW_BLOCK_10_ONLY; OTHER_FROZEN_WHT_MAPS_CLOSED_503; NOT_CAPTURED_PAGES',
      caseId: CASE_ID,
      publicSource: {
        mapId: OVERVIEW_MAP_ID,
        excerptBlockIndex: 10,
        excerptCharCount: overviewExcerpt.text.length,
        documentSha256: publicPage.documentSha256,
        excerptSha256: sha256(overviewExcerpt.text),
        syntheticHtmlSha256: sha256(html)
      },
      scope: {
        topicIds: issuePlan.topicIds,
        mapIds: issuePlan.definitions.map(definition => definition.id).sort(),
        conceptIds: issuePlan.requestedConcepts.map(concept => concept.id).sort()
      },
      bounds: {
        fetchTimeoutMs: FETCH_TIMEOUT_MS,
        syntheticTransportCalls: transportSnapshot.actualGetCount,
        mapUrlCount: canonicalUrls.length,
        discoveryAdapterInvocations: adapterCounters.discoveryInvocations,
        searchAdapterInvocations: adapterCounters.searchInvocations,
        closedMapIds,
        ambientFetchAttempts
      },
      direct: {
        candidateCount: fallback.records.length,
        overviewRecordCount: overviewRecords.length,
        admittedOverviewRecordCount: admittedRecords.filter(record =>
          (record.canonicalSourceUrl || record.officialSourceUrl) === overviewUrl).length,
        overviewConceptSupportFlags: Object.assign({}, ...helperFlags),
        boundTopicIds: overviewBoundTopicIds,
        unboundRequestedTopicIds: issuePlan.topicIds.filter(topicId => !overviewBoundTopicIds.includes(topicId)),
        overviewRecordTopicBindingFlags: overviewRecords.map(record => Object.fromEntries(issuePlan.topicIds.map(topicId =>
          [topicId, issuePlan.topics.some(topic => topic.id === topicId && topicBoundToRecordProjection(record, topic))])))
      },
      renderer: {
        acceptedClaimCount: accepted.length,
        rejectedClaimCount: rejected.length,
        eligibleRecordCount: admittedRecords.length,
        uncoveredTopicIds: [...(context.evidenceQuality?.uncoveredTopicIds || [])]
          .filter(id => issuePlan.topicIds.includes(id)).sort(),
        uncoveredConceptIds: issuePlan.requestedConcepts
          .filter(concept => (context.evidenceQuality?.uncoveredConcepts || []).includes(concept.label))
          .map(concept => concept.id).sort(),
        conceptSupport: renderConceptSupport,
        recordTopicBindingFlags: renderTopicBindings
      },
      central: {
        overallStatus: ['VERIFIED', 'CONDITIONAL', 'INSUFFICIENT'].includes(runtime.status) ? runtime.status : 'OTHER_STATUS',
        evidenceStatus: ['VERIFIED', 'INSUFFICIENT'].includes(runtimeIssue.evidenceStatus) ? runtimeIssue.evidenceStatus : 'OTHER_STATUS',
        applicationStatus: ['UNRESOLVED', 'NOT_REQUIRED'].includes(runtimeIssue.applicationStatus)
          ? runtimeIssue.applicationStatus : 'OTHER_STATUS',
        finalVerifiedClaimCount: runtimeIssue.verifiedClaims?.length || 0,
        finalSourceCount: runtimeIssue.sources?.length || 0,
        gapCodes: gapCodes(runtimeIssue.gaps),
        uncoveredConceptIds: issuePlan.requestedConcepts.filter(concept => (runtimeIssue.gaps || []).some(gap =>
          gap.code === 'ISSUE_CONCEPT_UNCOVERED' && gap.reason ===
            `Verified quotations do not support the requested concept ${concept.id}.`)).map(concept => concept.id).sort(),
        verifiedClaimSupport: finalVerifiedHelperSupport,
        recordTopicBindingFlags: finalTopicBindings,
        uncoveredRequestTopics: issuePlan.topicIds.filter(topicId => !finalTopicBindings.some(flags => flags[topicId]))
      },
      conclusion: {
        conceptSupportPresent: finalVerifiedHelperSupport.some(item => item.conceptSupported),
        requestedTopicBindingMissing: uncoveredFinalTopicIds.length > 0,
        supportedFinalClaimLeavesRequestedTopicUncovered: finalVerifiedHelperSupport.some(item => item.conceptSupported) &&
          uncoveredFinalTopicIds.length > 0 &&
          (runtimeIssue.gaps || []).some(gap => gap.code === 'ISSUE_CONCEPT_UNCOVERED'),
        missingTopicIds: uncoveredFinalTopicIds
      }
    });
  } finally {
    globalThis.fetch = oldFetch;
  }
}

export async function writeWhtPublicCoverageProbeReport({ outputPath = WHT_PUBLIC_PROBE_REPORT } = {}) {
  const report = await runWhtPublicCoverageProbe();
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const report = await writeWhtPublicCoverageProbeReport();
  process.stdout.write(`${JSON.stringify({ reportPath: path.relative(ROOT, WHT_PUBLIC_PROBE_REPORT),
    gapCodes: report.central.gapCodes, missingTopicIds: report.conclusion.missingTopicIds })}\n`);
}
