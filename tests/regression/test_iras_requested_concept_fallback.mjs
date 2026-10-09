import assert from 'node:assert/strict';
import { classifyQuestion } from '../../src/classification/questionClassifier.ts';
import { ControlledWebRetriever } from '../../src/retrieval/controlledWebRetriever.ts';
import { defaultAdvancedSourceRetriever } from '../../src/retrieval/advancedSourceRetriever.ts';
import { evaluateEvidenceQuality } from '../../src/retrieval/evidenceQualityGate.ts';
import { SourceCache } from '../../src/retrieval/sourceCache.ts';
import { getCoverageTopicById, IRAS_SOURCE_MAP_DEFINITIONS } from '../../src/standards/coverageRegistry.ts';
import { UNIFIED_SOURCE_REGISTRY } from '../../src/standards/unifiedSourceModel.ts';
import { buildAuthorityWorkstreams } from '../../src/services/authorityWorkstreams.ts';
import { getRequestedQuestionConcepts, reconcileQuestionUnderstanding, validateSemanticQuestionInterpretation } from '../../src/services/semanticQuestionUnderstanding.ts';
import { supportGeneralIrasRuleConcept } from '../../src/retrieval/irasRuleConceptSupport.ts';
import { irasResolverCases } from '../fixtures/irasResolverCases.mjs';

const REFERENCE_DATE = '2026-10-02';
const testCase = irasResolverCases.find(item => item.id === 'gst-input-tax-general-rule');
assert.ok(testCase, 'The frozen GST input-tax case exists.');
assert.equal(testCase.issues.length, 1, 'The frozen GST case remains a single-issue contract.');

const frozenIssue = testCase.issues[0];
const interpretation = {
  schemaVersion: 2,
  jurisdiction: ['Singapore'],
  authorityCandidates: ['IRAS'],
  contextualAuthorities: [],
  domain: frozenIssue.domain,
  population: frozenIssue.population,
  primarySubject: frozenIssue.subject,
  concepts: [{ concept: frozenIssue.subject, role: 'PRIMARY' }],
  requestedOperation: frozenIssue.operation,
  factsExplicitlyProvided: [],
  confidence: 0.96,
  issues: [{
    subject: frozenIssue.subject,
    population: frozenIssue.population,
    domain: frozenIssue.domain,
    governingAuthorities: ['IRAS'],
    contextualAuthorities: [],
    operation: frozenIssue.operation,
    mappedTopicIds: [],
    evidenceRequirement: 'AUTHORITATIVE_SOURCE',
    confidence: 0.96
  }]
};
assert.ok(validateSemanticQuestionInterpretation(interpretation, testCase.query));
const questionUnderstanding = { mode: 'SEMANTIC_INTERPRETATION', interpretation };
const classification = classifyQuestion(testCase.query);
const reconciled = reconcileQuestionUnderstanding(testCase.query, classification, questionUnderstanding);
assert.equal(reconciled.issuePlan.source, 'SEMANTIC_ISSUES');
assert.equal(reconciled.issuePlan.issues.length, 1);

const topicId = 'iras-gst-input-tax';
assert.ok(reconciled.classification.topicIds.includes(topicId), 'The public classifier maps the frozen query to GST input tax.');
const requestedConcepts = getRequestedQuestionConcepts(testCase.query, questionUnderstanding);
assert.equal(requestedConcepts.length, 1);
const requestedConcept = requestedConcepts[0];
assert.ok(requestedConcept.topicIds.includes(topicId));

// This is the actual reviewed local blocked-input-tax record. It covers the
// mapped topic at the production quality gate, but does not support the frozen
// general claim concept.
const localRecord = UNIFIED_SOURCE_REGISTRY.GST_REG26_BLOCKED_INPUT_TAX;
assert.ok(localRecord?.sourceText);
const localQuality = evaluateEvidenceQuality({
  query: testCase.query,
  topicIds: reconciled.classification.topicIds,
  records: [localRecord],
  missingFacts: classification.missingFacts,
  requestedConcepts,
  authorities: ['IRAS'],
  referenceDate: REFERENCE_DATE
});
assert.ok(localQuality.eligibleRecords.some(record => record.id === localRecord.id));
assert.deepEqual(localQuality.uncoveredTopicIds, [], 'The local record covers the existing mapped topic.');
assert.deepEqual(localQuality.uncoveredConcepts, [requestedConcept.label],
  'The local blocked-rule excerpt does not support the general input-tax claim concept.');
assert.equal(localQuality.status, 'LIMITED');

const mappedRule = 'A GST-registered business may claim input tax on costs used to make taxable supplies, subject to applicable conditions and a valid tax invoice.';
assert.equal(supportGeneralIrasRuleConcept({
  sourceText: mappedRule,
  domainId: 'IRAS_GST',
  topicIds: [topicId],
  subject: frozenIssue.subject,
  population: frozenIssue.population,
  concepts: [requestedConcept]
}), true, 'The synthetic mapped excerpt supports the complete requested general-rule concept.');

const sourceMaps = IRAS_SOURCE_MAP_DEFINITIONS.filter(definition =>
  definition.domainId === 'IRAS_GST' && definition.topicIds.includes(topicId));
