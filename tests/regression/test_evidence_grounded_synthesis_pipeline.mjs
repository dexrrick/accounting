import assert from 'node:assert/strict';
import { processAccountingQuery } from '../../src/services/geminiService.ts';
import { defaultSourceCache } from '../../src/retrieval/sourceCache.ts';
import { STATUTORY_COVERAGE_OFFICIAL_PAGE_FIXTURES } from '../fixtures/statutoryCoverageOfficialPages.mjs';
import { validateSemanticQuestionInterpretation } from '../../src/services/semanticQuestionUnderstanding.ts';

const query = 'Can my client claim GST input tax on an office expense, and what is the accounting treatment?';
const interpretation = {
  schemaVersion: 2, jurisdiction: ['Singapore'], authorityCandidates: ['IRAS'], contextualAuthorities: [],
  domain: 'IRAS_GST', population: 'COMPANY', primarySubject: 'GST input tax recovery conditions',
  concepts: [{ concept: 'GST input tax recovery conditions', role: 'PRIMARY' }, { concept: 'accounting treatment of office expense', role: 'RELATED' }],
  requestedOperation: 'CHECK_ELIGIBILITY', requiresUserSpecificFacts: true,
  factsExplicitlyProvided: ['The expense belongs to a client.'], confidence: 0.98,
  issues: [{ subject: 'GST input tax recovery conditions', population: 'COMPANY', domain: 'IRAS_GST',
    governingAuthorities: ['IRAS'], contextualAuthorities: [], operation: 'CHECK_ELIGIBILITY',
    mappedTopicIds: ['iras-gst-input-tax'], evidenceRequirement: 'AUTHORITATIVE_SOURCE_AND_CASE_FACTS', confidence: 0.98 },
  { subject: 'accounting treatment of office expense', population: 'COMPANY', domain: 'ACCOUNTING',
    governingAuthorities: ['ACCOUNTING_STANDARDS'], contextualAuthorities: [], operation: 'DETERMINE_TREATMENT',
    mappedTopicIds: [], evidenceRequirement: 'AUTHORITATIVE_SOURCE_AND_CASE_FACTS', confidence: 0.98 }]
};
assert.ok(validateSemanticQuestionInterpretation(interpretation, query), 'mocked semantic interpretation satisfies the production contract');

const provider = { activeProvider: 'openai', openai: { apiKey: 'test-key-for-offline-pipeline', model: 'test-model' }, gemini: {}, azure: {} };
const pages = new Map(STATUTORY_COVERAGE_OFFICIAL_PAGE_FIXTURES.map(page => [page.sourceUrl, page.html]));
const originalFetch = globalThis.fetch;
const providerStages = [];
let draftPacket;
let lastClaims = [];
let reviewFailure = false;
const modelReply = value => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(value) } }] }),
  { headers: { 'content-type': 'application/json' } });

globalThis.fetch = async (input, init) => {
  const url = typeof input === 'object' && input?.url ? input.url : String(input);
  if (url.includes('api.openai.com')) {
    const request = JSON.parse(init.body);
    const system = request.messages[0].content;
    const user = request.messages.at(-1).content;
    if (system.startsWith('EVIDENCE_GROUNDED_REVIEW')) {
      providerStages.push('review');
      if (reviewFailure) return modelReply({ invalid: 'This reviewer response has no verdicts.' });
      const review = JSON.parse(user);
      return modelReply({ verdicts: review.claims.map(claim => ({ claimId: claim.id, verdict: 'SUPPORTED',
        supportingEvidenceIds: claim.supportIds, supportingFactRefs: claim.factRefs, reason: 'The conditional statement preserves the supplied rule and unresolved facts.' })) });
    }
    if (system.startsWith('EVIDENCE_GROUNDED_SYNTHESIS')) {
      providerStages.push('synthesis');
      const requestPacket = JSON.parse(user);
      draftPacket = requestPacket.packet || requestPacket;
      const passage = draftPacket.evidencePassages.find(item => item.sourceRecordId.startsWith('LIVE_TOPIC_') && /input tax|GST/i.test(item.completeAdmittedPassage));
      assert.ok(passage, 'the synthesis receives an admitted GST passage from real retrieval');
      lastClaims = [{ id: 'practical-gst', kind: 'APPLICATION',
        text: 'Your client may recover the GST only if the applicable input-tax conditions are met; the office-expense description alone does not establish business use, supporting documentation or the absence of a blocked expense.',
        supportIds: [passage.id], factRefs: ['fact-current-question'], issueId: passage.issueId }];
      const accountingGap = draftPacket.trustedDeterministicOutputs.find(item => item.kind === 'EVIDENCE_GAP' && /accounting/i.test(item.text));
      assert.ok(accountingGap, 'the unresolved accounting issue reaches synthesis alongside the GST evidence');
      lastClaims.push({ id: 'accounting-gap', kind: 'LIMITATION',
        text: 'The accounting treatment is still unresolved: the available evidence does not establish the financial-accounting conclusion for this office expense.',
        supportIds: [accountingGap.id], factRefs: ['fact-current-question'], ...(accountingGap.issueId ? { issueId: accountingGap.issueId } : {}) });
      return modelReply({ claims: lastClaims });
    }
    providerStages.push('existing-pipeline');
    return modelReply(interpretation);
  }
  const page = pages.get(url);
  if (page) return new Response(page, { headers: { 'content-type': 'text/html; charset=utf-8' } });
  if (/sitemap/i.test(url)) {
    return new Response(`<urlset>${[...pages.keys()].filter(value => value.includes('iras.gov.sg')).map(value => `<url><loc>${value}</loc></url>`).join('')}</urlset>`,
      { headers: { 'content-type': 'application/xml' } });
  }
  return new Response('Unavailable in this offline fixture set', { status: 404 });
};

