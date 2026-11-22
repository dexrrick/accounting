import assert from 'node:assert/strict';
import React from 'react';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { SafeChatAnswer } from '../../src/components/SafeChatAnswer.tsx';
import { ComplianceRationale } from '../../src/components/ComplianceRationale.tsx';
import { InputHandlerPanel } from '../../src/components/InputHandlerPanel.tsx';
import { JournalTable } from '../../src/components/JournalTable.tsx';
import { createGroundedSynthesisFailureResponse, hasUnverifiedStatutoryClaim, processAccountingQuery } from '../../src/services/geminiService.ts';
import { prepareAuthorityWorkstreamsForPresentation } from '../../src/services/evidenceGroundedSynthesis.ts';
import { postProcessAIResponse } from '../../src/services/groundingContextBuilder.ts';
import { calculateDoubleEntries } from '../../src/engine/accountingEngine.ts';
import { parseAccountingQuery } from '../../src/engine/scenarioParser.ts';
import { getDisplayableUncommittedJournalGroups } from '../../src/services/committedJournal.ts';
import { defaultSourceCache } from '../../src/retrieval/sourceCache.ts';
import { STATUTORY_COVERAGE_OFFICIAL_PAGE_FIXTURES } from '../fixtures/statutoryCoverageOfficialPages.mjs';
import { validateSemanticQuestionInterpretation } from '../../src/services/semanticQuestionUnderstanding.ts';
import { validateJournalGroups } from '../../src/verification/journalIntegrity.ts';

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
let noEvidenceMode = false;
let accountingOnlyMode = false;
let accountingOnlyStatutoryClaimMode = false;
let accountingOnlyStatutoryClaimText = '';
let accountingOnlyMetadataMode = false;
let mockFailure;
let phase2Case;
const phase2OfficialFetches = [];
const modelReply = value => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(value) } }] }),
  { headers: { 'content-type': 'application/json' } });

globalThis.fetch = async (input, init) => {
  const url = typeof input === 'object' && input?.url ? input.url : String(input);
  if (url.includes('api.openai.com')) {
    const request = JSON.parse(init.body);
    const system = request.messages[0].content;
    const user = request.messages.at(-1).content;
    if (phase2Case && system.startsWith('EVIDENCE_GROUNDED_SUPPORT_VERIFICATION')) {
      providerStages.push('support-check');
      const packet = JSON.parse(user);
      try { return modelReply(phase2Case.verify(packet)); }
      catch (error) { mockFailure = error; throw error; }
    }
    if (phase2Case && system.startsWith('EVIDENCE_GROUNDED_SYNTHESIS')) {
      providerStages.push('synthesis');
      const requestPacket = JSON.parse(user);
      draftPacket = requestPacket.packet || requestPacket;
      // The real model can follow compact binding references; fixtures resolve
      // the same metadata without changing any admitted IDs or source text.
      draftPacket = { ...draftPacket, evidencePassages: draftPacket.evidencePassages.map(passage => ({
        ...(draftPacket.evidenceBindings?.find(binding => binding.id === passage.bindingRef) || {}), ...passage
      })) };
      let claims;
      try { claims = phase2Case.generate(draftPacket); }
      catch (error) { mockFailure = error; throw error; }
      lastClaims = claims;
      return modelReply({ claims });
    }
    if (phase2Case && user.includes('Interpret this question:')) {
      providerStages.push('existing-pipeline');
      return modelReply(phase2Case.interpretation);
    }
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
    if (noEvidenceMode && user.includes('Interpret this question:')) {
      return modelReply({
        schemaVersion: 2, jurisdiction: ['Singapore'], authorityCandidates: [], contextualAuthorities: [],
        domain: 'UNKNOWN', population: 'COMPANY', primarySubject: 'fictional Widgets Code filing deadline',
        concepts: [{ concept: 'fictional Widgets Code filing deadline', role: 'PRIMARY' }],
        requestedOperation: 'FILING_REQUIREMENT', requiresUserSpecificFacts: false,
        factsExplicitlyProvided: [], confidence: 0.98,
        issues: [{ subject: 'fictional Widgets Code filing deadline', population: 'COMPANY', domain: 'UNKNOWN',
          governingAuthorities: [], contextualAuthorities: [], operation: 'FILING_REQUIREMENT', mappedTopicIds: [],
          evidenceRequirement: 'AUTHORITATIVE_SOURCE', confidence: 0.98 }]
      });
    }
    if (accountingOnlyMode && user.includes('Interpret this question:')) {
      return modelReply({
        schemaVersion: 2, jurisdiction: ['Singapore'], authorityCandidates: ['ACCOUNTING_STANDARDS'], contextualAuthorities: [],
        domain: 'ACCOUNTING', population: 'COMPANY', primarySubject: 'expense accounting treatment',
        concepts: [{ concept: 'expense accounting treatment', role: 'PRIMARY' }],
        requestedOperation: 'DETERMINE_TREATMENT', requiresUserSpecificFacts: false,
        factsExplicitlyProvided: [], confidence: 0.98,
        issues: [{ subject: 'expense accounting treatment', population: 'COMPANY', domain: 'ACCOUNTING',
          governingAuthorities: ['ACCOUNTING_STANDARDS'], contextualAuthorities: [], operation: 'DETERMINE_TREATMENT',
          mappedTopicIds: [], evidenceRequirement: 'AUTHORITATIVE_SOURCE', confidence: 0.98 }]
      });
    }
    if (accountingOnlyMode) {
      providerStages.push('core-generation');
      if (accountingOnlyMetadataMode) return modelReply({
        directAnswer: 'The expense is recognized when incurred and reduces profit for the period.',
        effectiveDateOrTiming: 'Fictional Widgets Code filing deadline: 30 June 2025.',
        uncertaintyDisclaimer: 'The company must submit the Widgets Code return by 30 June 2025.'
      });
      return modelReply({ directAnswer: accountingOnlyStatutoryClaimMode
        ? `The expense is recognized when incurred. ${accountingOnlyStatutoryClaimText}`
        : 'The expense is recognized when incurred and reduces profit for the period.' });
    }
    if (noEvidenceMode) {
      providerStages.push('core-generation');
      return modelReply({ directAnswer: 'UNSAFE_MODEL_DEADLINE: file by 30 June 2025.' });
    }
    providerStages.push('existing-pipeline');
    return modelReply(interpretation);
  }
  if (phase2Case?.pages?.has(url)) {
    phase2OfficialFetches.push(url);
    const page = phase2Case.pages.get(url);
    return new Response(typeof page === 'function' ? page(phase2OfficialFetches.filter(item => item === url).length) : page,
      { headers: { 'content-type': 'text/html; charset=utf-8' } });
  }
  const page = pages.get(url);
  if (page) return new Response(page, { headers: { 'content-type': 'text/html; charset=utf-8' } });
  if (/sitemap/i.test(url)) {
    const sitemapPages = phase2Case
      ? [...phase2Case.pages.keys()].filter(value => new URL(value).hostname === new URL(url).hostname)
      : [...pages.keys()].filter(value => value.includes('iras.gov.sg'));
    return new Response(`<urlset>${sitemapPages.map(value => `<url><loc>${value}</loc></url>`).join('')}</urlset>`,
      { headers: { 'content-type': 'application/xml' } });
  }
  return new Response('Unavailable in this offline fixture set', { status: 404 });
};

function makePhase2Interpretation({ domain, population, authorities, subject, operation, issues }) {
  return {
    schemaVersion: 2, jurisdiction: ['Singapore'], authorityCandidates: authorities,
    contextualAuthorities: [], domain, population, primarySubject: subject,
    concepts: issues.map((issue, index) => ({ concept: issue.subject, role: index === 0 ? 'PRIMARY' : 'RELATED' })),
    requestedOperation: operation, factsExplicitlyProvided: [], confidence: 0.99,
    issues: issues.map(issue => ({ ...issue, contextualAuthorities: [], mappedTopicIds: issue.mappedTopicIds || [],
      evidenceRequirement: issue.evidenceRequirement || 'AUTHORITATIVE_SOURCE', confidence: 0.99 }))
  };
}

const escapeHtml = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
function officialFixturePage(title, publisher, text, nonce = '') {
  const paragraphs = text.trim().split(/\n\s*\n/).map(value => `<p>${escapeHtml(value).replaceAll('\n', '<br>')}</p>`).join('');
  return `<!doctype html><html lang="en"><head><title>${title} | ${publisher}</title><meta name="site_name" content="${publisher}"><meta name="capture-run" content="${nonce}"></head><body><main><h1>${title}</h1><article>${paragraphs}</article><footer>${publisher}</footer></main></body></html>`;
}

