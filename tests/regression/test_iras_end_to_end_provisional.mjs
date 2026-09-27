import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { processAccountingQuery } from '../../src/services/geminiService.ts';
import {
  buildGroundedReasoningContext,
  resolveMappedOfficialSourceFallback,
  postProcessAIResponse
} from '../../src/services/groundingContextBuilder.ts';
import { defaultSourceRetriever } from '../../src/retrieval/sourceRetriever.ts';
import { ControlledWebRetriever } from '../../src/retrieval/controlledWebRetriever.ts';
import { SourceCache } from '../../src/retrieval/sourceCache.ts';
import { defaultExternalSourceValidator } from '../../src/retrieval/externalSourceValidator.ts';
import { classifyQuestion } from '../../src/classification/questionClassifier.ts';
import {
  GST_STATUTE_RULES
} from '../../src/standards/statutes/gst.ts';
import { IRAS_SOURCE_MAP_DEFINITIONS, SINGAPORE_COVERAGE_REGISTRY } from '../../src/standards/coverageRegistry.ts';
import { sanitizeStatutoryLinks } from '../../src/utils/statutoryLinkResolver.ts';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const fixturePath = path.join(projectRoot, 'tests/evaluation/singapore/iras-answer-e2e.json');
const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
const executionCases = fixture.cases.filter(testCase => testCase.provisionalExecution === true);

assert.equal(fixture.reviewStatus, 'PENDING_REVIEW');
assert.equal(executionCases.length, 12, 'Exactly the 12 brief workflows run through processAccountingQuery.');
assert.ok(fixture.cases.every(testCase => testCase.provisionalOracle.review.status === 'PENDING_REVIEW'),
  'No provisional tax outcome is promoted to a reviewed benchmark oracle.');
const historicalTransitionCase = executionCases.find(testCase => testCase.id === 'gst-invoice-december-2022-payment-january-2023');
assert.equal(historicalTransitionCase.provisionalOracle.runtimeEvidencePolicy, 'DATED_LOCAL_EVIDENCE_REQUIRED_NO_UNDATED_MAP');
assert.deepEqual(historicalTransitionCase.provisionalOracle.sourceMapIds, [], 'Undated source maps are not runtime expectations for the 2022/2023 transition case.');
assert.ok(historicalTransitionCase.provisionalOracle.catalogSourceMapIds.length > 0,
  'Catalog associations remain separately visible for reviewer context.');
assert.ok(historicalTransitionCase.provisionalOracle.reviewEvidence.some(item => item.format === 'PDF' && item.notRuntimeHtmlFallback),
  'The IRAS transition PDF is review evidence, not an assumed HTML fallback.');

const urlFetches = [];
function syntheticIrasResponse(url) {
  const definition = IRAS_SOURCE_MAP_DEFINITIONS.find(item => item.canonicalSourceUrl === url);
  if (!definition) return new Response('Synthetic harness has no payload for this URL.', { status: 404 });
  const relatedTopicText = definition.topicIds.map(topicId => {
    const topic = SINGAPORE_COVERAGE_REGISTRY.find(candidate => candidate.id === topicId);
    return topic ? [topic.title, ...(topic.keywords || []), ...(topic.aliases || [])].join(' ') : '';
  }).join(' ');
  const title = definition.pageTitle.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const bodyText = `${definition.shortDescription} ${relatedTopicText}`
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const entertainmentSection = definition.id === 'IRAS_GST_INPUT_TAX_SOURCE_MAP'
    ? '<table><tr><td>Entertainment expenses</td><td>Subject to the conditions for input tax claim, these claims are allowed if you have a supporting tax invoice addressed to you. Keep information on entertainment details such as name of person entertained and purpose of entertainment.</td></tr></table>'
    : '';
  return new Response(
    `<html><head><title>${title}</title></head><body><main><h1>${title}</h1><p>IRAS ${bodyText}</p>${entertainmentSection}</main></body></html>`,
    { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } }
  );
}

const originalFetch = globalThis.fetch;
const originalLog = console.log;
const originalWarn = console.warn;
globalThis.fetch = async (request) => {
  const url = typeof request === 'string' ? request : request instanceof URL ? request.href : request.url;
  urlFetches.push(url);
  return syntheticIrasResponse(url);
};
console.log = () => {};
console.warn = () => {};

function status(statusValue, reason, details = {}) {
  return { status: statusValue, reason, ...details };
}

