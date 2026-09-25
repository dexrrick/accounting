import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyQuestion } from '../../../src/classification/questionClassifier.ts';
import { defaultQueryTopicResolver } from '../../../src/retrieval/queryTopicResolver.ts';
import { defaultAdvancedSourceRetriever } from '../../../src/retrieval/advancedSourceRetriever.ts';
import {
  buildClassificationRetrievalHints,
  GROUNDING_SOURCE_MAX_RESULTS
} from '../../../src/services/groundingContextBuilder.ts';

const directory = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(directory, 'gemini-seed.json');

export const BENCHMARK_DIMENSIONS = [
  'authorityRouting',
  'domainRouting',
  'topicRouting',
  'sourceRetrieval',
  'answerCorrectness',
  'calculationCorrectness',
  'citationCorrectness',
  'missingFactBehaviour',
  'effectiveDateCorrectness',
  'multiAuthorityHandling'
];

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
    unexpected
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

export async function runSingaporeBenchmark({
  fixturesPath = fixturePath,
  fixturesData,
  sourceRetriever = defaultAdvancedSourceRetriever
} = {}) {
  const fixtures = fixturesData ?? JSON.parse(await readFile(fixturesPath, 'utf8'));
  const results = [];

  for (const testCase of fixtures.cases) {
    const classification = classifyQuestion(testCase.question);
    const retrievalHints = buildClassificationRetrievalHints(classification);
    const decomposition = defaultQueryTopicResolver.decomposeQuery(testCase.question);
    const actualTopicIds = classification.topicIds ?? decomposition.topics.map(topic => topic.id);
    const expected = testCase.expected;
    const dimensions = {
      authorityRouting: expected.authorities
        ? exactSetResult(expected.authorities, classification.authorities)
        : unevaluated('No expected authority labels supplied.'),
      domainRouting: expected.domainIds
        ? exactSetResult(expected.domainIds, classification.domains)
        : unevaluated('No reviewed fine-grained domain labels supplied.'),
      topicRouting: expected.topicIds
        ? exactSetResult(expected.topicIds, actualTopicIds)
        : unevaluated('No expected topic labels supplied.'),
      sourceRetrieval: expected.sourceRecordIds
        ? await evaluateSourceRetrieval(testCase.question, expected.sourceRecordIds, retrievalHints, sourceRetriever)
        : unevaluated('No validated expected source record IDs supplied.'),
      answerCorrectness: expected.answer
        ? unevaluated('Answer observations are not connected to the current deterministic benchmark runner.')
        : unevaluated('No reviewed answer oracle supplied.'),
      calculationCorrectness: expected.calculation
        ? unevaluated('Calculation observations are not connected to the current deterministic benchmark runner.')
        : unevaluated('No reviewed calculation oracle supplied.'),
      citationCorrectness: expected.citationRecordIds
        ? unevaluated('Citation observations are not connected to the current deterministic benchmark runner.')
        : unevaluated('No reviewed citation oracle supplied.'),
      missingFactBehaviour: expected.missingFacts
        ? evaluateMissingFacts(expected.missingFacts, classification.missingFacts)
        : unevaluated('No reviewed missing-fact oracle supplied.'),
      effectiveDateCorrectness: expected.effectiveDate
        ? unevaluated('Effective-date answer observations are not connected to the current deterministic benchmark runner.')
        : unevaluated('No reviewed effective-date oracle supplied.'),
      multiAuthorityHandling: typeof expected.multiAuthority === 'boolean'
        ? {
            status: classification.multiAuthority === expected.multiAuthority ? 'PASS' : 'FAIL',
            expected: expected.multiAuthority,
            actual: classification.multiAuthority,
            authorities: sorted(classification.authorities)
          }
        : unevaluated('No expected multi-authority label supplied.')
    };
    results.push({ id: testCase.id, provenance: testCase.provenance, dimensions });
  }

  const summary = Object.fromEntries(BENCHMARK_DIMENSIONS.map(dimension => [dimension, aggregate(results, dimension)]));
  return {
    schemaVersion: 1,
    fixture: path.basename(fixturesPath),
    totalCases: results.length,
    summary,
    results
  };
}

async function evaluateSourceRetrieval(query, expectedSourceRecordIds, retrievalHints, sourceRetriever) {
  const records = await sourceRetriever.retrieveSources({
    query,
    ...retrievalHints,
    maxResults: GROUNDING_SOURCE_MAX_RESULTS
  });
  return exactSetResult(expectedSourceRecordIds, records.map(record => record.id));
}

function evaluateMissingFacts(expected, actual) {
  const normalizedActual = actual.map(item => item.toLowerCase());
  const matches = expected.filter(item => normalizedActual.some(value => value.includes(item.toLowerCase())));
  return {
    status: matches.length === expected.length ? 'PASS' : 'FAIL',
    expected: expected.length,
    matched: matches.length,
    missing: expected.filter(item => !matches.includes(item))
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = await runSingaporeBenchmark();
  console.log(process.argv.includes('--json')
    ? JSON.stringify(report, null, 2)
    : formatSummary(report));
}

function formatSummary(report) {
  const lines = [
    `Singapore knowledge benchmark: ${report.totalCases} cases (${report.fixture})`,
    'Scores reflect only dimensions with reviewed expected labels; other dimensions are NOT_EVALUATED.'
  ];
  for (const [dimension, score] of Object.entries(report.summary)) {
    const accuracy = score.accuracy === null ? 'n/a' : `${(score.accuracy * 100).toFixed(1)}%`;
    lines.push(`${dimension}: ${score.passed}/${score.evaluated} passed (${accuracy}); ${score.failed} failed`);
  }
  return lines.join('\n');
}
