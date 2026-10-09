import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { classifyQuestion } from '../../../src/classification/questionClassifier.ts';
import { ControlledWebRetriever } from '../../../src/retrieval/controlledWebRetriever.ts';
import { defaultAdvancedSourceRetriever } from '../../../src/retrieval/advancedSourceRetriever.ts';
import { evaluateEvidenceQuality } from '../../../src/retrieval/evidenceQualityGate.ts';
import { supportGeneralIrasRuleConcept } from '../../../src/retrieval/irasRuleConceptSupport.ts';
import { SourceCache } from '../../../src/retrieval/sourceCache.ts';
import { IRAS_SOURCE_MAP_DEFINITIONS } from '../../../src/standards/coverageRegistry.ts';
import { UNIFIED_SOURCE_REGISTRY } from '../../../src/standards/unifiedSourceModel.ts';
import { buildAuthorityWorkstreams } from '../../../src/services/authorityWorkstreams.ts';
import { buildGroundedReasoningContext } from '../../../src/services/groundingContextBuilder.ts';
import { renderIrasEvidenceResponse } from '../../../src/services/irasEvidencePolicy.ts';
import { getRequestedQuestionConcepts, reconcileQuestionUnderstanding, validateSemanticQuestionInterpretation } from '../../../src/services/semanticQuestionUnderstanding.ts';
import { irasResolverCases } from '../../fixtures/irasResolverCases.mjs';

const REFERENCE_DATE = '2026-10-02';
const topicId = 'iras-gst-input-tax';
const caseId = 'gst-input-tax-general-rule';
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
const sourceMaps = IRAS_SOURCE_MAP_DEFINITIONS.filter(definition => definition.domainId === 'IRAS_GST' && definition.topicIds.includes(topicId));
assert.equal(sourceMaps.length, 2, 'The frozen input-tax topic has exactly two registered source maps.');
const mapByUrl = new Map(sourceMaps.map(definition => [definition.canonicalSourceUrl, definition]));
const mapById = new Map(sourceMaps.map(definition => [definition.id, definition]));

const excerptReport = JSON.parse(await readFile(new URL(
  '../../../docs/evaluation/multi-authority-workstreams/iras-public-excerpts-2026-10-03-v1/iras-public-rule-excerpts-report-v1.json',
  import.meta.url), 'utf8'));
const gstOpeningUnit = excerptReport.results.find(row => row.mapId === 'IRAS_GST_INPUT_TAX_SOURCE_MAP')?.excerpts
  ?.find(row => row.blockIndex === 7)?.text;
assert.equal(typeof gstOpeningUnit, 'string', 'The reviewed source-derived public excerpt for GST map block 7 is present.');
const openingSentences = [
  'When purchasing from GST-registered suppliers or importing goods into Singapore, you may have incurred GST (input tax).',
  'You can claim the input tax incurred when you satisfy all of the conditions for making such a claim.',
  'You should only claim input tax in the accounting period corresponding to the date of the invoice or import permit.'
];
assert.ok(openingSentences.every(sentence => gstOpeningUnit.includes(sentence)), 'The captured unit is the complete three-sentence opening.');

const localBlockedRecord = UNIFIED_SOURCE_REGISTRY.GST_REG26_BLOCKED_INPUT_TAX;
assert.ok(localBlockedRecord?.sourceText);
const localAssessment = evaluateEvidenceQuality({
  query: testCase.query,
  topicIds: reconciled.classification.topicIds,
  records: [localBlockedRecord],
  missingFacts: classification.missingFacts,
  requestedConcepts: [requestedConcept],
  authorities: ['IRAS'],
  referenceDate: REFERENCE_DATE
});

const syntheticInvoiceBody = 'This is a synthetic invoice-map response for an API-free source-selection diagnostic. It mentions GST tax invoice records for customer supplies but asserts no general entitlement.';
const escapeHtml = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const openingBody = gstOpeningUnit.replace(/^•\s*\n\n/, '').trim();
let activePageBody = openingBody;
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
let activeRunLabel = 'UNSET_SCENARIO';
const customFetch = async (urlValue, init = {}) => {
  const url = String(urlValue);
  const sourceMap = mapByUrl.get(url);
  assert.ok(sourceMap, 'The injected fetch refuses URLs outside the two registered GST maps.');
  assert.equal((init.method || 'GET').toUpperCase(), 'GET');
  fetchEvents.push({ scenarioLabel: activeRunLabel, mapId: sourceMap.id,
    status: sourceMap.id === 'IRAS_GST_INVOICING_SOURCE_MAP' ? 'SYNTHETIC_CONTROL' : 'SYNTHETIC_PUBLIC_EXCERPT' });
  const body = sourceMap.id === 'IRAS_GST_INPUT_TAX_SOURCE_MAP' ? activePageBody : syntheticInvoiceBody;
  const title = `${sourceMap.pageTitle} | IRAS`;
  return new Response(`<html><head><title>${escapeHtml(title)}</title></head><body><main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(body)}</p></main></body></html>`, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' }
  });
};
const actualFetch = globalThis.fetch;
let ambientFetchCalls = 0;
globalThis.fetch = async () => { ambientFetchCalls += 1; throw new Error('AMBIENT_NETWORK_DISABLED'); };
const retriever = {
  async retrieveSources(retrievalQuery) {
    const retrieved = await defaultAdvancedSourceRetriever.retrieveSources(retrievalQuery);
    if (!retrievalQuery.topicIds?.includes(topicId)) return retrieved;
    return [...new Map([...retrieved, localBlockedRecord].map(record => [record.id, record])).values()];
  },
  getSourceById: id => defaultAdvancedSourceRetriever.getSourceById(id),
  findSourcesByStandardOrAct: (...args) => defaultAdvancedSourceRetriever.findSourcesByStandardOrAct(...args)
};