function actualTopics(classification) {
  if (Array.isArray(classification.topicIds)) return classification.topicIds;
  return [];
}

function traceFor(response) {
  return response?.sourceMapFallbackTrace || null;
}

function actualAnswerCitations(response) {
  const urls = [];
  for (const group of response?.scenarioState?.directGroups || []) {
    for (const citation of group.citations || []) if (citation.officialSourceUrl) urls.push(citation.officialSourceUrl);
  }
  const markdown = response?.messageText || '';
  for (const match of markdown.matchAll(/\[[^\]]+\]\((https?:\/\/[^)]+)\)/gi)) urls.push(match[1]);
  return [...new Set(urls)];
}

const provisionalResults = [];
try {
  for (const testCase of executionCases) {
    const query = testCase.question;
    const oracle = testCase.provisionalOracle;
    const classification = classifyQuestion(query);
    const topics = actualTopics(classification);
    const response = await processAccountingQuery(query, null, 'SFRS_I');
    const trace = traceFor(response);
    const actualMapIds = trace?.sourceMapIds || [];
    const expectedMapIds = oracle.sourceMapIds || [];
    const catalogMapIds = oracle.catalogSourceMapIds || [];
    const pendingMapIds = oracle.pendingSourceMapIds || [];
    const retrievedFromSyntheticIras = Boolean(trace?.selectedRecordIds?.length && trace?.finalVerifiedUrls?.length);
    const datedNoCurrentMapObserved = oracle.runtimeEvidencePolicy === 'DATED_LOCAL_EVIDENCE_REQUIRED_NO_UNDATED_MAP' && Boolean(trace) && actualMapIds.length === 0;
    const historicalMapGuard = oracle.runtimeEvidencePolicy === 'DATED_LOCAL_EVIDENCE_REQUIRED_NO_UNDATED_MAP'
      ? { status: trace && actualMapIds.length === 0 ? 'PASS' : 'FAIL', expectedRuntimeMapIds: [], actualRuntimeMapIds: actualMapIds }
      : null;
    assert.ok(!historicalMapGuard || historicalMapGuard.status === 'PASS',
      'Historical transition queries must not select undated current source maps.');
    const answerText = response?.messageText || '';
    const answerCitations = actualAnswerCitations(response);
    const pendingTopics = oracle.pendingTopicIds || [];
    const requiredTopicIds = (oracle.topicIds || []).filter(topicId => !pendingTopics.includes(topicId));
    const matchedTopicIds = requiredTopicIds.filter(topicId => topics.includes(topicId));
    const topicMissing = requiredTopicIds.filter(topicId => !topics.includes(topicId));
    const domainPresent = (classification.domains || []).includes(oracle.classification.domainId);
    const disallowedDomains = (oracle.disallowedDomainIds || []).filter(domain => (classification.domains || []).includes(domain));
    const domainPass = domainPresent && disallowedDomains.length === 0;
    const authorityPass = (classification.authorities || []).includes(oracle.classification.authority);
    const hasOfflinePlaceholder = /offline engine could not match|connect an ai provider/i.test(answerText);

    const dimensions = {
      classification: {
        status: domainPass && authorityPass ? 'PROVISIONAL_PASS' : 'PROVISIONAL_FAIL',
        expected: oracle.classification,
        actual: { authorities: classification.authorities || [], domains: classification.domains || [] },
        checks: {
          authority: authorityPass ? 'PASS' : 'FAIL',
          domain: domainPass ? 'PASS' : 'FAIL',
          disallowedDomains
        },
        reviewStatus: 'PENDING_REVIEW'
      },
      topicRouting: {
        status: topicMissing.length === 0 ? 'PROVISIONAL_PASS' : 'PROVISIONAL_FAIL',
        expected: oracle.topicIds || [],
        requiredForThisProvisionalComparison: requiredTopicIds,
        pendingReview: pendingTopics,
        actual: topics,
        missing: topicMissing,
        matched: matchedTopicIds,
        reviewStatus: 'PENDING_REVIEW'
      },
      sourceSelection: {
        status: (oracle.disallowedSourceMapIds || []).some(mapId => actualMapIds.includes(mapId))
          ? 'PROVISIONAL_FAIL'
          : (oracle.sourceSelectionReviewStatus || 'PENDING_REVIEW'),
        reason: (oracle.disallowedSourceMapIds || []).some(mapId => actualMapIds.includes(mapId))
          ? 'A source map explicitly marked as unrelated was selected.'
          : datedNoCurrentMapObserved
          ? 'No undated current map was selected; availability and use of dated local evidence remain unverified.'
          : oracle.sourceSelectionReviewStatus === 'PENDING_REVIEW'
          ? 'Runtime source selection is not independently reviewed; catalog associations are informational only.'
          : 'Source selection expectations are pending independent review.',
        expected: expectedMapIds,
        catalogAssociations: catalogMapIds,
        pendingReview: pendingMapIds,
        actual: actualMapIds,
        disallowed: (oracle.disallowedSourceMapIds || []).filter(mapId => actualMapIds.includes(mapId)),
        historicalRuntimeMapGuard: historicalMapGuard,
        reviewStatus: 'PENDING_REVIEW'
      },
      retrieval: status(
        !trace ? 'NOT_OBSERVED' : datedNoCurrentMapObserved ? 'NOT_EVALUATED_LOCAL_PATH_IN_RESPONSE' : retrievedFromSyntheticIras ? 'SYNTHETIC_PASS' : 'SYNTHETIC_FAIL',
        !trace ? 'Offline response exposes no fallback trace.' : datedNoCurrentMapObserved
          ? 'No undated current map was selected. This no-provider response does not expose dated local evidence; separate grounded-context diagnostics check the required records.'
          : trace.path,
        { selectedRecordIds: trace?.selectedRecordIds || [], finalVerifiedUrls: trace?.finalVerifiedUrls || [], syntheticPayloadsOnly: true }
      ),
      answerPath: status(
        !trace ? 'NOT_OBSERVED' : datedNoCurrentMapObserved
          ? 'NOT_EVALUATED_NO_DATED_EVIDENCE'
          : trace.path === 'MAPPED_SOURCE' || trace.path === 'DISCOVERED_SOURCE' ? 'SYNTHETIC_PASS' : 'SYNTHETIC_FAIL',
        !trace ? 'The offline response did not expose an answer-path trace.' : datedNoCurrentMapObserved
          ? 'No undated current map was selected; the no-provider trace does not expose date-valid local evidence for the answer.'
          : trace.path,
        { reviewStatus: 'PENDING_REVIEW' }
      ),
      grounding: status('NOT_EVALUATED_NO_PROVIDER', 'No model was called; processAccountingQuery used its offline response path.', {
        groundingEvidenceExposed: Array.isArray(response?.groundingEvidence),
        sourceMapPointerIsNotEvidence: true
      }),
      substantiveConclusion: status(
        'NOT_EVALUATED_NO_PROVIDER',
        'No model was called; no tax-outcome claim was evaluated.',
        { answerAvailability: hasOfflinePlaceholder ? 'OFFLINE_PLACEHOLDER' : 'NO_PROVIDER_RESPONSE', reviewStatus: 'PENDING_REVIEW', responseExcerpt: answerText.slice(0, 180) }
      ),
      citationCorrectness: status(
        'NOT_EVALUATED_NO_PROVIDER',
        'No model citation payload was produced in the no-provider run.',
        { actualCitationUrls: answerCitations, expectedCitationUrls: oracle.citations || [], reviewStatus: 'PENDING_REVIEW' }
      ),
      missingFactHandling: status(
        'NOT_EVALUATED_NO_PROVIDER',
        'No model answer was available to compare with the provisional clarification checklist.',
        { classifierMissingFacts: classification.missingFacts || [], expectedMissingFacts: oracle.missingFacts || [], reviewStatus: 'PENDING_REVIEW' }
      ),
      effectiveDateHandling: status(
        'NOT_EVALUATED_NO_PROVIDER',
        'The offline no-provider response is not treated as a reviewed historical-rule answer.',
        { expected: oracle.effectiveDate, reviewStatus: 'PENDING_REVIEW' }
      ),
      calculationCorrectness: status(
        'NOT_APPLICABLE',
        'The 12 brief workflows supply no numeric amount for an arithmetic assertion.',
        { reviewStatus: 'PENDING_REVIEW' }
      )
    };
    provisionalResults.push({ id: testCase.id, question: query, dimensions });
  }
} finally {
  globalThis.fetch = originalFetch;
  console.log = originalLog;
  console.warn = originalWarn;
}

