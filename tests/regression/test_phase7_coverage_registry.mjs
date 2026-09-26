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
assert.ok(SINGAPORE_COVERAGE_REGISTRY.length >= 150 && SINGAPORE_COVERAGE_REGISTRY.length <= 300, 'Master catalog must contain 150-300 practical topics after the consolidation source-map extension');
assert.equal(new Set(SINGAPORE_COVERAGE_REGISTRY.map(topic => topic.id)).size, SINGAPORE_COVERAGE_REGISTRY.length, 'Topic IDs must be unique');
for (const topic of SINGAPORE_COVERAGE_REGISTRY) {
  assert.deepEqual(new Set(topic.requiredChecks), requiredChecks, `${topic.id} must retain the complete topic-pack quality contract`);
  if (topic.status === 'VALIDATED') {
    assert.ok(topic.sourceRecordIds.length > 0, `${topic.id} cannot be VALIDATED without a source record`);
  }
  for (const sourceId of topic.sourceRecordIds) {
    assert.ok(sourceIds.has(sourceId), `${topic.id} references missing source '${sourceId}'`);
  }
}

const mappedTopic = id => SINGAPORE_COVERAGE_REGISTRY.find(topic => topic.id === id);
assert.equal(mappedTopic('sfrsi-step-acquisition').sourceRecordIds.includes('SFRSI128_SOURCE_MAP'), false,
  'A generic step acquisition may start from a passive holding; IAS 28 needs prior associate or joint venture facts');
assert.equal(mappedTopic('sfrsi-loss-of-control').sourceRecordIds.includes('SFRSI128_SOURCE_MAP'), false,
  'Loss of control alone does not establish significant influence over a retained interest');
assert.equal(mappedTopic('sfrsi-associate-to-subsidiary').sourceRecordIds.includes('SFRSI128_SOURCE_MAP'), true,
  'A confirmed associate-to-subsidiary transition retains the IAS 28 source pointer');
for (const id of ['sfrsi10-loss-of-control', 'sfrsi-loss-of-control']) {
  assert.equal(mappedTopic(id).relatedTopicIds.includes('sfrsi3-step-acquisition'), false,
    `${id} must not link a disposal to an acquisition topic`);
  assert.equal(mappedTopic(id).relatedTopicIds.includes('sfrsi-associate-to-subsidiary'), false,
    `${id} must not link loss of control to gaining control`);
}

console.log(`PASS | Phase 7 coverage registry: ${SINGAPORE_COVERAGE_REGISTRY.length} canonical topics`);
