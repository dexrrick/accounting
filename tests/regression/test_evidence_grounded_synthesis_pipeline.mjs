import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SafeChatAnswer } from '../../src/components/SafeChatAnswer.tsx';
import { createGroundedSynthesisFailureResponse, processAccountingQuery } from '../../src/services/geminiService.ts';
import { defaultSourceCache } from '../../src/retrieval/sourceCache.ts';
import { STATUTORY_COVERAGE_OFFICIAL_PAGE_FIXTURES } from '../fixtures/statutoryCoverageOfficialPages.mjs';
import { validateSemanticQuestionInterpretation } from '../../src/services/semanticQuestionUnderstanding.ts';

const query = 'Can my client claim GST input tax on an office expense, and what is the accounting treatment?';
const verifiedLink = { title: 'IRAS guidance', url: 'https://www.iras.gov.sg/taxes/goods-services-tax-(gst)' };
for (const format of [
  `[IRAS guidance](${verifiedLink.url})`,
  `[**IRAS guidance**](<${verifiedLink.url}>)`
]) {
  const markup = renderToStaticMarkup(React.createElement(SafeChatAnswer, { text: format, trustedLinks: [verifiedLink] }));
  assert.match(markup, /<a\b/, `a verified source link remains clickable in ${format}`);
  assert.ok(markup.includes(`href="${verifiedLink.url}"`));
}
const untrustedMarkup = renderToStaticMarkup(React.createElement(SafeChatAnswer, {
  text: '[untrusted](https://attacker.example/source) <img src=x onerror=alert(1)>', trustedLinks: [verifiedLink]
}));
assert.doesNotMatch(untrustedMarkup, /<a\b/, 'a link outside the admitted source allowlist is not clickable');
assert.match(untrustedMarkup, /&lt;img/ , 'untrusted HTML remains escaped text');
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
let generationFailure = false;
let supportFailure = false;
let rejectSupport = false;
let mockFailure;
const modelReply = value => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(value) } }] }),
  { headers: { 'content-type': 'application/json' } });

