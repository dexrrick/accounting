import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { classifyQuestion } from '../../../src/classification/questionClassifier.ts';
import { ControlledWebRetriever } from '../../../src/retrieval/controlledWebRetriever.ts';
import { defaultAdvancedSourceRetriever } from '../../../src/retrieval/advancedSourceRetriever.ts';
import { SourceCache } from '../../../src/retrieval/sourceCache.ts';
import { IRAS_SOURCE_MAP_DEFINITIONS } from '../../../src/standards/coverageRegistry.ts';
import { buildAuthorityWorkstreams } from '../../../src/services/authorityWorkstreams.ts';
import { buildGroundedReasoningContext } from '../../../src/services/groundingContextBuilder.ts';
import { renderIrasEvidenceResponse } from '../../../src/services/irasEvidencePolicy.ts';
import { supportGeneralIrasRuleConcept } from '../../../src/retrieval/irasRuleConceptSupport.ts';
import { getRequestedQuestionConcepts, reconcileQuestionUnderstanding, validateSemanticQuestionInterpretation } from '../../../src/services/semanticQuestionUnderstanding.ts';
import { irasResolverCases } from '../../fixtures/irasResolverCases.mjs';

const REFERENCE_DATE = '2026-10-02';
const caseId = 'foreign-dividend-treatment';
const topicId = 'iras-foreign-sourced-income';
const testCase = irasResolverCases.find(item => item.id === caseId);
assert.ok(testCase && testCase.issues.length === 1);
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
assert.ok(reconciled.classification.topicIds.includes(topicId));
const requestedConcept = getRequestedQuestionConcepts(testCase.query, questionUnderstanding)[0];
assert.ok(requestedConcept?.topicIds.includes(topicId));
const issue = reconciled.issuePlan.issues[0];
const topicIds = [...new Set([...issue.mappedTopicIds, topicId])];
const sourceMaps = IRAS_SOURCE_MAP_DEFINITIONS.filter(definition =>
  definition.domainId === 'IRAS_CORPORATE_TAX' && definition.topicIds.includes(topicId));
assert.equal(sourceMaps.length, 1, 'The frozen foreign-income topic has exactly one registered source map.');
const sourceMap = sourceMaps[0];

const v1Report = JSON.parse(await readFile(new URL(
  '../../../docs/evaluation/multi-authority-workstreams/iras-public-excerpts-2026-10-03-v1/iras-public-rule-excerpts-report-v1.json',
  import.meta.url), 'utf8'));
const v2Report = JSON.parse(await readFile(new URL(
  '../../../docs/evaluation/multi-authority-workstreams/iras-public-excerpts-2026-10-03-v2/iras-public-rule-excerpts-report-v2.json',
  import.meta.url), 'utf8'));
assert.equal(v1Report.profileVersion, 'iras-public-rule-excerpts-v1');
assert.equal(v2Report.profileVersion, 'iras-public-rule-excerpts-v2');
const mapId = 'IRAS_CIT_FOREIGN_INCOME_SOURCE_MAP';
const excerptFrom = (report, blockIndex) => {
  const row = report.results.find(item => item.mapId === mapId);
  const excerpt = row?.excerpts.find(item => item.blockIndex === blockIndex);
  assert.ok(excerpt, `The saved ${mapId} block ${blockIndex} is present.`);
  assert.equal(excerpt.truncated, false);
  return { text: excerpt.text, documentSha256: excerpt.documentSha256 };
};
const block10 = excerptFrom(v2Report, 10);
const block37 = excerptFrom(v2Report, 37);
const block41 = excerptFrom(v1Report, 41);
const expectedDocumentHash = '4f7b80b92ab81ce3bc2d84604a5025d289b026bed0b358ee04d7a0dca1e37625';
assert.deepEqual([block10.documentSha256, block37.documentSha256, block41.documentSha256],
  [expectedDocumentHash, expectedDocumentHash, expectedDocumentHash]);
