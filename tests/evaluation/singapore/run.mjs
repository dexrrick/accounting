import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { processAccountingQuery } from '../../../src/services/geminiService.ts';
import { classifyQuestion } from '../../../src/classification/questionClassifier.ts';
import { defaultQueryTopicResolver } from '../../../src/retrieval/queryTopicResolver.ts';
import { defaultAdvancedSourceRetriever } from '../../../src/retrieval/advancedSourceRetriever.ts';
import {
  buildClassificationRetrievalHints,
  GROUNDING_SOURCE_MAX_RESULTS
} from '../../../src/services/groundingContextBuilder.ts';

const directory = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(directory, 'gemini-seed.json');
const reviewedFixturePath = path.join(directory, 'reviewed-knowledge.json');
const consolidationFixturePath = path.join(directory, 'consolidation-source-map.json');

export const BENCHMARK_DIMENSIONS = [
  // Keep the original dimensions stable for existing consumers. The following
  // phase dimensions split the stages that were previously combined.
  'authorityRouting',
  'domainRouting',
  'topicRouting',
  'sourceRetrieval',
  'answerCorrectness',
  'calculationCorrectness',
  'citationCorrectness',
  'missingFactBehaviour',
  'effectiveDateCorrectness',
  'multiAuthorityHandling',
  'classification',
  'sourceSelection',
  'retrieval',
  'grounding',
  'answerPath',
  'substantiveConclusion',
  'citation',
  'missingFacts',
  'effectiveDate'
];

const REVIEW_STATUS = 'INDEPENDENTLY_VERIFIED';

function sorted(values = []) {
  return [...values].sort((a, b) => a.localeCompare(b));
}

function exactSetResult(expected, actual) {
  const expectedSorted = sorted(expected);
  const actualSorted = sorted(actual);
  const matches = expectedSorted.filter(value => actualSorted.includes(value));
  const unexpected = actualSorted.filter(value => !expectedSorted.includes(value));
  return {
    status: matches.length === expectedSorted.length && unexpected.length === 0 ? 'PASS' : 'FAIL',
    expected: expectedSorted,
    actual: actualSorted,
    matched: matches.length,
    unexpected,
    missing: expectedSorted.filter(value => !actualSorted.includes(value))
  };
}

function containsSetResult(expected, actual) {
  const expectedSorted = sorted(expected);
  const actualSorted = sorted(actual);
  const missing = expectedSorted.filter(value => !actualSorted.includes(value));
  return {
    status: missing.length === 0 ? 'PASS' : 'FAIL',
    expected: expectedSorted,
    actual: actualSorted,
    matched: expectedSorted.length - missing.length,
    missing
  };
}

function unevaluated(reason) {
  return { status: 'NOT_EVALUATED', reason };
}

function aggregate(results, dimension) {
  const scored = results.map(result => result.dimensions[dimension]).filter(item => item.status !== 'NOT_EVALUATED');
  return {
    evaluated: scored.length,
    passed: scored.filter(item => item.status === 'PASS').length,
    failed: scored.filter(item => item.status === 'FAIL').length,
    accuracy: scored.length ? scored.filter(item => item.status === 'PASS').length / scored.length : null
  };
}

function reviewGate(oracle) {
  const review = oracle?.review;
  if (!oracle) return { eligible: false, reason: 'No reviewed end-to-end answer oracle supplied.' };
  if (review?.status !== REVIEW_STATUS) {
    return { eligible: false, reason: `Oracle review status is not ${REVIEW_STATUS}.` };
  }
  if (typeof review.reviewer !== 'string' || !review.reviewer.trim() ||
      typeof review.reviewedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(review.reviewedAt)) {
    return { eligible: false, reason: 'Independently verified oracle requires a reviewer and reviewedAt date (YYYY-MM-DD).' };
  }
  return { eligible: true };
}

function expectedReviewGate(expected) {
  const status = expected?.review?.status;
  if (status && status !== REVIEW_STATUS) {
    return { eligible: false, reason: `Expected-label review status is not ${REVIEW_STATUS}.` };
  }
  return { eligible: true };
}

function routingReviewGate(routingOracle, expected) {
  if (!routingOracle) return expectedReviewGate(expected);
  const review = routingOracle.review;
  if (review?.status !== REVIEW_STATUS) {
    return { eligible: false, reason: `Routing oracle review status is not ${REVIEW_STATUS}.` };
  }
  if (typeof review.reviewer !== 'string' || !review.reviewer.trim() ||
      typeof review.reviewedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(review.reviewedAt)) {
    return { eligible: false, reason: 'Independently verified routing oracle requires a reviewer and reviewedAt date (YYYY-MM-DD).' };
  }
  return { eligible: true };
}

function evaluateTopicConstraints({ requiredTopicIds, allowedTopicIds, forbiddenTopicIds, actualTopicIds }) {
  const hasAssertions = [requiredTopicIds, allowedTopicIds, forbiddenTopicIds].some(Array.isArray);
  if (!hasAssertions) return null;

  const required = Array.isArray(requiredTopicIds) ? containsSetResult(requiredTopicIds, actualTopicIds) : null;
  const allowed = Array.isArray(allowedTopicIds) ? sorted(allowedTopicIds) : null;
  const forbidden = Array.isArray(forbiddenTopicIds) ? sorted(forbiddenTopicIds) : [];
  const unexpected = allowed === null ? [] : sorted(actualTopicIds).filter(topicId => !allowed.includes(topicId));
  const forbiddenFound = sorted(actualTopicIds).filter(topicId => forbidden.includes(topicId));
  const checks = [
    ...(required ? [{ name: 'requiredTopicIds', ...required }] : []),
    ...(allowed ? [{ name: 'allowedTopicIds', status: unexpected.length === 0 ? 'PASS' : 'FAIL', allowed, unexpected }] : []),
    ...(Array.isArray(forbiddenTopicIds) ? [{ name: 'forbiddenTopicIds', status: forbiddenFound.length === 0 ? 'PASS' : 'FAIL', forbidden, found: forbiddenFound }] : [])
  ];
  return {
    status: checks.every(check => check.status === 'PASS') ? 'PASS' : 'FAIL',
    expected: { required: required?.expected || [], allowed, forbidden },
    actual: sorted(actualTopicIds),
    checks,
    missing: required?.missing || [],
    unexpected,
    forbidden: forbiddenFound
  };
}

function evaluateClassification(results) {
  const evaluated = results.filter(result => result.status !== 'NOT_EVALUATED');
  if (evaluated.length === 0) return unevaluated('No reviewed classification labels supplied.');
  return {
    status: evaluated.every(result => result.status === 'PASS') ? 'PASS' : 'FAIL',
    checks: evaluated.map(result => result.status)
  };
}

