import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { BENCHMARK_DIMENSIONS, runSingaporeBenchmark } from '../evaluation/singapore/run.mjs';
import { GROUNDING_SOURCE_MAX_RESULTS } from '../../src/services/groundingContextBuilder.ts';

const fixture = JSON.parse(await readFile(new URL('../evaluation/singapore/gemini-seed.json', import.meta.url), 'utf8'));
const ids = fixture.cases.map(testCase => testCase.id);
assert.equal(new Set(ids).size, ids.length, 'Benchmark case IDs must be unique');
assert.ok(fixture.cases.every(testCase => Array.isArray(testCase.expected.domainIds)), 'Each fixture case must provide reviewed fine-grained domain labels, including empty labels for controls');
assert.ok(fixture.cases.some(testCase => testCase.provenance === 'gemini-seed-negative' && testCase.expected.authorities.length === 0), 'Include nonstatutory MOM ambiguity controls');
assert.ok(fixture.cases.some(testCase => testCase.id === 'mas-iras-section-13o' && testCase.expected.authorities.length === 2), 'Include an explicit multi-authority 13O sentinel');

const report = await runSingaporeBenchmark();
assert.equal(report.totalCases, fixture.cases.length);
assert.deepEqual(Object.keys(report.summary), BENCHMARK_DIMENSIONS);
for (const result of report.results) {
  assert.deepEqual(Object.keys(result.dimensions), BENCHMARK_DIMENSIONS, `${result.id} must report every benchmark dimension`);
}

let capturedRetrievalQuery;
const sourceHarness = {
  async retrieveSources(query) {
    capturedRetrievalQuery = query;
    return [{ id: 'REVIEWED_FIXTURE_SOURCE' }];
  }
};
const retrievalHarnessReport = await runSingaporeBenchmark({
  fixturesData: {
    cases: [{
      id: 'retrieval-harness-contract',
      provenance: 'test',
      question: 'IRAS GST registration',
      expected: {
        authorities: ['IRAS'],
        topicIds: ['gst_compulsory_registration'],
        multiAuthority: false,
        sourceRecordIds: ['REVIEWED_FIXTURE_SOURCE']
      }
    }]
  },
  sourceRetriever: sourceHarness
});
assert.equal(retrievalHarnessReport.results[0].dimensions.sourceRetrieval.status, 'PASS');
assert.equal(capturedRetrievalQuery.domain, 'IRAS_GST');
assert.deepEqual(capturedRetrievalQuery.authorities, ['IRAS']);
assert.ok(capturedRetrievalQuery.topicIds.includes('gst_compulsory_registration'));
assert.equal(capturedRetrievalQuery.maxResults, GROUNDING_SOURCE_MAX_RESULTS, 'Benchmark retrieval limit must match production grounding');

console.log(`PASS | Singapore knowledge benchmark framework: ${report.totalCases} cases; ${BENCHMARK_DIMENSIONS.length} dimensions`);
for (const [dimension, score] of Object.entries(report.summary)) {
  const accuracy = score.accuracy === null ? 'NOT_EVALUATED' : `${(score.accuracy * 100).toFixed(1)}%`;
  console.log(`  ${dimension}: ${score.passed}/${score.evaluated} passed (${accuracy})`);
}