// Full context → candidate evidence → answer post-processing → citation verification.
// The HTML is synthetic and intentionally does not support the universal tax claim below.
const mechanicsQuestion = 'A GST-registered company paid for a documented working lunch with a prospective customer. Can it claim the input GST?';
const mechanicsWeb = new ControlledWebRetriever(undefined, new SourceCache());
const mechanicsContext = await buildGroundedReasoningContext(
  mechanicsQuestion,
  null,
  defaultSourceRetriever,
  undefined,
  {
    webRetriever: mechanicsWeb,
    discoveryAdapter: { discoverOfficialSourceCandidates: async () => [] },
    fetchOptions: { useCache: false, customFetch: async url => syntheticIrasResponse(url) }
  }
);
assert.ok(mechanicsContext.evidenceQuality, 'The real context builder attaches the evidence-quality assessment.');
// Local-first evidence may now cover this query without a web request. Call
// the fallback explicitly so this test continues to exercise the synthetic
// live-candidate path without making that path a prerequisite for the answer.
const mechanicsFallback = await resolveMappedOfficialSourceFallback(
  ['iras-gst-entertainment'],
  mechanicsQuestion,
  defaultSourceRetriever,
  {
    webRetriever: new ControlledWebRetriever(undefined, new SourceCache()),
    discoveryAdapter: { discoverOfficialSourceCandidates: async () => [] },
    fetchOptions: { useCache: false, customFetch: async url => syntheticIrasResponse(url) }
  }
);
const mechanicsEvidence = mechanicsFallback.records.filter(record => record.provenance === 'LIVE_EXTERNAL');
const selectedEvidence = mechanicsEvidence[0];
assert.ok(selectedEvidence, `Synthetic IRAS page should be admitted as retrieved candidate evidence for the routed meal query: ${JSON.stringify(mechanicsFallback.trace)}`);
assert.equal(selectedEvidence.lifecycleState, 'CANDIDATE');
assert.equal(selectedEvidence.groundingEligible, true);
assert.equal(selectedEvidence.recordRole, 'DISCOVERED_EVIDENCE');
assert.equal(mechanicsFallback.trace.candidateOnly, true);
assert.ok(mechanicsFallback.trace.finalVerifiedUrls.includes(selectedEvidence.officialSourceUrl));
const legacyMealGuardContext = {
  ...mechanicsContext,
  primaryEvidence: [...mechanicsContext.primaryEvidence, ...mechanicsFallback.records.filter(record => record.evidenceTier === 'PRIMARY_SOURCE')],
  officialGuidance: [...mechanicsContext.officialGuidance, ...mechanicsFallback.records.filter(record => record.evidenceTier === 'OFFICIAL_GUIDANCE')],
  curatedSummaries: [...mechanicsContext.curatedSummaries, ...mechanicsFallback.records.filter(record => record.evidenceTier !== 'PRIMARY_SOURCE' && record.evidenceTier !== 'OFFICIAL_GUIDANCE')],
  evidenceQuality: undefined,
  sourceMapFallbackTrace: mechanicsFallback.trace
};