assert.ok(sourceMaps.length > 0, 'The topic has approved mapped IRAS pages for the synthetic transport.');
const sourceMapsByUrl = new Map(sourceMaps.map(definition => [definition.canonicalSourceUrl, definition]));
const mappedFetchCalls = [];
const discoveryCalls = [];
const searchCalls = [];
let syntheticLocalRecords = [];
let mappedBody = mappedRule;
const webRetriever = new ControlledWebRetriever(undefined, new SourceCache());
const discoveryAdapter = {
  async discoverOfficialSourceCandidates(request) { discoveryCalls.push(request.topicId); return []; },
  getLastFetchTrace() { return []; }
};
const officialDomainSearchAdapter = {
  async searchOfficialDomainCandidates(request) { searchCalls.push(request.topicId); return []; },
  getLastSearchTrace() { return []; }
};

// Preserve the real default local retrieval path, then include the real reviewed
// local record to make the local topic-covered/concept-missing condition stable.
const retriever = {
  async retrieveSources(retrievalQuery) {
    const retrieved = await defaultAdvancedSourceRetriever.retrieveSources(retrievalQuery);
    if (!retrievalQuery.topicIds?.includes(topicId)) return retrieved;
    return [...new Map([...retrieved, localRecord, ...syntheticLocalRecords].map(record => [record.id, record])).values()];
  },
  getSourceById(id) { return defaultAdvancedSourceRetriever.getSourceById(id); },
  findSourcesByStandardOrAct(standardOrActCode, paragraphOrSection) {
    return defaultAdvancedSourceRetriever.findSourcesByStandardOrAct(standardOrActCode, paragraphOrSection);
  }
};

async function runWorkstream() {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('AMBIENT_NETWORK_BLOCKED'); };
  try {
    return await buildAuthorityWorkstreams(testCase.query, reconciled.issuePlan, {
    retriever,
    questionUnderstanding,
    referenceDate: REFERENCE_DATE,
    groundingOptions: {
      webRetriever,
      fetchOptions: {
        customFetch: async (url, init = {}) => {
          const sourceMap = sourceMapsByUrl.get(url);
          assert.ok(sourceMap, 'Only frozen topic map URLs may be fetched.');
          assert.equal((init.method || 'GET').toUpperCase(), 'GET');
          assert.equal(init.redirect, 'manual');
          mappedFetchCalls.push(url);
          const html = `<!doctype html><html><head><title>${sourceMap.pageTitle} | IRAS</title></head><body><main>
            <h1>${sourceMap.pageTitle}</h1>
            <p>${mappedBody}</p>
          </main></body></html>`;
          return new Response(html, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
        },
        useCache: false,
        timeoutMs: 10_000
      },
      discoveryAdapter,
      officialDomainSearchAdapter,
      authorityLevelDiscovery: false
    }
    });
  } finally {
    globalThis.fetch = previousFetch;
  }
}
let result = await runWorkstream();

const finalIssue = result.workstreams.flatMap(workstream => workstream.issues)
  .find(issue => issue.issueId === reconciled.issuePlan.issues[0].id);
assert.ok(finalIssue, 'The public reconciled issue appears in the final workstream result.');
const mappedAttempts = finalIssue.retrievalTrace?.attempts?.filter(attempt =>
  attempt.topicId === topicId) || [];
process.stdout.write(`${JSON.stringify({
  localStatus: localQuality.status,
  localEligibleRecordCount: localQuality.eligibleRecords.length,
  localCoveredTopicIds: localQuality.coveredTopicIds,
  localUncoveredConceptIds: localQuality.uncoveredConcepts.map(() => requestedConcept.id),
  mappedFetchCount: mappedFetchCalls.length,
  mappedAttemptStatuses: mappedAttempts.map(attempt => attempt.fetchStatus),
  retainedLiveExternalRecordCount: finalIssue.sources.filter(record => record.provenance === 'LIVE_EXTERNAL').length,
  finalIssueEvidenceStatus: finalIssue.evidenceStatus,
  finalIssueLifecycle: finalIssue.lifecycle
})}\n`);

assert.ok(mappedAttempts.some(attempt => attempt.fetchStatus === 'SUCCESS'),
  'A topic-covered but concept-uncovered local IRAS result must trigger the mapped source attempt.');
assert.ok(mappedFetchCalls.length > 0, 'The mapped attempt must use only the injected synthetic response.');
assert.ok(finalIssue.sources.some(record => record.provenance === 'LIVE_EXTERNAL'),
  'The live source supporting the missing concept must remain in the issue evidence.');
assert.equal(finalIssue.evidenceStatus, 'VERIFIED',
  'The locally uncovered concept is verified after the matching mapped rule is retained.');
assert.equal(finalIssue.lifecycle.covered, true);
assert.deepEqual(discoveryCalls, [], 'The mapped page is sufficient; discovery remains closed.');
assert.deepEqual(searchCalls, [], 'The mapped page is sufficient; search remains closed.');