function evaluateSourceSelection({ expected, retrievedRecords, answer, gate, sourceError }) {
  if (!gate.eligible) return unevaluated(gate.reason);
  if (!expected || ![
    expected.allowedRecordIds,
    expected.forbiddenRecordIds,
    expected.expectedSourceMapIds,
    expected.allowedSourceMapIds,
    expected.expectedSourceMapTopicIds
  ].some(Array.isArray)) {
    return unevaluated('No reviewed source-selection oracle supplied.');
  }
  const records = Array.isArray(retrievedRecords) ? retrievedRecords : [];
  const actualRecordIds = records.map(record => record?.id).filter(value => typeof value === 'string');
  const trace = getSourceMapTrace(answer);
  const actualMapIds = traceList(trace, [
    'sourceMapIds',
    'pointerIds', 'sourceMapPointerIds', 'sourceMapRecordIds', 'selectedSourceMapIds', 'selectedMapRecordIds'
  ]);
  const traceTopicIds = traceList(trace, ['topicIds', 'sourceMapTopicIds', 'selectedSourceMapTopicIds']);
  const checks = [];
  if (Array.isArray(expected.expectedSourceMapIds)) {
    const mapResult = exactSetResult(expected.expectedSourceMapIds, actualMapIds);
    const traceReported = typeof trace.path === 'string' && Array.isArray(trace.sourceMapIds);
    checks.push({
      mode: 'expectedSourceMapIds',
      ...mapResult,
      status: mapResult.status === 'PASS' && traceReported ? 'PASS' : 'FAIL',
      ...(traceReported ? {} : { reason: 'Answer source-map trace is missing its path and sourceMapIds.' })
    });
  }
  if (Array.isArray(expected.allowedSourceMapIds)) {
    const unexpected = actualMapIds.filter(id => !expected.allowedSourceMapIds.includes(id));
    checks.push({
      mode: 'allowedSourceMapIds',
      status: unexpected.length === 0 ? 'PASS' : 'FAIL',
      allowed: sorted(expected.allowedSourceMapIds),
      actual: sorted(actualMapIds),
      unexpected
    });
  }
  if (Array.isArray(expected.expectedSourceMapTopicIds)) {
    checks.push({ mode: 'expectedSourceMapTopicIds', ...exactSetResult(expected.expectedSourceMapTopicIds, traceTopicIds) });
  }
  if (Array.isArray(expected.allowedRecordIds) || Array.isArray(expected.forbiddenRecordIds)) {
    const allowed = Array.isArray(expected.allowedRecordIds) ? expected.allowedRecordIds : null;
    const forbidden = Array.isArray(expected.forbiddenRecordIds) ? expected.forbiddenRecordIds : [];
    const outsideAllowed = allowed === null ? [] : actualRecordIds.filter(id => !allowed.includes(id));
    const forbiddenRetrieved = actualRecordIds.filter(id => forbidden.includes(id));
    checks.push({
      mode: 'reviewedRecordSelection',
      status: outsideAllowed.length === 0 && forbiddenRetrieved.length === 0 ? 'PASS' : 'FAIL',
      allowedRecordIds: allowed === null ? undefined : sorted(allowed),
      forbiddenRecordIds: sorted(forbidden),
      outsideAllowed,
      forbiddenRetrieved
    });
  }
  if (checks.length === 0) return unevaluated('No executable source-selection assertions supplied.');
  const scope = Array.isArray(expected.expectedSourceMapIds) || Array.isArray(expected.allowedSourceMapIds) || Array.isArray(expected.expectedSourceMapTopicIds)
    ? 'SOURCE_MAP_POINTER_IDENTITY_ONLY'
    : 'RETRIEVED_RECORD_SELECTION';
  if (sourceError && checks.some(check => check.mode === 'reviewedRecordSelection')) {
    return { status: 'FAIL', scope, reason: `Source selection failed: ${sourceError}`, checks };
  }
  return { status: checks.every(check => check.status === 'PASS') ? 'PASS' : 'FAIL', scope, checks };
}

function evaluateRetrievalDimension(sourceEvaluation, expected, answer, gate) {
  if (!gate.eligible) return unevaluated(gate.reason);
  if (expected && typeof expected === 'object') {
    const trace = getSourceMapTrace(answer);
    const actualRecordIds = traceList(trace, [
      'selectedRecordIds', 'fetchedRecordIds', 'retrievedEvidenceIds', 'selectedEvidenceRecordIds', 'evidenceRecordIds'
    ]);
    const actualUrls = traceList(trace, [
      'finalVerifiedUrls', 'verifiedFinalUrls', 'finalResolvedUrls', 'finalUrls', 'officialSourceUrls'
    ]).map(normalizeUrl);
    const checks = [];
    const requiredIds = expected.requiredRecordIds || expected.requiredSourceIds || [];
    const requiredUrls = expected.expectedFinalUrls || expected.requiredFinalUrls || [];
    if (Array.isArray(requiredIds) && requiredIds.length) {
      checks.push({ name: 'requiredFetchedRecords', ...containsSetResult(requiredIds, actualRecordIds) });
    }
    if (Array.isArray(requiredUrls) && requiredUrls.length) {
      checks.push({ name: 'requiredVerifiedFinalUrls', ...containsSetResult(requiredUrls.map(normalizeUrl), actualUrls) });
    }
    if (expected.requireSuccessfulFetch === true) {
      const fetched = extractGroundingEvidence(answer).filter(record => actualRecordIds.includes(record.id));
      const successfulFetch = trace.path === 'MAPPED_SOURCE' && fetched.length > 0 &&
        fetched.every(record => isSuccessfulFetchStatus(record.fetchStatus));
      checks.push({ name: 'successfulFetch', status: successfulFetch ? 'PASS' : 'FAIL', actual: fetched.map(record => record.fetchStatus || 'NOT_REPORTED') });
    }
    if (checks.length === 0) return unevaluated('Retrieval oracle has no executable record, URL, or fetch-status assertions.');
    return { status: checks.every(check => check.status === 'PASS') ? 'PASS' : 'FAIL', checks };
  }
  const retrievalChecks = (sourceEvaluation?.checks || []).filter(check => ['legacyExact', 'claimSources'].includes(check.mode));
  if (retrievalChecks.length === 0) return unevaluated('No reviewed retrieval recall/exact-source expectations supplied.');
  return {
    status: retrievalChecks.every(check => check.status === 'PASS') ? 'PASS' : 'FAIL',
    checks: retrievalChecks
  };
}

function evaluateAnswerPath(expected, answer, gate) {
  if (!gate.eligible) return unevaluated(gate.reason);
  if (!expected?.expectedMode) return unevaluated('No independently reviewed answer-path expectation supplied.');
  const trace = getSourceMapTrace(answer);
  const actual = trace.path || trace.mode || trace.route || trace.answerPath;
  if (typeof actual !== 'string' || !actual) {
    return { status: 'FAIL', expected: expected.expectedMode, actual: 'NOT_REPORTED', reason: 'Answer does not expose a source-map path trace.' };
  }
  const normalize = value => String(value).trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '');
  return { status: normalize(actual) === normalize(expected.expectedMode) ? 'PASS' : 'FAIL', expected: expected.expectedMode, actual };
}