const unsupportedTaxClaim = 'GST is always claimable for every customer or supplier meal, regardless of purpose or records.';
const validCandidateCitation = {
  standard: selectedEvidence.standardOrActCode,
  paragraph: selectedEvidence.paragraphOrSection,
  authority: 'IRAS',
  officialSourceUrl: selectedEvidence.officialSourceUrl
};
const fabricatedCitation = {
  ...validCandidateCitation,
  officialSourceUrl: 'https://www.iras.gov.sg/taxes/fabricated-universal-meal-deduction'
};
const processed = postProcessAIResponse({
  messageText: unsupportedTaxClaim,
  directGroups: [{ id: 'provisional-e2e', title: 'GST meal query', lines: [], citations: [validCandidateCitation, fabricatedCitation] }]
}, null, mechanicsQuestion, legacyMealGuardContext);
const processedGroup = processed.scenarioState.directGroups?.[0];
assert.ok(!processed.messageText.includes(unsupportedTaxClaim),
  'The narrow meal-GST guard must remove this unconditional claim, even when a candidate citation is present.');
assert.match(processed.messageText, /Do not assume input GST.*always claimable/i,
  'The narrow guard must replace the claim with conditional language and fact requests.');
assert.match(processed.messageText, /candidate evidence pending review/i,
  'The narrow replacement must preserve the candidate-only evidence status.');
