import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SafeChatAnswer } from '../../src/components/SafeChatAnswer.tsx';
import { ComplianceRationale } from '../../src/components/ComplianceRationale.tsx';
import { InputHandlerPanel } from '../../src/components/InputHandlerPanel.tsx';
import { JournalTable } from '../../src/components/JournalTable.tsx';
import { createGroundedSynthesisFailureResponse, hasUnverifiedStatutoryClaim, processAccountingQuery } from '../../src/services/geminiService.ts';
import { postProcessAIResponse } from '../../src/services/groundingContextBuilder.ts';
import { calculateDoubleEntries } from '../../src/engine/accountingEngine.ts';
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

  providerStages.length = 0;
  const offline = await processAccountingQuery(query, null, 'SFRS_I', undefined, 'unused', []);
  assert.equal(providerStages.length, 0, 'no-provider queries retain the original offline path');
  assert.notEqual(offline.answerPath, 'AI_GROUNDED_SYNTHESIS');
} finally {
  globalThis.fetch = originalFetch;
  defaultSourceCache.clear();
}
console.log('Evidence-grounded synthesis production pipeline passed: existing semantic retrieval/admission, practical conditional answer, citations, full display and safe fallback.');