function getSourceMapTrace(answer) {
  return answer?.sourceMapFallbackTrace ?? answer?.scenarioState?.sourceMapFallbackTrace ?? {};
}

function traceList(trace, keys) {
  const values = keys.flatMap(key => Array.isArray(trace?.[key]) ? trace[key] : []);
  return [...new Set(values.filter(value => typeof value === 'string'))];
}

function isSuccessfulFetchStatus(status) {
  return ['SUCCESS', 'FETCHED', 'VERIFIED', 'LIVE_VERIFIED', 'OK', 'HTTP_200'].includes(String(status || '').toUpperCase());
}

function evaluateGrounding(expected, answer, answerError, gate) {
  if (!gate.eligible) return unevaluated(gate.reason);
  if (!expected || typeof expected !== 'object') return unevaluated('No independently reviewed answer-grounding oracle supplied.');
  const evidence = extractGroundingEvidence(answer);
  if (!answer) return { status: 'FAIL', reason: answerError || 'Answer function returned no answer.', actual: [] };
  const ids = evidence.map(record => record.id).filter(value => typeof value === 'string');
  const required = expected.requiredRecordIds || expected.requiredSourceIds || [];
  const allowed = expected.allowedRecordIds || expected.allowedSourceIds || null;
  const requiredResult = Array.isArray(required) && required.length > 0
    ? containsSetResult(required, ids)
    : null;
  const outsideAllowed = Array.isArray(allowed) ? ids.filter(id => !allowed.includes(id)) : [];
  const invalidLifecycle = evidence.filter(record => {
    const lifecycle = String(record.lifecycle || record.lifecycleState || record.status || '').toUpperCase();
    if (record.groundingEligible === false || ['STAGED', 'REJECTED', 'INACTIVE'].includes(lifecycle)) return true;
    if (lifecycle !== 'CANDIDATE') return false;
    return !(expected.allowValidatedCandidateEvidence === true && isVerifiedCandidateEvidence(record, getSourceMapTrace(answer)));
  });
  const requireEligible = expected.requireGroundingEligible !== false;
  const checks = [
    ...(requiredResult ? [{ name: 'requiredSources', ...requiredResult }] : []),
    ...(Array.isArray(allowed) ? [{ name: 'allowedSources', status: outsideAllowed.length === 0 ? 'PASS' : 'FAIL', outsideAllowed }] : []),
    ...(requireEligible ? [{ name: 'lifecycleEligibility', status: invalidLifecycle.length === 0 && evidence.length > 0 ? 'PASS' : 'FAIL', invalid: invalidLifecycle.map(record => record.id) }] : [])
  ];
  if (checks.length === 0) return unevaluated('Grounding oracle must require/allow source IDs or eligible evidence.');
  return { status: checks.every(check => check.status === 'PASS') ? 'PASS' : 'FAIL', checks, actual: ids };
}

function extractGroundingEvidence(answer) {
  const raw = answer?.groundingEvidence ?? answer?.scenarioState?.groundingEvidence ??
    answer?.groundingContext?.selectedEvidence;
  if (Array.isArray(raw)) return raw.filter(record => record && typeof record === 'object').map(normalizeGroundingRecord);
  if (Array.isArray(raw?.records)) return raw.records.map(normalizeGroundingRecord);
  if (Array.isArray(raw?.sources)) return raw.sources.map(normalizeGroundingRecord);
  if (Array.isArray(raw?.selectedSources)) return raw.selectedSources.map(normalizeGroundingRecord);
  if (Array.isArray(raw?.groundingEvidence)) return raw.groundingEvidence.map(normalizeGroundingRecord);
  return [];
}

function normalizeGroundingRecord(record) {
  return {
    ...record,
    id: record.id || record.recordId || record.sourceId,
    lifecycle: record.lifecycle || record.lifecycleState || record.sourceLifecycle || record.status
  };
}

function isVerifiedCandidateEvidence(record, trace) {
  const finalUrl = normalizeUrl(record.finalUrl || record.officialSourceUrl || record.url);
  const traceUrls = traceList(trace, ['finalVerifiedUrls', 'verifiedFinalUrls', 'finalResolvedUrls', 'finalUrls']).map(normalizeUrl);
  return record.groundingEligible === true && record.candidateOnly === true &&
    typeof record.provenance === 'string' && record.provenance.length > 0 &&
    isSuccessfulFetchStatus(record.fetchStatus) && record.topicMatched === true &&
    record.titleMatched === true && record.contentMatched === true &&
    Boolean(finalUrl && traceUrls.includes(finalUrl));
}

function oracleSourceIds(oracle) {
  return (oracle?.claims || []).flatMap(claim => (claim.sources || [])
    .map(source => source.recordId)
    .filter(value => typeof value === 'string' && value.length > 0));
}