assert.equal(processedGroup?.citations?.length, 1, 'Only the fetched candidate URL should survive citation verification.');
assert.equal(processedGroup?.citations?.[0]?.verificationStatus, 'SOURCE_NEEDS_REVIEW', 'A candidate citation is structural provenance only.');
assert.ok(!processedGroup?.citations?.some(citation => citation.officialSourceUrl === fabricatedCitation.officialSourceUrl));
assert.equal(sanitizeStatutoryLinks(`[unsupported](${fabricatedCitation.officialSourceUrl})`), 'unsupported',
  'Fabricated same-host deep links must be stripped by URL provenance validation.');
const groundedCandidateTrace = processed.groundingEvidence || [];
assert.ok(groundedCandidateTrace.some(record => record.recordId === selectedEvidence.id && record.candidateOnly && record.groundingEligible));
assert.ok(!groundedCandidateTrace.some(record => record.recordId.startsWith('IRAS_') && record.groundingEligible === false),
  'Source-map pointers must not enter answer grounding evidence.');

// Navigation text must not qualify as substantive evidence, even when the
// title and a single topic keyword match.
const navigationOnlyHtml = '<html><head><title>Conditions for Claiming Input Tax</title></head><body><main><nav>IRAS home | GST motor car | input tax links</nav></main></body></html>';
const navigationValidation = defaultExternalSourceValidator.validateTopicContent(navigationOnlyHtml, {
  expectedTitles: ['Conditions for Claiming Input Tax'],
  standardIdentifiers: ['IRAS'],
  topicTerms: ['motor car'],
  minimumTopicTermMatches: 1
});
assert.equal(navigationValidation.isValid, false, 'Navigation-only content must not be admitted as a source evidence record.');

// Current local-rule content flags supplied by independent review; these checks
// report the baseline wording and deliberately do not edit production sources.
const timeSupplyRule = GST_STATUTE_RULES.GST_SEC11_TIME_OF_SUPPLY;
const zeroRatedRule = GST_STATUTE_RULES.GST_SEC21_ZERO_RATED_EXPORTS;
const currentTimeSupplyText = [timeSupplyRule.principle,
  ...(timeSupplyRule.practicalRules || []).filter(rule => rule.startsWith('Current General Rule:'))].join(' ');
const historicalTimeSupplyText = (timeSupplyRule.practicalRules || []).find(rule => rule.startsWith('Historical Transition:')) || '';
const zeroRatedText = [zeroRatedRule.principle, zeroRatedRule.application, ...(zeroRatedRule.practicalRules || [])].join(' ');

// A valid topic may have no retrieved local evidence. The fallback should
// still try its mapped official-source path in that case.
const validatedIrasTopic = SINGAPORE_COVERAGE_REGISTRY.find(topic =>
  topic.domainId === 'IRAS_GST' && (topic.sourceRecordIds || []).some(id => id.startsWith('IRAS_GST_') && id.endsWith('_SOURCE_MAP'))
);
let validatedTopicGap = { status: 'NOT_REPRODUCED', topicId: null, fallbackPath: null };
if (validatedIrasTopic) {
  const noLocalEvidenceRetriever = {
    retrieveSources: async () => [],
    getSourceById: id => defaultSourceRetriever.getSourceById(id),
    findSourcesByStandardOrAct: (...args) => defaultSourceRetriever.findSourcesByStandardOrAct(...args)
  };
  const originalStatus = validatedIrasTopic.status;
  try {
    validatedIrasTopic.status = 'VALIDATED';
    const fallbackResult = await resolveMappedOfficialSourceFallback(
      [validatedIrasTopic.id],
      validatedIrasTopic.title,
      noLocalEvidenceRetriever,
      {
        webRetriever: new ControlledWebRetriever(undefined, new SourceCache()),
        discoveryAdapter: { discoverOfficialSourceCandidates: async () => [] },
        fetchOptions: { useCache: false, customFetch: async url => syntheticIrasResponse(url) }
      }
    );
    validatedTopicGap = {
      status: fallbackResult.records.length === 0 && fallbackResult.trace.path === 'NOT_NEEDED' ? 'FAIL' : 'PASS',
      topicId: validatedIrasTopic.id,
      topicStatusDuringTest: 'VALIDATED',
      retrievedLocalRecordCount: 0,
      fallbackPath: fallbackResult.trace.path,
      mapIds: fallbackResult.trace.sourceMapIds
    };
  } finally {
    validatedIrasTopic.status = originalStatus;
  }
}
assert.equal(validatedTopicGap.status, 'PASS', 'A VALIDATED topic without local evidence should still attempt its mapped source fallback.');