// Matching synthetic text is not enough for scoped local admission. The
// synthetic record must not suppress the mapped request; the approved map
// response below is the evidence that can verify this concept.
const localGeneralRule = {
  ...localRecord,
  id: 'SYNTHETIC_LOCAL_GST_INPUT_TAX_GENERAL_RULE',
  sourceText: mappedRule,
  principleSummary: 'Synthetic focused-control general input-tax rule',
  tags: [topicId, 'input tax claim', 'gst business purchases']
};
syntheticLocalRecords = [localGeneralRule];
mappedFetchCalls.length = 0;
result = await runWorkstream();
const syntheticLocalRejectedIssue = result.workstreams.flatMap(workstream => workstream.issues)
  .find(issue => issue.issueId === reconciled.issuePlan.issues[0].id);
assert.ok(syntheticLocalRejectedIssue);
assert.ok(mappedFetchCalls.length > 0,
  'Unregistered synthetic local text cannot avoid the mapped evidence attempt.');
assert.ok(syntheticLocalRejectedIssue.sources.some(record => record.provenance === 'LIVE_EXTERNAL'),
  'The verified concept is supported by the injected mapped source, not the synthetic local record.');
assert.equal(syntheticLocalRejectedIssue.evidenceStatus, 'VERIFIED');

// A mapped page that is topically relevant but omits the requested general
// entitlement must not close the concept gap.
syntheticLocalRecords = [];
mappedBody = 'This GST page explains input tax claim records and tax invoice filing for registered businesses.';
mappedFetchCalls.length = 0;
result = await runWorkstream();
const unsupportedMappedIssue = result.workstreams.flatMap(workstream => workstream.issues)
  .find(issue => issue.issueId === reconciled.issuePlan.issues[0].id);
assert.ok(unsupportedMappedIssue);
assert.ok(mappedFetchCalls.length > 0, 'The unsupported mapped control still exercises the injected mapped path.');
assert.notEqual(unsupportedMappedIssue.evidenceStatus, 'VERIFIED',
  'Topical mapped evidence without support for the requested rule must remain insufficient.');

// Verify an actual retained live source through a provisional scope whose only
// registered association is the explicit mapped topic ID.
mappedBody = mappedRule;
mappedFetchCalls.length = 0;
result = await runWorkstream();
const liveSource = result.workstreams.flatMap(workstream => workstream.issues)
  .find(issue => issue.issueId === reconciled.issuePlan.issues[0].id)?.sources
  .find(record => record.provenance === 'LIVE_EXTERNAL');
assert.ok(liveSource, 'The positive control supplies a retained live record for the provisional scope test.');
const sourceMap = sourceMaps.find(definition => definition.canonicalSourceUrl === liveSource.canonicalSourceUrl);
assert.ok(sourceMap);
const liveTrace = {
  path: 'MAPPED_SOURCE',
  sourceMapIds: [sourceMap.id],
  selectedRecordIds: [liveSource.id],
  finalVerifiedUrls: [liveSource.canonicalSourceUrl],
  attempts: [{
    topicId,
    sourceMapId: sourceMap.id,
    fetchStatus: 'SUCCESS',
    finalUrl: liveSource.canonicalSourceUrl,
    pageTitle: sourceMap.pageTitle,
    titleMatched: true,
    contentMatched: true
  }]
};
const registeredTopic = getCoverageTopicById(topicId);
assert.ok(registeredTopic);
const provisionalTopic = {
  ...registeredTopic,
  id: 'iras-authority-query-provisional-gst-input-tax-control',
  sourceRecordIds: [],
  mappedTopicIds: [topicId],
  requestedConcepts: [requestedConcept]
};
const provisionalPositive = evaluateEvidenceQuality({
  query: testCase.query,
  topicIds: [],
  records: [liveSource],
  missingFacts: [],
  sourceMapFallbackTrace: liveTrace,
  provisionalTopics: [provisionalTopic],
  requestedConcepts: [requestedConcept],
  authorities: ['IRAS'],
  domain: 'IRAS_GST',
  referenceDate: REFERENCE_DATE
});
assert.deepEqual(provisionalPositive.uncoveredConcepts, [],
  'A requested registered concept explicitly bound by an existing provisional mapped topic is covered.');
assert.equal(provisionalPositive.status, 'RETRIEVED_SUFFICIENT',
  'Live-only concept evidence remains usable without being misclassified as local sufficiency.');

const unrelatedConcept = { ...requestedConcept, id: `${requestedConcept.id}-unrelated`, topicIds: ['iras-gst-registration'] };
const unrelatedBinding = evaluateEvidenceQuality({
  query: testCase.query,
  topicIds: [],
  records: [liveSource],
  missingFacts: [],
  sourceMapFallbackTrace: liveTrace,
  provisionalTopics: [{ ...provisionalTopic, requestedConcepts: [] }],
  requestedConcepts: [unrelatedConcept],
  authorities: ['IRAS'],
  domain: 'IRAS_GST',
  referenceDate: REFERENCE_DATE
});
assert.deepEqual(unrelatedBinding.uncoveredConcepts, [unrelatedConcept.label],
  'A sibling topic ID outside the provisional mapped scope cannot inherit the source concept.');

process.stdout.write('IRAS requested-concept fallback regression passed.\n');