export async function runSingaporeBenchmark({
  fixturesPath: selectedFixturesPath = fixturePath,
  fixturesData,
  sourceRetriever = defaultAdvancedSourceRetriever,
  answerFunction = productionAnswerFunction
} = {}) {
  let fixtures = fixturesData ?? JSON.parse(await readFile(selectedFixturesPath, 'utf8'));
  const includedSupplementalFixtures = !fixturesData && path.resolve(selectedFixturesPath) === path.resolve(reviewedFixturePath)
    ? [path.basename(consolidationFixturePath)]
    : [];
  if (includedSupplementalFixtures.length > 0) {
    const consolidation = JSON.parse(await readFile(consolidationFixturePath, 'utf8'));
    fixtures = { ...fixtures, cases: [...fixtures.cases, ...consolidation.cases] };
  }
  const results = [];

  for (const testCase of fixtures.cases) {
    const classification = classifyQuestion(testCase.question);
    const retrievalHints = buildClassificationRetrievalHints(classification);
    const decomposition = defaultQueryTopicResolver.decomposeQuery(testCase.question);
    const actualTopicIds = classification.topicIds ?? decomposition.topics.map(topic => topic.id);
    const expected = testCase.expected || {};
    const oracle = testCase.reviewedOracle;
    const routingOracle = testCase.routingOracle;
    const answerPathOracle = testCase.answerPathOracle;
    const gate = reviewGate(oracle);
    const expectedGate = expectedReviewGate(expected);
    const routingGate = routingReviewGate(routingOracle, expected);
    const answerPathGate = answerPathOracle ? reviewGate(answerPathOracle) : gate;
    const answerSourceSelection = gate.eligible ? oracle?.sourceSelection : undefined;
    const routeSourceSelection = routingGate.eligible ? routingOracle?.sourceSelection : undefined;
    let retrievedRecords;
    const expectedOracleSourceIds = gate.eligible ? oracleSourceIds(oracle) : [];
    const legacySourceIds = Array.isArray(expected.sourceRecordIds) ? expected.sourceRecordIds : null;
    const hasSourcePrecisionOracle = (
      gate.eligible && (Array.isArray(answerSourceSelection?.allowedRecordIds) || Array.isArray(answerSourceSelection?.forbiddenRecordIds))
    ) || (
      routingGate.eligible && (Array.isArray(routeSourceSelection?.allowedRecordIds) || Array.isArray(routeSourceSelection?.forbiddenRecordIds))
    );
    const shouldRetrieve = legacySourceIds !== null || expectedOracleSourceIds.length > 0 || hasSourcePrecisionOracle;
    let sourceError;
    if (shouldRetrieve) {
      try {
        retrievedRecords = await sourceRetriever.retrieveSources({
          query: testCase.question,
          ...retrievalHints,
          maxResults: GROUNDING_SOURCE_MAX_RESULTS
        });
      } catch (error) {
        sourceError = error instanceof Error ? error.message : String(error);
      }
    }

    let answer;
    let answerError;
    if (gate.eligible || (routingOracle && routingGate.eligible) || (answerPathOracle && answerPathGate.eligible)) {
      try {
        answer = await answerFunction(testCase.question, 'SFRS_I', testCase);
      } catch (error) {
        answerError = error instanceof Error ? error.message : String(error);
      }
    }

    const sourceIds = (Array.isArray(retrievedRecords) ? retrievedRecords : []).map(record => record?.id).filter(value => typeof value === 'string');
    const sourceRetrieval = evaluateSourceDimension({
      legacyExpected: legacySourceIds,
      oracleExpected: expectedOracleSourceIds,
      sourceSelection: answerSourceSelection,
      actual: sourceIds,
      error: sourceError,
      gate,
      oracle
    });
    const routingExpected = routingOracle && routingGate.eligible ? routingOracle : expected;
    const routingLabelsGate = routingOracle ? routingGate : expectedGate;
    const authorityRouting = routingLabelsGate.eligible && routingExpected.authorities
      ? exactSetResult(routingExpected.authorities, classification.authorities)
      : unevaluated(routingLabelsGate.reason || 'No expected authority labels supplied.');
    const domainRouting = routingLabelsGate.eligible && routingExpected.domainIds
      ? exactSetResult(routingExpected.domainIds, classification.domains)
      : unevaluated(routingLabelsGate.reason || 'No reviewed fine-grained domain labels supplied.');
    const reviewedTopicOracle = routingGate.eligible ? routingOracle : null;
    const topicConstraints = reviewedTopicOracle
      ? evaluateTopicConstraints({
          requiredTopicIds: reviewedTopicOracle.requiredTopicIds,
          allowedTopicIds: reviewedTopicOracle.allowedTopicIds,
          forbiddenTopicIds: reviewedTopicOracle.forbiddenTopicIds,
          actualTopicIds
        })
      : null;
    const topicRouting = reviewedTopicOracle
      ? topicConstraints || unevaluated('Reviewed routing oracle has no topic assertions.')
      : expectedGate.eligible && Array.isArray(expected.requiredTopicIds)
        ? containsSetResult(expected.requiredTopicIds, actualTopicIds)
        : expectedGate.eligible && expected.topicIds
          ? exactSetResult(expected.topicIds, actualTopicIds)
          : unevaluated((routingOracle ? routingGate.reason : expectedGate.reason) || 'No expected topic labels supplied.');
    const answerCorrectness = gate.eligible
      ? evaluateAnswerCorrectness(oracle, answer, answerError)
      : unevaluated(gate.reason);
    const calculationCorrectness = gate.eligible
      ? evaluateCalculation(oracle?.calculation, answer, answerError)
      : unevaluated(gate.reason);
    const citationCorrectness = gate.eligible
      ? evaluateCitations(oracle?.citations, answer, answerError, oracle)
      : unevaluated(gate.reason);
    const missingFactBehaviour = gate.eligible && oracle?.missingFacts
      ? evaluateMissingFactOracle(oracle.missingFacts, answer, answerError)
      : unevaluated(gate.eligible ? 'No reviewed missing-fact oracle supplied.' : gate.reason);
    const effectiveDateCorrectness = gate.eligible
      ? evaluateEffectiveDate(oracle?.effectiveDate, answer, answerError)
      : unevaluated(gate.reason);
    const multiAuthorityHandling = routingLabelsGate.eligible && typeof routingExpected.multiAuthority === 'boolean'
      ? {
          status: classification.multiAuthority === routingExpected.multiAuthority ? 'PASS' : 'FAIL',
          expected: routingExpected.multiAuthority,
          actual: classification.multiAuthority,
          authorities: sorted(classification.authorities)
        }
      : unevaluated(routingLabelsGate.reason || 'No expected multi-authority label supplied.');
    const dimensions = {
      authorityRouting,
      domainRouting,
      topicRouting,
      sourceRetrieval,
      answerCorrectness,
      calculationCorrectness,
      citationCorrectness,
      missingFactBehaviour,
      effectiveDateCorrectness,
      multiAuthorityHandling,
      classification: evaluateClassification([authorityRouting, domainRouting, multiAuthorityHandling]),
      sourceSelection: evaluateSourceSelection({
        expected: routeSourceSelection || answerSourceSelection,
        retrievedRecords,
        answer,
        gate: routeSourceSelection ? routingGate : gate,
        sourceError
      }),
      retrieval: evaluateRetrievalDimension(sourceRetrieval, oracle?.retrieval, answer, gate),
      grounding: evaluateGrounding(oracle?.grounding, answer, answerError, gate),
      answerPath: answerPathOracle
        ? evaluateAnswerPath(answerPathOracle.answerPath, answer, answerPathGate)
        : evaluateAnswerPath(oracle?.answerPath, answer, answerPathGate),
      substantiveConclusion: answerCorrectness,
      citation: citationCorrectness,
      missingFacts: missingFactBehaviour,
      effectiveDate: effectiveDateCorrectness
    };
    results.push({
      id: testCase.id,
      provenance: testCase.provenance,
      caseContext: {
        expectedAnswerPath: answerPathOracle?.answerPath?.expectedMode || testCase.answerPathExpectation || null,
        oracleReviewStatus: oracle?.review?.status || 'NOT_SUPPLIED',
        routingReviewStatus: routingOracle?.review?.status || (expected.review?.status ? `LEGACY_${expected.review.status}` : 'NOT_SUPPLIED'),
        answerPathReviewStatus: answerPathOracle?.review?.status || (oracle?.answerPath ? oracle.review?.status : 'NOT_SUPPLIED'),
        answerReviewEligible: gate.eligible,
        routingReviewEligible: routingGate.eligible,
        answerPathReviewEligible: answerPathGate.eligible && Boolean(answerPathOracle?.answerPath || oracle?.answerPath)
      },
      evaluationContext: {
        sourceRetrieval: {
          mode: dimensions.sourceRetrieval.selectionMode || 'notEvaluated',
          answerGrounding: 'NOT_EVALUATED',
          answerGroundingReason: 'Candidate retrieval is run independently of the answer function; the benchmark does not establish that the answer used these records.'
        }
      },
      dimensions
    });
  }

  const summary = Object.fromEntries(BENCHMARK_DIMENSIONS.map(dimension => [dimension, aggregate(results, dimension)]));
  return {
    schemaVersion: 1,
    fixture: path.basename(selectedFixturesPath),
    sourceEvaluation: {
      candidateSelection: 'Scored from an independent source retriever call.',
      precision: 'Reviewed allow/forbidden record IDs provide a precision check; cases without a precision oracle are reported as recall-only when source recall is scored.',
      sourceMapSelection: 'SOURCE_MAP_POINTER_IDENTITY_ONLY checks the selected map pointer IDs reported by the answer route; it does not imply that a page was fetched, selected as grounding evidence, or cited.',
      answerGrounding: 'NOT_EVALUATED unless an independently reviewed grounding oracle and answer grounding evidence are both supplied; independently retrieved candidate records do not establish answer grounding.'
    },
    supplementalFixtures: includedSupplementalFixtures,
    totalCases: results.length,
    summary,
    results
  };
}