// Exercise every fixture beyond the 12 no-provider workflows through the
// grounded context builder. For date-scoped local rules, report actual missing
// record IDs as observed failures; fixture oracle review stays pending.
const additionalFixtureCases = fixture.cases.filter(testCase => testCase.provisionalExecution !== true);
const dateScopedFixtureCases = fixture.cases.filter(testCase =>
  (testCase.provisionalOracle.requiredLocalRecordIds || []).length > 0
);
const targetRangesByCaseId = {
  'gst-invoice-december-2022-payment-january-2023': [
    { from: '2022-12-01', to: '2022-12-31' },
    { from: '2023-01-01', to: '2023-01-31' }
  ],
  'cit-renovation-section-14n-ya2024': [{ from: '2024-01-01', to: '2024-12-31' }],
  'gst-historical-standard-rated-supply-2023': [{ from: '2023-07-01', to: '2023-07-01' }],
  'gst-historical-standard-rated-supply-2024': [{ from: '2024-07-01', to: '2024-07-01' }],
  'cit-section-13w-pre-2026-disposal': [{ from: '2025-12-30', to: '2025-12-30' }],
  'cit-section-13w-post-2026-disposal': [{ from: '2026-01-02', to: '2026-01-02' }]
};
const casesNeedingGroundedContext = [...new Map([
  ...dateScopedFixtureCases,
  ...additionalFixtureCases
].map(testCase => [testCase.id, testCase])).values()];
const groundedDiagnosticsByCaseId = new Map();
for (const testCase of casesNeedingGroundedContext) {
  let syntheticFetchCount = 0;
  const context = await buildGroundedReasoningContext(
    testCase.question,
    null,
    defaultSourceRetriever,
    undefined,
    {
      webRetriever: new ControlledWebRetriever(undefined, new SourceCache()),
      discoveryAdapter: { discoverOfficialSourceCandidates: async () => [] },
      fetchOptions: {
        useCache: false,
        customFetch: async url => {
          syntheticFetchCount += 1;
          return syntheticIrasResponse(url);
        }
      }
    }
  );
  const evidenceRecords = [
    ...context.primaryEvidence,
    ...context.officialGuidance,
    ...context.curatedSummaries
  ];
  const localRecords = evidenceRecords.filter(record => record.provenance === 'LOCAL_STATIC' || record.provenance === 'LIVE_PATCH');
  const localRecordsById = new Map(localRecords.map(record => [record.id, record]));
  const requiredLocalRecordIds = testCase.provisionalOracle.requiredLocalRecordIds || [];
  const targetRanges = targetRangesByCaseId[testCase.id] || [];
  const missingRequiredLocalRecordIds = requiredLocalRecordIds.filter(id => !localRecordsById.has(id));
  const dateInvalidRequiredLocalRecordIds = requiredLocalRecordIds.filter(id => {
    const record = localRecordsById.get(id);
    if (!record) return false;
    if (!record.validFrom && !record.validTo) return true;
    return !targetRanges.some(range =>
      (!record.validFrom || record.validFrom <= range.to) &&
      (!record.validTo || record.validTo >= range.from)
    );
  });
  const expectedRuntimeMapIds = testCase.provisionalOracle.sourceMapIds || [];
  const actualRuntimeMapIds = context.sourceMapFallbackTrace?.sourceMapIds || [];
  const missingExpectedRuntimeMapIds = expectedRuntimeMapIds.filter(id => !actualRuntimeMapIds.includes(id));
  const forbiddenRuntimeMapIds = expectedRuntimeMapIds.length === 0 ? actualRuntimeMapIds : [];
  const issues = [
    ...missingRequiredLocalRecordIds.map(id => `missing local record ${id}`),
    ...dateInvalidRequiredLocalRecordIds.map(id => `local record ${id} does not cover the target period`),
    ...missingExpectedRuntimeMapIds.map(id => `missing expected runtime map ${id}`),
    ...forbiddenRuntimeMapIds.map(id => `unexpected undated runtime map ${id}`)
  ];
  groundedDiagnosticsByCaseId.set(testCase.id, {
    status: issues.length === 0 ? 'OBSERVED_PASS' : 'OBSERVED_FAIL',
    oracleReviewStatus: testCase.provisionalOracle.review.status,
    requiredLocalRecordIds,
    observedRequiredLocalRecordIds: requiredLocalRecordIds.filter(id => localRecordsById.has(id)),
    missingRequiredLocalRecordIds,
    dateInvalidRequiredLocalRecordIds,
    targetRanges,
    observedLocalRecordIds: localRecords.map(record => record.id),
    expectedRuntimeMapIds,
    actualRuntimeMapIds,
    syntheticFetchCount,
    issues
  });
}
const dateScopedLocalEvidenceDiagnostics = dateScopedFixtureCases.map(testCase => ({
  id: testCase.id,
  question: testCase.question,
  ...groundedDiagnosticsByCaseId.get(testCase.id)
}));
const additionalGroundedCaseDiagnostics = additionalFixtureCases.map(testCase => ({
  id: testCase.id,
  question: testCase.question,
  ...groundedDiagnosticsByCaseId.get(testCase.id)
}));
assert.equal(dateScopedLocalEvidenceDiagnostics.length, 6, 'All six required-local-record fixtures receive grounded-context diagnostics.');
assert.equal(additionalGroundedCaseDiagnostics.length, 7, 'All seven fixtures beyond the 12 no-provider workflows receive grounded-context diagnostics.');