globalThis.fetch = async (input, init) => {
  const url = typeof input === 'object' && input?.url ? input.url : String(input);
  if (url.includes('api.openai.com')) {
    const request = JSON.parse(init.body);
    const system = request.messages[0].content;
    const user = request.messages.at(-1).content;
    if (system.startsWith('EVIDENCE_GROUNDED_SUPPORT_VERIFICATION')) {
      try {
      providerStages.push('support-check');
      const packet = JSON.parse(user);
      assert.ok(packet.claims.length > 0);
      if (supportFailure) throw new Error('scripted support-verification failure');
      const expectedTypes = { 'practical-gst': 'CONDITIONAL_APPLICATION', 'accounting-gap': 'RULE' };
      for (const claim of packet.claims) {
        assert.ok(Object.hasOwn(expectedTypes, claim.claimId), 'only the scripted supported claims are checked');
        assert.equal(claim.text, lastClaims.find(item => item.id === claim.claimId).text);
      }
      return modelReply({ verdicts: packet.claims.map(claim => ({
        claimId: claim.claimId, support: rejectSupport ? 'UNSUPPORTED' : 'SUPPORTED', claimType: expectedTypes[claim.claimId]
      })) });
      } catch (error) { mockFailure = error; throw error; }
    }
    if (system.startsWith('EVIDENCE_GROUNDED_SYNTHESIS')) {
      try {
      providerStages.push('synthesis');
      if (generationFailure) return new Response('{"claims":[', { headers: { 'content-type': 'application/json' } });
      const requestPacket = JSON.parse(user);
      draftPacket = requestPacket.packet || requestPacket;
      const passage = draftPacket.evidencePassages.find(item => item.sourceRecordId.startsWith('LIVE_TOPIC_') && /input tax|GST/i.test(item.completeAdmittedPassage)) ||
        draftPacket.evidencePassages.find(item => item.domain === 'IRAS_GST' && /input tax|GST/i.test(item.completeAdmittedPassage));
      assert.ok(passage, 'the synthesis receives an admitted GST passage');
      if (draftPacket.query === query) assert.match(passage.sourceRecordId, /^LIVE_TOPIC_/,
        'the original advisory request exercises real fixture retrieval and admission');
      lastClaims = [{ id: 'practical-gst', kind: 'APPLICATION',
        text: 'Your client may recover the GST only if the applicable input-tax conditions are met; the office-expense description alone does not establish business use, supporting documentation or the absence of a blocked expense.',
        supportIds: [passage.id], factRefs: ['fact-current-question'], issueId: passage.issueId }];
      const accountingGap = draftPacket.trustedDeterministicOutputs.find(item => item.kind === 'EVIDENCE_GAP' && /accounting/i.test(item.text));
      assert.ok(accountingGap, 'the unresolved accounting issue reaches synthesis alongside the GST evidence');
      lastClaims.push({ id: 'accounting-gap', kind: 'LIMITATION',
        text: 'The accounting treatment is still unresolved: the available evidence does not establish the financial-accounting conclusion for this office expense.',
        supportIds: [accountingGap.id], factRefs: ['fact-current-question'], ...(accountingGap.issueId ? { issueId: accountingGap.issueId } : {}) });
      return modelReply({ claims: lastClaims });
      } catch (error) { mockFailure = error; throw error; }
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
  assert.ifError(mockFailure);
  assert.ok(capturedWorkstreams?.workstreams.some(stream => stream.verifiedClaims.length > 0) || capturedContext?.evidenceQuality?.eligibleRecords.length > 0, 'the existing authority pipeline admits the fixture evidence');
  assert.equal(result.answerPath, 'AI_GROUNDED_SYNTHESIS', 'the production query result enters evidence-grounded synthesis');
  assert.equal(result.displayFullAnswer, true, 'the coherent answer is displayed in full');
  assert.match(result.messageText, /office-expense description alone does not establish/, 'case-specific conditional reasoning reaches the answer');
  assert.match(result.messageText, /accounting treatment is still unresolved/, 'the second requested issue is addressed without erasing the supported GST reasoning');
  assert.ok(result.scenarioState.officialAnswerLinks.some(link => link.url.includes('iras.gov.sg')), 'citations use admitted IRAS URLs');
  assert.deepEqual(result.scenarioState.directGroups, [], 'AI synthesis creates no journal');
  assert.ok(draftPacket.missingFactsAndEvidenceGaps.length > 0, 'unresolved case facts reach synthesis instead of being silently filled');
  assert.equal(providerStages.filter(stage => stage === 'existing-pipeline').length, 1,
    'the full query receives one semantic-understanding call before retrieval and synthesis');
  assert.equal(providerStages.filter(stage => stage === 'synthesis').length, 1,
    'the full query receives one synthesis-generation call');
  assert.equal(providerStages.filter(stage => stage === 'support-check').length, 1,
    'the full query receives one scoped batch support check and no repair generation');

  const mixedQuery = 'On 03/11/2026, purchased office equipment for SGD 1,250 and paid from the business bank. Can my client claim GST input tax on this office expense, and what is its accounting treatment?';
  const conflictingHistory = [
    { id: 'prior-user', sender: 'user', timestamp: '', text: 'For the previous share issue, the purchase was private and GST input tax was blocked.' },
    { id: 'prior-assistant', sender: 'assistant', timestamp: '', text: 'The old share transaction used a private-use assumption and no equipment journal.' },
    { id: 'current-user', sender: 'user', timestamp: '', text: mixedQuery }
  ];
  const oldShareScenario = {
    scenarioType: 'SHARE_ISSUANCE', rawQuery: 'Issued shares to an investor.', transactionTitle: 'Share issue',
    functionalCurrency: 'SGD', transactionCurrency: 'SGD', directGroups: [], missingFields: [], isComplete: true,
    semanticUnderstanding: { transactionType: 'share_capital_issuance' }
  };
  providerStages.length = 0;
  let mixedWorkstreams;
  let mixedContext;
  const mixedResult = await processAccountingQuery(mixedQuery, oldShareScenario, 'SFRS_I', provider, 'unused', conflictingHistory,
    undefined, { onAuthorityWorkstreams: value => { mixedWorkstreams = value; }, onGroundedContext: value => { mixedContext = value; } });
  assert.ifError(mockFailure);
  assert.equal(mixedResult.answerPath, 'AI_GROUNDED_SYNTHESIS', 'a new mixed accounting/statutory question uses the production synthesis path');
  const historyContext = JSON.stringify(draftPacket.historyContext);
  assert.doesNotMatch(historyContext, /previous share issue|old share transaction|private-use assumption/i,
    'starting a new accounting scenario removes conflicting prior accounting and statutory turns before grounding');
  assert.equal(draftPacket.query, mixedQuery, 'the current user turn remains the production synthesis query');
  assert.equal(draftPacket.historyContext.turns.length, 0,
    'the current query is supplied separately and no earlier turn remains after the scenario boundary');
  assert.notEqual(mixedResult.scenarioState.scenarioType, oldShareScenario.scenarioType,
    'the prior accounting scenario is not carried into the new mixed query result');
  assert.ok(mixedResult.scenarioState.directGroups?.some(group => group.lines?.length),
    'the mixed production case has a nonempty deterministic journal to preserve');

  const unsafeOriginal = 'UNSAFE_ORIGINAL_ADVISORY: the client definitely qualifies for recovery.';
  const contaminatedResponse = {
    ...mixedResult,
    messageText: unsafeOriginal,
    scenarioState: {
      ...mixedResult.scenarioState,
      accountingTreatmentSummary: unsafeOriginal,
      singaporeTaxTreatmentSummary: unsafeOriginal,
      regulatoryMandatesSummary: unsafeOriginal,
      statutoryAdvisory: [{ summary: unsafeOriginal }],
      irasEvidencePresentation: { answerText: unsafeOriginal },
      authorityEvidencePresentation: { query: mixedQuery, summary: unsafeOriginal },
      officialAnswerLinks: [{ title: 'unverified', url: 'https://attacker.example/unverified' }]
    }
  };
  const unresolvedFallback = createGroundedSynthesisFailureResponse(
    contaminatedResponse, mixedQuery, 'SFRS_I', undefined, undefined, 'INVALID_RESPONSE'
  );
  assert.equal(unresolvedFallback.displayFullAnswer, true);
  assert.doesNotMatch(unresolvedFallback.messageText, /UNSAFE_ORIGINAL_ADVISORY/);
  assert.doesNotMatch(JSON.stringify(unresolvedFallback.scenarioState), /UNSAFE_ORIGINAL_ADVISORY/,
    'failure fallback clears unchecked summaries and stale statutory presentation fields');
  assert.deepEqual(unresolvedFallback.scenarioState.directGroups, mixedResult.scenarioState.directGroups,
    'the fallback preserves the validated engine journal byte-for-byte');
  assert.equal(unresolvedFallback.scenarioState.amount, mixedResult.scenarioState.amount,
    'the fallback retains independently calculated accounting facts');
  assert.deepEqual(unresolvedFallback.scenarioState.officialAnswerLinks, [], 'unresolved fallback clears stale and unchecked links');

  const admittedFallback = createGroundedSynthesisFailureResponse(
    contaminatedResponse, mixedQuery, 'SFRS_I', undefined, mixedContext, 'NETWORK'
  );
  assert.doesNotMatch(admittedFallback.messageText, /UNSAFE_ORIGINAL_ADVISORY/);
  assert.match(admittedFallback.messageText, /IRAS|input tax|GST/i,
    'captured admitted IRAS evidence is freshly rendered into the fallback');
  assert.ok(admittedFallback.scenarioState.irasEvidencePresentation,
    'the fallback installs its newly built IRAS presentation for the compliance panel');
  const freshIrasSources = admittedFallback.scenarioState.irasEvidencePresentation.sourceGroups
    .filter(source => source.passages.length > 0);
  assert.ok(freshIrasSources.length > 0 && freshIrasSources.some(source => admittedFallback.messageText.includes(source.title)),
    'the fallback message cites a source from the newly admitted IRAS presentation');
  assert.doesNotMatch(JSON.stringify(admittedFallback.scenarioState), /UNSAFE_ORIGINAL_ADVISORY/);
  assert.ok(admittedFallback.scenarioState.officialAnswerLinks?.some(link => link.url.includes('iras.gov.sg')),
    'fresh fallback citations remain available to the UI');

  providerStages.length = 0;
  generationFailure = true;
  const fallback = await processAccountingQuery(query, null, 'SFRS_I', provider, 'unused', []);
  assert.notEqual(fallback.answerPath, 'AI_GROUNDED_SYNTHESIS', 'malformed generation preserves the governed response');
  assert.ok(fallback.messageText.length > 0);
  assert.equal(fallback.advisoryFailureStatus, 'INVALID_RESPONSE', 'the synthesis failure retains a safe, specific cause');
  assert.equal(providerStages.filter(stage => stage === 'synthesis').length, 1, 'a malformed response does not start a second generation');
  assert.equal(fallback.displayFullAnswer, true, 'synthesis failure presents the deterministic evidence fallback in full');
  assert.doesNotMatch(fallback.messageText, /office-expense description alone does not establish/,
    'unsupported synthesis prose is not returned with the fallback');
  assert.deepEqual(fallback.scenarioState.officialAnswerLinks, [], 'failed synthesis does not retain unverified answer links');

  generationFailure = false;
  for (const failure of ['verification-error', 'all-claims-rejected']) {
    providerStages.length = 0;
    supportFailure = failure === 'verification-error';
    rejectSupport = failure === 'all-claims-rejected';
    const failed = await processAccountingQuery(mixedQuery, oldShareScenario, 'SFRS_I', provider, 'unused', conflictingHistory);
    assert.ok(failed.advisoryFailureStatus, `${failure} is reported as an advisory failure`);
    assert.equal(failed.displayFullAnswer, true, `${failure} exposes the safe fallback in full`);
    assert.doesNotMatch(failed.messageText, /office-expense description alone does not establish/,
      `${failure} does not display rejected statutory prose`);
    assert.deepEqual(failed.scenarioState.directGroups, mixedResult.scenarioState.directGroups,
      `${failure} preserves the existing deterministic journal state`);
    assert.ok(!failed.scenarioState.officialAnswerLinks?.some(link => link.url.includes('attacker.example')),
      `${failure} clears unverified synthesis links`);
  }
  supportFailure = false;
  rejectSupport = false;

  providerStages.length = 0;
  const offline = await processAccountingQuery(query, null, 'SFRS_I', undefined, 'unused', []);
  assert.equal(providerStages.length, 0, 'no-provider queries retain the original offline path');
  assert.notEqual(offline.answerPath, 'AI_GROUNDED_SYNTHESIS');
} finally {
  globalThis.fetch = originalFetch;
  defaultSourceCache.clear();
}
console.log('Evidence-grounded synthesis production pipeline passed: existing semantic retrieval/admission, practical conditional answer, citations, full display and safe fallback.');
