import assert from 'node:assert/strict';
import { resolveMappedOfficialSourceFallback } from '../../src/services/groundingContextBuilder.ts';
import { defaultSourceRetriever } from '../../src/retrieval/sourceRetriever.ts';
import { getCoverageTopicById, IRAS_SOURCE_MAP_DEFINITIONS } from '../../src/standards/coverageRegistry.ts';
import { UNIFIED_SOURCE_REGISTRY } from '../../src/standards/unifiedSourceModel.ts';

// Reuse the API-free synthetic stage harness and keep its detailed trace out of
// the suite log. It asserts the five positive families and admission controls.
const originalLog = console.log;
console.log = () => {};
try {
  await import('../../docs/evaluation/multi-authority-workstreams/iras-first-local-2026-10-02-v4/test-local-evidence-stages.mjs');
} finally {
  console.log = originalLog;
}

// A mapped corporate-tax topic must still reject a WHT-route page when the
// query is not about withholding tax, even if the injected page body matches.
const topic = getCoverageTopicById('iras-cit-deductibility');
const expenseMap = IRAS_SOURCE_MAP_DEFINITIONS.find(item => item.id === 'IRAS_CIT_EXPENSES_SOURCE_MAP');
const whtPointer = UNIFIED_SOURCE_REGISTRY.IRAS_WHT_RATES_SOURCE_MAP;
assert.ok(topic && expenseMap && whtPointer);
const page = '<html><head><title>Business Expenses</title></head><body><main><h1>Business Expenses</h1><p>IRAS corporate tax deductibility for business expenses incurred wholly and exclusively in producing income, subject to conditions and supporting business records.</p></main></body></html>';
const result = await resolveMappedOfficialSourceFallback(
  [topic.id], 'Can this expense be claimed as a corporate income tax deduction?', defaultSourceRetriever,
  {
    discoveryAdapter: { discoverOfficialSourceCandidates: async () => [] },
    webRetriever: {
      fetchOfficialSource: async () => ({
        status: 'SUCCESS', content: page, finalUrl: whtPointer.canonicalSourceUrl,
        pageTitle: expenseMap.pageTitle, topicMatched: true, titleMatched: true, contentMatched: true,
        retrievedAt: '2026-10-02T00:00:00.000Z'
      })
    }
  }
);
assert.equal(result.records.length, 0, 'An unrelated corporate-tax query cannot admit an injected WHT-route page.');
assert.equal(result.trace.attempts[0]?.fetchStatus, 'DOMAIN_MISMATCH');

console.log('PASS: IRAS multi-authority local evidence stage regressions');
