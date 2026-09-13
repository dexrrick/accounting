import assert from 'node:assert/strict';
import { AdvancedSourceRetriever } from '../../src/retrieval/advancedSourceRetriever.ts';
import {
  retrievalEvaluationCases,
  retrievalQualityThresholds
} from '../fixtures/retrievalEvaluationCases.mjs';

async function runRetrievalQualityEvaluation() {
  console.log('================================================================');
  console.log('RETRIEVAL QUALITY EVALUATION');
  console.log('================================================================\n');

  const retriever = new AdvancedSourceRetriever();
  let topThreeHits = 0;
  let authorityHits = 0;
  let temporalChecks = 0;
  let temporalPasses = 0;

  for (const testCase of retrievalEvaluationCases) {
    const request = {
      query: testCase.query,
      domain: testCase.domain,
      authorities: testCase.authorities,
      targetDate: testCase.targetDate,
      includeHistorical: testCase.includeHistorical,
      referenceDate: '2026-09-12',
      maxResults: 3
    };

    const runs = [];
    for (let attempt = 0; attempt < retrievalQualityThresholds.repetitionsForDeterminism; attempt++) {
      const records = await retriever.retrieveSources(request);
      runs.push(records.map(record => record.id));
    }

    const resultIds = runs[0];
    for (const ids of runs.slice(1)) {
      assert.deepEqual(ids, resultIds, `${testCase.id}: ranking must be deterministic across repeated retrievals`);
    }

    const topThreeHit = resultIds.includes(testCase.expectedRecordId);
    const authorityHit = resultIds[0] && retriever.getSourceById(resultIds[0])?.authority === testCase.expectedAuthority;
    topThreeHits += Number(topThreeHit);
    authorityHits += Number(authorityHit);

    for (const excludedId of testCase.excludedRecordIds || []) {
      temporalChecks++;
      const excluded = resultIds.includes(excludedId);
      temporalPasses += Number(!excluded);
      assert.equal(excluded, false, `${testCase.id}: temporally invalid record '${excludedId}' must not be retrieved`);
    }

    console.log(`${topThreeHit && authorityHit ? 'PASS' : 'FAIL'} | ${testCase.id} | top-3: ${resultIds.join(', ') || '(none)'}`);
  }

  const total = retrievalEvaluationCases.length;
  const topThreeRecall = topThreeHits / total;
  const authorityPrecisionAtOne = authorityHits / total;
  const temporalExclusionRate = temporalChecks === 0 ? 1 : temporalPasses / temporalChecks;

  console.log('\nMetrics');
  console.log(`- Top-3 expected-source recall: ${topThreeHits}/${total} (${(topThreeRecall * 100).toFixed(0)}%)`);
  console.log(`- Authority precision at rank 1: ${authorityHits}/${total} (${(authorityPrecisionAtOne * 100).toFixed(0)}%)`);
  console.log(`- Temporal exclusion rate: ${temporalPasses}/${temporalChecks} (${(temporalExclusionRate * 100).toFixed(0)}%)`);

  assert(topThreeRecall >= retrievalQualityThresholds.minimumTopThreeRecall, 'Top-3 expected-source recall fell below the release threshold');
  assert(authorityPrecisionAtOne >= retrievalQualityThresholds.minimumAuthorityPrecisionAtOne, 'Authority precision at rank 1 fell below the release threshold');
  assert(temporalExclusionRate >= retrievalQualityThresholds.minimumTemporalExclusionRate, 'Temporal exclusion rate fell below the release threshold');
}

runRetrievalQualityEvaluation().catch(error => {
  console.error('\nRETRIEVAL QUALITY EVALUATION FAILED');
  console.error(error);
  process.exit(1);
});