async function productionAnswerFunction(question, standard) {
  // No provider/API key is passed: benchmark answers must be reproducible and offline.
  return processAccountingQuery(question, null, standard);
}

function evaluateSourceDimension({ legacyExpected, oracleExpected, sourceSelection, actual, error, gate, oracle }) {
  const checks = [];
  const hasPrecisionOracle = Array.isArray(sourceSelection?.allowedRecordIds) || Array.isArray(sourceSelection?.forbiddenRecordIds);
  if (legacyExpected !== null) {
    checks.push({ mode: 'legacyExact', ...exactSetResult(legacyExpected, actual) });
  }
  if (gate.eligible && (oracle?.claims || []).length > 0) {
    const claimResults = oracle.claims.map(claim => {
      const sources = (claim.sources || []).filter(source => typeof source.recordId === 'string' && source.recordId.length > 0);
      if (sources.length === 0) {
        return {
          claimId: claim.id,
          status: 'FAIL',
          expected: [],
          missing: [],
          reason: 'Every independently reviewed substantive claim must name at least one expected source record ID.'
        };
      }
      const result = containsSetResult(sources.map(source => source.recordId), actual);
      return { claimId: claim.id, status: result.status, expected: result.expected, missing: result.missing };
    });
    checks.push({
      mode: 'claimSources',
      status: claimResults.every(result => result.status === 'PASS') ? 'PASS' : 'FAIL',
      expected: sorted(oracleExpected),
      actual: sorted(actual),
      claims: claimResults
    });
  }
  if (hasPrecisionOracle) {
    const allowed = Array.isArray(sourceSelection.allowedRecordIds) ? sourceSelection.allowedRecordIds : null;
    const forbidden = Array.isArray(sourceSelection.forbiddenRecordIds) ? sourceSelection.forbiddenRecordIds : [];
    const outsideAllowed = allowed === null ? [] : actual.filter(id => !allowed.includes(id));
    const forbiddenRetrieved = actual.filter(id => forbidden.includes(id));
    checks.push({
      mode: 'reviewedSelectionPrecision',
      status: outsideAllowed.length === 0 && forbiddenRetrieved.length === 0 ? 'PASS' : 'FAIL',
      allowedRecordIds: allowed === null ? undefined : sorted(allowed),
      forbiddenRecordIds: sorted(forbidden),
      outsideAllowed,
      forbiddenRetrieved
    });
  }
  if (checks.length === 0) return unevaluated('No validated expected source record IDs supplied.');
  if (error) {
    return { status: 'FAIL', reason: `Source retrieval failed: ${error}`, selectionMode: hasPrecisionOracle || legacyExpected !== null ? 'precisionChecked' : 'recallOnly', checks };
  }
  return {
    status: checks.every(check => check.status === 'PASS') ? 'PASS' : 'FAIL',
    selectionMode: hasPrecisionOracle || legacyExpected !== null ? 'precisionChecked' : 'recallOnly',
    actual: sorted(actual),
    checks
  };
}

function evaluateAnswerCorrectness(oracle, answer, answerError) {
  const claims = Array.isArray(oracle?.claims) ? oracle.claims : [];
  if (claims.length === 0) return unevaluated('No reviewed substantive claims supplied.');
  const claimResults = claims.map(claim => {
    const assertions = Array.isArray(claim.assertions) ? claim.assertions : [];
    if (assertions.length === 0) {
      return { id: claim.id, status: 'FAIL', reason: 'Reviewed claim has no executable answer assertions.' };
    }
    if (!answer || typeof answer.messageText !== 'string') {
      return { id: claim.id, status: 'FAIL', reason: answerError || 'Answer function returned no answer.' };
    }
    const results = assertions.map(assertion => evaluateAssertion(answer, assertion));
    return {
      id: claim.id,
      status: results.every(result => result.status === 'PASS') ? 'PASS' : 'FAIL',
      assertions: results
    };
  });
  return {
    status: claimResults.every(claim => claim.status === 'PASS') ? 'PASS' : 'FAIL',
    claims: claimResults
  };
}

function evaluateMissingFactOracle(expected, answer, answerError) {
  const required = normalizeFactAssertions(expected.required);
  const forbidden = normalizeFactAssertions(expected.forbidden);
  if (required.length + forbidden.length === 0) return unevaluated('No executable missing-fact assertions supplied.');
  if (!answer || typeof answer.messageText !== 'string') {
    return { status: 'FAIL', reason: answerError || 'Answer function returned no answer.', required: [], forbidden: [] };
  }
  const requiredResults = required.map(assertion => evaluateAssertion(answer, assertion));
  const forbiddenResults = forbidden.map(assertion => evaluateForbiddenAssertion(answer, assertion));
  return {
    status: [...requiredResults, ...forbiddenResults].every(result => result.status === 'PASS') ? 'PASS' : 'FAIL',
    required: requiredResults,
    forbidden: forbiddenResults
  };
}

function normalizeFactAssertions(items) {
  if (!Array.isArray(items)) return [];
  return items.flatMap(item => {
    if (item && Array.isArray(item.assertions)) return item.assertions;
    return item ? [item] : [];
  });
}

function evaluateForbiddenAssertion(answer, assertion) {
  const op = assertion?.op || assertion?.operator;
  const inverse = {
    includes: 'notIncludes',
    includesAny: 'notIncludesAny',
    matches: 'notMatches',
    equals: 'notEquals'
  }[op];
  return evaluateAssertion(answer, inverse ? { ...assertion, op: inverse } : assertion);
}

function evaluateEffectiveDate(expected, answer, answerError) {
  const assertions = Array.isArray(expected?.assertions) ? expected.assertions : [];
  if (assertions.length === 0) return unevaluated('No explicitly reviewed effective-date assertions supplied.');
  if (!answer || typeof answer.messageText !== 'string') {
    return { status: 'FAIL', reason: answerError || 'Answer function returned no answer.', assertions: [] };
  }
  const results = assertions.map(assertion => evaluateAssertion(answer, assertion));
  return { status: results.every(result => result.status === 'PASS') ? 'PASS' : 'FAIL', assertions: results };
}