const savedUnits = [
  { savedBlockId: 'V2:10', text: block10.text },
  { savedBlockId: 'V2:37', text: block37.text },
  { savedBlockId: 'V1:41', text: block41.text }
];
const sourceComposition = 'SYNTHETIC_COMPOSITION_NOT_ORIGINAL_PAGE';
const activePageBody = savedUnits.map(unit => unit.text).join('\n\n');
const escapeHtml = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const sourceMapByUrl = new Map([[sourceMap.canonicalSourceUrl, sourceMap]]);
const fetchEvents = [];
const closedAdapterCounts = { discovery: 0, search: 0 };
const discoveryAdapter = {
  async discoverOfficialSourceCandidates() { closedAdapterCounts.discovery += 1; return []; },
  getLastFetchTrace() { return []; }
};
const officialDomainSearchAdapter = {
  async searchOfficialDomainCandidates() { closedAdapterCounts.search += 1; return []; },
  getLastSearchTrace() { return []; }
};
const emptyAdapters = { discoveryAdapter, officialDomainSearchAdapter };
const sourceCache = new SourceCache();
const webRetriever = new ControlledWebRetriever(undefined, sourceCache);
const customFetch = async (urlValue, init = {}) => {
  const url = String(urlValue);
  const requestedMap = sourceMapByUrl.get(url);
  assert.ok(requestedMap, 'The injected fetch refuses URLs outside the approved foreign-income source map.');
  assert.equal((init.method || 'GET').toUpperCase(), 'GET');
  fetchEvents.push({ mapId: requestedMap.id, status: 200 });
  const title = `${requestedMap.pageTitle} | IRAS`;
  const body = `<section><p>${escapeHtml(block10.text)}</p></section><section><p>${escapeHtml(block37.text)}</p></section><section><p>${escapeHtml(block41.text)}</p></section>`;
  return new Response(`<html><head><title>${escapeHtml(title)}</title></head><body><main><h1>${escapeHtml(title)}</h1>${body}</main></body></html>`, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' }
  });
};
let ambientFetchCalls = 0;
const actualFetch = globalThis.fetch;
globalThis.fetch = async () => { ambientFetchCalls += 1; throw new Error('AMBIENT_NETWORK_DISABLED'); };
const retriever = {
  retrieveSources: retrievalQuery => defaultAdvancedSourceRetriever.retrieveSources(retrievalQuery),
  getSourceById: id => defaultAdvancedSourceRetriever.getSourceById(id),
  findSourcesByStandardOrAct: (...args) => defaultAdvancedSourceRetriever.findSourcesByStandardOrAct(...args)
};
const normalize = text => text.normalize('NFC').replace(/\s+/g, ' ').trim();
const helperSupport = sourceText => supportGeneralIrasRuleConcept({
  sourceText,
  domainId: 'IRAS_CORPORATE_TAX',
  topicIds,
  subject: issue.subject,
  population: issue.population,
  concepts: [requestedConcept]
});

