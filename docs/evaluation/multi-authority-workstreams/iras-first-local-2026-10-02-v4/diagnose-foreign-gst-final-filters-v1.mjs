import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyQuestion } from '../../../../src/classification/questionClassifier.ts';
import { defaultAdvancedSourceRetriever } from '../../../../src/retrieval/advancedSourceRetriever.ts';
import { defaultTargetDateResolver } from '../../../../src/retrieval/targetDateResolver.ts';
import { evaluateEvidenceQuality, matchesRequestedQuestionConcept } from '../../../../src/retrieval/evidenceQualityGate.ts';
import { IRAS_SOURCE_MAP_DEFINITIONS, getCoverageTopicsByIds } from '../../../../src/standards/coverageRegistry.ts';
import { UNIFIED_SOURCE_REGISTRY } from '../../../../src/standards/unifiedSourceModel.ts';
import { buildAuthorityWorkstreams, planAuthorityWorkstreams } from '../../../../src/services/authorityWorkstreams.ts';
import { buildGroundedReasoningContext } from '../../../../src/services/groundingContextBuilder.ts';
import { renderIrasEvidenceResponse } from '../../../../src/services/irasEvidencePolicy.ts';
import {
  getRequestedQuestionConcepts,
  reconcileQuestionUnderstanding,
  validateSemanticQuestionInterpretation
} from '../../../../src/services/semanticQuestionUnderstanding.ts';
import { ControlledWebRetriever } from '../../../../src/retrieval/controlledWebRetriever.ts';
import { SourceCache } from '../../../../src/retrieval/sourceCache.ts';
import { irasResolverCases } from '../../../../tests/fixtures/irasResolverCases.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url));
const referenceDate = '2026-10-02';
const selectedIds = ['foreign-dividend-treatment', 'gst-input-tax-general-rule'];
const localFixtures = JSON.parse(await readFile(path.join(directory, 'local-evidence-fixtures.json'), 'utf8'));
const mapByTopic = new Map();
for (const map of IRAS_SOURCE_MAP_DEFINITIONS) {
  for (const topicId of map.topicIds) {
    const definitions = mapByTopic.get(topicId) || [];
    definitions.push(map);
    mapByTopic.set(topicId, definitions);
  }
}

const originalFetch = globalThis.fetch;
let ambientFetchCalls = 0;
globalThis.fetch = async (...args) => {
  ambientFetchCalls += 1;
  throw new Error(`NETWORK_DISABLED:${String(args[0] || '')}`);
};

function syntheticInterpretation(testCase) {
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
      evidenceRequirement: issue.facts ? 'AUTHORITATIVE_SOURCE_AND_CASE_FACTS' : 'AUTHORITATIVE_SOURCE',
      confidence: 0.96
    }]
  };
}

function buildCasePlan(caseId) {
  const testCase = irasResolverCases.find(item => item.id === caseId);
  assert.ok(testCase, `Frozen resolver fixture exists: ${caseId}`);
  assert.equal(testCase.issues.length, 1, `${caseId}: one frozen issue is required`);
  const interpretation = syntheticInterpretation(testCase);
  assert.ok(validateSemanticQuestionInterpretation(interpretation, testCase.query),
    `${caseId}: V4's fixture-derived interpretation remains valid`);
  const understanding = { mode: 'SEMANTIC_INTERPRETATION', interpretation };
  const classification = classifyQuestion(testCase.query);
  const reconciled = reconcileQuestionUnderstanding(testCase.query, classification, understanding);
  assert.equal(reconciled.issuePlan.source, 'SEMANTIC_ISSUES');
  const issue = reconciled.issuePlan.issues[0];
  const workstream = planAuthorityWorkstreams(reconciled.issuePlan).find(candidate =>
    candidate.authority === 'IRAS' && candidate.issueIds.includes(issue.id));
  assert.ok(workstream, `${caseId}: issue has a planned IRAS workstream`);
  const topics = getCoverageTopicsByIds(issue.mappedTopicIds).filter(topic =>
    topic.domainId.startsWith('IRAS_') && !topic.routingOnly);
  const topicIds = [...new Set(topics.map(topic => topic.id))].sort();
  const definitionsById = new Map();
  for (const topic of topics) {
    for (const definition of mapByTopic.get(topic.id) || []) {
      if (definition.domainId === topic.domainId) definitionsById.set(definition.id, definition);
    }
  }
  const definitions = [...definitionsById.values()];
  const requestedConcepts = getRequestedQuestionConcepts(testCase.query, understanding)
    .filter(concept => concept.topicIds.some(topicId => topicIds.includes(topicId)));
  assert.ok(topicIds.length && definitions.length, `${caseId}: topic and source-map selection is mapped`);
  const sourceDomain = topics[0].domainId;
  const evidenceScope = {
    authority: 'IRAS',
    domain: workstream.domain,
    topicIds,
    requestedConcepts,
    context: {
      domainId: sourceDomain,
      population: issue.population,
      primarySubject: issue.subject,
      concepts: [issue.subject],
      requestedOperation: issue.operation
    }
  };
  return { caseId, testCase, understanding, issue, issuePlan: reconciled.issuePlan,
    workstream, topics, topicIds, definitions, requestedConcepts, evidenceScope };
}