try {
  defaultSourceCache.clear();
  let capturedWorkstreams;
  let capturedContext;
  const result = await processAccountingQuery(query, null, 'SFRS_I', provider, 'unused', [
    { id: 'current-question', sender: 'user', timestamp: '', text: query }
  ], undefined, { onAuthorityWorkstreams: value => { capturedWorkstreams = value; }, onGroundedContext: value => { capturedContext = value; } });
  assert.ok(capturedWorkstreams?.workstreams.some(stream => stream.verifiedClaims.length > 0) || capturedContext?.evidenceQuality?.eligibleRecords.length > 0, 'the existing authority pipeline admits the fixture evidence');
  assert.equal(result.answerPath, 'AI_GROUNDED_SYNTHESIS', 'the production query result enters evidence-grounded synthesis');
  assert.equal(result.displayFullAnswer, true, 'the coherent answer is displayed in full');
  assert.match(result.messageText, /office-expense description alone does not establish/, 'case-specific conditional reasoning reaches the answer');
  assert.match(result.messageText, /accounting treatment is still unresolved/, 'the second requested issue is addressed without erasing the supported GST reasoning');
  assert.ok(result.scenarioState.officialAnswerLinks.some(link => link.url.includes('iras.gov.sg')), 'citations use admitted IRAS URLs');
  assert.deepEqual(result.scenarioState.directGroups, [], 'AI synthesis creates no journal');
  assert.ok(draftPacket.missingFactsAndEvidenceGaps.length > 0, 'unresolved case facts reach synthesis instead of being silently filled');
  assert.equal(providerStages.filter(stage => stage === 'synthesis').length, 1);
  assert.equal(providerStages.filter(stage => stage === 'review').length, 1);

  providerStages.length = 0;
  reviewFailure = true;
  const fallback = await processAccountingQuery(query, null, 'SFRS_I', provider, 'unused', []);
  assert.notEqual(fallback.answerPath, 'AI_GROUNDED_SYNTHESIS', 'malformed semantic review preserves the governed response');
  assert.ok(fallback.messageText.length > 0);
  assert.equal(fallback.advisoryFailureStatus, 'INVALID_RESPONSE', 'the synthesis failure retains a safe, specific cause');
  assert.equal(providerStages.filter(stage => stage === 'synthesis').length, 1, 'a review failure does not start another generation');

  providerStages.length = 0;
  const offline = await processAccountingQuery(query, null, 'SFRS_I', undefined, 'unused', []);
  assert.equal(providerStages.length, 0, 'no-provider queries retain the original offline path');
  assert.notEqual(offline.answerPath, 'AI_GROUNDED_SYNTHESIS');
} finally {
  globalThis.fetch = originalFetch;
  defaultSourceCache.clear();
}
console.log('Evidence-grounded synthesis production pipeline passed: existing semantic retrieval/admission, practical conditional answer, citations, full display and safe fallback.');