function evaluateCalculation(expected, answer, answerError) {
  if (!expected || typeof expected !== 'object') return unevaluated('No reviewed calculation oracle supplied.');
  const checks = Array.isArray(expected.checks) ? expected.checks : [];
  const lineExpectations = Array.isArray(expected.expectedLines)
    ? expected.expectedLines
    : Array.isArray(expected.groups) ? expected.groups.flatMap(group => group.lines || []) : [];
  const journalMode = expected.journal || (expected.requireJournal === true ? 'required' : expected.forbidJournal === true ? 'forbidden' : undefined);
  const balanceExpected = expected.balanced === true || expected.requireBalanced === true;
  if (checks.length === 0 && lineExpectations.length === 0 && !journalMode && !balanceExpected) {
    return unevaluated('No executable calculation or journal assertions supplied.');
  }
  if (!answer || !answer.scenarioState) {
    return { status: 'FAIL', reason: answerError || 'Answer function returned no scenario state.', checks: [] };
  }

  const results = checks.map(assertion => evaluateAssertion(answer, assertion));
  const groups = getJournalGroups(answer.scenarioState);
  const actualLines = groups.flatMap(group => (group.lines || []).map(line => ({
    accountName: line.accountName || '',
    side: Number(line.debit || 0) > 0 ? 'DEBIT' : Number(line.credit || 0) > 0 ? 'CREDIT' : 'NONE',
    amount: Math.round(Math.max(Number(line.debit || 0), Number(line.credit || 0)) * 100) / 100,
    line
  })));
  const journalResults = [];

  if (journalMode === 'required') {
    journalResults.push({ name: 'journalPresent', status: groups.some(group => (group.lines || []).length > 0) ? 'PASS' : 'FAIL', expected: 'at least one journal group' });
  } else if (journalMode === 'forbidden') {
    journalResults.push({ name: 'journalAbsent', status: groups.some(group => (group.lines || []).length > 0) ? 'FAIL' : 'PASS', expected: 'no journal groups', actualGroups: groups.length });
  }

  if (lineExpectations.length > 0) {
    const tolerance = Number.isFinite(expected.tolerance) ? expected.tolerance : 0.01;
    const lineMatches = lineExpectations.map((lineExpectation, index) => {
      const validAmount = isValidExpectedAmount(lineExpectation);
      const candidates = actualLines.filter(actual => lineMatchesExpectation(actual, lineExpectation, tolerance));
      return {
        index,
        status: validAmount && candidates.length > 0 ? 'PASS' : 'FAIL',
        ...(!validAmount ? { reason: 'Expected journal amount must be a finite non-negative number in currency units.' } : {}),
        expected: lineExpectation,
        actual: candidates.map(candidate => ({ accountName: candidate.accountName, side: candidate.side, amount: candidate.amount }))
      };
    });
    journalResults.push({ name: 'expectedJournalLines', status: lineMatches.every(result => result.status === 'PASS') ? 'PASS' : 'FAIL', lines: lineMatches });

    if (expected.exactLines !== false) {
      const unmatched = actualLines.filter(actual => !lineExpectations.some(lineExpectation => lineMatchesExpectation(actual, lineExpectation, tolerance)));
      journalResults.push({
        name: 'noUnexpectedJournalLines',
        status: unmatched.length === 0 && actualLines.length === lineExpectations.length ? 'PASS' : 'FAIL',
        expectedLineCount: lineExpectations.length,
        actualLineCount: actualLines.length,
        unmatched: unmatched.map(actual => ({ accountName: actual.accountName, side: actual.side, amount: actual.amount }))
      });
    }
  }

  if (balanceExpected) {
    const tolerance = Number.isFinite(expected.tolerance) ? expected.tolerance : 0.01;
    const balanceResults = groups.map((group, index) => {
      const debit = (group.lines || []).reduce((sum, line) => sum + Number(line.debit || 0), 0);
      const credit = (group.lines || []).reduce((sum, line) => sum + Number(line.credit || 0), 0);
      const calculatedBalanced = Number.isFinite(debit) && Number.isFinite(credit) && Math.abs(debit - credit) < tolerance;
      return {
        index,
        status: calculatedBalanced && group.isBalanced !== false ? 'PASS' : 'FAIL',
        debit: roundMoney(debit),
        credit: roundMoney(credit),
        reportedBalanced: group.isBalanced
      };
    });
    journalResults.push({
      name: 'journalBalance',
      status: balanceResults.length > 0 && balanceResults.every(result => result.status === 'PASS') ? 'PASS' : 'FAIL',
      groups: balanceResults
    });
  }

  const all = [...results, ...journalResults];
  return { status: all.every(result => result.status === 'PASS') ? 'PASS' : 'FAIL', checks: results, journal: journalResults };
}