function emptyAdapters() {
  return {
    discoveryAdapter: {
      async discoverOfficialSourceCandidates() { return []; },
      getLastFetchTrace() { return []; }
    },
    officialDomainSearchAdapter: {
      async searchOfficialDomainCandidates() { return []; },
      getLastSearchTrace() { return []; }
    }
  };
}

function html(title, paragraph) {
  const escape = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  return `<html><head><title>${escape(title)}</title></head><body><main><h1>${escape(title)}</h1><p>${escape(paragraph)}</p></main></body></html>`;
}

function urlKey(value) {
  const url = new URL(String(value));
  const host = url.hostname.toLowerCase() === 'iras.gov.sg' ? 'www.iras.gov.sg' : url.hostname.toLowerCase();
  return `${host}${url.pathname.toLowerCase().replace(/\/$/, '')}`;
}

function emptyLocalRetriever() {
  return {
    async retrieveSources() { return []; },
    getSourceById: id => defaultAdvancedSourceRetriever.getSourceById(id),
    findSourcesByStandardOrAct: (...args) => defaultAdvancedSourceRetriever.findSourcesByStandardOrAct(...args)
  };
}

function claimMatchingProjection(claims, concepts) {
  return claims.map((claim, index) => ({
    claimIndex: index,
    quoteLength: claim.quote.length,
    quoteSha256Prefix: hash(claim.quote).slice(0, 12),
    evidenceQualityConceptMatcherIds: concepts.filter(concept => matchesRequestedQuestionConcept(claim.quote, concept))
      .map(concept => concept.id)
  }));
}