const baseline = {
  fixture: path.relative(projectRoot, fixturePath),
  caseCount: fixture.cases.length,
  noProviderExecutionCount: provisionalResults.length,
  oracleReviewStatus: 'PENDING_REVIEW',
  syntheticOnly: true,
  sourceMapFetchCount: urlFetches.length,
  sourceMapFetchUrls: [...new Set(urlFetches)].sort(),
  dateScopedLocalEvidenceDiagnostics: {
    status: 'OBSERVED_RUNTIME_DIAGNOSTICS_NOT_ORACLE_REVIEW',
    observedPassCount: dateScopedLocalEvidenceDiagnostics.filter(item => item.status === 'OBSERVED_PASS').length,
    observedFailCount: dateScopedLocalEvidenceDiagnostics.filter(item => item.status === 'OBSERVED_FAIL').length,
    cases: dateScopedLocalEvidenceDiagnostics
  },
  additionalGroundedCaseDiagnostics: {
    status: 'OBSERVED_RUNTIME_DIAGNOSTICS_NOT_ORACLE_REVIEW',
    caseCount: additionalGroundedCaseDiagnostics.length,
    observedPassCount: additionalGroundedCaseDiagnostics.filter(item => item.status === 'OBSERVED_PASS').length,
    observedFailCount: additionalGroundedCaseDiagnostics.filter(item => item.status === 'OBSERVED_FAIL').length,
    cases: additionalGroundedCaseDiagnostics
  },
  knownBaselineFindings: {
    narrowUnconditionalMealGstGuard: {
      status: processed.messageText.includes(unsupportedTaxClaim) ? 'FAIL' : 'PASS',
      detail: 'The targeted guard removes this unconditional meal input-tax claim and replaces it with a conditional response; this does not verify general semantic claim support.',
      acceptedStructuralCitationStatus: processedGroup?.citations?.[0]?.verificationStatus || null
    },
    generalSemanticClaimEntailment: {
      status: 'UNVERIFIED',
      detail: 'This regression covers one narrow unconditional meal-GST wording pattern only; arbitrary claim-to-evidence entailment remains unverified.'
    },
    fabricatedUrlStripping: {
      status: processedGroup?.citations?.some(citation => citation.officialSourceUrl === fabricatedCitation.officialSourceUrl) ? 'FAIL' : 'PASS'
    },
    navigationTextRejection: {
      status: navigationValidation.isValid ? 'FAIL' : 'PASS',
      accepted: navigationValidation.isValid,
      reason: navigationValidation.reason || null
    },
    currentTimeOfSupplyRule: {
      status: /basic tax point|14.day rule/i.test(currentTimeSupplyText) ||
        !/pre-1 january 2011/i.test(historicalTimeSupplyText) ||
        !/do not apply those historical rules/i.test(historicalTimeSupplyText) ? 'FAIL' : 'PASS',
      flags: ['Current general rule must use invoice or payment; Basic Tax Point / 14-day rule must be explicitly limited to the pre-2011 period.'],
      currentGeneralRule: (timeSupplyRule.practicalRules || []).find(rule => rule.startsWith('Current General Rule:')) || null,
      historicalTransition: historicalTimeSupplyText
    },
    zeroRatedOvergeneralization: {
      status: /software companies exporting saas or advisory services to overseas clients bill at 0% gst/i.test(zeroRatedText) ? 'FAIL' : 'PASS',
      flags: ['A qualifying Section 21(3) category and its beneficiary/location conditions must be identified; overseas customer status alone is insufficient.'],
      legacyBroadExamplePresent: /software companies exporting saas or advisory services to overseas clients bill at 0% gst/i.test(zeroRatedText)
    },
    validatedTopicMissingLocalEvidenceFallback: validatedTopicGap
  },
  cases: provisionalResults
};