function getJournalGroups(scenarioState) {
  const groups = [
    ...(Array.isArray(scenarioState.directGroups) ? scenarioState.directGroups : []),
    ...(Array.isArray(scenarioState.committedDirectGroups) ? scenarioState.committedDirectGroups : [])
  ].filter(group => !group.isHypothetical);
  const seen = new Set();
  return groups.filter((group, index) => {
    const key = group.id || `${group.title || ''}|${group.eventDate || ''}|${index}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function lineMatchesExpectation(actual, expected, tolerance) {
  if (!isValidExpectedAmount(expected)) return false;
  const permittedAccounts = Array.isArray(expected.accountNames)
    ? expected.accountNames
    : Array.isArray(expected.accountNameAnyOf) ? expected.accountNameAnyOf
      : expected.accountName ? [expected.accountName] : [];
  const accountMatches = permittedAccounts.length === 0 || permittedAccounts.some(name => normalizeAccount(name) === normalizeAccount(actual.accountName));
  const sideMatches = !expected.side || expected.side.toUpperCase() === actual.side;
  const expectedAmount = Number(expected.amount);
  const amountMatches = !Object.prototype.hasOwnProperty.call(expected, 'amount') || Math.abs(expectedAmount - actual.amount) <= tolerance;
  return accountMatches && sideMatches && amountMatches;
}

function isValidExpectedAmount(expected) {
  if (!Object.prototype.hasOwnProperty.call(expected || {}, 'amount')) return true;
  const amount = expected.amount;
  if (typeof amount !== 'number' && typeof amount !== 'string') return false;
  if (typeof amount === 'string' && !amount.trim()) return false;
  const numericAmount = Number(amount);
  return Number.isFinite(numericAmount) && numericAmount >= 0;
}

function roundMoney(value) {
  return Math.round(value * 100) / 100;
}

function normalizeAccount(value) {
  return String(value).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
}

function evaluateCitations(expected, answer, answerError, oracle) {
  if (!expected || typeof expected !== 'object') return unevaluated('No reviewed citation oracle supplied.');
  const required = Array.isArray(expected.required) ? expected.required : [];
  const allowed = Array.isArray(expected.allowed) ? expected.allowed : required;
  const forbidUnsupported = expected.forbidUnsupported === true;
  const requireVerifiedLiveUrls = expected.requireVerifiedLiveUrls === true;
  if (required.length === 0 && !forbidUnsupported && !requireVerifiedLiveUrls) return unevaluated('No reviewed citation support requirements supplied.');
  if (!answer || typeof answer.messageText !== 'string') {
    return { status: 'FAIL', reason: answerError || 'Answer function returned no answer.', required: [], unsupported: [] };
  }

  const actual = collectCitations(answer);
  const verifiedLiveUrls = extractVerifiedLiveUrls(answer);
  const requiredResults = required.map(requirement => {
    const requiredClaim = (oracle?.claims || []).find(claim => claim.id === requirement.claimId);
    const claimExists = typeof requirement.claimId === 'string' && Boolean(requiredClaim);
    const expectedUrl = normalizeUrl(requirement.officialSourceUrl);
    const reviewedClaimParagraphs = (requiredClaim?.sources || [])
      .filter(source => normalizeUrl(source.officialSourceUrl) === expectedUrl)
      .flatMap(source => source.paragraphs || []);
    const paragraphs = Array.isArray(requirement.paragraphs)
      ? requirement.paragraphs
      : requirement.paragraph ? [requirement.paragraph] : reviewedClaimParagraphs;
    const urlMatches = actual.filter(citation => expectedUrl && normalizeUrl(citation.officialSourceUrl) === expectedUrl);
    const matchingParagraphs = paragraphs.filter(paragraph => urlMatches.some(citation => {
      return citationParagraphMatches(citation.paragraph, paragraph);
    }));
    const standardMatches = !requirement.standard || urlMatches.some(citation => standardsMatch(citation.standard, requirement.standard));
    const paragraphsMatch = paragraphs.length === 0 || matchingParagraphs.length === paragraphs.length;
    const liveVerificationRequired = requireVerifiedLiveUrls || requirement.requireVerifiedLiveUrl === true;
    const liveVerified = !liveVerificationRequired || verifiedLiveUrls.includes(expectedUrl);
    return {
      claimId: requirement.claimId,
      status: claimExists && urlMatches.length > 0 && standardMatches && paragraphsMatch && liveVerified ? 'PASS' : 'FAIL',
      expected: requirement,
      claimExists,
      liveVerified,
      matchingParagraphs,
      actual: urlMatches.map(({ standard, paragraph, officialSourceUrl }) => ({ standard, paragraph, officialSourceUrl }))
    };
  });

  let unsupportedResults = [];
  if (forbidUnsupported) {
    unsupportedResults = actual.map(citation => ({
      citation,
      status: allowed.some(permitted => citationMatchesRequirement(citation, permitted)) ? 'PASS' : 'FAIL'
    }));
  }
  if (requireVerifiedLiveUrls) {
    unsupportedResults.push(...actual.map(citation => ({
      citation,
      status: verifiedLiveUrls.includes(normalizeUrl(citation.officialSourceUrl)) ? 'PASS' : 'FAIL',
      reason: 'Citation URL is absent from the answer path trace of successfully verified live sources.'
    })));
  }
  const all = [...requiredResults, ...unsupportedResults];
  return {
    status: all.every(result => result.status === 'PASS') && (requiredResults.length > 0 || forbidUnsupported) ? 'PASS' : 'FAIL',
    required: requiredResults,
    unsupported: unsupportedResults.filter(result => result.status === 'FAIL').map(result => result.citation),
    actual: actual.map(({ standard, paragraph, officialSourceUrl }) => ({ standard, paragraph, officialSourceUrl }))
  };
}

function extractVerifiedLiveUrls(answer) {
  const trace = getSourceMapTrace(answer);
  if (trace.path !== 'MAPPED_SOURCE') return [];
  const traceUrls = new Set(traceList(trace, ['finalVerifiedUrls', 'verifiedFinalUrls', 'verifiedSourceUrls', 'finalResolvedUrls', 'finalUrls']).map(normalizeUrl));
  const evidenceUrls = extractGroundingEvidence(answer).filter(record => isVerifiedCandidateEvidence(record, trace))
    .map(record => normalizeUrl(record.finalUrl || record.officialSourceUrl || record.url))
    .filter(url => url && traceUrls.has(url));
  return [...new Set(evidenceUrls)];
}

function citationMatchesRequirement(citation, requirement) {
  if (!requirement?.officialSourceUrl || normalizeUrl(citation.officialSourceUrl) !== normalizeUrl(requirement.officialSourceUrl)) return false;
  if (requirement.standard && !standardsMatch(citation.standard, requirement.standard)) return false;
  const paragraphs = requirement.paragraphs || (requirement.paragraph ? [requirement.paragraph] : []);
  return paragraphs.length === 0 || paragraphs.some(paragraph => {
    return citationParagraphMatches(citation.paragraph, paragraph);
  });
}

function citationParagraphMatches(actual, expected) {
  const actualId = paragraphIdentifier(actual);
  const expectedId = paragraphIdentifier(expected);
  return Boolean(actualId && expectedId && (actualId === expectedId || actualId.startsWith(`${expectedId}(`)));
}

function paragraphIdentifier(value) {
  const cleaned = String(value || '')
    .toLowerCase()
    .replace(/§/g, ' ')
    .replace(/paragraph|para\.?/g, ' ')
    .trim();
  const match = cleaned.match(/(?:^|[^a-z0-9])(\d+(?:\.\d+)*(?:\([a-z0-9]+\))*)/i);
  return match ? match[1].replace(/\s/g, '') : normalizeCitationPart(cleaned);
}

function collectCitations(answer) {
  const citations = [];
  const state = answer.scenarioState || {};
  const groups = [
    ...(Array.isArray(state.directGroups) ? state.directGroups : []),
    ...(Array.isArray(state.committedDirectGroups) ? state.committedDirectGroups : [])
  ].filter(group => !group.isHypothetical);
  for (const group of groups) {
    for (const citation of group.citations || []) citations.push(citation);
  }
  for (const advisory of state.statutoryAdvisory || []) {
    if (advisory.officialUrl) {
      citations.push({
        standard: advisory.statuteOrAct,
        paragraph: advisory.sectionOrSchedule,
        officialSourceUrl: advisory.officialUrl
      });
    }
  }
  for (const link of state.officialAnswerLinks || []) {
    if (link.url || link.href) {
      citations.push({
        standard: link.standard || link.title || link.label || '',
        paragraph: link.paragraph || link.section || '',
        officialSourceUrl: link.url || link.href
      });
    }
  }
  const markdownLinks = answer.messageText.matchAll(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/gi);
  for (const [, label, url] of markdownLinks) {
    const standardMatch = label.match(/(?:SFRS\s*\(\s*I\s*\)|SFRS\s*\(?I\)?|IFRS|IAS)\s*[^,;—–-]*/i);
    const paragraphMatch = label.match(/(?:§|paragraph\s+|para\.?\s*)([^,;—–]+)/i) || label.match(/,\s*([^,;—–]+)$/);
    citations.push({
      standard: standardMatch?.[0]?.trim() || label.trim(),
      paragraph: paragraphMatch?.[1]?.trim() || '',
      officialSourceUrl: url
    });
  }
  const seen = new Set();
  return citations.filter(citation => {
    if (!citation.officialSourceUrl) return false;
    const key = [citation.standard, citation.paragraph, normalizeUrl(citation.officialSourceUrl)].join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return '';
  try {
    const url = new URL(value.trim());
    url.hash = '';
    url.search = '';
    return url.toString().replace(/\/$/, '').toLowerCase();
  } catch {
    return value.trim().replace(/\/$/, '').toLowerCase();
  }
}

function normalizeCitationPart(value) {
  return String(value || '').toLowerCase().replace(/§/g, '').replace(/paragraph|para\.?/g, '').replace(/[^a-z0-9]/g, '');
}

function normalizeStandard(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function standardsMatch(actual, expected) {
  const actualCode = standardCode(actual);
  const expectedCode = standardCode(expected);
  if (actualCode && expectedCode) return actualCode === expectedCode;
  const normalizedActual = normalizeStandard(actual);
  const normalizedExpected = normalizeStandard(expected);
  return normalizedActual === normalizedExpected;
}

function standardCode(value) {
  const text = String(value || '');
  const match = text.match(/\b(SFRS\s*\(\s*I\s*\)|SFRS\s*\(?\s*I\s*\)?|IFRS|IAS)\s*(\d+(?:-\d+)*)/i);
  return match ? `${match[1].toLowerCase().replace(/[^a-z]/g, '')}${match[2].replace(/[^0-9]/g, '')}` : '';
}

function evaluateAssertion(answer, assertion) {
  const op = assertion?.op || assertion?.operator;
  const path = assertion?.path;
  const actualValues = resolvePath(answer, path);
  const strings = actualValues.filter(value => typeof value === 'string').map(value => value.toLowerCase());
  let passed = false;
  let actual = actualValues;
  let error;

  try {
  switch (op) {
    case 'includes':
    case 'notIncludes': {
      const expected = String(assertion.value ?? '').toLowerCase();
      const included = strings.some(value => value.includes(expected));
      passed = op === 'includes' ? included : !included;
      break;
    }
    case 'includesAny':
    case 'notIncludesAny': {
      const expected = (assertion.values || []).map(value => String(value).toLowerCase());
      const included = expected.some(needle => strings.some(value => value.includes(needle)));
      passed = op === 'includesAny' ? included : !included;
      break;
    }
    case 'equals': {
      passed = actualValues.some(value => value === assertion.value || String(value) === String(assertion.value));
      break;
    }
    case 'notEquals': {
      passed = !actualValues.some(value => value === assertion.value || String(value) === String(assertion.value));
      break;
    }
    case 'numberEquals': {
      const expected = Number(assertion.value);
      const tolerance = Number.isFinite(assertion.tolerance) ? assertion.tolerance : 0.01;
      const numericValues = actualValues.map(parseNumber).filter(Number.isFinite);
      passed = Number.isFinite(expected) && numericValues.some(value => Math.abs(value - expected) <= tolerance);
      actual = numericValues;
      break;
    }
    case 'numberInText': {
      const pattern = new RegExp(assertion.pattern, 'i');
      const textValue = strings.join('\n');
      const match = textValue.match(pattern);
      const capture = match?.[1];
      const number = parseNumber(capture);
      const expected = Number(assertion.value);
      const tolerance = Number.isFinite(assertion.tolerance) ? assertion.tolerance : 0.01;
      passed = Number.isFinite(number) && Number.isFinite(expected) && Math.abs(number - expected) <= tolerance;
      actual = { match: match?.[0] || null, captured: capture ?? null, number: Number.isFinite(number) ? number : null };
      if (match && capture === undefined) error = 'numberInText pattern must contain a numeric capture group.';
      break;
    }
    case 'matches':
    case 'notMatches': {
      const regex = new RegExp(assertion.pattern, 'i');
      const matches = strings.some(value => regex.test(value));
      passed = op === 'matches' ? matches : !matches;
      break;
    }
    case 'isEmpty': {
      passed = actualValues.length === 0 || actualValues.every(value => value == null || value === '' || (Array.isArray(value) && value.length === 0));
      break;
    }
    default:
      error = `Unsupported assertion operator '${op}'.`;
  }
  } catch (assertionError) {
    error = assertionError instanceof Error ? assertionError.message : String(assertionError);
    passed = false;
  }

  return {
    status: passed ? 'PASS' : 'FAIL',
    path,
    op,
    expected: assertion.value ?? assertion.values ?? assertion.pattern,
    actual: actual.length === 1 ? actual[0] : actual,
    ...(error ? { error } : {})
  };
}

function resolvePath(root, path) {
  if (typeof path !== 'string' || !path) return [];
  let current = [root];
  for (const segment of path.split('.')) {
    const wildcard = segment.endsWith('[*]');
    const key = wildcard ? segment.slice(0, -3) : segment;
    current = current.flatMap(value => {
      if (value == null) return [];
      const next = value[key];
      if (wildcard) return Array.isArray(next) ? next : [];
      return next === undefined ? [] : [next];
    });
  }
  return current;
}

function parseNumber(value) {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return Number.NaN;
  const numeric = value.replace(/,/g, '').replace(/[^\d.+-]/g, '');
  return numeric ? Number(numeric) : Number.NaN;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const fixtureArgument = process.argv.find(arg => arg.startsWith('--fixture='));
  const selectedPath = fixtureArgument ? path.resolve(process.cwd(), fixtureArgument.slice('--fixture='.length)) : fixturePath;
  const report = await runSingaporeBenchmark({ fixturesPath: selectedPath });
  console.log(process.argv.includes('--json')
    ? JSON.stringify(report, null, 2)
    : formatSummary(report));
}

function formatSummary(report) {
  const lines = [
    `Singapore knowledge benchmark: ${report.totalCases} cases (${report.fixture})`,
    'Scores reflect only dimensions with reviewed expected labels; other dimensions are NOT_EVALUATED.',
    'Source retrieval is independent candidate selection; cases without a precision oracle are recall-only, and answer grounding against retrieved records is NOT_EVALUATED.'
  ];
  for (const [dimension, score] of Object.entries(report.summary)) {
    const accuracy = score.accuracy === null ? 'n/a' : `${(score.accuracy * 100).toFixed(1)}%`;
    lines.push(`${dimension}: ${score.passed}/${score.evaluated} passed (${accuracy}); ${score.failed} failed`);
  }
  return lines.join('\n');
}