function hash(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function centralRun(casePlan, candidates, claims, evidenceQualityTrace) {
  const targetDate = defaultTargetDateResolver.resolveTargetDate(casePlan.testCase.query, referenceDate).targetDate;
  const centralQuality = evaluateEvidenceQuality({
    query: casePlan.testCase.query,
    topicIds: casePlan.topicIds,
    records: candidates,
    missingFacts: [],
    targetDate,
    referenceDate,
    authorities: ['IRAS'],
    requestedConcepts: casePlan.requestedConcepts,
    sourceMapFallbackTrace: evidenceQualityTrace
  });
  const provider = {
    authority: 'IRAS',
    async retrieve() {
      return { candidates, claims, evidenceQualityTrace, trace: { status: 'SUCCESS', attempts: [] } };
    }
  };
  const runtime = await buildAuthorityWorkstreams(casePlan.testCase.query, casePlan.issuePlan, {
    retriever: defaultAdvancedSourceRetriever,
    referenceDate,
    questionUnderstanding: casePlan.understanding,
    providers: { IRAS: provider }
  });
  const issue = runtime.workstreams.flatMap(item => item.issues).find(item => item.issueId === casePlan.issue.id);
  assert.ok(issue, `${casePlan.caseId}: central workstream issue returned`);
  assert.equal(issue.lifecycle.admitted, centralQuality.eligibleRecords.length > 0,
    `${casePlan.caseId}: central admission replay agrees with workstream lifecycle`);
  return { centralQuality, issue };
}

async function runCase(casePlan) {
  const localFetchAttempts = [];
  const localOnlyContext = await buildGroundedReasoningContext(casePlan.testCase.query, null,
    defaultAdvancedSourceRetriever, undefined, {
      ...emptyAdapters(),
      localOnly: true,
      authorityLevelDiscovery: false,
      referenceDate,
      questionUnderstanding: casePlan.understanding,
      evidenceScope: casePlan.evidenceScope,
      webRetriever: new ControlledWebRetriever(undefined, new SourceCache()),
      fetchOptions: {
        timeoutMs: 1000,
        useCache: false,
        customFetch: async url => {
          localFetchAttempts.push(String(url));
          throw new Error('LOCAL_ONLY_TRANSPORT_BLOCKED');
        }
      }
    });
  const localRendered = renderIrasEvidenceResponse({}, localOnlyContext, casePlan.testCase.query,
    null, 'SFRS_I', 'LOCAL');
  const localCandidates = localOnlyContext.evidenceQuality?.eligibleRecords || [];
  const localClaims = localRendered.claimVerification.accepted;
  const localCentral = await centralRun(casePlan, localCandidates, localClaims,
    localOnlyContext.sourceMapFallbackTrace);

  const fixtureCaseIds = casePlan.caseId === 'foreign-dividend-treatment'
    ? ['foreign-dividend-conditional-rule', 'foreign-income-without-dividend-negative']
    : ['gst-input-tax-natural', 'gst-input-tax-phrase-matched'];
  const sourceProbes = [];
  for (const fixtureCaseId of fixtureCaseIds) {
    const fixture = fixtureCaseId === 'foreign-dividend-conditional-rule'
      ? localFixtures.cases['foreign-dividend-conditional-rule']
      : fixtureCaseId === 'foreign-income-without-dividend-negative'
        ? localFixtures.cases['foreign-income-without-dividend-negative']
        : localFixtures.cases[fixtureCaseId];
    assert.ok(fixture, `Local synthetic passage exists: ${fixtureCaseId}`);
    assert.ok(casePlan.topicIds.includes(fixture.topicId), `${fixtureCaseId}: topic is in the frozen issue scope`);
    const urls = new Map(casePlan.definitions.map(definition => [
      urlKey(definition.canonicalSourceUrl),
      UNIFIED_SOURCE_REGISTRY[definition.id]?.documentTitle
    ]));
    const fixtureFetches = [];
    const syntheticFetch = async url => {
      const key = urlKey(url);
      fixtureFetches.push(hash(key).slice(0, 12));
      const title = urls.get(key);
      assert.ok(title, `${casePlan.caseId}: fixture transport rejected unmapped URL`);
      return new Response(html(title, fixture.passage), {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' }
      });
    };
    const sourceContext = await buildGroundedReasoningContext(casePlan.testCase.query, null,
      emptyLocalRetriever(), undefined, {
        ...emptyAdapters(),
        localOnly: false,
        authorityLevelDiscovery: false,
        referenceDate,
        questionUnderstanding: casePlan.understanding,
        evidenceScope: casePlan.evidenceScope,
        webRetriever: new ControlledWebRetriever(undefined, new SourceCache()),
        fetchOptions: { timeoutMs: 1000, useCache: false, customFetch: syntheticFetch }
      });
    const rendered = renderIrasEvidenceResponse({}, sourceContext, casePlan.testCase.query,
      null, 'SFRS_I', 'LOCAL');
    const candidates = sourceContext.evidenceQuality?.eligibleRecords || [];
    const claims = rendered.claimVerification.accepted;
    const central = await centralRun(casePlan, candidates, claims, sourceContext.sourceMapFallbackTrace);
    sourceProbes.push({
      fixtureCaseId,
      syntheticQuoteSha256Prefix: hash(fixture.passage).slice(0, 12),
      syntheticQuoteLength: fixture.passage.length,
      fixtureFetchCount: fixtureFetches.length,
      fixtureFetchUrlSha256Prefixes: fixtureFetches,
      expectedMapUrlSha256Prefixes: casePlan.definitions.map(definition => hash(urlKey(definition.canonicalSourceUrl)).slice(0, 12)).sort(),
      sourceMapAttemptStatuses: (sourceContext.sourceMapFallbackTrace?.attempts || []).map(attempt => ({
        topicId: attempt.topicId,
        fetchStatus: attempt.fetchStatus,
        titleMatched: attempt.titleMatched,
        contentMatched: attempt.contentMatched
      })),
      candidateRecordCount: sourceContext.sourceMapFallbackTrace?.selectedRecordIds?.length || 0,
      renderer: {
        acceptedClaimCount: claims.length,
        rejectedClaimCount: rendered.claimVerification.rejected.length,
        acceptedClaimMatches: claimMatchingProjection(claims, casePlan.requestedConcepts)
      },
      centralAdmission: {
        inputRecordCount: candidates.length,
        eligibleRecordCount: central.centralQuality.eligibleRecords.length,
        rejected: central.centralQuality.rejectedRecords.map(item => ({ code: item.code, topicId: item.topicId }))
      },
      centralIssue: {
        finalVerifiedClaimCount: central.issue.verifiedClaims.length,
        evidenceStatus: central.issue.evidenceStatus,
        applicationStatus: central.issue.applicationStatus,
        firstUnresolvedStage: candidates.length === 0 ? 'MAPPED_SOURCE_CANDIDATE_SELECTION' :
          claims.length > 0 && central.issue.verifiedClaims.length === 0 ? 'CENTRAL_POST_LITERAL_CLAIM_TOPIC_OR_SUBJECT_FILTER' :
            central.centralQuality.uncoveredConcepts.length ? 'CENTRAL_REQUESTED_CONCEPT_COVERAGE' : 'NONE',
        lifecycle: central.issue.lifecycle,
        gaps: central.issue.gaps.map(gap => ({ stage: gap.stage, code: gap.code }))
      },
      topicCoverage: {
        coveredTopicIds: central.centralQuality.coveredTopicIds,
        uncoveredTopicIds: central.centralQuality.uncoveredTopicIds
      },
      uncoveredConceptIds: central.centralQuality.uncoveredConcepts.map(item =>
        casePlan.requestedConcepts.find(concept => concept.label === item)?.id || 'UNMAPPED_LABEL')
    });
  }

  return {
    caseId: casePlan.caseId,
    fixtureCaseId: casePlan.testCase.id,
    authority: 'IRAS',
    domain: casePlan.issue.domain,
    population: casePlan.issue.population,
    operation: casePlan.issue.operation,
    evidenceRequirement: casePlan.issue.evidenceRequirement,
    topicIds: casePlan.topicIds,
    requestedConcepts: casePlan.requestedConcepts.map(concept => ({
      id: concept.id,
      label: concept.label,
      terms: concept.terms,
      topicIds: concept.topicIds
    })),
    finalClaimMatchingRoute: casePlan.issue.domain === 'IRAS_INCOME_TAX'
      ? 'topic-plus-issue-subject OR matchesRequestedQuestionConcept'
      : 'topic-plus-issue-subject OR distinctive-concept-phrase-plus-issue-subject',
    localOnlyDefaultRetriever: {
      localFetchAttempts: localFetchAttempts.length,
      localEligibleRecordCount: localCandidates.length,
      eligibleRecordIds: localCandidates.map(record => record.id),
      rendererAcceptedClaimCount: localClaims.length,
      rendererAcceptedClaimMatches: claimMatchingProjection(localClaims, casePlan.requestedConcepts),
      rendererRejectedClaimCount: localRendered.claimVerification.rejected.length,
      centralAdmittedRecordCount: localCentral.centralQuality.eligibleRecords.length,
      centralCoveredTopicIds: localCentral.centralQuality.coveredTopicIds,
      centralUncoveredTopicIds: localCentral.centralQuality.uncoveredTopicIds,
      centralUncoveredConcepts: localCentral.centralQuality.uncoveredConcepts,
      finalVerifiedClaimCount: localCentral.issue.verifiedClaims.length,
      applicationStatus: localCentral.issue.applicationStatus,
      firstUnresolvedStage: localCandidates.length === 0 ? 'LOCAL_CANDIDATE_SELECTION' :
        localClaims.length > 0 && localCentral.issue.verifiedClaims.length === 0 ? 'CENTRAL_POST_LITERAL_CLAIM_TOPIC_OR_SUBJECT_FILTER' :
          localCentral.centralQuality.uncoveredConcepts.length ? 'CENTRAL_REQUESTED_CONCEPT_COVERAGE' : 'NONE',
      gapCodes: localCentral.issue.gaps.map(gap => gap.code)
    },
    syntheticMappedPageProbes: sourceProbes
  };
}

try {
  const plans = selectedIds.map(buildCasePlan);
  assert.equal(plans.length, 2);
  assert.equal(ambientFetchCalls, 0);
  const rows = [];
  for (const plan of plans) rows.push(await runCase(plan));
  assert.equal(ambientFetchCalls, 0, 'No ambient network request occurred');
  const report = {
    schemaVersion: 1,
    profileVersion: 'foreign-gst-central-filter-diagnostic-v1',
    mode: 'API_FREE_LOCAL_AND_SYNTHETIC_MAPPED_PAGE_PROBES',
    referenceDate,
    selectedCaseIds: selectedIds,
    modelRequests: 0,
    ambientFetchCalls,
    caveats: [
      'The default local-only section uses the production local retriever with network blocked.',
      'Mapped-page sections use hand-authored synthetic paragraphs and a local-only custom transport; they are not IRAS quotations or retained live HTML.',
      'The frozen V4 live response body was not retained, so synthetic probes identify current matching conditions but cannot name the exact absent token in that live excerpt.'
    ],
    cases: rows
  };
  const tracePath = path.join(directory, 'foreign-gst-central-filter-diagnostic-v1.json');
  await writeFile(tracePath, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} finally {
  globalThis.fetch = originalFetch;
}
