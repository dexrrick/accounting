import assert from 'node:assert/strict';
import { processAccountingQuery } from '../../src/services/geminiService.ts';

const targetQuery = 'Explain the SFRS(I) 6 accounting treatment for exploration and evaluation assets. Explain the rule only; do not calculate amounts or prepare a journal.';
const provider = {
  activeProvider: 'gemini',
  gemini: { apiKey: '0123456789012345', model: 'gemini-3.5-flash-lite' },
  azure: { apiKey: '', endpoint: '', deploymentName: 'gpt-4o', apiVersion: '2024-08-01-preview' },
  openai: { apiKey: '', model: 'gpt-4o' }
};

async function runOffline(query, options = {}) {
  const originalFetch = globalThis.fetch;
  let semanticCalls = 0;
  const nonSemanticRequests = [];
  let totalFetchDispatches = 0;
  let workstreams;
  globalThis.fetch = async (url, init) => {
    totalFetchDispatches += 1;
    if (String(url).includes('generativelanguage.googleapis.com')) {
      const body = JSON.parse(String(init?.body || '{}'));
      const systemText = body.systemInstruction?.parts?.[0]?.text || '';
      if (systemText.includes('Interpret the user question only')) {
        semanticCalls += 1;
        if (options.semanticFailure === 'timeout') throw new Error('request timed out');
        if (options.semanticFailure === 'provider error') throw new Error('offline provider failure');
        if (options.semanticFailure === 'malformed') {
          return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{malformed' }] } }] }), { status: 200 });
        }
      } else {
        nonSemanticRequests.push(String(url));
      }
    } else {
      nonSemanticRequests.push(String(url));
    }
    return new Response('', { status: 503 });
  };
  try {
    const response = await processAccountingQuery(
      query, null, 'SFRS_I', options.withoutProvider ? undefined : provider,
      'gemini-3.5-flash-lite', options.chatHistory || [], options.outputPreference || { journal: false, statutory: true },
      { onAuthorityWorkstreams(result) { workstreams = result; } }
    );
    return { response, semanticCalls, nonSemanticRequests, totalFetchDispatches, workstreams };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

for (const failure of ['no provider', 'malformed', 'timeout', 'provider error']) {
  const result = await runOffline(targetQuery, {
    withoutProvider: failure === 'no provider',
    semanticFailure: failure === 'no provider' ? undefined : failure
  });
  assert.equal(result.semanticCalls, failure === 'no provider' ? 0 : 1, `${failure}: semantic transport stays mocked and bounded`);
  assert.deepEqual(result.nonSemanticRequests, [], `${failure}: no legacy model or source request follows the semantic failure`);
  assert.equal(result.totalFetchDispatches, failure === 'no provider' ? 0 : 1,
    `${failure}: only the expected semantic request is dispatched`);
  assert.ok(result.workstreams, `${failure}: the explicit accounting coverage gap reaches the governed runtime`);
  assert.equal(result.workstreams.issuePlan.source, 'TAXONOMY_FALLBACK');
  assert.equal(result.workstreams.issuePlan.issues.length, 1);
  assert.equal(result.workstreams.issuePlan.issues[0].status, 'UNRESOLVED');
  assert.equal(result.workstreams.issuePlan.issues[0].unresolvedReason, 'NO_COVERAGE_TOPIC');
  assert.deepEqual(result.workstreams.issuePlan.issues[0].mappedTopicIds, []);
  assert.equal(result.workstreams.status, 'INSUFFICIENT');
  assert.ok(result.workstreams.workstreams.every(stream => stream.sources.length === 0));
  assert.ok(result.workstreams.workstreams.every(stream => stream.issues.every(issue => issue.verifiedClaims.length === 0)));
  assert.equal(result.response.scenarioState.scenarioType, 'AUTHORITY_ADVISORY');
  assert.equal(result.response.scenarioState.directGroups?.length || 0, 0, `${failure}: no journal is produced`);
  assert.match(result.response.messageText, /No reviewed topic was resolved/i);
}

const oneSentenceParaphrase = 'Explain the general IFRS 6 rule for exploration and evaluation assets; do not calculate amounts or prepare a journal.';
const paraphrase = await runOffline(oneSentenceParaphrase, { withoutProvider: true });
assert.deepEqual(paraphrase.nonSemanticRequests, [], 'The paraphrase does not trigger a legacy model or source request.');
assert.equal(paraphrase.totalFetchDispatches, 0, 'The no-provider paraphrase makes no network requests.');
assert.equal(paraphrase.workstreams?.issuePlan.issues[0]?.unresolvedReason, 'NO_COVERAGE_TOPIC',
  'A one-sentence rule-only paraphrase follows the same explicit gap path.');

const supportedStandard = await runOffline(
  'Under SFRS(I) 9, what is the initial carrying amount of a bond investment not measured at FVTPL or covered by the trade-receivable exception, if its fair value is SGD 100,000 and directly attributable acquisition transaction costs are SGD 2,000?',
  { withoutProvider: true }
);
assert.match(supportedStandard.response.messageText, /Initial carrying amount: SGD 102,000/,
  'The established SFRS(I) 9 knowledge answer remains available.');
assert.equal(supportedStandard.response.scenarioState.authorityEvidencePresentation, undefined);

const journalRequest = await runOffline(
  'Prepare a journal entry for initial recognition of exploration and evaluation assets under SFRS(I) 6.',
  { withoutProvider: true }
);
assert.equal(journalRequest.response.scenarioState.authorityEvidencePresentation, undefined,
  'A positive journal request does not enter the rule-only gap runtime.');

const shortFollowUp = await runOffline('And explain the IFRS 6 rule; do not calculate amounts or prepare a journal.', { withoutProvider: true });
assert.equal(shortFollowUp.response.scenarioState.authorityEvidencePresentation, undefined,
  'A short semantic follow-up stays on the established follow-up path.');

const imageQuery = await runOffline(targetQuery, {
  withoutProvider: true,
  chatHistory: [{
    id: 'current-image-query', sender: 'user', text: targetQuery, timestamp: new Date('2026-01-02T00:00:00Z'),
    images: [{ id: 'image-1', fileName: 'support.png', mimeType: 'image/png', dataUrl: 'data:image/png;base64,c2FmZQ==', size: 4 }]
  }]
});
assert.equal(imageQuery.response.scenarioState.authorityEvidencePresentation, undefined,
  'Image-bearing questions do not enter the deterministic rule-only gap runtime.');

const mixedIras = await runOffline(
  'Explain SFRS(I) 6 and whether a GST-registered company can claim input tax; do not calculate amounts or prepare a journal.',
  { withoutProvider: true }
);
assert.equal(mixedIras.response.scenarioState.authorityEvidencePresentation, undefined,
  'A mixed accounting and IRAS request is not truncated into the single accounting-gap response.');

console.log('Unmapped accounting rule gap fallback regressions passed.');