const dimensions = [
  'classification', 'topicRouting', 'sourceSelection', 'retrieval', 'answerPath', 'grounding',
  'substantiveConclusion', 'citationCorrectness', 'missingFactHandling', 'effectiveDateHandling', 'calculationCorrectness'
];
const totals = Object.fromEntries(dimensions.map(dimension => {
  const statuses = provisionalResults.map(result => result.dimensions[dimension].status);
  return [dimension, Object.fromEntries([...new Set(statuses)].map(value => [value, statuses.filter(item => item === value).length]))];
}));
baseline.provisionalTotals = totals;
baseline.syntheticMechanics = {
  fallbackPath: mechanicsFallback.trace.path,
  mapIds: mechanicsFallback.trace.sourceMapIds || [],
  candidateCount: mechanicsEvidence.length,
  finalUrls: mechanicsFallback.trace.finalVerifiedUrls || [],
  evidenceRecordIds: groundedCandidateTrace.map(record => record.recordId),
  structuralCitationStatus: processedGroup?.citations?.[0]?.verificationStatus || null,
  narrowMealClaimRemoved: !processed.messageText.includes(unsupportedTaxClaim),
  generalSemanticClaimEntailment: 'UNVERIFIED',
  fabricatedCitationDropped: !processedGroup?.citations?.some(citation => citation.officialSourceUrl === fabricatedCitation.officialSourceUrl),
  sourceMapPointerGrounded: groundedCandidateTrace.some(record => record.recordId.startsWith('IRAS_') && record.groundingEligible === false)
};

if (process.argv.includes('--full')) {
  console.log(JSON.stringify(baseline, null, 2));
} else {
  const compact = {
    fixture: baseline.fixture,
    caseCount: baseline.caseCount,
    noProviderExecutionCount: baseline.noProviderExecutionCount,
    additionalGroundedCaseDiagnostics: baseline.additionalGroundedCaseDiagnostics,
    dateScopedLocalEvidenceDiagnostics: baseline.dateScopedLocalEvidenceDiagnostics,
    oracleReviewStatus: baseline.oracleReviewStatus,
    syntheticOnly: baseline.syntheticOnly,
    provisionalTotals: baseline.provisionalTotals,
    cases: baseline.cases.map(result => ({
      id: result.id,
      checks: Object.fromEntries(Object.entries(result.dimensions).map(([dimension, check]) => [dimension, check.status])),
      expectedDomain: result.dimensions.classification.expected.domainId,
      actualDomains: result.dimensions.classification.actual.domains,
      missingTopics: result.dimensions.topicRouting.missing,
      actualTopics: result.dimensions.topicRouting.actual,
      pendingReviewTopics: result.dimensions.topicRouting.pendingReview,
      expectedSourceMapIds: result.dimensions.sourceSelection.expected,
      catalogSourceMapIds: result.dimensions.sourceSelection.catalogAssociations,
      actualSourceMapIds: result.dimensions.sourceSelection.actual,
      disallowedSourceMapIds: result.dimensions.sourceSelection.disallowed,
      fallbackPath: result.dimensions.retrieval.reason,
      noProviderAnswerAvailability: result.dimensions.substantiveConclusion.answerAvailability,
      failureReasons: Object.entries(result.dimensions)
        .filter(([, check]) => check.status.endsWith('_FAIL'))
        .map(([dimension, check]) => `${dimension}: ${check.reason || check.missing?.join(', ') || check.status}`)
    })),
    knownBaselineFindings: baseline.knownBaselineFindings,
    syntheticMechanics: baseline.syntheticMechanics,
    syntheticIrasSourceUrls: baseline.sourceMapFetchUrls
  };
  console.log(JSON.stringify(compact, null, 2));
}
