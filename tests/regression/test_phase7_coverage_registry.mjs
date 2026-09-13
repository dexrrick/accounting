import assert from 'node:assert/strict';
import { SINGAPORE_COVERAGE_REGISTRY, getCoverageTopicsByPriority } from '../../src/standards/coverageRegistry.ts';
import { getAllAuthoritativeSources } from '../../src/standards/unifiedSourceModel.ts';

const sourceIds = new Set(getAllAuthoritativeSources().map(source => source.id));
const requiredChecks = new Set([
  'SOURCE_PROVENANCE',
  'RETRIEVAL_EVALUATION',
  'TEMPORAL_VALIDITY',
  'ACCOUNTING_OR_CALCULATION_RULE',
  'MISSING_FACT_GUARD',
  'REGRESSION_TEST'
]);

assert.ok(getCoverageTopicsByPriority('P1').length >= 3, 'Phase 7 must begin with at least three P1 topic packs');
for (const topic of SINGAPORE_COVERAGE_REGISTRY) {
  assert.ok(topic.sourceRecordIds.length > 0, `${topic.id} must identify its authoritative source records`);
  assert.deepEqual(new Set(topic.requiredChecks), requiredChecks, `${topic.id} must retain the complete topic-pack quality contract`);
  for (const sourceId of topic.sourceRecordIds) {
    assert.ok(sourceIds.has(sourceId), `${topic.id} references missing source '${sourceId}'`);
  }
}

console.log(`PASS | Phase 7 coverage registry: ${SINGAPORE_COVERAGE_REGISTRY.length} governed topic packs`);