async function runPhase2ApplicationCase(testCase, queryText, history = []) {
  mockFailure = undefined;
  defaultSourceCache.clear();
  providerStages.length = 0;
  phase2OfficialFetches.length = 0;
  phase2Case = testCase;
  let authorityWorkstreams;
  try {
    const result = await processAccountingQuery(queryText, null, 'SFRS_I', provider, 'unused', history, undefined, {
      onAuthorityWorkstreams: value => { authorityWorkstreams = value; }
    });
    if (mockFailure && !testCase.expectSynthesisFailure) throw mockFailure;
    return { result, authorityWorkstreams, stages: [...providerStages], officialFetches: [...phase2OfficialFetches], synthesisFailure: mockFailure };
  } finally {
    phase2Case = undefined;
    defaultSourceCache.clear();
  }
}

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
  const falseAuxiliaryMetadata = {
    effectiveDateOrTiming: 'Fictional Widgets Code filing deadline: 30 June 2025.',
    uncertaintyDisclaimer: 'The company must submit the Widgets Code return by 30 June 2025.'
  };
  const metadataCurrentScenario = { ...mixedResult.scenarioState, ...falseAuxiliaryMetadata };
  for (const [kind, parsed] of [
    ['compact', { directAnswer: 'The equipment expense is recognized when incurred.', ...falseAuxiliaryMetadata }],
    ['legacy', { messageText: 'The equipment expense is recognized when incurred.', ...falseAuxiliaryMetadata }]
  ]) {
    const safePostProcessed = postProcessAIResponse(parsed, metadataCurrentScenario, mixedQuery,
      { ...mixedContext, evidenceQuality: undefined }, null, 'SFRS_I');
    const postProcessedCompliance = renderToStaticMarkup(React.createElement(ComplianceRationale, {
      citations: [], standard: 'SFRS_I', rawQuery: mixedQuery,
      primaryDomain: safePostProcessed.scenarioState.primaryDomain,
      queryIntent: safePostProcessed.scenarioState.queryIntent,
      assumptions: safePostProcessed.scenarioState.assumptions,
      effectiveDateOrTiming: safePostProcessed.scenarioState.effectiveDateOrTiming,
      uncertaintyDisclaimer: safePostProcessed.scenarioState.uncertaintyDisclaimer
    }));
    assert.doesNotMatch(JSON.stringify(safePostProcessed.scenarioState), /Widgets Code|30 June 2025/,
      `${kind} post-processing removes model timing and disclaimer fields before scenario assembly`);
    assert.doesNotMatch(postProcessedCompliance, /Widgets Code|30 June 2025/,
      `${kind} rendered compliance panel excludes metadata-only false statutory claims`);
  }
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
  const sourceJournal = mixedResult.scenarioState.directGroups.find(group => group.lines?.length > 0);
  assert.ok(sourceJournal, 'the mixed production case has a journal to preserve');
  const verifiedSourceCitation = sourceJournal.citations?.find(citation =>
    citation.standard && citation.paragraph && citation.officialSourceUrl
  );
  assert.ok(verifiedSourceCitation, 'the source journal carries a registry-supported citation for the counterfactual contamination');
  const falseModelCitation = {
    ...verifiedSourceCitation,
    title: 'Fictional filing rule',
    text: 'The company must file by 30 June 2025.'
  };
  const deterministicJournal = { ...sourceJournal, id: 'validated-deterministic-journal', authorityStatus: 'DETERMINISTIC' };
  const modelProposedGroup = {
    ...sourceJournal, id: 'model-proposed-with-false-citation', authorityStatus: 'AI_PROPOSED',
    title: 'Fictional filing deadline: 30 June 2025', summary: 'File by 30 June 2025.',
    eventDate: 'The company must file under fictional Widgets Code',
    taxSummary: 'The company must file under the fictional Widgets Code.',
    rationalePoints: ['Fictional Widgets Code filing rule: 30 June 2025.'],
    lines: sourceJournal.lines.map(line => ({ ...line, accountName: 'Fictional filing deadline liability',
      foreignCurrency: '30 June 2025', foreignDebit: 'The filing deadline is 30 June 2025',
      foreignCredit: 'Widgets Code', exchangeRate: '30 June 2025',
      lineExplanation: 'This line is required before the 30 June 2025 filing deadline.' })),
    citations: [falseModelCitation]
  };
  const validFxProposal = {
    ...modelProposedGroup, id: 'valid-fx-proposal-control', eventDate: '2026-11-05',
    lines: modelProposedGroup.lines.map(line => ({ ...line, foreignCurrency: 'USD', foreignDebit: 100,
      foreignCredit: 0, exchangeRate: 1.25 }))
  };
  const deterministicClarification = { fieldKey: 'transactionAmount', fieldName: 'Transaction amount',
    prompt: 'What was the transaction amount?', whyNeeded: 'The amount is needed to calculate the journal.' };
  const trustedEngineScenario = {
    scenarioType: 'EXPENSE', rawQuery: mixedQuery, transactionTitle: 'Engine transaction', functionalCurrency: 'SGD',
    transactionCurrency: 'SGD', amount: 850, isComplete: false, missingFields: [deterministicClarification],
    missingFacts: ['The transaction amount has not been provided.'], directGroups: [deterministicJournal],
    committedDirectGroups: [deterministicJournal], projectedGroups: []
  };
  const deterministicLabelGroups = [
    {
      id: 'trusted-share-capital-label', title: 'Share Capital Issuance', eventDate: '05/11/2026',
      summary: 'Recognize share consideration received.', totalDebit: 100, totalCredit: 100, isBalanced: true,
      authorityStatus: 'DETERMINISTIC', citations: [], rationalePoints: [],
      lines: [
        { id: 'share-cash', accountCode: '1010', accountName: 'Cash at Bank (Current Account)', category: 'ASSET', debit: 100, credit: 0, lineExplanation: 'Cash received.' },
        { id: 'share-capital', accountCode: '3000', accountName: 'Share Capital (Ordinary Shares)', category: 'EQUITY', debit: 0, credit: 100, lineExplanation: 'Ordinary share capital issued.' }
      ]
    },
    {
      id: 'trusted-gst-receivable-label', title: 'Office Equipment Purchase', eventDate: '05/11/2026',
      summary: 'Recognize equipment and the related input tax amount.', totalDebit: 100, totalCredit: 100, isBalanced: true,
      authorityStatus: 'DETERMINISTIC', citations: [], rationalePoints: [],
      lines: [
        { id: 'equipment-cost', accountCode: '1500', accountName: 'Property, Plant and Equipment — Equipment', category: 'ASSET', debit: 91.74, credit: 0, lineExplanation: 'Recognize equipment cost.' },
        { id: 'gst-receivable', accountCode: '1501', accountName: 'GST Input Tax Receivable', category: 'ASSET', debit: 8.26, credit: 0, lineExplanation: 'Recognize the stated input tax amount.' },
        { id: 'equipment-bank', accountCode: '1010', accountName: 'Cash at Bank', category: 'ASSET', debit: 0, credit: 100, lineExplanation: 'Cash paid to supplier.' }
      ]
    }
  ];
  const labelMarkup = renderToStaticMarkup(React.createElement(JournalTable, {
    groups: deterministicLabelGroups, standard: 'SFRS_I', functionalCurrency: 'SGD'
  }));
  for (const group of deterministicLabelGroups) {
    assert.ok(validateJournalGroups([group]).isValid, `${group.id} is a valid balanced journal fixture`);
    const scenarioState = {
      scenarioType: 'EXPENSE', rawQuery: 'Explain the accounting journal.', transactionTitle: group.title,
      functionalCurrency: 'SGD', transactionCurrency: 'SGD', directGroups: [group], isComplete: true, missingFields: []
    };
    const ordinaryResponse = { messageText: 'The transaction is recorded using the balanced accounting journal.', scenarioState };
    assert.equal(hasUnverifiedStatutoryClaim(ordinaryResponse, scenarioState), false,
      `${group.id} excludes only its independently validated deterministic labels from claim scanning`);
  }
  const auxiliaryClaimResponse = {
    messageText: 'The transaction is recorded using the balanced accounting journal.',
    scenarioState: { scenarioType: 'EXPENSE', rawQuery: 'Explain the accounting journal.', transactionTitle: 'Office Equipment Purchase',
      functionalCurrency: 'SGD', transactionCurrency: 'SGD', directGroups: [deterministicLabelGroups[1]], isComplete: true, missingFields: [],
      effectiveDateOrTiming: 'Fictional filing deadline: 30 June 2025.',
      uncertaintyDisclaimer: 'The company must submit its return by 30 June 2025.' }
  };
  assert.equal(hasUnverifiedStatutoryClaim(auxiliaryClaimResponse, auxiliaryClaimResponse.scenarioState), true,
    'the detector checks auxiliary compliance narratives on paths that bypass post-processing');
  assert.match(labelMarkup, /Share Capital \(Ordinary Shares\)/,
    'the rendered journal retains the deterministic ordinary-share account label');
  assert.match(labelMarkup, /GST Input Tax Receivable/,
    'the rendered journal retains the deterministic GST receivable account label');
  const gstLabelResponse = {
    messageText: 'The transaction is recorded using the balanced accounting journal.',
    scenarioState: { scenarioType: 'EXPENSE', rawQuery: 'Explain the accounting journal.', transactionTitle: 'Office Equipment Purchase',
      functionalCurrency: 'SGD', transactionCurrency: 'SGD', directGroups: [deterministicLabelGroups[1]], isComplete: true, missingFields: [] }
  };
  assert.equal(hasUnverifiedStatutoryClaim(gstLabelResponse), true,
    'a provider-set deterministic status cannot exempt an unowned GST label without a trusted engine snapshot');
  const invalidTrustedGroup = { ...deterministicLabelGroups[1], totalCredit: 99 };
  assert.equal(validateJournalGroups([invalidTrustedGroup]).isValid, false,
    'the invalid-label control fails independent journal validation');
  assert.equal(hasUnverifiedStatutoryClaim({
    ...gstLabelResponse,
    scenarioState: { ...gstLabelResponse.scenarioState, directGroups: [invalidTrustedGroup] }
  }, { ...gstLabelResponse.scenarioState, directGroups: [invalidTrustedGroup] }), true,
  'an invalid snapshot group cannot authorize its visible legal-domain label');
  assert.equal(hasUnverifiedStatutoryClaim({
    ...gstLabelResponse, messageText: 'The company must file by 30 June 2025.'
  }, gstLabelResponse.scenarioState), true,
  'a supported account label cannot suppress an appended unsupported statutory claim');
  const contaminatedResponse = {
    ...mixedResult,
    messageText: unsafeOriginal,
    scenarioState: {
      ...mixedResult.scenarioState,
      transactionTitle: 'Fictional filing deadline: 30 June 2025',
      keyParameters: [{ label: 'Filing deadline', value: '30 June 2025', badge: 'Statutory' }],
      directGroups: [modelProposedGroup, validFxProposal, deterministicJournal, ...(mixedResult.scenarioState.directGroups || [])],
      committedDirectGroups: [modelProposedGroup, validFxProposal, deterministicJournal, ...(mixedResult.scenarioState.committedDirectGroups || [])],
      projectedGroups: [modelProposedGroup, validFxProposal, deterministicJournal, ...(mixedResult.scenarioState.projectedGroups || [])],
      accountingTreatmentSummary: unsafeOriginal,
      singaporeTaxTreatmentSummary: unsafeOriginal,
      regulatoryMandatesSummary: unsafeOriginal,
      assumptions: [{ id: 'false-deadline', field: 'filing deadline', assumedValue: '30 June',
        basisOrRationale: 'False statutory deadline: 30 June 2025', materiality: 'HIGH' }],
      effectiveDateOrTiming: 'Statutory filing deadline: 30 June 2025',
      uncertaintyDisclaimer: 'The company must submit under fictional Widgets Code by 30 June 2025.',
      missingFacts: ['The filing deadline is 30 June 2025.'],
      missingFields: [{ fieldKey: 'deadline', fieldName: 'deadline', prompt: 'Confirm the 30 June 2025 filing deadline.',
        whyNeeded: 'Confirm the statutory deadline.' }],
      statutoryAdvisory: [{ summary: unsafeOriginal }],
      irasEvidencePresentation: { answerText: unsafeOriginal },
      authorityEvidencePresentation: { query: mixedQuery, summary: unsafeOriginal },
      officialAnswerLinks: [{ title: 'unverified', url: 'https://attacker.example/unverified' }]
    },
    clarifications: [{ fieldKey: 'deadline', fieldName: 'deadline', prompt: 'Confirm the 30 June 2025 filing deadline.',
      whyNeeded: 'Confirm the statutory deadline.' }]
  };
  const contaminatedComputedGroups = calculateDoubleEntries(contaminatedResponse.scenarioState, 'SFRS_I').groups;
  const contaminatedAppSelectedCitations = [
    ...contaminatedComputedGroups.flatMap(group => group.citations),
    ...(contaminatedResponse.scenarioState.directGroups?.[0]?.citations || [])
  ];
  const contaminatedCompliance = renderToStaticMarkup(React.createElement(ComplianceRationale, {
    citations: contaminatedAppSelectedCitations, standard: 'SFRS_I', rawQuery: mixedQuery,
    primaryDomain: contaminatedResponse.scenarioState.primaryDomain,
    queryIntent: contaminatedResponse.scenarioState.queryIntent,
    assumptions: contaminatedResponse.scenarioState.assumptions,
    effectiveDateOrTiming: contaminatedResponse.scenarioState.effectiveDateOrTiming,
    uncertaintyDisclaimer: contaminatedResponse.scenarioState.uncertaintyDisclaimer
  }));
  assert.match(contaminatedCompliance, /Fictional filing rule/,
    'the structurally valid model citation is visible before fallback');
  assert.match(contaminatedCompliance, /The company must file by 30 June 2025\./,
    'the registry-supported citation exposes the false deadline in pre-fallback App-equivalent compliance markup');
  const unresolvedFallback = createGroundedSynthesisFailureResponse(
    contaminatedResponse, mixedQuery, 'SFRS_I', undefined, undefined, 'INVALID_RESPONSE', trustedEngineScenario
  );
  const equipmentQuery = 'My company incurred SGD 80,000 on a piece of equipment. How should we account for it?';
  const equipment = await parseAccountingQuery(equipmentQuery, null);
  const equipmentFallback = createGroundedSynthesisFailureResponse(
    contaminatedResponse, equipmentQuery, 'SFRS_I', undefined, undefined, 'OTHER', equipment
  );
  const [equipmentGroup, ...extraEquipmentGroups] = getDisplayableUncommittedJournalGroups(equipmentFallback.scenarioState, 'SFRS_I');
  assert.equal(extraEquipmentGroups.length, 0);
  assert.equal(equipmentGroup.authorityStatus, 'CONDITIONAL');
  assert.deepEqual(equipmentGroup.lines.map(line => [line.category, line.debit, line.credit]),
    [['ASSET', 80000, 0], ['LIABILITY', 0, 80000]]);
  assert.match(equipmentGroup.lines[0].accountName, /Equipment/);
  assert.equal(equipmentGroup.lines[1].accountName, 'Trade Payables');
  assert.deepEqual(equipmentGroup.citations, []);
  assert.match(equipmentFallback.messageText, /paid immediately, or is it still payable/);
  assert.doesNotMatch(equipmentFallback.messageText, /Statutory evidence unresolved/);
  assert.equal(equipmentFallback.scenarioState.committedDirectGroups, undefined);
  const unpaidEquipmentQuery = 'My company incurred SGD 80,000 on a piece of equipment and has not yet paid the supplier. How should we account for it?';
  const unpaidEquipment = await parseAccountingQuery(unpaidEquipmentQuery, null);
  const unpaidFallback = createGroundedSynthesisFailureResponse(
    contaminatedResponse, unpaidEquipmentQuery, 'SFRS_I', undefined, undefined, 'OTHER', unpaidEquipment
  );
  const [unpaidGroup] = getDisplayableUncommittedJournalGroups(unpaidFallback.scenarioState, 'SFRS_I');
  assert.equal(unpaidGroup.lines.find(line => line.credit === 80000)?.accountName, 'Trade Payables');
  assert.deepEqual(unpaidFallback.scenarioState.assumptions, []);
  assert.equal(unresolvedFallback.displayFullAnswer, true);
  assert.doesNotMatch(unresolvedFallback.messageText, /UNSAFE_ORIGINAL_ADVISORY/);
  assert.doesNotMatch(JSON.stringify(unresolvedFallback.scenarioState), /UNSAFE_ORIGINAL_ADVISORY/,
    'failure fallback clears unchecked summaries and stale statutory presentation fields');
  assert.deepEqual(unresolvedFallback.scenarioState.assumptions, [], 'unverified model assumptions are removed');
  assert.equal(unresolvedFallback.scenarioState.effectiveDateOrTiming, undefined, 'unverified timing metadata is removed');
  assert.equal(unresolvedFallback.scenarioState.uncertaintyDisclaimer, 'The original advisory response was not retained because its claims did not pass verification.',
    'a model disclaimer is replaced with the deterministic synthesis-failure notice');
  assert.deepEqual(unresolvedFallback.scenarioState.missingFields, [deterministicClarification],
    'deterministic accounting missing fields survive statutory synthesis failure');
  assert.deepEqual(unresolvedFallback.scenarioState.missingFacts, ['The transaction amount has not been provided.'],
    'deterministic accounting missing facts survive statutory synthesis failure');
  assert.deepEqual(unresolvedFallback.clarifications, [deterministicClarification],
    'only the canonical engine clarification survives');
  assert.equal(unresolvedFallback.scenarioState.isComplete, false, 'the incomplete engine state remains incomplete');
  assert.equal(unresolvedFallback.scenarioState.transactionTitle, 'Transaction facts',
    'the provider-generated transaction title is replaced with a neutral label');
  assert.equal(unresolvedFallback.scenarioState.keyParameters, undefined,
    'provider-generated labels and values are removed from the scenario state');
  assert.equal(unresolvedFallback.scenarioState.amount, 850, 'the engine-owned amount remains available');
  assert.doesNotMatch(unresolvedFallback.messageText, /30 June 2025/,
    'a false statutory deadline does not survive in fallback chat text');
  const safeModelProposedGroup = unresolvedFallback.scenarioState.directGroups.find(group => group.id === modelProposedGroup.id);
  assert.equal(safeModelProposedGroup.authorityStatus, 'AI_PROPOSED');
  assert.equal(safeModelProposedGroup.title, 'Unverified AI-proposed journal');
  assert.equal(safeModelProposedGroup.summary, '', 'unverified group summaries are removed');
  assert.equal(safeModelProposedGroup.taxSummary, undefined, 'unverified tax summaries are removed');
  assert.deepEqual(safeModelProposedGroup.rationalePoints, [], 'unverified rationale is removed');
  assert.equal(safeModelProposedGroup.lines[0].lineExplanation, '', 'unverified line explanations are removed');
  assert.equal(safeModelProposedGroup.lines[0].accountName, 'Unverified proposed account',
    'an unverified account label is not presented as validated');
  assert.equal(safeModelProposedGroup.eventDate, '', 'non-date model metadata is cleared before the journal renderer');
  assert.equal(safeModelProposedGroup.lines[0].foreignCurrency, undefined, 'non-currency model metadata is cleared');
  assert.equal(safeModelProposedGroup.lines[0].foreignDebit, undefined, 'non-numeric FX amounts are cleared');
  assert.equal(safeModelProposedGroup.lines[0].exchangeRate, undefined, 'non-numeric exchange rates are cleared');
  assert.equal(safeModelProposedGroup.lines[0].debit, modelProposedGroup.lines[0].debit,
    'quarantine preserves proposed journal amounts');
  const validFxControl = unresolvedFallback.scenarioState.directGroups.find(group => group.id === validFxProposal.id);
  assert.equal(validFxControl.eventDate, '05/11/2026', 'a valid proposal date remains visible');
  assert.equal(validFxControl.lines[0].foreignCurrency, 'USD', 'a valid ISO currency remains visible');
  assert.equal(validFxControl.lines[0].foreignDebit, 100, 'a numeric FX amount remains visible');
  assert.equal(validFxControl.lines[0].exchangeRate, 1.25, 'a numeric exchange rate remains visible');
  assert.deepEqual(unresolvedFallback.scenarioState.directGroups[0], deterministicJournal,
    'the deterministic journal remains byte-for-byte intact');
  for (const key of ['directGroups', 'committedDirectGroups', 'projectedGroups']) {
    assert.ok(unresolvedFallback.scenarioState[key]?.filter(group => group.authorityStatus !== 'DETERMINISTIC')
      .every(group => group.citations.length === 0), `${key} removes citations attached to non-deterministic groups`);
  }
  const appComputedGroups = calculateDoubleEntries(unresolvedFallback.scenarioState, 'SFRS_I').groups;
  const appSelectedCitations = [
    ...appComputedGroups.flatMap(group => group.citations),
    ...(unresolvedFallback.scenarioState.directGroups?.[0]?.citations || [])
  ];
  const fallbackCompliance = renderToStaticMarkup(React.createElement(ComplianceRationale, {
    citations: appSelectedCitations, standard: 'SFRS_I', rawQuery: mixedQuery,
    primaryDomain: unresolvedFallback.scenarioState.primaryDomain,
    queryIntent: unresolvedFallback.scenarioState.queryIntent,
    assumptions: unresolvedFallback.scenarioState.assumptions,
    effectiveDateOrTiming: unresolvedFallback.scenarioState.effectiveDateOrTiming,
    uncertaintyDisclaimer: unresolvedFallback.scenarioState.uncertaintyDisclaimer
  }));
  assert.doesNotMatch(fallbackCompliance, /30 June 2025/,
    'a false statutory deadline does not survive in compliance presentation markup');
  assert.doesNotMatch(fallbackCompliance, /Widgets Code|Fictional filing rule|attacker\.example/,
    'App-equivalent citation selection does not expose the model-proposed legal citation');
  assert.equal(unresolvedFallback.scenarioState.directGroups[0].id, deterministicJournal.id,
    'only a group in the independent engine snapshot retains deterministic status');
  assert.equal(unresolvedFallback.scenarioState.amount, 850,
    'the fallback retains independently calculated accounting facts');
  assert.deepEqual(unresolvedFallback.scenarioState.officialAnswerLinks, [], 'unresolved fallback clears stale and unchecked links');

  const scenarioPanel = renderToStaticMarkup(React.createElement(InputHandlerPanel, {
    scenario: unresolvedFallback.scenarioState, onResetToDefaults: () => undefined, defaultExpanded: true
  }));
  assert.match(scenarioPanel, /Transaction facts/, 'the scenario panel renders a neutral transaction title');
  assert.match(scenarioPanel, /1 detail needed/, 'the scenario panel keeps the accounting clarification visible');
  assert.match(scenarioPanel, /Transaction Amount/);
  assert.match(scenarioPanel, /SGD 850/, 'the rendered scenario panel keeps the engine-owned amount');
  assert.doesNotMatch(scenarioPanel, /Fictional filing deadline|30 June 2025|Filing deadline/,
    'unverified statutory prose is absent from the rendered scenario panel');
  const journalPanel = renderToStaticMarkup(React.createElement(JournalTable, {
    groups: unresolvedFallback.scenarioState.directGroups, standard: 'SFRS_I', functionalCurrency: 'SGD'
  }));
  assert.match(journalPanel, /Unverified AI-proposed journal/, 'the journal panel shows a generic proposal title');
  assert.match(journalPanel, /AI Proposed/, 'the journal panel retains the proposal status warning');
  assert.doesNotMatch(journalPanel, /UNSAFE_ORIGINAL_ADVISORY|30 June 2025|Fictional Widgets Code|Fictional filing rule/,
    'unverified legal prose is absent from the rendered journal panel');
  assert.match(journalPanel, /FX: USD 100 @ 1\.25/, 'valid FX data remains visible in the rendered journal panel');

  const governedMissingFact = 'The purchase business purpose remains unconfirmed.';
  const admittedFallbackContext = {
    ...mixedContext,
    missingFacts: [governedMissingFact],
    evidenceQuality: { ...mixedContext.evidenceQuality, missingFacts: [governedMissingFact] }
  };
  const admittedFallback = createGroundedSynthesisFailureResponse(
    contaminatedResponse, mixedQuery, 'SFRS_I', undefined, admittedFallbackContext, 'NETWORK', trustedEngineScenario
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
  assert.ok(admittedFallback.scenarioState.missingFacts?.includes(governedMissingFact),
    'missing facts in a rendered fallback are rebuilt from the current governed IRAS response');
  assert.ok(!admittedFallback.scenarioState.missingFacts?.some(fact => /30 June 2025/.test(fact)),
    'model-generated missing facts do not re-enter the governed fallback metadata');

  const mixedIrasIssue = mixedWorkstreams?.issuePlan.issues.find(issue => issue.governingAuthorities.includes('IRAS'));
  assert.ok(mixedIrasIssue, 'the mixed production query has a planned IRAS issue for evidence ownership');
  const additionalIrasContext = {
    ...mixedContext,
    authorityIssue: { authority: 'IRAS', issue: mixedIrasIssue, requestedConcepts: [] }
  };
  const combinedFallback = createGroundedSynthesisFailureResponse(
    contaminatedResponse, mixedQuery, 'SFRS_I', mixedWorkstreams, additionalIrasContext, 'NETWORK', trustedEngineScenario
  );
  assert.ok(combinedFallback.scenarioState.authorityEvidencePresentation,
    'the fallback retains the original whole-question workstream gaps');
  assert.ok(combinedFallback.scenarioState.irasEvidencePresentation?.sourceGroups.some(group => group.passages.length > 0),
    'new IRAS retrieval is selected for its matching planned issue despite the same-query workstream result');
  assert.match(combinedFallback.messageText, /Additional admitted IRAS evidence/);
  assert.doesNotMatch(combinedFallback.messageText, /UNSAFE_ORIGINAL_ADVISORY/);
  const combinedCompliance = renderToStaticMarkup(React.createElement(ComplianceRationale, {
    citations: [], standard: 'SFRS_I', rawQuery: mixedQuery,
    primaryDomain: combinedFallback.scenarioState.primaryDomain,
    queryIntent: combinedFallback.scenarioState.queryIntent,
    assumptions: combinedFallback.scenarioState.assumptions,
    effectiveDateOrTiming: combinedFallback.scenarioState.effectiveDateOrTiming,
    uncertaintyDisclaimer: combinedFallback.scenarioState.uncertaintyDisclaimer,
    authorityEvidencePresentation: combinedFallback.scenarioState.authorityEvidencePresentation,
    irasEvidencePresentation: combinedFallback.scenarioState.irasEvidencePresentation
  }));
  assert.match(combinedCompliance, /Statutory Compliance &amp; Legal Authority/,
    'the compliance panel retains the whole-question workstream presentation');
  assert.match(combinedCompliance, /Supporting Official Guidance/,
    'the compliance panel also presents newly admitted IRAS evidence');

  const staleQueryFallback = createGroundedSynthesisFailureResponse(
    contaminatedResponse, mixedQuery, 'SFRS_I', { ...mixedWorkstreams, query: 'A different user query' },
    additionalIrasContext, 'NETWORK', trustedEngineScenario
  );
  assert.equal(staleQueryFallback.scenarioState.authorityEvidencePresentation, undefined,
    'a workstream presentation from another query is not shown');
  assert.equal(staleQueryFallback.scenarioState.irasEvidencePresentation, undefined,
    'IRAS evidence is not reused against a stale workstream query');
  assert.match(staleQueryFallback.messageText, /Statutory evidence unresolved/);

  const wrongOwnerContext = {
    ...additionalIrasContext,
    authorityIssue: { ...additionalIrasContext.authorityIssue,
      issue: { ...mixedIrasIssue, id: 'a-different-requested-issue' } }
  };
  const wrongOwnerFallback = createGroundedSynthesisFailureResponse(
    contaminatedResponse, mixedQuery, 'SFRS_I', mixedWorkstreams, wrongOwnerContext, 'NETWORK', trustedEngineScenario
  );
  assert.ok(wrongOwnerFallback.scenarioState.authorityEvidencePresentation,
    'the current whole-question workstream evidence remains available');
  assert.equal(wrongOwnerFallback.scenarioState.irasEvidencePresentation, undefined,
    'additional IRAS evidence cannot cross to an unowned issue');
  assert.doesNotMatch(wrongOwnerFallback.messageText, /Additional admitted IRAS evidence/);

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
  assert.ok(!fallback.scenarioState.officialAnswerLinks?.some(link => link.url.includes('attacker.example')),
    'failed synthesis replaces unverified links with only freshly admitted evidence links');

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
    assert.deepEqual(failed.scenarioState.directGroups.map(group => ({ id: group.id, totalDebit: group.totalDebit,
      totalCredit: group.totalCredit, lines: group.lines.map(line => ({ id: line.id, debit: line.debit, credit: line.credit })) })),
    mixedResult.scenarioState.directGroups.map(group => ({ id: group.id, totalDebit: group.totalDebit,
      totalCredit: group.totalCredit, lines: group.lines.map(line => ({ id: line.id, debit: line.debit, credit: line.credit })) })),
    `${failure} preserves the engine-validated journal numbers`);
    assert.ok(failed.scenarioState.directGroups.filter(group => group.authorityStatus !== 'DETERMINISTIC')
      .every(group => group.citations.length === 0 && group.summary === '' && group.rationalePoints.length === 0 &&
        group.lines.every(line => line.lineExplanation === '')),
      `${failure} removes narrative and citations from non-deterministic journal groups`);
    assert.ok(!failed.scenarioState.officialAnswerLinks?.some(link => link.url.includes('attacker.example')),
      `${failure} clears unverified synthesis links`);
  }
  supportFailure = false;
  rejectSupport = false;

  noEvidenceMode = true;
  providerStages.length = 0;
  const noEvidenceQuery = 'What is the filing deadline under Singapore Widgets Code section 900?';
  const noEvidenceResult = await processAccountingQuery(noEvidenceQuery, null, 'SFRS_I', provider, 'unused', []);
  assert.equal(noEvidenceResult.answerPath, 'AI_GROUNDED_SYNTHESIS_FALLBACK',
    'a provider-generated statutory answer with no admitted passages is replaced through the production fallback path');
  assert.match(noEvidenceResult.messageText, /Statutory evidence unresolved/);
  assert.doesNotMatch(noEvidenceResult.messageText, /UNSAFE_MODEL_DEADLINE|30 June 2025/);
  assert.equal(providerStages.filter(stage => stage === 'synthesis').length, 0,
    'no synthesis or extra AI repair call is made without admitted source passages');
  assert.ok(providerStages.filter(stage => stage === 'core-generation').length >= 1,
    'the no-evidence regression exercises a provider-generated core statutory answer');

  noEvidenceMode = false;
  accountingOnlyMode = true;
  const accountingOnlyQuery = 'Prepare a journal entry for an unspecified widget expense.';
  accountingOnlyMode = true;
  let accountingOnlyClassification;
  for (const claimText of [
    'The company can claim GST input tax on it.',
    'GST recovery is permitted on this expense.',
    'The company must notify ACRA of the director appointment.',
    'The company must file by 30 June 2025.',
    'The company is eligible to recover input tax on this purchase.',
    'The company is eligible for the scheme.',
    'The company qualifies for the scheme.',
    'The company must submit its annual return.',
    'A return is required.',
    'The company must complete the return.',
    'The business must renew its operating licence every year.',
    'The business needs to renew its operating licence.',
    'The company has to obtain an operating licence.',
    'An operating licence is required.',
    'An operating licence is optional for this company.',
    'The business may operate without an operating licence.',
    'The company is exempt from obtaining an operating licence.',
    'Regulatory approval is required before commencing operations.',
    'The business does not need an operating licence.',
    'The business must renew its operating licences every year.',
    'Licence renewal is required.',
    'No licence renewal is necessary.',
    'The business does not need to renew its licence.',
    'The business must obtain regulatory approval from MAS.',
    'No ACRA approval is required.',
    'The company must appoint a company secretary.',
    'The company must appoint directors.',
    'The company must appoint auditors.',
    'The business can operate without a permit.',
    'The company may operate without regulatory registration.',
    'An auditor must be appointed.',
    'An auditor is not required to be appointed.',
    'An auditor must not be appointed.',
    'No statutory auditor appointment is necessary.',
    'The company must register with ACRA.',
    'The company must register for GST.',
    'A company must register its business.',
    'The business must register with the regulator.',
    'The company must register with the relevant government agency.',
    'Appointment of an auditor is required.',
    'Appointment of a director is required.',
    'The company is not required to appoint an auditor.',
    'The bookkeeper must register the asset in the fixed asset register, and the business must register with the regulator.',
    'The company must register with ACRA and note it in the general ledger.',
    'The company must return the leased equipment to the supplier, and must register with ACRA.',
    'The company must register with ACRA and note the asset at cost in the fixed asset register.',
    'The bookkeeper must register the asset on acquisition in the general ledger, and the company must register with ACRA.',
    'The business must register its premises with the regulator, then note the asset in the general ledger.',
    'A software licence is required to run the application, and an operating licence is required to trade.',
    'The company must declare taxable income.',
    'The company must comply with the law.'
  ]) {
    providerStages.length = 0;
    accountingOnlyStatutoryClaimMode = true;
    accountingOnlyStatutoryClaimText = claimText;
    const accountingOnlyResult = await processAccountingQuery(accountingOnlyQuery, null, 'SFRS_I', provider, 'unused', [], undefined, {
      onGroundedContext: value => { accountingOnlyClassification = value.classification; }
    });
    assert.equal(accountingOnlyResult.answerPath, 'AI_GROUNDED_SYNTHESIS_FALLBACK',
      `an unsolicited statutory claim is quarantined for an accounting-only request: ${claimText}`);
    assert.match(accountingOnlyResult.messageText, /Statutory evidence unresolved/);
    assert.ok(!accountingOnlyResult.messageText.includes(claimText), 'unsupported statutory prose is removed');
    assert.ok(providerStages.includes('core-generation'), 'the accounting-only request reaches the provider');
    assert.equal(accountingOnlyClassification?.primaryDomain, 'ACCOUNTING');
    assert.equal(accountingOnlyClassification?.intent, 'TRANSACTION');
  }
  accountingOnlyStatutoryClaimMode = false;
  accountingOnlyStatutoryClaimText = '';
  const ordinaryAccountingResult = await processAccountingQuery(accountingOnlyQuery, null, 'SFRS_I', provider, 'unused', [], undefined, {
    onGroundedContext: value => { accountingOnlyClassification = value.classification; }
  });
  assert.notEqual(ordinaryAccountingResult.answerPath, 'AI_GROUNDED_SYNTHESIS_FALLBACK',
    'an ordinary accounting explanation stays independent of the statutory no-evidence fallback');
  assert.match(ordinaryAccountingResult.messageText, /expense is recognized when incurred/);
  assert.equal(accountingOnlyClassification?.primaryDomain, 'ACCOUNTING');
  assert.equal(accountingOnlyClassification?.intent, 'TRANSACTION');
  for (const accountingInstruction of [
    'The company must pay the supplier under the agreed settlement terms.',
    'You must record the expense when incurred.',
    'The company must report the impairment loss in profit or loss.',
    'The company shall report the impairment loss in profit or loss.',
    'The company must declare dividends to its shareholders.',
    'The software licence must be amortised over its useful life.',
    'The company must amortise the software licence over its useful life.',
    'The business must renew its software licence.',
    'A software licence is required to run the application.',
    'A commercial licence is required to use the paid application.',
    'The bookkeeper must register the asset in the fixed asset register.',
    'The accountant must register the asset at cost in the fixed asset register.',
    'The bookkeeper must register the asset on acquisition in the general ledger.',
    'The bookkeeper must register the new asset in the fixed asset register.',
    'The bookkeeper must register the asset in the general ledger.',
    'The company must return the leased equipment to the supplier.',
    'The company must accrue the fees for appointing an auditor.',
    'An accrual for the auditor appointment is required.',
    'The company must accrue fees for the auditor appointment because an accrual is necessary.',
    'The company must obtain internal approval for the expense.',
    'An equipment lease renewal is required before next year.',
    'The supplier invoice is due by 30 June 2025 under the agreed payment terms.',
    'The receivable is recoverable from the customer.',
    'The company must retain ownership of the equipment under the lease agreement.',
    'The lease renewal takes effect next year.',
    'Finance approval is required before capitalising the equipment.',
    'The company appointed an accounting manager for the finance team.'
  ]) {
    providerStages.length = 0;
    accountingOnlyStatutoryClaimMode = true;
    accountingOnlyStatutoryClaimText = accountingInstruction;
    const accountingInstructionResult = await processAccountingQuery(accountingOnlyQuery, null, 'SFRS_I', provider, 'unused', []);
    assert.notEqual(accountingInstructionResult.answerPath, 'AI_GROUNDED_SYNTHESIS_FALLBACK',
      `ordinary accounting instructions do not trigger the statutory fallback: ${accountingInstruction}`);
    assert.ok(accountingInstructionResult.messageText.includes(accountingInstruction),
      `ordinary accounting instruction remains in the accounting answer: ${accountingInstruction}`);
    assert.ok(providerStages.includes('core-generation'), 'the ordinary accounting control reaches the provider');
  }

  providerStages.length = 0;
  accountingOnlyStatutoryClaimMode = false;
  accountingOnlyMetadataMode = true;
  const metadataOnlyAccountingResult = await processAccountingQuery(accountingOnlyQuery, null, 'SFRS_I', provider, 'unused', []);
  accountingOnlyMetadataMode = false;
  assert.equal(providerStages.filter(stage => stage === 'synthesis').length, 0,
    'the metadata-only accounting answer follows the no-synthesis path');
  assert.equal(metadataOnlyAccountingResult.scenarioState.effectiveDateOrTiming, undefined,
    'no-synthesis processing removes model-controlled filing timing metadata');
  assert.doesNotMatch(metadataOnlyAccountingResult.scenarioState.uncertaintyDisclaimer || '', /Widgets Code|30 June 2025/,
    'no-synthesis processing removes the model uncertainty disclaimer');
  assert.match(metadataOnlyAccountingResult.scenarioState.uncertaintyDisclaimer || '', /Conclusion is conditional upon establishing/,
    'no-synthesis processing retains deterministic missing-fact caution');
  const metadataOnlyCompliance = renderToStaticMarkup(React.createElement(ComplianceRationale, {
    citations: [], standard: 'SFRS_I', rawQuery: accountingOnlyQuery,
    primaryDomain: metadataOnlyAccountingResult.scenarioState.primaryDomain,
    queryIntent: metadataOnlyAccountingResult.scenarioState.queryIntent,
    assumptions: metadataOnlyAccountingResult.scenarioState.assumptions,
    effectiveDateOrTiming: metadataOnlyAccountingResult.scenarioState.effectiveDateOrTiming,
    uncertaintyDisclaimer: metadataOnlyAccountingResult.scenarioState.uncertaintyDisclaimer
  }));
  assert.doesNotMatch(metadataOnlyCompliance, /Widgets Code|30 June 2025/,
    'the rendered compliance panel stays clean on the no-synthesis path for metadata-only false claims');

  accountingOnlyStatutoryClaimMode = false;
  accountingOnlyStatutoryClaimText = '';
  accountingOnlyMode = false;

  const motorCarQuery = 'Our GST-registered Singapore company bought a private motor car for business use. We are not a motor dealer or driving school. Can we recover the input GST, and what restrictions or exceptions should we check? I only need advice, not a journal.';
  const motorCarList = readFileSync(new URL('../fixtures/iras-motor-car-qualified-list.txt', import.meta.url), 'utf8')
    .replace(/\r\n/g, '\n').trim();
  const motorCarUrl = 'https://www.iras.gov.sg/taxes/goods-services-tax-(gst)/claiming-gst-(input-tax)/common-scenarios---do-i-claim-gst/Motor-Vehicles-Expenses';
  const irasConditionsUrl = 'https://www.iras.gov.sg/taxes/goods-services-tax-(gst)/claiming-gst-(input-tax)/conditions-for-claiming-input-tax';
  const motorCarEligibilityIssue = {
    subject: 'input GST recovery eligibility on private motor car',
    population: 'COMPANY', domain: 'IRAS_GST', governingAuthorities: ['IRAS'], operation: 'CHECK_ELIGIBILITY',
    mappedTopicIds: ['iras-gst-blocked-input-tax', 'iras-gst-input-tax', 'iras-gst-motor-vehicles'],
    evidenceRequirement: 'AUTHORITATIVE_SOURCE_AND_CASE_FACTS'
  };
  const motorCarIssue = {
    subject: 'restrictions and exceptions on private motor car GST',
    population: 'COMPANY', domain: 'IRAS_GST', governingAuthorities: ['IRAS'], operation: 'EXPLAIN_RULE',
    mappedTopicIds: ['iras-gst-blocked-input-tax', 'iras-gst-motor-vehicles'], evidenceRequirement: 'AUTHORITATIVE_SOURCE'
  };
  const motorCarInterpretation = makePhase2Interpretation({
    domain: 'IRAS_GST', population: 'COMPANY', authorities: ['IRAS'],
    subject: motorCarEligibilityIssue.subject, operation: 'OTHER', issues: [motorCarEligibilityIssue, motorCarIssue]
  });
  assert.ok(validateSemanticQuestionInterpretation(motorCarInterpretation, motorCarQuery));
  let motorCarSupportIssueId;
  const motorCarRun = await runPhase2ApplicationCase({
    interpretation: motorCarInterpretation,
    pages: new Map([
      [motorCarUrl, officialFixturePage('Motor Vehicles Expenses', 'Inland Revenue Authority of Singapore',
        'Input tax claims on motor car expenses for cars used by you or your employees are disallowed under Regulation 27 of the GST (General) Regulations. This input tax restriction applies regardless of whether the motor car is used wholly or partly for business purposes, unless the car is excluded from the definition of a motor car under Regulation 25(1).\n\n' + motorCarList)],
      [irasConditionsUrl, readFileSync(new URL('../fixtures/statutoryKnowledge20261027b/iras-mas-input-tax-native.html', import.meta.url), 'utf8')]
    ]),
    generate: packet => {
      assert.equal(packet.query, motorCarQuery);
      const requestedIssue = packet.requestedIssues.find(issue => /restrictions and exceptions/i.test(issue.subject));
      const passage = packet.evidencePassages.find(item => item.issueId === requestedIssue?.id && item.domain === 'IRAS_GST' &&
        item.completeAdmittedPassage.includes('(a)') && item.completeAdmittedPassage.includes('(h)'));
      assert.ok(passage, 'the production packet admits the complete qualified official motor-car list');
      motorCarSupportIssueId = passage.issueId;
      return [{ id: 'captured-motor-car-summary', kind: 'RULE',
        text: 'The motor-car list includes dealer vehicles, financial-institution hire-purchase vehicles, and licensed driving-school vehicles.',
        supportIds: [passage.id], factRefs: [], issueId: passage.issueId }];
    },
    verify: packet => {
      const claim = packet.claims.find(item => item.claimId === 'captured-motor-car-summary');
      assert.ok(claim);
      assert.equal(claim.issue.issueId, motorCarSupportIssueId);
      assert.ok(claim.citedPassages[0].completeAdmittedPassage.includes('(d)') &&
        claim.citedPassages[0].completeAdmittedPassage.includes('(h)'),
      'the positive verdict is based on the complete source list, including its item-specific conditions');
      return { verdicts: [{ claimId: claim.claimId, support: 'SUPPORTED', claimType: 'RULE' }] };
    }
  }, motorCarQuery);
  assert.equal(motorCarRun.result.answerPath, 'AI_GROUNDED_SYNTHESIS');
  assert.ok(motorCarRun.result.messageText.includes(motorCarList),
    'a supported shortened list summary renders the complete list through the production entry point');
  assert.doesNotMatch(motorCarRun.result.messageText, /The motor-car list includes dealer vehicles/);
  assert.deepEqual(motorCarRun.result.scenarioState.directGroups, [], 'the exact IRAS question creates no journal');
  assert.ok(motorCarRun.officialFetches.includes(motorCarUrl), 'the mocked official IRAS source page was retrieved');
  assert.deepEqual(motorCarRun.stages.filter(stage => ['existing-pipeline', 'synthesis', 'support-check'].includes(stage)),
    ['existing-pipeline', 'synthesis', 'support-check']);

  const mixedFirstEmployeeQuery = 'We are hiring our first employee in Singapore. Explain how CPF registration and contribution duties differ from MOM salary-payment duties, and what facts you need from us before applying the rules. Please cover both authorities. Do not calculate payroll or create journal entries.';
  const cpfIssue = {
    subject: 'CPF registration and contribution duties',
    population: 'EMPLOYER', domain: 'CPF_PAYROLL', governingAuthorities: ['CPF'], operation: 'EXPLAIN_RULE',
    mappedTopicIds: ['cpf_contribution_rates'], evidenceRequirement: 'AUTHORITATIVE_SOURCE'
  };
  const momIssue = {
    subject: 'MOM salary-payment duties',
    population: 'EMPLOYER', domain: 'MOM_EMPLOYMENT', governingAuthorities: ['MOM'], operation: 'EXPLAIN_RULE',
    mappedTopicIds: ['mom-salary-payment'], evidenceRequirement: 'AUTHORITATIVE_SOURCE'
  };
  const mixedFirstEmployeeInterpretation = makePhase2Interpretation({
    domain: 'UNKNOWN', population: 'UNKNOWN', authorities: ['CPF', 'MOM'],
    subject: 'CPF employer contributions and MOM salary duties for a first employee', operation: 'OTHER',
    issues: [cpfIssue, momIssue]
  });
  assert.ok(validateSemanticQuestionInterpretation(mixedFirstEmployeeInterpretation, mixedFirstEmployeeQuery));
  const payrollCapture = JSON.parse(readFileSync(new URL('../fixtures/statutory-answer-payroll-steps-20261113.json', import.meta.url), 'utf8'));
  const momSalaryUrl = 'https://www.mom.gov.sg/employment-practices/salary/paying-salary';
  const momPayslipUrl = 'https://www.mom.gov.sg/employment-practices/salary/itemised-payslips';
  let mixedCpfIssueId;
  let mixedMomIssueId;
  const mixedFirstEmployeeRun = await runPhase2ApplicationCase({
    interpretation: mixedFirstEmployeeInterpretation,
    pages: new Map([
      ['https://www.cpf.gov.sg/employer/employer-obligations', officialFixturePage('Employer obligations', 'Central Provident Fund Board',
        readFileSync(new URL('../fixtures/cpf-employer-obligations-admitted-context.txt', import.meta.url), 'utf8').replace(/\r\n?/g, '\n'))],
      [momSalaryUrl, officialFixturePage('Paying salary', 'Ministry of Manpower', payrollCapture.record.sourceText)],
      [momPayslipUrl, readFileSync(new URL('../fixtures/statutoryWorkflows20261029/mom-payslips.html', import.meta.url), 'utf8')]
    ]),
    generate: packet => {
      assert.equal(packet.query, mixedFirstEmployeeQuery);
      const cpfEvidence = packet.evidencePassages.find(item => item.authority === 'CPF' &&
        /contribution rate.*depends/i.test(item.completeAdmittedPassage));
      const wageEvidence = packet.evidencePassages.find(item => item.authority === 'CPF' &&
        /Ordinary Wages or Additional Wages/i.test(item.completeAdmittedPassage));
      const cpfRequested = packet.requestedIssues.find(issue => /CPF/i.test(issue.subject));
      const momRequested = packet.requestedIssues.find(issue => /salary|payslip|employment record/i.test(issue.subject));
      assert.ok(cpfEvidence && wageEvidence && cpfRequested && momRequested, 'each authority issue and its own source-backed facts reach synthesis');
      assert.equal(cpfEvidence.issueId, cpfRequested.id);
      const cpfDuties = packet.evidencePassages.filter(item => item.issueId === cpfRequested.id && item.authority === 'CPF' &&
        /total CPF contributions|need to have a CSN/i.test(item.completeAdmittedPassage));
      assert.ok(cpfDuties.some(item => /CPF Board/.test(item.completeAdmittedPassage)) &&
        cpfDuties.some(item => /CSN/.test(item.completeAdmittedPassage)), 'CPF employer remittance and registration have their own admitted support');
      mixedCpfIssueId = cpfRequested.id;
      mixedMomIssueId = momRequested.id;
      const momEvidence = packet.evidencePassages.filter(item => item.issueId === mixedMomIssueId && item.authority === 'MOM');
      const c4Passages = momEvidence.filter(item => /at least once a month|shorter intervals|within 7 days|exceptions for overtime/i.test(item.completeAdmittedPassage));
      const c5Passages = momEvidence.filter(item => /1 April 2016/i.test(item.completeAdmittedPassage) && /payslip|employment record/i.test(item.completeAdmittedPassage));
      const momCoverageFacts = momEvidence.filter(item => /covered by the Employment Act/i.test(item.completeAdmittedPassage));
      const momSalaryPeriodFacts = momEvidence.filter(item => /within 7 days after the end of the salary period/i.test(item.completeAdmittedPassage));
      assert.ok(c4Passages.length && c5Passages.length && momCoverageFacts.length && momSalaryPeriodFacts.length,
        'the complete MOM c4/c5 clauses and their coverage and salary-period context are admitted to the MOM issue');
      return [
        { id: 'mixed-cpf-employer-duties', kind: 'RULE',
          text: 'When CPF applies, the employer needs a CPF Submission Number (CSN) to submit contributions and pays the total employer and employee shares to the CPF Board.',
          supportIds: cpfDuties.map(item => item.id), factRefs: [], issueId: mixedCpfIssueId },
        { id: 'mixed-cpf-fact-guidance', kind: 'RULE',
          text: 'CPF contribution rates depend on employee citizenship or permanent-resident status, age and total wages; confirm those facts and classify wages as Ordinary Wages or Additional Wages before calculating contributions.',
          supportIds: [cpfEvidence.id, wageEvidence.id], factRefs: [], issueId: mixedCpfIssueId },
        { id: 'mixed-mom-c4-salary', kind: 'RULE',
          text: 'By contrast, MOM salary-payment duties concern paying the employee. Under the Employment Act, employers must pay salary at least once a month (or at shorter intervals) and within 7 days after the end of the salary period, with specific exceptions applying to overtime, resignation, and other situations.',
          supportIds: c4Passages.map(item => item.id), factRefs: [], issueId: mixedMomIssueId },
        { id: 'mixed-mom-c5-records', kind: 'RULE',
          text: 'From 1 April 2016, employers must issue itemised payslips and keep detailed employment records, including salary records, for employees covered by the Employment Act.',
          supportIds: c5Passages.map(item => item.id), factRefs: [], issueId: mixedMomIssueId },
        { id: 'mixed-mom-facts-to-confirm', kind: 'RULE',
          text: 'Before applying the salary deadline, establish whether the employee is covered by the Employment Act and when the salary period ends.',
          supportIds: [...new Set([...momCoverageFacts, ...momSalaryPeriodFacts].map(item => item.id))], factRefs: [], issueId: mixedMomIssueId }
      ];
    },
    verify: packet => {
      const byId = new Map(packet.claims.map(item => [item.claimId, item]));
      assert.deepEqual([...byId.keys()], ['mixed-cpf-employer-duties', 'mixed-cpf-fact-guidance', 'mixed-mom-c4-salary', 'mixed-mom-c5-records', 'mixed-mom-facts-to-confirm']);
      assert.equal(byId.get('mixed-cpf-employer-duties').issue.issueId, mixedCpfIssueId);
      assert.ok(byId.get('mixed-cpf-employer-duties').citedPassages.every(passage => passage.authority === 'CPF'));
      assert.equal(byId.get('mixed-cpf-fact-guidance').issue.issueId, mixedCpfIssueId);
      assert.ok(byId.get('mixed-cpf-fact-guidance').citedPassages.every(passage => passage.authority === 'CPF'));
      for (const id of ['mixed-mom-c4-salary', 'mixed-mom-c5-records', 'mixed-mom-facts-to-confirm']) {
        assert.equal(byId.get(id).issue.issueId, mixedMomIssueId);
        assert.ok(byId.get(id).citedPassages.every(passage => passage.authority === 'MOM'));
      }
      return { verdicts: packet.claims.map(item => ({ claimId: item.claimId, support: 'SUPPORTED', claimType: 'RULE' })) };
    }
  }, mixedFirstEmployeeQuery);
  assert.equal(mixedFirstEmployeeRun.result.answerPath, 'AI_GROUNDED_SYNTHESIS');
  assert.match(mixedFirstEmployeeRun.result.messageText, /CPF Submission Number \(CSN\).*CPF Board/);
  assert.match(mixedFirstEmployeeRun.result.messageText, /By contrast, MOM salary-payment duties concern paying the employee/);
  assert.ok(mixedFirstEmployeeRun.result.messageText.includes('CPF contribution rates depend'));
  assert.ok(mixedFirstEmployeeRun.result.messageText.includes('within 7 days after the end of the salary period'));
  assert.ok(mixedFirstEmployeeRun.result.messageText.includes('From 1 April 2016'));
  assert.ok(mixedFirstEmployeeRun.result.messageText.includes('establish whether the employee is covered by the Employment Act'));
  assert.ok(!/your employee is covered by the Employment Act/i.test(mixedFirstEmployeeRun.result.messageText),
    'the general salary rule remains conditional and does not assume the first employee is covered');
  assert.ok(mixedFirstEmployeeRun.authorityWorkstreams.workstreams.some(stream => stream.authority === 'CPF'));
  assert.ok(mixedFirstEmployeeRun.authorityWorkstreams.workstreams.some(stream => stream.authority === 'MOM'));
  assert.ok(!mixedFirstEmployeeRun.authorityWorkstreams.issuePlan.issues.some(issue => issue.domain === 'UNKNOWN'),
    'separate CPF and MOM duties do not create an unsupported third-law issue');
  assert.deepEqual(mixedFirstEmployeeRun.result.scenarioState.directGroups, [], 'the exact mixed-authority question creates no journal');
  assert.deepEqual(mixedFirstEmployeeRun.stages.filter(stage => ['existing-pipeline', 'synthesis', 'support-check'].includes(stage)),
    ['existing-pipeline', 'synthesis', 'support-check']);

  const followupQuery = 'Does that change if the employee is not covered by the overtime provisions? Please keep ordinary salary and overtime separate. No journal is required.';
  const capturedHistory = JSON.parse(readFileSync(new URL('../fixtures/mom-salary-overtime-history.json', import.meta.url), 'utf8'));
  const priorCoveredQuestion = capturedHistory.parentQuestion;
  const priorSalaryAnswer = capturedHistory.assistantAnswer;
  const followupInterpretation = makePhase2Interpretation({
    domain: 'MOM_EMPLOYMENT', population: 'EMPLOYER', authorities: ['MOM'],
    subject: 'ordinary salary and overtime rules for the current employee', operation: 'OTHER',
    issues: [
      { subject: 'ordinary salary payment frequency and deadline under the Employment Act', population: 'EMPLOYER',
        domain: 'MOM_EMPLOYMENT', governingAuthorities: ['MOM'], operation: 'EXPLAIN_RULE' },
      { subject: 'Part 4 hours-of-work guideline scope for an employee not covered by overtime provisions', population: 'EMPLOYER',
        domain: 'MOM_EMPLOYMENT', governingAuthorities: ['MOM'], operation: 'EXPLAIN_RULE' }
    ]
  });
  assert.ok(validateSemanticQuestionInterpretation(followupInterpretation, followupQuery));
  const overtimeUrl = 'https://www.mom.gov.sg/employment-practices/hours-of-work-overtime-and-rest-days';
  const overtimeSourceText = readFileSync(new URL('../fixtures/mom-hours-of-work-captured-source.txt', import.meta.url), 'utf8')
    .replace(/\r\n?/g, '\n').trim();
  const coverageQuote = 'The hours of work guidelines apply only to those covered under Part 4 of the Employment Act.';
  const exclusionQuote = 'Note: Part 4 of the Employment Act does not cover managers and executives.';
  const contractQuote = 'If you are not covered under Part 4 of the Employment Act, your terms and conditions of employment will be according to your employment contract.';
  const rateCapQuote = 'The overtime rate payable for non-workmen is capped at the salary level of $2,600, or an hourly rate of $13.60.';
  let followupSalaryIssueId;
  let followupOvertimeIssueId;
  let followupUsedAlias = false;
  const followupHistory = [
    { id: 'prior-covered-user', sender: 'user', timestamp: '', text: priorCoveredQuestion },
    { id: 'prior-assistant-salary-overtime', sender: 'ai', timestamp: '', text: priorSalaryAnswer }
  ];
  const followupRun = await runPhase2ApplicationCase({
    interpretation: followupInterpretation,
    pages: new Map([
      [momSalaryUrl, officialFixturePage('Paying salary', 'Ministry of Manpower', payrollCapture.record.sourceText)],
      [overtimeUrl, count => officialFixturePage('Hours of work, overtime and rest days', 'Ministry of Manpower', overtimeSourceText, String(count))]
    ]),
    generate: packet => {
      assert.equal(packet.query, followupQuery, 'the exact current question remains the synthesis request');
      assert.ok(packet.historyContext.turns.some(turn => turn.role === 'user' && turn.text === priorCoveredQuestion));
      assert.ok(packet.historyContext.turns.some(turn => turn.role === 'assistant' && turn.text === priorSalaryAnswer));
      assert.ok(!packet.facts.some(fact => fact.text === priorSalaryAnswer), 'assistant history remains context, never a current fact');
      const salaryIssue = packet.requestedIssues.find(issue => /ordinary salary/i.test(issue.subject));
      const overtimeIssue = packet.requestedIssues.find(issue => /Part 4|overtime/i.test(issue.subject));
      assert.ok(salaryIssue && overtimeIssue && salaryIssue.id !== overtimeIssue.id,
        'ordinary salary and overtime remain independently owned requested issues');
      followupSalaryIssueId = salaryIssue.id;
      followupOvertimeIssueId = overtimeIssue.id;
      const passages = packet.evidencePassages;
      const ownCoverage = passages.find(item => item.issueId === overtimeIssue.id && item.completeAdmittedPassage === coverageQuote);
      const ownExclusion = passages.find(item => item.issueId === overtimeIssue.id && item.completeAdmittedPassage === exclusionQuote);
      const foreignCoverage = passages.find(item => item.issueId === salaryIssue.id && item.completeAdmittedPassage === coverageQuote);
      const foreignExclusion = passages.find(item => item.issueId === salaryIssue.id && item.completeAdmittedPassage === exclusionQuote);
      assert.ok(ownCoverage && ownExclusion, 'the overtime issue has its own admitted literal scope and exclusion passages');
      followupUsedAlias = Boolean(foreignCoverage && foreignExclusion);
      const overtimeSupportIds = followupUsedAlias
        ? [foreignCoverage.id, foreignExclusion.id]
        : [ownCoverage.id, ownExclusion.id];
      const salaryPassage = passages.find(item => item.issueId === salaryIssue.id &&
        /salary.*at least once a month/i.test(item.completeAdmittedPassage) && /within 7 days/i.test(item.completeAdmittedPassage));
      assert.ok(salaryPassage, 'the ordinary-salary issue has its own explicit Employment Act salary source');
      return [
        { id: 'followup-overtime-scope', kind: 'RULE',
          text: 'The hours-of-work guidelines apply only to those covered under Part 4 of the Employment Act; Part 4 does not cover managers and executives.',
          supportIds: overtimeSupportIds, factRefs: [], issueId: overtimeIssue.id },
        { id: 'followup-ordinary-salary', kind: 'RULE',
          text: 'For employees covered by the Employment Act, the employer must pay ordinary salary at least once a month and within 7 days after the end of the salary period.',
          supportIds: [salaryPassage.id], factRefs: [], issueId: salaryIssue.id },
        { id: 'followup-overbroad-contract-conclusion', kind: 'RULE',
          text: 'Employees not covered by overtime rules are never entitled to overtime pay under any contract.',
          supportIds: overtimeSupportIds, factRefs: [], issueId: overtimeIssue.id }
      ];
    },
    verify: packet => {
      const scopeClaim = packet.claims.find(item => item.claimId === 'followup-overtime-scope');
      const salaryClaim = packet.claims.find(item => item.claimId === 'followup-ordinary-salary');
      const overbroadClaim = packet.claims.find(item => item.claimId === 'followup-overbroad-contract-conclusion');
      assert.equal(scopeClaim?.issue?.issueId, followupOvertimeIssueId);
      assert.ok(scopeClaim?.citedPassages.every(passage => passage.issueId === followupOvertimeIssueId),
        'support review sees the overtime scope only under its own issue, whether direct or narrowly rebound');
      assert.equal(salaryClaim?.issue?.issueId, followupSalaryIssueId);
      assert.ok(salaryClaim?.citedPassages.every(passage => passage.issueId === followupSalaryIssueId));
      assert.ok(overbroadClaim, 'the support stage explicitly reviews the broader unsupported contract claim');
      return { verdicts: packet.claims.map(item => ({
        claimId: item.claimId, support: item.claimId === 'followup-overbroad-contract-conclusion' ? 'UNSUPPORTED' : 'SUPPORTED',
        claimType: 'RULE'
      })) };
    }
  }, followupQuery, followupHistory);
  assert.equal(followupRun.result.answerPath, 'AI_GROUNDED_SYNTHESIS');
  assert.ok(followupRun.result.messageText.includes('The hours-of-work guidelines apply only to those covered under Part 4 of the Employment Act; Part 4 does not cover managers and executives.'));
  assert.ok(followupRun.result.messageText.includes('ordinary salary at least once a month and within 7 days'));
  assert.doesNotMatch(followupRun.result.messageText, /never entitled to overtime pay under any contract/,
    'the captured overbroad follow-up interpretation stays unresolved without foreign-only evidence');
  assert.deepEqual(followupRun.result.scenarioState.directGroups, [], 'the exact follow-up question creates no journal');
  assert.ok(followupRun.authorityWorkstreams.workstreams.some(stream => stream.authority === 'MOM'));
  if (followupUsedAlias) {
    assert.ok(followupRun.officialFetches.filter(url => url === overtimeUrl).length >= 2,
      'the duplicate source path is built only from repeated mocked official-page retrievals');
  }
  assert.deepEqual(followupRun.stages.filter(stage => ['existing-pipeline', 'synthesis', 'support-check'].includes(stage)),
    ['existing-pipeline', 'synthesis', 'support-check']);

  const capturedFallbackInterpretation = makePhase2Interpretation({
    domain: 'MOM_EMPLOYMENT', population: 'EMPLOYEE', authorities: ['MOM'],
    subject: 'ordinary salary and overtime terms for an employee not covered by overtime provisions', operation: 'OTHER',
    issues: [
      { subject: 'ordinary salary payment deadline for employee not covered by overtime provisions', population: 'EMPLOYEE',
        domain: 'MOM_EMPLOYMENT', governingAuthorities: ['MOM'], operation: 'EXPLAIN_RULE' },
      { subject: 'overtime payment deadline for employee not covered by overtime provisions', population: 'EMPLOYEE',
        domain: 'MOM_EMPLOYMENT', governingAuthorities: ['MOM'], operation: 'EXPLAIN_RULE' },
      { subject: 'practical payroll steps for salary and overtime', population: 'EMPLOYER',
        domain: 'MOM_EMPLOYMENT', governingAuthorities: ['MOM'], operation: 'EXPLAIN_RULE' }
    ]
  });
  assert.ok(validateSemanticQuestionInterpretation(capturedFallbackInterpretation, followupQuery));
  const capturedFallbackMomHoursText = [coverageQuote, exclusionQuote, contractQuote, rateCapQuote,
    'For overtime work, your employer must pay you at least 1.5 times the hourly basic rate of pay. Payment must be made within 14 days after the last day of the salary period.'].join('\n\n');
  const capturedFallbackSalaryText = [
    'In accordance with the Employment Act, your employer must pay your salary at least once a month and within 7 days after the end of the salary period. There are exceptions for overtime, resignation without notice and other situations.',
    'Salary must be paid:\n\n• Within 7 days after the end of the salary period\n\n• For overtime work, within 14 days after the end of the salary period'
  ].join('\n\n');
  const contextLimitFallback = await runPhase2ApplicationCase({
    expectSynthesisFailure: true,
    interpretation: capturedFallbackInterpretation,
    pages: new Map([
      [momSalaryUrl, officialFixturePage('Paying salary', 'Ministry of Manpower', capturedFallbackSalaryText)],
      [overtimeUrl, count => officialFixturePage('Hours of work, overtime and rest days', 'Ministry of Manpower', capturedFallbackMomHoursText, String(count))]
    ]),
    generate: packet => {
      const overtimeIssue = packet.requestedIssues.find(issue => /overtime payment deadline for employee not covered by overtime provisions/i.test(issue.subject));
      const salaryIssue = packet.requestedIssues.find(issue => /ordinary salary payment deadline for employee not covered by overtime provisions/i.test(issue.subject));
      assert.ok(overtimeIssue && salaryIssue, 'the captured follow-up resolves into separate scoped salary and overtime issues');
      assert.ok(packet.evidencePassages.some(passage => passage.issueId === overtimeIssue.id && passage.completeAdmittedPassage === contractQuote),
        'the admitted captured MOM page supplies the exact employment-contract qualification');
      assert.ok(packet.evidencePassages.some(passage => passage.issueId === overtimeIssue.id && /overtime work.*14 days/i.test(passage.completeAdmittedPassage)),
        'the captured evidence also reproduces the 14-day passage rejected in live acceptance');
      assert.ok(packet.evidencePassages.some(passage => passage.issueId === salaryIssue.id && /within 7 days/i.test(passage.completeAdmittedPassage)),
        'the ordinary salary obligation remains independently supported');
      throw new Error('The complete question and relevant context exceed the advisory context budget.');
    }
  }, followupQuery, followupHistory);
  assert.equal(contextLimitFallback.result.answerPath, 'AI_GROUNDED_SYNTHESIS_FALLBACK');
  assert.equal(contextLimitFallback.synthesisFailure?.message, 'The complete question and relevant context exceed the advisory context budget.');
  assert.equal(contextLimitFallback.result.advisoryFailureStatus, 'CONTEXT_LIMIT');
  assert.match(contextLimitFallback.result.messageText, /terms and conditions of employment will be according to your employment contract/,
    'the failure answer retains the verified contract qualification');
  assert.match(contextLimitFallback.result.messageText, /ordinary salary.*within 7 days|regular salary.*within 7 days/i,
    'the failure answer retains the separately verified ordinary salary obligation');
  assert.match(contextLimitFallback.result.messageText, /employment contract and its overtime payment terms are not available/i,
    'the failure answer explains that the employee contract terms are unknown');
  assert.doesNotMatch(contextLimitFallback.result.messageText, /overtime pay must be paid within 14 days/i,
    'the failure answer does not present the 14-day deadline as applicable outside Part 4');

  const fallbackPresentation = contextLimitFallback.result.scenarioState.authorityEvidencePresentation;
  assert.ok(fallbackPresentation, 'the failure answer retains structured evidence for the displayed compliance panel');
  const fallbackMom = fallbackPresentation.workstreams.find(stream => stream.authority === 'MOM');
  const fallbackSalaryIssue = fallbackMom?.issues.find(issue => /ordinary salary payment deadline/i.test(issue.subject));
  const fallbackOvertimeIssue = fallbackMom?.issues.find(issue => /overtime payment deadline/i.test(issue.subject));
  assert.equal(fallbackSalaryIssue?.evidenceStatus, 'VERIFIED', 'the separate ordinary salary evidence remains verified');
  assert.ok(fallbackOvertimeIssue?.claims.some(claim => claim.text === contractQuote),
    'the structured overtime issue carries the verified contract qualification');
  assert.ok(fallbackOvertimeIssue?.gaps.some(gap => /employment contract and its overtime payment terms are not available/i.test(gap)),
    'the structured overtime issue records the missing employee-specific contract terms');
  assert.ok(!fallbackSalaryIssue?.claims.some(claim => claim.text === contractQuote),
    'the contract qualification is attached only to the overtime issue');
  assert.doesNotMatch(JSON.stringify(fallbackPresentation.workstreams.flatMap(stream => stream.sources.flatMap(source => source.claims))),
    /overtime work.*14 days/i, 'the displayed evidence and citation labels omit the excluded deadline excerpt');

  const rawFallbackMom = contextLimitFallback.authorityWorkstreams.workstreams.find(stream => stream.authority === 'MOM');
  const rawFallbackOvertime = rawFallbackMom?.issues.find(issue => /overtime payment deadline/i.test(issue.subject));
  assert.ok(rawFallbackOvertime, 'the captured workstream contains the overtime owner');

  const mixedScopeWorkstreams = structuredClone(contextLimitFallback.authorityWorkstreams);
  const mixedScopeMom = mixedScopeWorkstreams.workstreams.find(stream => stream.authority === 'MOM');
  const excludedOwner = mixedScopeMom?.issues.find(issue => /overtime payment deadline/i.test(issue.subject));
  assert.ok(excludedOwner, 'the captured workstream contains the excluded overtime owner');
  const oldOwnerPlan = mixedScopeWorkstreams.issuePlan.issues.find(issue => issue.id === excludedOwner.issueId);
  assert.ok(oldOwnerPlan, 'the excluded owner is present in the captured issue plan');
  const paySubject = 'overtime pay deadline for employee not covered by overtime provisions';
  excludedOwner.subject = paySubject;
  oldOwnerPlan.subject = paySubject;
  const hoursSource = excludedOwner.sources.find(source => source.canonicalSourceUrl === overtimeUrl);
  const hoursClaimTemplate = excludedOwner.verifiedClaims.find(claim => claim.recordId === hoursSource?.id);
  assert.ok(hoursSource && hoursClaimTemplate, 'the rate-cap control binds to the captured canonical MOM source');
  const capturedRateCapClaim = { ...hoursClaimTemplate, text: rateCapQuote, quote: rateCapQuote, canonicalUrl: overtimeUrl };
  excludedOwner.verifiedClaims.push(capturedRateCapClaim);
  for (const issue of mixedScopeMom.issues.filter(candidate =>
    /ordinary salary payment deadline|practical payroll steps/i.test(candidate.subject))) {
    issue.sources.push(hoursSource);
    issue.verifiedClaims.push({ ...capturedRateCapClaim });
  }
  const coveredSubject = 'overtime pay deadline for employee covered by the overtime provisions';
  const coveredOwner = structuredClone(excludedOwner);
  coveredOwner.issueId = 'mom-overtime-covered-control';
  coveredOwner.subject = coveredSubject;
  coveredOwner.applicationStatus = 'NOT_REQUIRED';
  mixedScopeMom.issues.push(coveredOwner);
  mixedScopeWorkstreams.issuePlan.issues.push({ ...structuredClone(oldOwnerPlan), id: coveredOwner.issueId, subject: coveredSubject });
  const mixedScopePresentation = prepareAuthorityWorkstreamsForPresentation(mixedScopeWorkstreams);
  const mixedScopeIssues = mixedScopePresentation.workstreams.find(stream => stream.authority === 'MOM')?.issues || [];
  const projectedExcludedOwner = mixedScopeIssues.find(issue => issue.subject === paySubject);
  const projectedCoveredOwner = mixedScopeIssues.find(issue => issue.subject === coveredSubject);
  const projectedSalaryRow = mixedScopeIssues.find(issue => /ordinary salary payment deadline/i.test(issue.subject));
  const projectedPayrollRow = mixedScopeIssues.find(issue => /practical payroll steps/i.test(issue.subject));
  assert.ok(projectedExcludedOwner && !projectedExcludedOwner.verifiedClaims.some(claim => /overtime work.*14 days/i.test(claim.quote)),
    'an excluded overtime pay issue is recognized and its 14-day source passage is removed');
  assert.ok(projectedCoveredOwner?.verifiedClaims.some(claim => /overtime work.*14 days/i.test(claim.quote)),
    'a sibling explicitly covered by the overtime provisions retains its valid deadline evidence');
  assert.ok(!projectedExcludedOwner?.verifiedClaims.some(claim => /overtime rate payable.*capped at the salary level of \$2,600/i.test(claim.quote)),
    'the excluded overtime pay row does not retain the captured Part 4 cap');
  assert.ok(projectedCoveredOwner?.verifiedClaims.some(claim => /overtime rate payable.*capped at the salary level of \$2,600/i.test(claim.quote)),
    'the covered overtime pay row retains the captured Part 4 cap evidence');
  assert.ok(!projectedSalaryRow?.verifiedClaims.some(claim => /overtime rate payable.*capped at the salary level of \$2,600/i.test(claim.quote)),
    'an excluded ordinary-salary row does not retain the Part 4 cap');
  assert.ok(projectedSalaryRow?.verifiedClaims.some(claim => /within 7 days/i.test(claim.quote)),
    'the ordinary-salary row keeps the independent Paying Salary evidence');
  assert.ok(!projectedPayrollRow?.verifiedClaims.some(claim => /overtime rate payable.*capped at the salary level of \$2,600/i.test(claim.quote)),
    'an affected payroll row does not retain the Part 4 cap');

  const fallbackPanelMarkup = renderToStaticMarkup(React.createElement(ComplianceRationale, {
    citations: [], standard: 'SFRS_I', rawQuery: followupQuery,
    authorityEvidencePresentation: fallbackPresentation
  }));
  assert.doesNotMatch(fallbackPanelMarkup, /overtime work.*14 days/i,
    'the rendered evidence panel does not label the 14-day excerpt as supporting this case');
  assert.ok(fallbackPanelMarkup.includes(contractQuote), 'the panel positively displays the verified contract qualification');
  assert.match(fallbackPanelMarkup,
    /Supports: overtime payment deadline for employee not covered by overtime provisions/i,
    'the contract excerpt is labeled as supporting the overtime issue');
  assert.match(fallbackPanelMarkup,
    /href="https:\/\/www\.mom\.gov\.sg\/employment-practices\/hours-of-work-overtime-and-rest-days"/i,
    'the panel links the excerpt to the canonical MOM Hours of Work source');

  const scopeCases = [
    {
      query: 'The employee is outside Part 4 of the Employment Act. When are ordinary salary and overtime pay due?',
      overtimeSubject: 'overtime payment deadline',
      applicationStatus: 'NOT_REQUIRED',
      expected: { deadlineInAnswer: false, deadlineInEvidence: false, contractInAnswer: true, contractInEvidence: true }
    },
    {
      query: 'The employee is covered under Part 4, but overtime is not covered by the company handbook. When are ordinary salary and overtime pay due?',
      overtimeSubject: 'overtime payment deadline for overtime not covered by the company handbook',
      applicationStatus: 'UNRESOLVED',
      expected: { deadlineInAnswer: true, deadlineInEvidence: true, contractInAnswer: false, contractInEvidence: false }
    }
  ];
  const checkedScopes = scopeCases.map(({ query, overtimeSubject, applicationStatus }) => {
    const workstreams = structuredClone(contextLimitFallback.authorityWorkstreams);
    workstreams.query = query;
    const mom = workstreams.workstreams.find(stream => stream.authority === 'MOM');
    const overtime = mom.issues.find(issue => /^overtime payment deadline/.test(issue.subject));
    const salary = mom.issues.find(issue => /^ordinary salary payment deadline/.test(issue.subject));
    for (const [issue, subject] of [[overtime, overtimeSubject], [salary, 'ordinary salary payment deadline']]) {
      workstreams.issuePlan.issues.find(planned => planned.id === issue.issueId).subject = subject;
      issue.subject = subject;
    }
    overtime.applicationStatus = applicationStatus;
    assert.ok(overtime.verifiedClaims.some(claim => /\b14 days\b/.test(claim.quote)),
      'the scope controls start with source-backed overtime deadline evidence');
    const fallback = createGroundedSynthesisFailureResponse(
      contextLimitFallback.result, query, 'SFRS_I', workstreams, undefined, 'CONTEXT_LIMIT'
    );
    assert.equal(fallback.answerPath, 'AI_GROUNDED_SYNTHESIS_FALLBACK');
    assert.match(fallback.messageText, /salary at least once a month and within 7 days/i);
    const sources = fallback.scenarioState.authorityEvidencePresentation.workstreams
      .find(stream => stream.authority === 'MOM').sources;
    const overtimeEvidence = sources.filter(source => source.officialUrl === overtimeUrl)
      .flatMap(source => source.claims.filter(claim => claim.issueIds.includes(overtime.issueId)));
    assert.ok(sources.some(source => source.officialUrl === momSalaryUrl &&
      source.claims.some(claim => claim.issueIds.includes(salary.issueId) && /within 7 days/i.test(claim.text))),
      'ordinary-salary evidence stays with the salary issue');
    return {
      deadlineInAnswer: /\b14 days\b/.test(fallback.messageText),
      deadlineInEvidence: overtimeEvidence.some(claim => /\b14 days\b/.test(claim.text)),
      contractInAnswer: fallback.messageText.includes(contractQuote),
      contractInEvidence: overtimeEvidence.some(claim => claim.text === contractQuote)
    };
  });
  assert.deepEqual(checkedScopes, scopeCases.map(testCase => testCase.expected),
    'current Part 4 exclusions apply to neutral overtime topics and unrelated handbook wording preserves covered evidence');

  const missingContractWorkstreams = structuredClone(contextLimitFallback.authorityWorkstreams);
  for (const stream of missingContractWorkstreams.workstreams) {
    for (const issue of stream.issues) {
      if (!/overtime payment deadline/i.test(issue.subject)) continue;
      issue.admittedDocumentSources = [];
      issue.admittedDocumentContexts = [];
      issue.verifiedClaims = issue.verifiedClaims.filter(claim => claim.quote !== contractQuote);
    }
  }
  const missingContractFallback = createGroundedSynthesisFailureResponse(
    contextLimitFallback.result, followupQuery, 'SFRS_I', missingContractWorkstreams, undefined,
    'CONTEXT_LIMIT'
  );
  assert.match(missingContractFallback.messageText,
    /available evidence does not state the overtime terms.*employment contract is needed/i,
    'without a verified qualification excerpt, the fallback states the evidence limitation and requests the contract');
  assert.doesNotMatch(missingContractFallback.messageText, /overtime pay must be paid within 14 days/i);

  const selectedContractWithoutDocument = structuredClone(contextLimitFallback.authorityWorkstreams);
  for (const stream of selectedContractWithoutDocument.workstreams) {
    for (const issue of stream.issues) {
      if (!/overtime payment deadline/i.test(issue.subject)) continue;
      const contractSource = issue.admittedDocumentSources?.find(source => source.canonicalSourceUrl === overtimeUrl);
      const selectedSourceClaim = issue.verifiedClaims.find(claim => claim.recordId === contractSource?.id);
      assert.ok(contractSource && selectedSourceClaim, 'the selected-claim control has a source-bound MOM record');
      issue.verifiedClaims.push({ ...selectedSourceClaim, text: contractQuote, quote: contractQuote,
        canonicalUrl: contractSource.canonicalSourceUrl });
      issue.admittedDocumentSources = [];
      issue.admittedDocumentContexts = [];
    }
  }
  const selectedContractFallback = createGroundedSynthesisFailureResponse(
    contextLimitFallback.result, followupQuery, 'SFRS_I', selectedContractWithoutDocument, undefined,
    'CONTEXT_LIMIT'
  );
  assert.match(selectedContractFallback.messageText,
    /employment contract and its overtime payment terms are not available/i,
    'an exact selected contract claim counts as verified evidence while preserving the missing employee-specific terms limitation');
  assert.doesNotMatch(selectedContractFallback.messageText,
    /available evidence does not state the overtime terms/i,
    'a selected exact contract qualification is not mislabeled as absent source evidence');

  providerStages.length = 0;
  const offline = await processAccountingQuery(query, null, 'SFRS_I', undefined, 'unused', []);
  assert.equal(providerStages.length, 0, 'no-provider queries retain the original offline path');
  assert.notEqual(offline.answerPath, 'AI_GROUNDED_SYNTHESIS');
} finally {
  globalThis.fetch = originalFetch;
  defaultSourceCache.clear();
}
console.log('Evidence-grounded synthesis production pipeline passed: existing semantic retrieval/admission, practical conditional answer, citations, full display and safe fallback.');