function helperSupport(sourceText, domainId = 'IRAS_GST') {
  return supportGeneralIrasRuleConcept({
    sourceText,
    domainId,
    topicIds,
    subject: issue.subject,
    population: issue.population,
    concepts: [requestedConcept]
  });
}

const normalize = text => text.normalize('NFC').replace(/\s+/g, ' ').trim();
const openingSentencesInQuotes = claims => openingSentences.map(sentence =>
  claims.some(claim => normalize(claim.quote).includes(normalize(sentence))));

async function runStages(label) {
  activeRunLabel = label;
  sourceCache.clear();
  const evidenceScope = {
    authority: 'IRAS',
    domain: 'IRAS_GST',
    topicIds,
    requestedConcepts: [requestedConcept],
    context: {
      domainId: 'IRAS_GST',
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
  const acceptedRenderClaims = rendered.claimVerification?.accepted || [];
  const finalClaims = finalIssue.verifiedClaims || [];
  const sourceRecords = [...new Map([...contextRecords, ...finalIssue.sources].map(record => [record.id, record])).values()];
  const mapForRecord = record => sourceMaps.find(definition =>
    definition.canonicalSourceUrl === (record.canonicalSourceUrl || record.officialSourceUrl))?.id || 'UNMAPPED_RECORD';
  // Map identity describes the registered canonical URL, not the content's
  // provenance or its independent rule support.
  const helperFlags = sourceRecords.map(record => ({
    mapId: mapForRecord(record),
    provenance: ['LOCAL_STATIC', 'LIVE_EXTERNAL', 'LIVE_PATCH'].includes(record.provenance) ? record.provenance : 'OTHER',
    associatedTopics: topicIds.filter(id => [...(record.tags || []), ...(record.relatedTopicIds || []),
      ...(record.sourceMapTopicIds || []), ...(record.retrievalHints || [])].includes(id)),
    completeOpeningRetained: normalize(record.sourceText || '').includes(normalize(openingBody)),
    helperRecognized: helperSupport(record.sourceText || '') !== undefined,
    helperSupported: helperSupport(record.sourceText || '') === true
  }));
  const renderClaimFlags = acceptedRenderClaims.map((claim, index) => {
    const source = sourceRecords.find(record => record.id === claim.recordId);
    return {
      claimIndex: index,
      mapId: source ? mapForRecord(source) : 'UNMAPPED_RECORD',
      helperRecognized: helperSupport(claim.quote) !== undefined,
      helperSupported: helperSupport(claim.quote) === true,
      openingSentenceFlags: openingSentencesInQuotes([claim])
    };
  });
  const finalClaimFlags = finalClaims.map((claim, index) => ({
    claimIndex: index,
    mapId: sourceRecords.find(record => record.id === claim.recordId) ? mapForRecord(sourceRecords.find(record => record.id === claim.recordId)) : 'UNMAPPED_RECORD',
    helperSupported: helperSupport(claim.quote) === true,
    openingSentenceFlags: openingSentencesInQuotes([claim])
  }));
  const attempts = (context.sourceMapFallbackTrace?.attempts || []).map(attempt => ({
    mapId: mapById.has(attempt.sourceMapId) ? attempt.sourceMapId : 'UNMAPPED_MAP',
    topicId: attempt.topicId === topicId ? topicId : 'OTHER_TOPIC',
    fetchStatus: typeof attempt.fetchStatus === 'string' ? attempt.fetchStatus : 'OTHER_STATUS'
  }));
  const recognizedAcceptedQuote = renderClaimFlags.some(row => row.helperRecognized && row.helperSupported);
  const openingSentenceCoverage = openingSentences.map((_sentence, index) =>
    finalClaimFlags.some(row => row.openingSentenceFlags[index]));
  const firstFailureBoundary = recognizedAcceptedQuote ?
    (finalIssue.evidenceStatus === 'VERIFIED' ? 'NONE' : 'CENTRAL_WORKSTREAM_FINALIZATION') :
    (helperFlags.some(row => row.helperSupported) ? 'RENDERER_OR_LITERAL_VERIFICATION' :
      (contextRecords.length ? 'SOURCE_QUALITY_GATE_OR_RECORD_SELECTION' : 'MAPPED_SOURCE_OR_CONTEXT'));
  return {
    label,
    mapAttemptCount: attempts.length,
    mapAttempts: attempts,
    contextEligibleRecordCount: contextRecords.length,
    contextUncoveredConceptCount: context.evidenceQuality?.uncoveredConcepts?.length ?? null,
    sourceRecordFlags: helperFlags,
    renderedAcceptedClaimCount: acceptedRenderClaims.length,
    renderedRejectedClaimCount: rendered.claimVerification?.rejected?.length || 0,
    renderedClaimFlags: renderClaimFlags,
    finalVerifiedClaimCount: finalClaims.length,
    finalClaimFlags,
    openingSentenceCoverage,
    finalEvidenceStatus: ['VERIFIED', 'INSUFFICIENT'].includes(finalIssue.evidenceStatus) ? finalIssue.evidenceStatus : 'OTHER_STATUS',
    finalApplicationStatus: ['UNRESOLVED', 'NOT_REQUIRED'].includes(finalIssue.applicationStatus) ? finalIssue.applicationStatus : 'OTHER_STATUS',
    finalLifecycle: {
      requested: finalIssue.lifecycle?.requested === true,
      mapped: finalIssue.lifecycle?.mapped === true,
      retrievalAttempted: finalIssue.lifecycle?.retrievalAttempted === true,
      evidenceFound: finalIssue.lifecycle?.evidenceFound === true,
      admitted: finalIssue.lifecycle?.admitted === true,
      verified: finalIssue.lifecycle?.verified === true,
      covered: finalIssue.lifecycle?.covered === true
    },
    finalGapCodes: (finalIssue.gaps || []).map(gap => typeof gap.code === 'string' ? gap.code : 'OTHER_GAP'),
    firstFailureBoundary
  };
}

try {
  const positive = await runStages('COMPLETE_OPENING');
  const completeOpeningSelected = positive.renderedClaimFlags.some(row => row.helperSupported && row.openingSentenceFlags.every(Boolean)) ||
    positive.finalClaimFlags.some(row => row.helperSupported && row.openingSentenceFlags.every(Boolean));

  activePageBody = [
    'To claim input tax:',
    'A GST-registered business may make purchases used for taxable supplies when the prescribed conditions are met.',
    'Input tax incurred on motor car expenses is blocked except under a specific narrow exception.'
  ].join('\n\n');
  const negative = await runStages('INCOMPLETE_INTRO_AND_NARROW_EXCEPTION');

  const sourceMapResponseCount = fetchEvents.filter(event => event.mapId === 'IRAS_GST_INPUT_TAX_SOURCE_MAP' &&
      event.status === 'SYNTHETIC_PUBLIC_EXCERPT').length;
  const diagnostic = {
    schemaVersion: 1,
    profile: 'IRAS_GST_PUBLIC_OPENING_FALLBACK_DIAGNOSTIC_V1',
    fixedCaseId: caseId,
    fixedTopicId: topicId,
    fixedConceptId: requestedConcept.id,
    approvedMapIds: sourceMaps.map(row => row.id),
    localBaseline: {
      status: localAssessment.status,
      eligibleRecordCount: localAssessment.eligibleRecords.length,
      coveredTopicCount: localAssessment.coveredTopicIds.length,
      uncoveredConceptCount: localAssessment.uncoveredConcepts.length,
      helperRecognized: helperSupport(localBlockedRecord.sourceText || '') !== undefined,
      helperSupported: helperSupport(localBlockedRecord.sourceText || '') === true
    },
    syntheticFetchCount: fetchEvents.length,
    syntheticInputTaxMapResponseCount: sourceMapResponseCount,
    syntheticFetchCounts: [...new Set(fetchEvents.map(event => `${event.scenarioLabel}:${event.mapId}`))].map(key => {
      const [scenarioLabel, mapId] = key.split(':');
      return { scenarioLabel, mapId, callCount: fetchEvents.filter(event => event.scenarioLabel === scenarioLabel && event.mapId === mapId).length };
    }),
    ambientFetchCount: ambientFetchCalls,
    discoveryCalls: closedAdapterCounts.discovery,
    searchCalls: closedAdapterCounts.search,
    completeOpeningSelected,
    positive,
    negative
  };
  process.stdout.write(`${JSON.stringify(diagnostic)}\n`);
  assert.equal(diagnostic.ambientFetchCount, 0);
  assert.equal(diagnostic.discoveryCalls, 0);
  assert.equal(diagnostic.searchCalls, 0);
  assert.ok(diagnostic.syntheticFetchCount > 0);
  assert.equal(negative.renderedClaimFlags.some(row => row.helperSupported), false,
    'An incomplete colon introduction and a narrow blocked exception cannot support the general claim concept.');
  assert.equal(completeOpeningSelected, true);
  assert.equal(positive.firstFailureBoundary, 'NONE');
  assert.equal(positive.finalEvidenceStatus, 'VERIFIED');
  assert.equal(positive.finalVerifiedClaimCount, 1);
  assert.ok(positive.openingSentenceCoverage.every(Boolean));
  assert.deepEqual(positive.finalGapCodes, []);
  assert.equal(negative.finalEvidenceStatus, 'INSUFFICIENT');
  assert.equal(negative.finalVerifiedClaimCount, 0);
} finally {
  globalThis.fetch = actualFetch;
}