try {
  const unitHelperFlags = savedUnits.map(unit => ({
    savedBlockId: unit.savedBlockId,
    helperRecognized: helperSupport(unit.text) !== undefined,
    helperSupported: helperSupport(unit.text) === true
  }));
  const compositionHelperSupported = helperSupport(activePageBody) === true;
  sourceCache.clear();
  const evidenceScope = {
    authority: 'IRAS',
    domain: 'IRAS_CORPORATE_TAX',
    topicIds,
    requestedConcepts: [requestedConcept],
    context: {
      domainId: 'IRAS_CORPORATE_TAX',
      population: issue.population,
      primarySubject: issue.subject,
      concepts: [issue.subject],
      requestedOperation: issue.operation
    }
  };
  const context = await buildGroundedReasoningContext(testCase.query, null, retriever, undefined, {
    webRetriever,
    fetchOptions: { customFetch, timeoutMs: 10_000 },
    ...emptyAdapters,
    authorityLevelDiscovery: false,
    localOnly: false,
    referenceDate: REFERENCE_DATE,
    questionUnderstanding,
    evidenceScope
  });
  const rendered = renderIrasEvidenceResponse({}, context, testCase.query, null, 'SFRS_I', 'LOCAL');
  const workstreams = await buildAuthorityWorkstreams(testCase.query, reconciled.issuePlan, {
    retriever,
    questionUnderstanding,
    referenceDate: REFERENCE_DATE,
    groundingOptions: {
      webRetriever,
      fetchOptions: { customFetch, timeoutMs: 10_000 },
      ...emptyAdapters,
      authorityLevelDiscovery: false,
      localOnly: false,
      referenceDate: REFERENCE_DATE
    }
  });
  const finalIssue = workstreams.workstreams.flatMap(row => row.issues).find(row => row.issueId === issue.id);
  assert.ok(finalIssue);

  const contextRecords = context.evidenceQuality?.eligibleRecords || [];
  const acceptedClaims = rendered.claimVerification?.accepted || [];
  const finalClaims = finalIssue.verifiedClaims || [];
  const records = [...new Map([...contextRecords, ...finalIssue.sources].map(record => [record.id, record])).values()];
  const mapForRecord = record => sourceMaps.find(definition =>
    definition.canonicalSourceUrl === (record.canonicalSourceUrl || record.officialSourceUrl))?.id || 'UNMAPPED_RECORD';
  const recordFlags = records.map(record => ({
    mapId: mapForRecord(record),
    provenance: ['LOCAL_STATIC', 'LIVE_EXTERNAL', 'LIVE_PATCH'].includes(record.provenance) ? record.provenance : 'OTHER',
    associatedTopic: [...(record.tags || []), ...(record.relatedTopicIds || []),
      ...(record.sourceMapTopicIds || []), ...(record.retrievalHints || [])].includes(topicId),
    retainedBlockFlags: savedUnits.map(unit => normalize(record.sourceText || '').includes(normalize(unit.text)))
  }));
  const acceptedClaimFlags = acceptedClaims.map((claim, index) => ({
    claimIndex: index,
    mapId: records.find(record => record.id === claim.recordId) ? mapForRecord(records.find(record => record.id === claim.recordId)) : 'UNMAPPED_RECORD',
    helperRecognized: helperSupport(claim.quote) !== undefined,
    helperSupported: helperSupport(claim.quote) === true,
    retainedBlockFlags: savedUnits.map(unit => normalize(claim.quote).includes(normalize(unit.text)))
  }));
  const finalClaimFlags = finalClaims.map((claim, index) => ({
    claimIndex: index,
    helperSupported: helperSupport(claim.quote) === true,
    retainedBlockFlags: savedUnits.map(unit => normalize(claim.quote).includes(normalize(unit.text)))
  }));
  const attempts = (context.sourceMapFallbackTrace?.attempts || []).map(attempt => ({
    mapId: attempt.sourceMapId === sourceMap.id ? sourceMap.id : 'OTHER_MAP',
    topicId: attempt.topicId === topicId ? topicId : 'OTHER_TOPIC',
    fetchStatus: typeof attempt.fetchStatus === 'string' && /^\d{3}$/.test(attempt.fetchStatus) ? attempt.fetchStatus : 'OTHER_STATUS'
  }));
  const supportedAcceptedQuoteCount = acceptedClaimFlags.filter(claim => claim.helperSupported).length;
  const firstFailureBoundary = attempts.length === 0 ? 'MAPPED_SOURCE_NOT_ATTEMPTED' :
    contextRecords.length === 0 ? 'NO_QUALITY_ELIGIBLE_RECORD' :
      acceptedClaims.length === 0 ? 'RENDERER_OR_LITERAL_VERIFICATION' :
        supportedAcceptedQuoteCount === 0 ? 'GENERAL_RULE_SUPPORT_AFTER_LITERAL_ACCEPTANCE' :
          finalClaims.length === 0 ? 'CENTRAL_WORKSTREAM_FINALIZATION' : 'NONE';
  const statusOf = (value, allowed) => allowed.includes(value) ? value : 'OTHER_STATUS';
  const diagnostic = {
    schemaVersion: 1,
    profile: 'IRAS_FOREIGN_PUBLIC_RULE_PROBE_V1',
    sourceComposition,
    fixedCaseId: caseId,
    fixedTopicId: topicId,
    fixedConceptId: requestedConcept.id,
    approvedMapIds: sourceMaps.map(row => row.id),
    savedUnitIds: savedUnits.map(unit => unit.savedBlockId),
    savedDocumentHashMatch: new Set(savedUnits.map((_unit, index) => [block10, block37, block41][index].documentSha256)).size === 1,
    directUnitHelperFlags: unitHelperFlags,
    syntheticCompositionHelperSupported: compositionHelperSupported,
    customGetCount: fetchEvents.length,
    customGetMapIds: [...new Set(fetchEvents.map(event => event.mapId))],
    customGetStatuses: [...new Set(fetchEvents.map(event => event.status))],
    ambientFetchCount: ambientFetchCalls,
    discoveryCalls: closedAdapterCounts.discovery,
    searchCalls: closedAdapterCounts.search,
    modelCallCount: 0,
    mapAttempts: attempts,
    contextEligibleRecordCount: contextRecords.length,
    contextUncoveredConceptCount: (context.evidenceQuality?.uncoveredConcepts || []).length,
    sourceRecordFlags: recordFlags,
    rendererAcceptedClaimCount: acceptedClaims.length,
    rendererRejectedClaimCount: rendered.claimVerification?.rejected?.length || 0,
    acceptedClaimFlags,
    supportedAcceptedQuoteCount,
    finalVerifiedClaimCount: finalClaims.length,
    finalClaimFlags,
    finalEvidenceStatus: statusOf(finalIssue.evidenceStatus, ['VERIFIED', 'INSUFFICIENT']),
    finalApplicationStatus: statusOf(finalIssue.applicationStatus, ['UNRESOLVED', 'NOT_REQUIRED']),
    finalGapCodes: (finalIssue.gaps || []).map(gap => typeof gap.code === 'string' ? gap.code : 'OTHER_GAP'),
    finalLifecycle: {
      requested: finalIssue.lifecycle?.requested === true,
      mapped: finalIssue.lifecycle?.mapped === true,
      retrievalAttempted: finalIssue.lifecycle?.retrievalAttempted === true,
      evidenceFound: finalIssue.lifecycle?.evidenceFound === true,
      admitted: finalIssue.lifecycle?.admitted === true,
      verified: finalIssue.lifecycle?.verified === true,
      covered: finalIssue.lifecycle?.covered === true
    },
    firstFailureBoundary
  };
  process.stdout.write(`${JSON.stringify(diagnostic)}\n`);
  assert.equal(diagnostic.sourceComposition, 'SYNTHETIC_COMPOSITION_NOT_ORIGINAL_PAGE');
  assert.deepEqual(diagnostic.savedUnitIds, ['V2:10', 'V2:37', 'V1:41']);
  assert.equal(diagnostic.savedDocumentHashMatch, true);
  assert.equal(diagnostic.ambientFetchCount, 0);
  assert.equal(diagnostic.discoveryCalls, 0);
  assert.equal(diagnostic.searchCalls, 0);
  assert.equal(diagnostic.modelCallCount, 0);
  assert.ok(diagnostic.customGetCount > 0);
  assert.deepEqual(diagnostic.customGetMapIds, [sourceMap.id]);
  assert.ok(diagnostic.mapAttempts.some(attempt => attempt.mapId === sourceMap.id));
  assert.deepEqual(diagnostic.directUnitHelperFlags, [
    { savedBlockId: 'V2:10', helperRecognized: true, helperSupported: false },
    { savedBlockId: 'V2:37', helperRecognized: true, helperSupported: false },
    { savedBlockId: 'V1:41', helperRecognized: true, helperSupported: false }
  ]);
  assert.equal(diagnostic.syntheticCompositionHelperSupported, false);
  assert.equal(diagnostic.contextEligibleRecordCount, 1);
  assert.equal(diagnostic.rendererAcceptedClaimCount, 2);
  assert.equal(diagnostic.rendererRejectedClaimCount, 0);
  assert.deepEqual(diagnostic.acceptedClaimFlags.map(claim => claim.retainedBlockFlags), [
    [true, false, false],
    [false, true, false]
  ]);
  assert.equal(diagnostic.supportedAcceptedQuoteCount, 0);
  assert.equal(diagnostic.finalVerifiedClaimCount, 0);
  assert.equal(diagnostic.finalEvidenceStatus, 'INSUFFICIENT');
  assert.equal(diagnostic.firstFailureBoundary, 'GENERAL_RULE_SUPPORT_AFTER_LITERAL_ACCEPTANCE');
  assert.ok(diagnostic.finalGapCodes.includes('IRAS_SCOPE_NOT_COVERED'));
  assert.ok(diagnostic.finalGapCodes.includes('ISSUE_CONCEPT_UNCOVERED'));
  assert.equal(diagnostic.finalApplicationStatus, 'UNRESOLVED');
} finally {
  globalThis.fetch = actualFetch;
}
