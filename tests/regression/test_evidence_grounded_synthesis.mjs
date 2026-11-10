import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { estimateAdvisoryTokens } from '../../src/services/aiFirstAdvisory.ts';
import { UNIFIED_SOURCE_REGISTRY } from '../../src/standards/unifiedSourceModel.ts';
import { classifyQuestion } from '../../src/classification/questionClassifier.ts';
import { evaluateEvidenceQuality } from '../../src/retrieval/evidenceQualityGate.ts';
import { classifyAdvisoryFailure } from '../../src/services/aiFirstAdvisory.ts';
import { createRequestCompletenessContext } from '../../src/services/requestCompleteness.ts';
import { parseAccountingQuery } from '../../src/engine/scenarioParser.ts';
import { calculateDoubleEntries } from '../../src/engine/accountingEngine.ts';
import { tryGenerateGroundedSynthesis } from '../../src/services/evidenceGroundedSynthesis.ts';

const provider = {
  activeProvider: 'openai',
  openai: { apiKey: 'test-key-for-mocked-synthesis', model: 'test-model' },
  gemini: {}, azure: {}
};
const record = UNIFIED_SOURCE_REGISTRY.GST_REG26_BLOCKED_INPUT_TAX;
assert.ok(record, 'a registered IRAS GST source record is available');
const quote = record.sourceText.match(/[^.!?]+[.!?]/)?.[0]?.trim() || record.sourceText.trim();
assert.ok(quote && record.sourceText.includes(quote), 'the test uses a complete admitted source quotation');
const sourceClaim = {
  recordId: record.id,
  quote,
  text: quote,
  supportKind: 'EXACT_SOURCE_QUOTE',
  canonicalUrl: record.canonicalSourceUrl
};
const query = 'Can this expense qualify for input tax recovery?';

function makeIssue(issueId = 'issue-gst', options = {}) {
  const withSource = options.withSource !== false;
  return {
    issueId,
    subject: options.subject || 'input tax recovery',
    population: options.population || 'BUSINESS',
    domain: 'IRAS_GST',
    operation: options.operation || 'RECOVER',
    evidenceRequirement: options.evidenceRequirement || 'APPLICATION',
    governingAuthority: 'IRAS',
    sourceSections: [],
    lifecycle: {},
    evidenceStatus: withSource ? 'VERIFIED' : 'INSUFFICIENT',
    applicationStatus: options.applicationStatus || 'UNRESOLVED',
    applicationReason: options.applicationReason || 'The expense purpose and applicable restrictions have not been established.',
    verifiedClaims: withSource ? [{ ...sourceClaim, sourceAdmissionOptions: { targetDate: options.targetDate || '2026-11-03' } }] : [],
    sources: withSource ? [record] : [],
    gaps: options.gaps || []
  };
}

function makeInput(options = {}) {
  const queryText = options.query || query;
  const issues = options.issues || [makeIssue()];
  return {
    query: queryText,
    standard: 'SFRS(I)',
    provider: Object.hasOwn(options, 'provider') ? options.provider : provider,
    history: options.history || [],
    response: {
      scenarioState: options.scenarioState || {
        scenarioType: 'EXPENSE', transactionTitle: 'Office expense', amount: 100,
        transactionCurrency: 'SGD', functionalCurrency: 'SGD', transactionDate: '', eventDate: '',
        directGroups: [], missingFacts: [], missingFields: [], isComplete: false
      },
      evidenceQuality: options.evidenceQuality || {
        eligibleRecords: [record], missingFacts: ['The purchase purpose was not provided.'], targetDate: '2026-11-03'
      },
      ...(options.calculation ? { calculation: options.calculation } : {}),
      ...(options.applicationConclusions ? { applicationConclusions: options.applicationConclusions } : {}),
      ...(options.claimVerification ? { claimVerification: options.claimVerification } : {})
    },
    ...(options.context ? { context: options.context } : {}),
    ...(options.noWorkstreams ? {} : { workstreams: {
      query: options.workstreamQuery || queryText,
      issuePlan: Object.hasOwn(options, 'issuePlan')
        ? options.issuePlan
        : { issues: options.issuePlanIssues || [] },
      requestCompletenessContext: {},
      workstreams: issues.map((issue, index) => ({
        id: `workstream-${index + 1}`, authority: issue.governingAuthority, domain: issue.domain, sourceSections: [],
        populations: [issue.population], issues: [issue], evidenceStatus: issue.evidenceStatus,
        applicationStatus: issue.applicationStatus, verifiedClaims: issue.verifiedClaims, sources: issue.sources, gaps: issue.gaps
      })),
      evidenceStatus: issues.some(issue => issue.evidenceStatus === 'VERIFIED') ? 'VERIFIED' : 'INSUFFICIENT',
      applicationStatus: issues.some(issue => issue.applicationStatus === 'UNRESOLVED') ? 'UNRESOLVED' : 'VERIFIED',
      status: 'CONDITIONAL', gaps: options.workstreamGaps || []
    } })
  };
}

function claim(id, text, supportIds = ['passage-1'], overrides = {}) {
  return { id, kind: 'RULE', text, supportIds, factRefs: [], ...overrides };
}

function scriptedCall(handler, verificationHandler) {
  const calls = [];
  const call = async (prompt, system, activeProvider, options) => {
    calls.push({ prompt, system, provider: activeProvider, options });
    const context = { prompt, system, provider: activeProvider, index: calls.length };
    const value = system.startsWith('EVIDENCE_GROUNDED_SUPPORT_VERIFICATION')
      ? verificationHandler ? await verificationHandler(context) : defaultVerification(prompt)
      : await handler(context);
    return typeof value === 'string' ? value : JSON.stringify(value);
  };
  return { call, calls };
}

function defaultVerification(prompt) {
  const packet = JSON.parse(prompt);
  return { verdicts: packet.claims.map(item => {
    return {
      claimId: item.claimId,
      support: 'SUPPORTED',
      claimType: item.kind === 'APPLICATION' ? 'DEFINITIVE_APPLICATION' : 'RULE'
    };
  }) };
}

function packetFrom(prompt) {
  return JSON.parse(prompt);
}

const supportedRule = quote;
{
  const scripted = scriptedCall(({ prompt }) => {
    const packet = packetFrom(prompt);
    return { claims: [claim('rule-1', supportedRule)] };
  });
  const result = await tryGenerateGroundedSynthesis(makeInput({ history: [
    { id: 'prior-user', sender: 'user', timestamp: '', text: 'The office expense is used partly for business.' },
    { id: 'prior-assistant', sender: 'assistant', timestamp: '', text: 'Previous answer preview.',
      fullText: 'Earlier guidance: the extent of business use is relevant to input tax treatment.' }
  ] }), { call: scripted.call });
  assert.ok(result);
  assert.match(result.messageText, /Regulations 26 and 27 generally disallow input tax/);
  assert.match(result.messageText, /\[IRAS:/, 'the inline citation comes from the verified record, not generated text');
  assert.equal(result.officialAnswerLinks[0]?.url, record.canonicalSourceUrl);
  assert.match(result.messageText, /general rule is supported above; whether input tax recovery applies to your circumstances remains unresolved/i);
  assert.match(result.messageText, /purchase purpose was not provided/i);
  assert.equal(result.verification.claimValidation, 'DETERMINISTIC_PACKET_CHECKS');
  assert.equal(result.verification.sourceAdmission, 'EXISTING_PIPELINE_ADMITTED');
  assert.equal(result.verification.providerCalls, 1, 'an exact admitted rule quote stays on the single generation call');
  assert.equal(result.verification.providerAttempts, 1);
  assert.equal(result.verification.admittedClaimIds[0], 'rule-1');
  assert.ok(result.verification.providerElapsedMs >= 0);
  const generationPacket = packetFrom(scripted.calls[0].prompt);
  assert.equal(createHash('sha256').update(scripted.calls[0].prompt).digest('hex'),
    'c7fc9c7c1693e8d8379e73eb6c61230f6e41306dc81f4012c0947b41602218e8',
    'An under-budget prompt retains the original byte serialization.');
  assert.equal(scripted.calls[0].prompt.includes('bindingRef'), false,
    'An under-budget prompt keeps its original expanded passage format.');
  assert.equal(generationPacket.evidencePassages[0].targetDate, '2026-11-03');
  assert.equal(generationPacket.evidencePassages[0].issueId, 'issue-gst');
  assert.equal(generationPacket.evidencePassages[0].completeAdmittedPassage, quote);
  assert.equal(generationPacket.historyContext.turns[1].text,
    'Earlier guidance: the extent of business use is relevant to input tax treatment.',
    'the synthesis receives the previous assistant full answer as contextual history');
  assert.equal(generationPacket.historyContext.turns.filter(turn => turn.role === 'user' && turn.text === query).length, 0,
    'the current question is passed separately and is not duplicated in conversation history');
  assert.ok(!scripted.calls[0].prompt.includes(record.sourceText.slice(quote.length)), 'unrelated source body text is not duplicated into the prompt');
}

{
  const literalQuotes = Array.from({ length: 90 }, (_, start) => record.sourceText.slice(start, start + 100));
  assert.ok(literalQuotes.every(literalQuote => literalQuote.length === 100 && record.sourceText.includes(literalQuote)));
  assert.equal(new Set(literalQuotes).size, literalQuotes.length,
    'The compression control uses distinct, exact excerpts from the registered source text.');
  const compactIssue = makeIssue('issue-compact-main', {
    subject: 'input tax recovery', applicationStatus: 'UNRESOLVED'
  });
  compactIssue.verifiedClaims = literalQuotes.map(literalQuote => ({
    ...sourceClaim, quote: literalQuote, text: literalQuote,
    sourceAdmissionOptions: { targetDate: '2026-11-03' }
  }));
  const repeatedQuoteIssue = makeIssue('issue-compact-second', {
    subject: 'input tax recovery', applicationStatus: 'UNRESOLVED'
  });
  repeatedQuoteIssue.verifiedClaims = [{
    ...sourceClaim, quote: literalQuotes[0], text: literalQuotes[0],
    sourceAdmissionOptions: { targetDate: '2026-11-03' }
  }];
  const compactIssues = [compactIssue, repeatedQuoteIssue];
  const compactInput = makeInput({ issues: compactIssues });
  const compactScript = scriptedCall(({ prompt }) => {
    const packet = packetFrom(prompt);
    const passage = packet.evidencePassages[0];
    const binding = passage.bindingRef
      ? packet.evidenceBindings.find(candidate => candidate.id === passage.bindingRef)
      : passage;
    assert.equal(passage.issueId, binding.issueId, 'Inline issue ownership agrees with the losslessly factored binding.');
    return { claims: [claim('compact-packet-rule', passage.completeAdmittedPassage, [passage.id], { issueId: passage.issueId })] };
  });
  const compactResult = await tryGenerateGroundedSynthesis(compactInput, { call: compactScript.call });
  assert.ok(compactResult);
  const compactCall = compactScript.calls[0];
  const compactPacket = packetFrom(compactCall.prompt);
  assert.ok(compactPacket.evidenceEncodingInstruction);
  assert.ok(compactPacket.evidencePassages.every(passage =>
    Object.keys(passage).sort().join(',') === 'bindingRef,completeAdmittedPassage,id,issueId'),
  'Oversized passages keep their original IDs, issue IDs, and exact quotes inline while factoring only repeated binding metadata.');
  assert.ok(estimateAdvisoryTokens(compactCall.prompt) + estimateAdvisoryTokens(compactCall.system) <= 15_000,
    'The compact packet and actual generation system remain inside the existing shared budget.');
  assert.ok(compactPacket.evidencePassages.length > compactPacket.evidenceBindings.length);
  assert.equal(compactPacket.evidencePassages.length, 91);
  assert.equal(compactPacket.evidenceBindings.length, 2,
    'All claims in each issue reuse that issue’s exact source-binding metadata.');
  assert.equal(Object.hasOwn(compactPacket, 'admittedQuotes'), false,
    'Exact quotations are not moved into a second lookup table.');
  assert.equal(compactPacket.evidencePassages[0].bindingRef, compactPacket.evidencePassages[1].bindingRef,
    'Passages in one issue share only that issue’s identical binding metadata.');
  assert.notEqual(compactPacket.evidencePassages[0].bindingRef, compactPacket.evidencePassages.at(-1).bindingRef,
    'Different issue scopes retain different binding references.');
  assert.equal(compactPacket.evidencePassages[0].completeAdmittedPassage,
    compactPacket.evidencePassages.at(-1).completeAdmittedPassage,
    'A repeated exact quote remains inline on both original passage IDs.');
  assert.notEqual(compactPacket.evidencePassages[0].completeAdmittedPassage,
    compactPacket.evidencePassages[1].completeAdmittedPassage,
    'Distinct literal quotations remain attached to their own original passage IDs.');

  const bindingTable = new Map(compactPacket.evidenceBindings.map(({ id, ...metadata }) => [id, metadata]));
  const restoredPassages = compactPacket.evidencePassages.map(({ id, issueId, bindingRef, completeAdmittedPassage }) => {
    assert.ok(bindingTable.has(bindingRef), `Every passage binding reference resolves: ${bindingRef}`);
    assert.equal(typeof completeAdmittedPassage, 'string', 'The exact admitted quote is inline on its passage.');
    const bindingMetadata = bindingTable.get(bindingRef);
    assert.equal(issueId, bindingMetadata.issueId,
      'The inline issue ID matches the original issue ID retained in its binding metadata.');
    return { id, ...bindingMetadata, completeAdmittedPassage };
  });
  let passageSequence = 0;
  const expectedPassages = compactIssues.flatMap(issue => issue.verifiedClaims.map(sourceClaimValue => ({
    id: `passage-${++passageSequence}`,
    issueId: issue.issueId,
    subject: issue.subject,
    authority: issue.governingAuthority,
    domain: issue.domain,
    operation: issue.operation,
    population: issue.population,
    sourceRecordId: record.id,
    sourceTitle: record.documentTitle,
    publisher: record.sourcePublisher,
    instrument: record.legalOrStandardInstrument,
    section: record.paragraphOrSection,
    ...(record.effectiveDate ? { effectiveDate: record.effectiveDate } : {}),
    ...(record.validFrom ? { validFrom: record.validFrom } : {}),
    ...(record.validTo ? { validTo: record.validTo } : {}),
    targetDate: sourceClaimValue.sourceAdmissionOptions.targetDate,
    supportKind: sourceClaimValue.supportKind,
    applicationStatus: issue.applicationStatus,
    applicationReason: issue.applicationReason,
    completeAdmittedPassage: sourceClaimValue.quote
  })));
  assert.deepEqual(restoredPassages, expectedPassages,
    'Reconstruction restores every passage ID, scope/date/application field, source-record binding, and exact literal quote.');
  const restoredPacket = { ...compactPacket, evidencePassages: restoredPassages };
  delete restoredPacket.evidenceBindings;
  delete restoredPacket.evidenceEncodingInstruction;
  assert.equal(restoredPacket.query, compactInput.query, 'The original question is unchanged.');
  assert.deepEqual(restoredPacket.facts, [
    { id: 'fact-current-question', origin: 'CURRENT_QUESTION', text: compactInput.query },
    { id: 'fact-scenario-1', origin: 'ACTIVE_SCENARIO', text: 'scenarioType: EXPENSE' },
    { id: 'fact-scenario-2', origin: 'ACTIVE_SCENARIO', text: 'transactionTitle: Office expense' },
    { id: 'fact-scenario-3', origin: 'ACTIVE_SCENARIO', text: 'amount: 100' },
    { id: 'fact-scenario-4', origin: 'ACTIVE_SCENARIO', text: 'transactionCurrency: SGD' },
    { id: 'fact-scenario-5', origin: 'ACTIVE_SCENARIO', text: 'functionalCurrency: SGD' }
  ], 'All current-question and scenario facts remain unchanged.');
  assert.deepEqual(restoredPacket.historyContext.turns, [], 'History remains unchanged.');
  assert.deepEqual(restoredPacket.missingFactsAndEvidenceGaps, [
    '[Issue issue-compact-main] Applicability remains unresolved for input tax recovery under IRAS.',
    '[Issue issue-compact-second] Applicability remains unresolved for input tax recovery under IRAS.',
    '[Question-wide unresolved fact] The purchase purpose was not provided.'
  ], 'Issue-specific and question-wide evidence gaps remain unchanged.');
  assert.equal(restoredPacket.trustedDeterministicOutputs.length, 2,
    'Both original issue-owned deterministic limitations remain present.');
  assert.deepEqual(restoredPacket.trustedDeterministicOutputs.map(output => output.issueId),
    compactIssues.map(issue => issue.issueId), 'Trusted outputs retain their original issue ownership.');
  assert.equal(restoredPacket.requestedIssues.length, compactIssues.length, 'Every requested issue remains present.');
  assert.ok(restoredPacket.requestedIssues.every((issue, index) => issue.id === compactIssues[index].issueId),
    'Requested issue scope and order remain intact.');
  assert.ok(estimateAdvisoryTokens(JSON.stringify(restoredPacket)) + estimateAdvisoryTokens(compactCall.system) > 15_000,
    'The expanded packet exceeds the budget and therefore requires compaction.');
}

{
  let calls = 0;
  await assert.rejects(tryGenerateGroundedSynthesis(makeInput({
    query: 'Can this expense qualify for input tax recovery? '.repeat(4_000)
  }), { call: async () => { calls++; return JSON.stringify({ claims: [] }); } }),
  /complete question and relevant context exceed the advisory context budget/);
  assert.equal(calls, 0, 'A still-oversized compact packet fails closed before provider dispatch.');
}

{
  const contextQuery = 'What GST input tax costs are blocked for motor cars?';
  const classification = classifyQuestion(contextQuery);
  const quality = evaluateEvidenceQuality({
    query: contextQuery, topicIds: classification.topicIds, records: [record], missingFacts: [],
    targetDate: '2026-11-03', domain: 'GST', authorities: ['IRAS']
  });
  const context = {
    evidenceQuality: quality, classification, userFacts: [], missingFacts: [], assumptions: [],
    primaryEvidence: [record], officialGuidance: [], curatedSummaries: [], applicationRules: [],
    currentInformationRequired: false,
    authorityIssue: {
      authority: 'IRAS', requestedConcepts: [], issue: {
        id: 'issue-gst', subject: 'input tax recovery', population: 'BUSINESS', domain: 'IRAS_GST',
        governingAuthorities: ['IRAS'], contextualAuthorities: [], operation: 'RECOVER',
        mappedTopicIds: [], evidenceRequirement: 'APPLICATION', confidence: 1, status: 'MAPPED'
      }
    }
  };
  const scripted = scriptedCall(({ system, prompt }) => {
    const packet = packetFrom(prompt);
    return { claims: packet.evidencePassages.map((passage, index) => claim(
      `passage-claim-${index + 1}`, passage.completeAdmittedPassage, [passage.id], { issueId: passage.issueId }
    )) };
  });
  const result = await tryGenerateGroundedSynthesis(makeInput({ query: contextQuery, context }), { call: scripted.call });
  assert.ok(result);
  const passages = packetFrom(scripted.calls[0].prompt).evidencePassages;
  assert.ok(passages.length >= 2, 'workstream evidence and locally selected IRAS context evidence are both retained');
  assert.equal(new Set(passages.map(passage => passage.id)).size, passages.length, 'merged passage IDs stay unique');
  assert.deepEqual(new Set(passages.map(passage => passage.issueId)), new Set(['issue-gst']),
    'fallback IRAS passages retain the original requested issue ID and cannot become a synthetic whole-query scope');
  assert.match(result.messageText, /Regulations 26 and 27 generally disallow/);
  assert.match(result.messageText, /Business purpose alone does not make a blocked claim recoverable/);
  {
    const { authorityIssue: _authorityIssue, ...contextWithoutIssueOwner } = context;
    const unownedFallback = scriptedCall(({ system, prompt }) => {
      const packet = packetFrom(prompt);
      return { claims: [claim('rule-unowned-fallback', supportedRule)] };
    });
    const unownedResult = await tryGenerateGroundedSynthesis(
      makeInput({ query: contextQuery, context: contextWithoutIssueOwner }), { call: unownedFallback.call }
    );
    assert.ok(unownedResult);
    const unownedPassages = packetFrom(unownedFallback.calls[0].prompt).evidencePassages;
    assert.equal(unownedPassages.length, 1, 'fallback evidence is not guessed into a requested issue without an explicit validated owner');
    assert.equal(unownedPassages[0].issueId, 'issue-gst', 'the sole passage is the directly admitted workstream issue passage');
  }
  for (const mismatchedIssue of [
    { ...context.authorityIssue.issue, population: 'COMPANY' },
    { ...context.authorityIssue.issue, governingAuthorities: ['CPF'] }
  ]) {
    const mismatchedContext = {
      ...context,
      authorityIssue: { ...context.authorityIssue, issue: mismatchedIssue }
    };
    const mismatchCall = scriptedCall(({ system, prompt }) => {
      const packet = packetFrom(prompt);
      return { claims: [claim('mismatched-owner-rule', supportedRule, ['passage-1'], { issueId: 'issue-gst' })] };
    });
    const mismatchResult = await tryGenerateGroundedSynthesis(
      makeInput({ query: contextQuery, context: mismatchedContext }), { call: mismatchCall.call }
    );
    assert.ok(mismatchResult);
    const mismatchPassages = packetFrom(mismatchCall.calls[0].prompt).evidencePassages;
    assert.equal(mismatchPassages.length, 1, 'fallback evidence cannot cross the planned population or governing authority');
    assert.equal(mismatchPassages[0].issueId, 'issue-gst');
  }
}

{
  const sentences = record.sourceText.match(/[^.!?]+[.!?]/g)?.map(sentence => sentence.trim()) || [];
  const secondQuote = sentences.find(sentence => sentence !== quote && record.sourceText.includes(sentence));
  assert.ok(secondQuote, 'the admitted source includes more than one complete passage');
  const issue = makeIssue('issue-multipassage', { applicationStatus: 'VERIFIED' });
  issue.verifiedClaims = [sourceClaim, { ...sourceClaim, quote: secondQuote, text: secondQuote }];
  const scripted = scriptedCall(({ system, prompt }) => {
    const packet = packetFrom(prompt);
    return { claims: [claim('multi-passage-rule', supportedRule, ['passage-1'], { issueId: 'issue-multipassage' })] };
  });
  const result = await tryGenerateGroundedSynthesis(makeInput({ issues: [issue] }), { call: scripted.call });
  assert.ok(result);
  const passages = packetFrom(scripted.calls[0].prompt).evidencePassages;
  assert.equal(passages.filter(passage => passage.issueId === 'issue-multipassage').length, 2,
    'multiple admitted passages remain available inside one issue scope');
}

{
  let providerCalls = 0;
  const noProvider = await tryGenerateGroundedSynthesis(makeInput({ provider: undefined }), {
    call: async () => { providerCalls += 1; return '{}'; }
  });
  assert.equal(noProvider, undefined);
  assert.equal(providerCalls, 0, 'missing credentials do not trigger a synthesis call');

  const noEvidence = await tryGenerateGroundedSynthesis(makeInput({ issues: [makeIssue('issue-empty', { withSource: false })] }), {
    call: async () => { providerCalls += 1; return '{}'; }
  });
  assert.equal(noEvidence, undefined);
  assert.equal(providerCalls, 0, 'no usable admitted passage avoids provider calls');
}

{
  const scripted = scriptedCall(({ system }) => {
    return { claims: [claim('bad-id', 'The passage proves this claim.', ['invented-source-id'])] };
  });
  await assert.rejects(
    tryGenerateGroundedSynthesis(makeInput(), { call: scripted.call }),
    error => /no supportable claims/.test(error.message) && !/invented-source-id/.test(error.message)
  );
  assert.equal(scripted.calls.length, 1, 'invalid support IDs fail deterministic validation after one generation call');
}

{
  const issue = makeIssue('issue-gst-rule', {
    subject: 'input GST recovery for blocked motor car purchases',
    operation: 'EXPLAIN_RULE', evidenceRequirement: 'AUTHORITATIVE_SOURCE', applicationStatus: 'NOT_REQUIRED'
  });
  const truthfulRule = claim('rule-blocked-category', supportedRule, ['passage-1'], {
    issueId: 'issue-gst-rule'
  });
  const contradiction = claim('rule-private-motor-car-recoverable',
    'Input GST on a blocked private motor car purchase is always recoverable.', ['passage-1'], {
      issueId: 'issue-gst-rule'
    });
  const scripted = scriptedCall(() => ({ claims: [truthfulRule, contradiction] }), ({ prompt, system }) => {
    assert.match(system, /full legal meaning.*every conclusion, exception, qualification, and contradiction/i);
    const input = JSON.parse(prompt);
    assert.ok(input.claims.some(item => item.claimId === 'rule-private-motor-car-recoverable'),
      'a paraphrased RULE is verified even when issue routing says EXPLAIN_RULE and NOT_REQUIRED');
    return { verdicts: [
      { claimId: 'rule-private-motor-car-recoverable', support: 'UNSUPPORTED', claimType: 'RULE' }
    ] };
  });
  const result = await tryGenerateGroundedSynthesis(makeInput({
    query: 'Explain the input GST rule for a blocked private motor car purchase.',
    issues: [issue], evidenceQuality: { eligibleRecords: [record], missingFacts: [], targetDate: '2026-11-03' }
  }), { call: scripted.call });
  assert.ok(result);
  assert.ok(result.messageText.includes(supportedRule), 'the independently supported rule remains available');
  assert.ok(!result.messageText.includes(contradiction.text), 'a valid IRAS source citation cannot rescue a contradictory conclusion');
  assert.equal(result.verification.providerCalls, 2);
  assert.equal(result.verification.semanticVerificationCalls, 1);
  assert.equal(result.verification.claims.find(item => item.claimId === contradiction.id)?.semanticSupport, 'UNSUPPORTED');
}

{
  const goodRule = claim('rule-supported', supportedRule);
  const unconditional = claim('application-needs-facts', 'This client qualifies to recover the input tax for this expense.', ['passage-1'], {
    kind: 'APPLICATION', factRefs: ['fact-current-question'], issueId: 'issue-gst'
  });
  const issueConceptGap = {
    issueId: 'issue-gst', authority: 'IRAS', domain: 'IRAS_GST', subject: 'input tax recovery',
    operation: 'RECOVER', stage: 'covered', code: 'ISSUE_CONCEPT_UNCOVERED',
    reason: 'Verified quotations do not support the requested input tax recovery concept.'
  };
  const issuePlanGap = {
    issueId: 'issue-plan', authority: 'UNKNOWN', domain: 'UNKNOWN', subject: 'Issue plan',
    operation: 'OTHER', stage: 'covered', code: 'ISSUE_PLAN_HAS_UNMAPPED_RESIDUAL',
    reason: 'The reconciled issue plan does not establish coverage of the complete question.'
  };
  const scripted = scriptedCall(({ system, prompt }) => {
    const packet = packetFrom(prompt);
    assert.ok(packet.missingFactsAndEvidenceGaps.some(gap =>
      gap.startsWith('[Issue issue-plan]') && gap.includes('Issue plan')),
    'the issue-plan diagnostic remains in the prompt packet for deterministic checks');
    assert.ok(packet.missingFactsAndEvidenceGaps.some(gap =>
      gap.startsWith('[Issue issue-gst]') && gap.includes('input tax recovery')),
    'the issue-scoped concept diagnostic remains in the prompt packet for deterministic checks');
    return { claims: [goodRule, unconditional] };
  });
  const result = await tryGenerateGroundedSynthesis(makeInput({
    issues: [makeIssue('issue-gst', { gaps: [issueConceptGap] })],
    workstreamGaps: [issuePlanGap, issueConceptGap]
  }), { call: scripted.call });
  assert.ok(result);
  assert.match(result.messageText, /Regulations 26 and 27 generally disallow/);
  assert.match(result.messageText, /\[IRAS:/, 'the supported rule keeps its source citation');
  assert.match(result.messageText, /Some claims could not be established from the admitted evidence and stated facts/);
  assert.match(result.messageText, /The general rule is supported above; whether input tax recovery applies to your circumstances remains unresolved on the facts available/);
  assert.doesNotMatch(result.messageText, /Verified evidence is still needed for|Issue plan|concept is not supported/i,
    'internal workstream diagnostics do not render as contradictory evidence gaps');
  assert.doesNotMatch(result.messageText, /A supported explanation of input tax recovery was not established/i,
    'the supported general rule is not described as unavailable');
  assert.equal(result.verification.providerCalls, 2, 'the application claim receives one batched support check');
  assert.equal(result.verification.claims.find(item => item.claimId === 'rule-supported')?.outcome, 'ADMITTED');
  assert.ok(result.verification.withheldClaimIds.includes('application-needs-facts'));
  assert.ok(!result.messageText.includes('This client qualifies to recover'));
  assert.ok(result.messageText.includes('The purchase purpose was not provided.'));
}

{
  const definitiveApplications = [
    claim('application-definitive-before-caveat',
      'This client qualifies to recover the input tax, subject to the usual conditions. The purchase purpose still needs to be confirmed.',
      ['passage-1'], { kind: 'APPLICATION', factRefs: ['fact-current-question'], issueId: 'issue-gst' }),
    claim('application-contradictory-caveat',
      'The client qualifies for recovery, although the required eligibility facts cannot be confirmed.',
      ['passage-1'], { kind: 'APPLICATION', factRefs: ['fact-current-question'], issueId: 'issue-gst' }),
    claim('application-unrelated-condition',
      'If the office is open, the client qualifies for GST recovery.',
      ['passage-1'], { kind: 'APPLICATION', factRefs: ['fact-current-question'], issueId: 'issue-gst' }),
    claim('application-definitive-after-yet',
      'The purchase purpose has not been established. The client may recover GST if the conditions are met, yet the client qualifies today.',
      ['passage-1'], { kind: 'APPLICATION', factRefs: ['fact-current-question'], issueId: 'issue-gst' }),
    claim('application-definitive-after-although',
      'Although the purchase purpose has not been established, the client qualifies for GST recovery.',
      ['passage-1'], { kind: 'APPLICATION', factRefs: ['fact-current-question'], issueId: 'issue-gst' }),
    claim('application-definitive-after-comma-caveat',
      'The purchase purpose has not been established, the client is eligible today.',
      ['passage-1'], { kind: 'APPLICATION', factRefs: ['fact-current-question'], issueId: 'issue-gst' }),
    claim('application-definitive-despite-caveat',
      'The client qualifies despite the purchase purpose remaining unresolved.',
      ['passage-1'], { kind: 'APPLICATION', factRefs: ['fact-current-question'], issueId: 'issue-gst' }),
    claim('application-definitive-after-and-pronoun',
      'The relevant facts remain unresolved. The client may recover GST if the conditions are met, and it qualifies today.',
      ['passage-1'], { kind: 'APPLICATION', factRefs: ['fact-current-question'], issueId: 'issue-gst' }),
    claim('application-definitive-after-and-inherited-subject',
      'The client may recover GST if the conditions are met, and is eligible today.',
      ['passage-1'], { kind: 'APPLICATION', factRefs: ['fact-current-question'], issueId: 'issue-gst' }),
    claim('application-definitive-after-so',
      'The client may recover GST if the conditions are met, so the client qualifies today.',
      ['passage-1'], { kind: 'APPLICATION', factRefs: ['fact-current-question'], issueId: 'issue-gst' }),
    claim('application-definitive-after-so-copular',
      'The client may recover GST if the conditions are met, so the client is eligible today.',
      ['passage-1'], { kind: 'APPLICATION', factRefs: ['fact-current-question'], issueId: 'issue-gst' }),
    claim('application-definitive-after-so-modal',
      'The client may recover GST if the conditions are met, so the client can recover GST today.',
      ['passage-1'], { kind: 'APPLICATION', factRefs: ['fact-current-question'], issueId: 'issue-gst' }),
    claim('application-categorical-after-condition',
      'The relevant facts remain unresolved. The client may recover GST if the applicable conditions hold; the client qualifies for recovery.',
      ['passage-1'], { kind: 'APPLICATION', factRefs: ['fact-current-question'], issueId: 'issue-gst' }),
    claim('application-categorical-after-conjunction',
      'The relevant facts remain unresolved. The client may recover GST if the applicable conditions hold, and the client qualifies for recovery.',
      ['passage-1'], { kind: 'APPLICATION', factRefs: ['fact-current-question'], issueId: 'issue-gst' })
  ];
  const positiveConditional = claim('application-condition-first-modal',
    'If the purchase is for taxable business use and the documentary conditions are met, the client may recover the input tax.',
    ['passage-1'], { kind: 'APPLICATION', factRefs: ['fact-current-question'], issueId: 'issue-gst' });
  const positiveEpistemicConditional = claim('application-epistemic-condition-first-modal',
    'Eligibility cannot be confirmed. If the purchase is for taxable business use and documentary conditions are met, the client may recover input tax.',
    ['passage-1'], { kind: 'APPLICATION', factRefs: ['fact-current-question'], issueId: 'issue-gst' });
  const positiveCanConditional = claim('application-condition-first-can',
    'If the purchase is for taxable business use and documentary conditions are met, the client can recover the input tax.',
    ['passage-1'], { kind: 'APPLICATION', factRefs: ['fact-current-question'], issueId: 'issue-gst' });
  const positiveNegativeUnless = claim('application-negative-unless',
    'The client is not eligible unless the missing business purpose is confirmed.',
    ['passage-1'], { kind: 'APPLICATION', factRefs: ['fact-current-question'], issueId: 'issue-gst' });
  const conditionalClaimIds = new Set([
    positiveConditional.id, positiveEpistemicConditional.id, positiveCanConditional.id, positiveNegativeUnless.id
  ]);
  const scripted = scriptedCall(({ system, prompt }) => {
    const packet = packetFrom(prompt);
    return { claims: [claim('rule-kept', supportedRule), positiveConditional, positiveEpistemicConditional,
      positiveCanConditional, positiveNegativeUnless, ...definitiveApplications] };
  }, ({ prompt }) => {
    const packet = JSON.parse(prompt);
    return { verdicts: packet.claims.map(item => ({
      claimId: item.claimId, support: 'SUPPORTED',
      claimType: conditionalClaimIds.has(item.claimId) ? 'CONDITIONAL_APPLICATION' : 'DEFINITIVE_APPLICATION'
    })) };
  });
  const result = await tryGenerateGroundedSynthesis(makeInput(), { call: scripted.call });
  assert.ok(result);
  assert.match(result.messageText, /Regulations 26 and 27 generally disallow/);
  assert.match(result.messageText, /If the purchase is for taxable business use and the documentary conditions are met, the client may recover the input tax/,
    'a relevant condition-first modal outcome remains available without an added unresolved-facts warning');
  assert.match(result.messageText, /Eligibility cannot be confirmed\. If the purchase is for taxable business use and documentary conditions are met, the client may recover input tax/,
    'a concise epistemic caveat followed by the relevant conditional outcome remains usable');
  assert.match(result.messageText, /If the purchase is for taxable business use and documentary conditions are met, the client can recover the input tax/,
    'ordinary condition-first can wording remains usable');
  assert.match(result.messageText, /The client is not eligible unless the missing business purpose is confirmed/,
    'a negative eligibility statement remains conditional when it is explicitly linked to the missing fact');
  for (const unsafe of definitiveApplications) {
    assert.ok(!result.messageText.includes(unsafe.text),
      'a caveat later in the sentence or an unrelated condition cannot make a categorical application conditional');
  }
  assert.ok(result.verification.withheldClaimIds.length >= definitiveApplications.length,
    'the deterministic conditional wording guard withholds categorical applications');
}

{
  const claimText = 'The client may recover GST if the conditions are met, and therefore is eligible today.';
  const exactRule = claim('conditional-bypass-rule', supportedRule);
  const caseApplication = claim('conditional-bypass-application', claimText, ['passage-1'], {
    kind: 'APPLICATION', factRefs: ['fact-current-question'], issueId: 'issue-gst'
  });
  const scripted = scriptedCall(() => ({ claims: [exactRule, caseApplication] }), ({ prompt }) => {
    const verificationPacket = JSON.parse(prompt);
    assert.equal(verificationPacket.claims.length, 1, 'the exact general rule needs no second semantic check');
    return { verdicts: [{
      claimId: caseApplication.id, support: 'SUPPORTED', claimType: 'DEFINITIVE_APPLICATION'
    }] };
  });
  const result = await tryGenerateGroundedSynthesis(makeInput(), { call: scripted.call });
  assert.ok(result);
  assert.ok(!result.messageText.includes(claimText),
    'a permissive support verdict cannot admit a definitive outcome while issue eligibility remains unresolved');
  assert.ok(result.messageText.includes(supportedRule));
  assert.equal(result.verification.claims.find(item => item.claimId === caseApplication.id)?.semanticSupport, 'SUPPORTED',
    'the semantic reviewer may agree with source meaning while the structured unresolved status still withholds the case outcome');
  assert.equal(result.verification.claims.find(item => item.claimId === caseApplication.id)?.outcome, 'WITHHELD');
}

{
  const cpfRecord = UNIFIED_SOURCE_REGISTRY.CPFA_SEC7_FIRST_SCHEDULE;
  assert.ok(cpfRecord?.sourceText, 'the test uses the admitted CPF Act First Schedule source');
  const quote = cpfRecord.sourceText;
  const issueId = 'issue-cpf-agc';
  const factOnlyConclusion = claim('fact-only-cpf-limitation',
    'Your employee is definitively exempt from all CPF contributions.', [], {
      kind: 'LIMITATION', factRefs: ['fact-current-question'], issueId
    });
  const context = {
    evidenceQuality: { eligibleRecords: [cpfRecord], missingFacts: [], targetDate: '2026-11-03' },
    authorityIssue: { authority: 'AGC', requestedConcepts: [], issue: {
      id: issueId, subject: 'CPF contribution eligibility for the employee', population: 'EMPLOYEE', domain: 'CPF_PAYROLL',
      governingAuthorities: ['AGC'], contextualAuthorities: [], operation: 'CHECK_ELIGIBILITY',
      mappedTopicIds: [], evidenceRequirement: 'CASE_FACTS', confidence: 1, status: 'MAPPED'
    } }
  };
  const scripted = scriptedCall(({ prompt }) => {
    const generationPacket = packetFrom(prompt);
    const passage = generationPacket.evidencePassages[0];
    return { claims: [claim('cpf-exact-source-rule', passage.completeAdmittedPassage, [passage.id], { issueId }), factOnlyConclusion] };
  }, ({ prompt }) => {
    const verificationPacket = JSON.parse(prompt);
    assert.equal(verificationPacket.claims[0].citedPassages.length, 0,
      'fact-only LIMITATION text cannot borrow an uncited admitted passage');
    assert.equal(verificationPacket.claims[0].issue.operation, 'CHECK_ELIGIBILITY');
    return { verdicts: [{
      claimId: factOnlyConclusion.id, support: 'UNSUPPORTED', claimType: 'DEFINITIVE_APPLICATION'
    }] };
  });
  const result = await tryGenerateGroundedSynthesis(makeInput({
    noWorkstreams: true, context,
    query: 'Our employee asks whether they are exempt from CPF contributions.',
    claimVerification: { accepted: [{ recordId: cpfRecord.id, quote, text: quote,
      supportKind: 'EXACT_SOURCE_QUOTE', canonicalUrl: cpfRecord.canonicalSourceUrl }] },
    evidenceQuality: { eligibleRecords: [cpfRecord], missingFacts: [], targetDate: '2026-11-03' }
  }), { call: scripted.call });
  assert.ok(result);
  assert.ok(result.messageText.includes(cpfRecord.sourceText), 'the bounded verifier retains the admitted source rule');
  assert.ok(!result.messageText.includes(factOnlyConclusion.text),
    'a fact-only LIMITATION cannot assert statutory eligibility in an AGC fallback passage path');
  assert.equal(result.verification.semanticVerificationCalls, 1);
}

{
  const exactRule = claim('malformed-review-rule', supportedRule);
  const deceptiveLimitation = claim('malformed-review-limitation',
    'Input GST on a blocked private motor car purchase is always recoverable.', ['passage-1'], {
      kind: 'LIMITATION', issueId: 'issue-gst'
    });
  const malformedVerdicts = [
    {},
    { verdicts: [] },
    { verdicts: [{ claimId: 'unknown-claim', support: 'SUPPORTED', claimType: 'RULE' }] },
    { verdicts: [
      { claimId: deceptiveLimitation.id, support: 'SUPPORTED', claimType: 'RULE' },
      { claimId: deceptiveLimitation.id, support: 'SUPPORTED', claimType: 'RULE' }
    ] },
    { verdicts: [{ claimId: deceptiveLimitation.id, support: 'SUPPORTED', claimType: 'MAYBE' }] }
  ];
  for (const malformed of malformedVerdicts) {
    const scripted = scriptedCall(() => ({ claims: [exactRule, deceptiveLimitation] }), () => malformed);
    const result = await tryGenerateGroundedSynthesis(makeInput(), { call: scripted.call });
    assert.ok(result);
    assert.ok(!result.messageText.includes(deceptiveLimitation.text),
      'a missing, duplicate, unknown, or malformed semantic verdict fails closed');
    assert.ok(result.messageText.includes(supportedRule), 'an exact supported rule remains available after an invalid verdict');
    assert.ok(result.verification.withheldClaimIds.includes(deceptiveLimitation.id));
  }
  const failedReview = scriptedCall(() => ({ claims: [exactRule, deceptiveLimitation] }), () => {
    throw new Error('support verification unavailable');
  });
  const result = await tryGenerateGroundedSynthesis(makeInput(), { call: failedReview.call });
  assert.ok(result);
  assert.ok(!result.messageText.includes(deceptiveLimitation.text), 'support-check provider failures withhold selected claims');
  assert.ok(result.messageText.includes(supportedRule));
}

{
  const rule = claim('rule-kept', supportedRule);
  const invalidClaim = claim('invalid-support', 'A claim with an invented citation is not admitted.', ['unknown-passage-id']);
  const scripted = scriptedCall(() => ({ claims: [rule, invalidClaim] }));
  const result = await tryGenerateGroundedSynthesis(makeInput(), { call: scripted.call });
  assert.ok(result);
  assert.match(result.messageText, /Regulations 26 and 27 generally disallow/);
  assert.ok(!result.messageText.includes(invalidClaim.text));
  assert.deepEqual(result.verification.admittedClaimIds, ['rule-kept']);
  assert.deepEqual(result.verification.withheldClaimIds, ['invalid-support']);
  assert.equal(result.verification.claims[0]?.outcome, 'ADMITTED');
  assert.equal(result.verification.claims[0]?.admittedPassageIds[0], 'passage-1');
  assert.equal(result.verification.providerCalls, 1, 'a mixed valid/invalid answer uses one generation call');
}

{
  const scripted = scriptedCall(() => { throw new Error('429 rate limit secret provider response'); });
  await assert.rejects(tryGenerateGroundedSynthesis(makeInput(), { call: scripted.call }), error =>
    classifyAdvisoryFailure(error) === 'RATE_LIMIT' && !/secret provider response/.test(error.message));
  assert.equal(scripted.calls.length, 1, 'provider failures stop after the single synthesis attempt');
}

{
  const rejectedClaim = claim('only-rejected', 'This client qualifies for the GST recovery.', ['passage-1'], {
    kind: 'APPLICATION', factRefs: ['fact-current-question'], issueId: 'issue-gst'
  });
  const scripted = scriptedCall(() => ({ claims: [rejectedClaim] }));
  await assert.rejects(tryGenerateGroundedSynthesis(makeInput(), { call: scripted.call }), /no supportable claims/);
  assert.equal(scripted.calls.length, 2, 'a case application is semantically checked once before the answer is rejected');
}

{
  const issues = [
    makeIssue('issue-covered', { subject: 'input tax restriction' }),
    makeIssue('issue-uncovered', { withSource: false, subject: 'GST registration evidence', applicationReason: 'No admitted source established this requirement.' })
  ];
  const scripted = scriptedCall(({ system, prompt }) => {
    const packet = packetFrom(prompt);
    return { claims: [claim('covered-rule', supportedRule, ['passage-1'], { issueId: 'issue-covered' })] };
  });
  const result = await tryGenerateGroundedSynthesis(makeInput({ issues }), { call: scripted.call });
  assert.ok(result);
  assert.match(result.messageText, /Regulations 26 and 27 generally disallow/);
  assert.match(result.messageText, /available admitted evidence does not establish whether GST registration evidence applies to your circumstances/i);
  assert.match(scripted.calls[0].prompt, /"issueId":"issue-uncovered"/);
  assert.match(scripted.calls[0].prompt, /UNRESOLVED/);
}

{
  const input = makeInput();
  input.workstreams.issuePlan = {
    source: 'SEMANTIC_ISSUES', coverageEstablished: true, hasUnmappedResidual: false,
    issues: [
      { id: 'issue-gst', subject: 'input tax recovery eligibility', operation: 'CHECK_ELIGIBILITY', evidenceRequirement: 'AUTHORITATIVE_SOURCE_AND_CASE_FACTS' },
      { id: 'planned-registration', subject: 'GST registration filing duty', operation: 'FILING_REQUIREMENT', evidenceRequirement: 'AUTHORITATIVE_SOURCE' }
    ]
  };
  const scripted = scriptedCall(({ system, prompt }) => {
    const packet = packetFrom(prompt);
    return { claims: [claim('rule-only', supportedRule, ['passage-1'], { issueId: 'issue-gst' })] };
  });
  const result = await tryGenerateGroundedSynthesis(input, { call: scripted.call });
  assert.ok(result);
  assert.match(result.messageText, /The general rule is supported above; whether input tax recovery eligibility applies to your circumstances remains unresolved/,
    'a supported rule alone cannot answer a planned eligibility issue');
  assert.match(result.messageText, /available admitted evidence does not establish whether GST registration filing duty applies to your circumstances/,
    'an uncovered planned issue receives an explicit per-issue limitation');
  assert.match(scripted.calls[0].prompt, /planned-registration/,
    'planned issues without admitted passages remain visible to generation');
}

{
  const cpfFact = 'The CPF contribution month has not been provided.';
  const cpfGap = {
    issueId: 'issue-cpf', authority: 'CPF', domain: 'CPF_PAYROLL', subject: 'CPF contribution reporting month',
    operation: 'FILING_REQUIREMENT', stage: 'mapped', code: 'MISSING_FACT', reason: cpfFact
  };
  const gstIssue = makeIssue('issue-gst', { applicationStatus: 'VERIFIED' });
  const cpfIssue = {
    ...makeIssue('issue-cpf', { withSource: false, subject: 'CPF contribution reporting month', applicationStatus: 'UNRESOLVED', applicationReason: cpfFact }),
    population: 'EMPLOYER', domain: 'CPF_PAYROLL', operation: 'FILING_REQUIREMENT',
    evidenceRequirement: 'CASE_FACTS', governingAuthority: 'CPF', gaps: [cpfGap]
  };
  const scripted = scriptedCall(({ system, prompt }) => {
    const packet = packetFrom(prompt);
    return { claims: [claim('supported-gst-application', 'Input tax recovery for the stated blocked motor car expense is not available.', ['passage-1'], {
      kind: 'APPLICATION', factRefs: ['fact-current-question'], issueId: 'issue-gst'
    })] };
  });
  const result = await tryGenerateGroundedSynthesis(makeInput({
    query: 'Our company incurred GST on a motor car expense that falls within the blocked input tax category. Can it recover the input tax, and which CPF contribution month applies?',
    issues: [gstIssue, cpfIssue], workstreamGaps: [cpfGap],
    evidenceQuality: { eligibleRecords: [record], missingFacts: [cpfFact], targetDate: '2026-11-03' },
    context: { missingFacts: [cpfFact] }
  }), { call: scripted.call });
  assert.ok(result);
  assert.match(result.messageText, /Input tax recovery for the stated blocked motor car expense is not available/,
    'a CPF-specific missing fact does not force the verified GST issue to be conditional');
  assert.match(result.messageText, /CPF contribution reporting month/,
    'the unsupported CPF issue remains visible separately');
  assert.match(scripted.calls[0].prompt, /\[Issue issue-cpf\] The CPF contribution month has not been provided\./,
    'evidence-quality and contextual copies remain attached to their owning workstream issue');
  assert.doesNotMatch(scripted.calls[0].prompt, /Question-wide unresolved fact.*CPF contribution month/,
    'a fact already owned by an issue is not duplicated as a question-wide blocker');
}

{
  const mixedQuery = 'GST on blocked motor-car input tax expenses: can they be recovered? Also calculate CPF contributions on salary wages.';
  const classification = classifyQuestion(mixedQuery);
  const scopedCpfFact = 'CPF contribution period or wage month';
  assert.ok(classification.missingFacts.includes(scopedCpfFact), 'the real classifier produces the CPF period fact for this request');
  assert.ok(classification.missingFactDomains?.some(item => item.fact === scopedCpfFact && item.domain === 'CPF_PAYROLL'),
    'the classifier records the domain at the point the CPF fact is created');
  const gstIssue = makeIssue('issue-gst', { applicationStatus: 'VERIFIED' });
  const cpfIssue = {
    ...makeIssue('issue-cpf', { withSource: false, subject: 'CPF contribution reporting month', applicationStatus: 'UNRESOLVED' }),
    domain: 'CPF_PAYROLL', population: 'EMPLOYER', governingAuthority: 'CPF', evidenceRequirement: 'CASE_FACTS',
    gaps: [{ issueId: 'issue-cpf', authority: 'CPF', domain: 'CPF_PAYROLL', subject: 'CPF contribution reporting month',
      operation: 'FILING_REQUIREMENT', stage: 'retrievalAttempted', code: 'MISSING_FACT',
      reason: 'CPF payroll details and the applicable reporting period remain unresolved.' }]
  };
  const issuePlanIssues = [
    { id: 'issue-gst', subject: gstIssue.subject, operation: gstIssue.operation, evidenceRequirement: gstIssue.evidenceRequirement,
      domain: gstIssue.domain, population: gstIssue.population, governingAuthorities: ['IRAS'] },
    { id: 'issue-cpf', subject: cpfIssue.subject, operation: cpfIssue.operation, evidenceRequirement: cpfIssue.evidenceRequirement,
      domain: cpfIssue.domain, population: cpfIssue.population, governingAuthorities: ['CPF'] }
  ];
  const currentContext = {
    classification, requestCompletenessContext: createRequestCompletenessContext(mixedQuery),
    missingFacts: [scopedCpfFact], assumptions: [], userFacts: [], primaryEvidence: [record], officialGuidance: [], curatedSummaries: [],
    applicationRules: [], currentInformationRequired: false,
    evidenceQuality: { eligibleRecords: [record], missingFacts: [scopedCpfFact], targetDate: '2026-11-03', status: 'SUFFICIENT', uncoveredTopicIds: [] }
  };
  const scripted = scriptedCall(({ prompt }) => {
    const packet = packetFrom(prompt);
    return { claims: [claim('independent-gst-application', 'GST input tax recovery for the stated blocked motor-car expense is unavailable.',
      ['passage-1'], { kind: 'APPLICATION', factRefs: ['fact-current-question'], issueId: 'issue-gst' })] };
  }, ({ prompt }) => {
    const packet = packetFrom(prompt);
    return { verdicts: packet.claims.map(item => ({ claimId: item.claimId, support: 'SUPPORTED', claimType: 'DEFINITIVE_APPLICATION' })) };
  });
  const inputOptions = { query: mixedQuery, issues: [gstIssue, cpfIssue], issuePlanIssues,
    evidenceQuality: { eligibleRecords: [record], missingFacts: [scopedCpfFact], targetDate: '2026-11-03' }, context: currentContext };
  const currentInput = makeInput(inputOptions);
  const result = await tryGenerateGroundedSynthesis(currentInput, { call: scripted.call });
  const generationPacket = packetFrom(scripted.calls[0].prompt);
  const packet = packetFrom(scripted.calls[1].prompt);
  assert.ok(result.messageText.includes('GST input tax recovery for the stated blocked motor-car expense is unavailable.'),
    'a differently worded CPF workstream gap does not suppress the verified GST conclusion');
  assert.deepEqual(packet.claims[0].questionWideUnresolvedFacts, [], 'the source-tagged CPF fact is issue-owned, not global');
  assert.ok(generationPacket.missingFactsAndEvidenceGaps.some(gap => gap.startsWith('[Issue issue-cpf]') && gap.includes(scopedCpfFact)),
    'the generation packet retains the CPF fact under the explicit validated CPF issue ID');
  assert.equal(packet.claims[0].mustRemainConditional, false, 'the CPF issue gap leaves the independent GST claim definitive');

  const globalControl = async (overrides = {}) => {
    const controlScript = scriptedCall(({ prompt }) => {
      packetFrom(prompt);
      return { claims: [claim('gst-with-control-gap', 'The client qualifies for this expense recovery.', ['passage-1'], {
        kind: 'APPLICATION', factRefs: ['fact-current-question'], issueId: 'issue-gst'
      })] };
    }, ({ prompt }) => {
      const controlPacket = packetFrom(prompt);
      return { verdicts: controlPacket.claims.map(item => ({ claimId: item.claimId, support: 'SUPPORTED', claimType: 'DEFINITIVE_APPLICATION' })) };
    });
    await assert.rejects(
      tryGenerateGroundedSynthesis(makeInput({ ...inputOptions, ...overrides }), { call: controlScript.call }),
      /produced no supportable claims/,
      'a conservative global gap must reject the unsupported definitive application'
    );
    return packetFrom(controlScript.calls[0].prompt).missingFactsAndEvidenceGaps;
  };
  const staleQueryPacket = await globalControl({ workstreamQuery: 'a different query' });
  assert.ok(staleQueryPacket.some(gap => gap.startsWith('[Question-wide unresolved fact]') && gap.includes(scopedCpfFact)),
    'a stale workstream query cannot validate an issue owner');
  const staleContextPacket = await globalControl({ context: { ...currentContext, requestCompletenessContext: createRequestCompletenessContext('different query') } });
  assert.ok(staleContextPacket.some(gap => gap.startsWith('[Question-wide unresolved fact]') && gap.includes(scopedCpfFact)),
    'a request-completeness context bound to another query cannot validate ownership');
  const malformedDomainPacket = await globalControl({ context: { ...currentContext,
    classification: { ...classification, missingFactDomains: [{ fact: scopedCpfFact, domain: 'UNKNOWN' }] } } });
  assert.ok(malformedDomainPacket.some(gap => gap.startsWith('[Question-wide unresolved fact]') && gap.includes(scopedCpfFact)),
    'a classifier ownership tag that does not resolve to an admitted issue remains global');
  const staleIssueIdPacket = await globalControl({ issuePlanIssues: issuePlanIssues.map(issue =>
    issue.id === 'issue-cpf' ? { ...issue, id: 'stale-cpf-issue-id' } : issue) });
  assert.ok(staleIssueIdPacket.some(gap => gap.startsWith('[Question-wide unresolved fact]') && gap.includes(scopedCpfFact)),
    'an issue ID that does not match the current evidence workstream cannot own a missing fact');
  const ambiguousPlanPacket = await globalControl({ issuePlanIssues: [...issuePlanIssues,
    { ...issuePlanIssues[1], id: 'issue-cpf-second', subject: 'CPF contribution month for another employee' }] });
  assert.ok(ambiguousPlanPacket.some(gap => gap.startsWith('[Question-wide unresolved fact]') && gap.includes(scopedCpfFact)),
    'multiple matching issue domains remain ambiguous and keep their missing facts question-wide');
}

{
  const cpfIssue = {
    ...makeIssue('issue-cpf', { withSource: false, subject: 'CPF contribution month',
      operation: 'FILING_REQUIREMENT', evidenceRequirement: 'CASE_FACTS', applicationStatus: 'UNRESOLVED' }),
    domain: 'CPF_PAYROLL', population: 'EMPLOYEE', governingAuthority: 'CPF'
  };
  let verificationPacket;
  const scripted = scriptedCall(({ prompt }) => {
    const packet = packetFrom(prompt);
    const passage = packet.evidencePassages.find(item => item.issueId === 'issue-gst');
    assert.ok(passage);
    return { claims: [claim('resolved-gst-issue', 'The admitted rule applies to this stated GST purchase.',
      [passage.id], { kind: 'APPLICATION', factRefs: ['fact-current-question'], issueId: 'issue-gst' })] };
  }, ({ prompt }) => {
    verificationPacket = packetFrom(prompt);
    return { verdicts: verificationPacket.claims.map(item => ({
      claimId: item.claimId, support: 'SUPPORTED', claimType: 'DEFINITIVE_APPLICATION'
    })) };
  });
  const result = await tryGenerateGroundedSynthesis(makeInput({
    issues: [makeIssue('issue-gst', { applicationStatus: 'VERIFIED' }), cpfIssue], workstreamGaps: [
      { issueId: 'issue-cpf', authority: 'CPF', domain: 'CPF_PAYROLL', subject: 'CPF contribution month',
        operation: 'FILING_REQUIREMENT', stage: 'mapped', code: 'MISSING_FACT',
        reason: 'The CPF contribution month has not been provided.' }
    ],
    evidenceQuality: { eligibleRecords: [record], missingFacts: [], targetDate: '2026-11-03' },
    context: { missingFacts: ['The CPF contribution month has not been provided.'] }
  }), { call: scripted.call });
  assert.ok(result.messageText.includes('The admitted rule applies to this stated GST purchase.'),
    'an unowned fact for a second issue does not suppress the resolved GST conclusion');
  assert.equal(verificationPacket.claims[0].mustRemainConditional, false,
    'a validated CPF ownership link keeps its issue gap from making the GST issue conditional');
  assert.deepEqual(verificationPacket.claims[0].questionWideUnresolvedFacts,
    [], 'an explicitly issue-owned fact is not also presented as a question-wide unresolved fact');
  assert.match(result.messageText, /available admitted evidence does not establish whether CPF contribution month applies to your circumstances/,
    'the separately unresolved CPF issue remains visible');
}

{
  const contextualIssue = {
    id: 'context-gst', subject: 'GST input tax recovery', population: 'COMPANY', domain: 'IRAS_GST',
    operation: 'CHECK_ELIGIBILITY', evidenceRequirement: 'AUTHORITATIVE_SOURCE_AND_CASE_FACTS', status: 'MAPPED',
    governingAuthorities: ['IRAS'], contextualAuthorities: []
  };
  const scripted = scriptedCall(({ prompt }) => {
    const packet = packetFrom(prompt);
    const passage = packet.evidencePassages.find(item => item.issueId === 'context-gst');
    assert.ok(passage, 'the context-only passage retains its validated issue owner');
      return { claims: [
        claim('context-only-rule', supportedRule, [passage.id], { kind: 'RULE', issueId: 'context-gst' }),
        claim('context-only-application', 'The client may be eligible if the applicable requirements are met.',
          [passage.id], { kind: 'APPLICATION', factRefs: ['fact-current-question'], issueId: 'context-gst' })
      ] };
  }, ({ prompt }) => {
    const packet = packetFrom(prompt);
    assert.equal(packet.claims[0].issue.issueId, 'context-gst');
    assert.equal(packet.claims.length, 1, 'the exact admitted source quotation remains on deterministic validation');
    assert.equal(packet.claims[0].mustRemainConditional, true,
      'a mapped context-only issue lacks an affirmative application determination');
    return { verdicts: packet.claims.map(item => ({
      claimId: item.claimId, support: 'SUPPORTED', claimType: 'CONDITIONAL_APPLICATION'
    })) };
  });
  const result = await tryGenerateGroundedSynthesis(makeInput({
    noWorkstreams: true,
    claimVerification: { accepted: [sourceClaim], rejected: [] },
    evidenceQuality: { eligibleRecords: [record], missingFacts: [], targetDate: '2026-11-03' },
    context: {
      missingFacts: [],
      evidenceQuality: { eligibleRecords: [record], missingFacts: [], targetDate: '2026-11-03', status: 'SUFFICIENT', uncoveredTopicIds: [] },
      authorityIssue: { authority: 'IRAS', issue: contextualIssue, requestedConcepts: [] }
    }
  }), { call: scripted.call });
  assert.ok(result.messageText.includes(supportedRule),
    'a context-only source rule remains usable without a matching workstream issue');
  assert.ok(result.messageText.includes('The client may be eligible if the applicable requirements are met.'),
    'a context-only application remains explicitly conditional without an affirmative case determination');
}

{
  const scripted = scriptedCall(({ system, prompt }) => {
    const packet = packetFrom(prompt);
    return { claims: [
      claim('supported-rule', supportedRule),
      claim('application-with-global-gap', 'The client qualifies for this expense recovery.', ['passage-1'], {
        kind: 'APPLICATION', factRefs: ['fact-current-question'], issueId: 'issue-gst'
      })
    ] };
  });
  const result = await tryGenerateGroundedSynthesis(makeInput({
    issues: [makeIssue('issue-gst', { applicationStatus: 'VERIFIED' })],
    evidenceQuality: { eligibleRecords: [record], missingFacts: [], targetDate: '2026-11-03' },
    context: { missingFacts: ['The purchase purpose remains unclear.'] }
  }), { call: scripted.call });
  assert.ok(result);
  assert.ok(!result.messageText.includes('The client qualifies for this expense recovery.'),
    'a material fact without an identifiable owning issue remains a conservative question-wide blocker');
  assert.match(result.messageText, /purchase purpose remains unclear/);
}

{
  const cpfIssue = {
    ...makeIssue('issue-cpf', { withSource: false, subject: 'CPF contribution reporting month',
      operation: 'FILING_REQUIREMENT', evidenceRequirement: 'CASE_FACTS', applicationStatus: 'UNRESOLVED' }),
    domain: 'CPF_PAYROLL', population: 'EMPLOYER', governingAuthority: 'CPF', gaps: []
  };
  const scripted = scriptedCall(() => ({ claims: [
    claim('supported-multi-rule', supportedRule),
    claim('application-with-unowned-multi-gap', 'The client qualifies for this input tax recovery.', ['passage-1'], {
      kind: 'APPLICATION', factRefs: ['fact-current-question'], issueId: 'issue-gst'
    })
  ] }), ({ prompt }) => {
    const packet = packetFrom(prompt);
    assert.equal(packet.claims.length, 1, 'only the application claim requires semantic verification');
    assert.equal(packet.claims[0].mustRemainConditional, true,
      'an unassigned fact blocks definitive application even when the request contains multiple issues');
    assert.deepEqual(packet.claims[0].questionWideUnresolvedFacts, ['The purchase purpose remains unclear.']);
    return { verdicts: packet.claims.map(item => ({
      claimId: item.claimId, support: 'SUPPORTED', claimType: 'DEFINITIVE_APPLICATION'
    })) };
  });
  const result = await tryGenerateGroundedSynthesis(makeInput({
    query: 'Can our client recover GST input tax on an office expense, and which CPF contribution month applies?',
    issues: [makeIssue('issue-gst', { applicationStatus: 'VERIFIED' }), cpfIssue],
    evidenceQuality: { eligibleRecords: [record], missingFacts: [], targetDate: '2026-11-03' },
    context: { missingFacts: ['The purchase purpose remains unclear.'] }
  }), { call: scripted.call });
  assert.ok(result);
  assert.ok(!result.messageText.includes('The client qualifies for this input tax recovery.'),
    'an unowned multi-issue gap withholds the otherwise supported definitive application');
  assert.match(result.messageText, /The purchase purpose remains unclear/);
}

{
  const scripted = scriptedCall(({ system, prompt }) => {
    const packet = packetFrom(prompt);
    const gap = packet.trustedDeterministicOutputs.find(output => output.kind === 'EVIDENCE_GAP');
    return { claims: [
      claim('gap-as-rule', 'Regulations 26 and 27 generally disallow input tax recovery.', [gap.id], { issueId: 'issue-gst' }),
      claim('gap-limitation', 'The purchase facts still do not establish whether the recovery conditions are met.', [gap.id], {
        kind: 'LIMITATION', issueId: 'issue-gst'
      }),
      claim('source-backed-rule', supportedRule, ['passage-1'], { issueId: 'issue-gst' })
    ] };
  });
  const result = await tryGenerateGroundedSynthesis(makeInput(), { call: scripted.call });
  assert.ok(result);
  assert.ok(!result.messageText.includes('gap-as-rule'));
  assert.match(result.messageText, /purchase facts still do not establish/,
    'an admitted evidence-gap marker can support a scoped limitation');
  assert.ok(result.verification.withheldClaimIds.includes('gap-as-rule'),
    'a rule supported only by an evidence-gap marker is deterministically withheld');
}

{
  const issues = [makeIssue('issue-one'), makeIssue('issue-two', { targetDate: '2019-01-01' })];
  const scripted = scriptedCall(({ system }) => {
    return { claims: [claim('cross-scope', 'The rule applies across both issues.', ['passage-2'], { issueId: 'issue-one' })] };
  });
  await assert.rejects(tryGenerateGroundedSynthesis(makeInput({ issues }), { call: scripted.call }), /no supportable claims/);
  assert.equal(scripted.calls.length, 1, 'a claim cannot borrow an admitted quote from a different issue or date scope');
}

{
  const calculation = { netAmount: 1000, rate: 0.09, outputTax: 90, invoiceTotal: 1090, currency: 'SGD', sourceRecordId: record.id, effectiveDate: '2026-11-03' };
  const groups = [{ isBalanced: true, isHypothetical: false, title: 'Existing expense', eventDate: '2026-11-03', totalDebit: 100, totalCredit: 100, lines: [] }];
  const scenarioState = { scenarioType: 'EXPENSE', directGroups: groups, missingFacts: [], missingFields: [], isComplete: true };
  const before = structuredClone(scenarioState);
  const scripted = scriptedCall(({ system, prompt }) => {
    const packet = packetFrom(prompt);
    const calcOutput = packet.trustedDeterministicOutputs.find(output => output.kind === 'GST_CALCULATION');
    return { claims: [claim('wrong-number', 'The calculated GST is SGD 999.00.', ['passage-1', calcOutput.id])] };
  });
  await assert.rejects(tryGenerateGroundedSynthesis(makeInput({ calculation, scenarioState }), { call: scripted.call }), /no supportable claims/);
  assert.deepEqual(scenarioState, before, 'synthesis cannot mutate scenario facts or balanced journal state');
}

{
  const parsed = await parseAccountingQuery(
    'On 22/10/2026, buy office equipment for SGD 1,250 and pay the full amount immediately from the business bank account. No GST applies.',
    null
  );
  const calculated = calculateDoubleEntries(parsed, 'SFRS_I');
  const directGroups = structuredClone(calculated.groups);
  assert.equal(directGroups.length, 1);
  assert.equal(directGroups[0].isBalanced, true);
  assert.deepEqual(directGroups[0].lines.map(line => [line.accountName, line.debit, line.credit]), [
    ['Office Equipment', 1250, 0], ['Cash at Bank', 0, 1250]
  ]);
  const scenarioState = { ...parsed, directGroups };
  const before = JSON.stringify(scenarioState.directGroups);
  const accountingNarrative = 'The office equipment is recognized as an asset at its acquisition cost, and the related payment reduces cash at bank.';
  const scripted = scriptedCall(({ system, prompt }) => {
    const packet = packetFrom(prompt);
    const journalOutput = packet.trustedDeterministicOutputs.find(output => output.kind === 'VALIDATED_JOURNAL');
    return { claims: [
      claim('gst-rule', supportedRule),
      claim('accounting-narrative', accountingNarrative, [journalOutput.id], { kind: 'ACCOUNTING' })
    ] };
  });
  const result = await tryGenerateGroundedSynthesis(makeInput({ scenarioState }), { call: scripted.call });
  assert.ok(result);
  assert.ok(result.messageText.includes(accountingNarrative), 'engine-backed accounting discussion remains in the complete answer');
  assert.deepEqual(JSON.stringify(scenarioState.directGroups), before, 'accepted synthesis preserves the existing journal byte-for-byte');
  assert.deepEqual(directGroups[0].lines.map(line => [line.accountName, line.debit, line.credit]), [
    ['Office Equipment', 1250, 0], ['Cash at Bank', 0, 1250]
  ]);

  const accountingIssueInput = makeInput({ scenarioState });
  accountingIssueInput.workstreams.issuePlan = {
    source: 'SEMANTIC_ISSUES', coverageEstablished: true, hasUnmappedResidual: false,
    issues: [{ id: 'issue-accounting', subject: 'financial accounting treatment', domain: 'ACCOUNTING',
      operation: 'DETERMINE_TREATMENT', evidenceRequirement: 'AUTHORITATIVE_SOURCE_AND_CASE_FACTS' }]
  };
  const accountingIssueCall = scriptedCall(({ system, prompt }) => {
    const packet = packetFrom(prompt);
    const journalOutput = packet.trustedDeterministicOutputs.find(output => output.kind === 'VALIDATED_JOURNAL');
    return { claims: [claim('accounting-issue-covered', accountingNarrative, [journalOutput.id], {
      kind: 'ACCOUNTING', issueId: 'issue-accounting'
    })] };
  });
  const accountingIssueResult = await tryGenerateGroundedSynthesis(accountingIssueInput, { call: accountingIssueCall.call });
  assert.ok(accountingIssueResult.messageText.includes(accountingNarrative));
  assert.doesNotMatch(accountingIssueResult.messageText, /financial accounting treatment.*remains unresolved/i,
    'a supported issue-scoped accounting conclusion satisfies an accounting treatment request');

  let inspectedJournalSummary;
  const mixedSummaryCall = scriptedCall(({ prompt }) => {
    const packet = packetFrom(prompt);
    const output = packet.trustedDeterministicOutputs.find(item => item.kind === 'VALIDATED_JOURNAL');
    assert.ok(output?.accountingSummary, 'the validated engine journal supplies its bounded accounting summary');
    assert.doesNotMatch(output.accountingSummary, /Office Equipment|Cash at Bank|Existing balanced journal group/i,
      'the exempt summary excludes account names, group labels, and free text');
    inspectedJournalSummary = output.accountingSummary;
    return { claims: [
      claim('statutory-paraphrase', 'Input tax cannot be recovered for an expense that falls within the cited blocked categories.', ['passage-1']),
      claim('exact-journal-summary', output.accountingSummary, [output.id], { kind: 'ACCOUNTING' })
    ] };
  }, ({ prompt }) => {
    const packet = packetFrom(prompt);
    assert.deepEqual(packet.claims.map(item => item.claimId), ['statutory-paraphrase'],
      'the faithful deterministic journal summary skips semantic review while the statutory paraphrase is checked');
    return { verdicts: [{ claimId: 'statutory-paraphrase', support: 'SUPPORTED', claimType: 'RULE' }] };
  });
  const mixedSummaryResult = await tryGenerateGroundedSynthesis(makeInput({ scenarioState }), { call: mixedSummaryCall.call });
  assert.ok(mixedSummaryResult.messageText.includes(inspectedJournalSummary),
    'the exact validated accounting summary survives the numeric and posting guards');
  assert.equal(mixedSummaryCall.calls.length, 2, 'only the statutory claim reaches the existing batch verifier');

  const summaryOnlyCall = scriptedCall(({ prompt }) => {
    const packet = packetFrom(prompt);
    const output = packet.trustedDeterministicOutputs.find(item => item.kind === 'VALIDATED_JOURNAL');
    return { claims: [claim('summary-only', output.accountingSummary, [output.id], { kind: 'ACCOUNTING' })] };
  });
  const summaryOnlyResult = await tryGenerateGroundedSynthesis(makeInput({ scenarioState }), { call: summaryOnlyCall.call });
  assert.ok(summaryOnlyResult.messageText.includes(inspectedJournalSummary));
  assert.equal(summaryOnlyCall.calls.length, 1, 'a packet containing only the faithful deterministic summary needs no semantic call');

  const appendedStatutoryCall = scriptedCall(({ prompt }) => {
    const packet = packetFrom(prompt);
    const output = packet.trustedDeterministicOutputs.find(item => item.kind === 'VALIDATED_JOURNAL');
    return { claims: [
      claim('valid-summary', output.accountingSummary, [output.id], { kind: 'ACCOUNTING' }),
      claim('appended-statutory-assertion', `${output.accountingSummary} The expense also qualifies for GST input tax recovery.`, [output.id], { kind: 'ACCOUNTING' })
    ] };
  }, ({ prompt }) => {
    const packet = packetFrom(prompt);
    assert.deepEqual(packet.claims.map(item => item.claimId), ['appended-statutory-assertion'],
      'appending a statutory conclusion removes the claim from the exact-content exemption');
    return { verdicts: [{ claimId: 'appended-statutory-assertion', support: 'UNSUPPORTED', claimType: 'DEFINITIVE_APPLICATION' }] };
  });
  const appendedResult = await tryGenerateGroundedSynthesis(makeInput({ scenarioState }), { call: appendedStatutoryCall.call });
  assert.ok(appendedResult.messageText.includes(inspectedJournalSummary), 'the exact summary remains independently available');
  assert.doesNotMatch(appendedResult.messageText, /also qualifies for GST input tax recovery/i,
    'a statutory assertion appended to the summary is withheld');
  assert.ok(appendedResult.verification.withheldClaimIds.includes('appended-statutory-assertion'));

  for (const alteredSummary of [
    inspectedJournalSummary.replace('SGD 1,250', 'SGD 1,251'),
    inspectedJournalSummary.replace('SGD 1,250', 'USD 1,250')
  ]) {
    const mismatchedCall = scriptedCall(({ prompt }) => {
      const packet = packetFrom(prompt);
      const output = packet.trustedDeterministicOutputs.find(item => item.kind === 'VALIDATED_JOURNAL');
      return { claims: [claim('mismatched-journal-summary', alteredSummary, [output.id], { kind: 'ACCOUNTING' })] };
    });
    await assert.rejects(tryGenerateGroundedSynthesis(makeInput({ scenarioState }), { call: mismatchedCall.call }), /no supportable claims/);
  }

  const untrustedJournalVariants = [
    ['AI_PROPOSED', {}], ['CONDITIONAL', {}], [undefined, {}],
    ['DETERMINISTIC', { isHypothetical: true }],
    ['DETERMINISTIC', { totalDebit: 0 }],
    ['DETERMINISTIC', { totalDebit: 1250.01 }],
    ['DETERMINISTIC', { lines: [] }]
  ];
  for (const [authorityStatus, overrides] of untrustedJournalVariants) {
    let packetOutputs = [];
    const candidateGroup = { ...directGroups[0], ...overrides, authorityStatus };
    const scriptedCandidate = scriptedCall(({ system, prompt }) => {
      const packet = packetFrom(prompt);
      packetOutputs = packet.trustedDeterministicOutputs;
      return { claims: [claim('source-rule', supportedRule)] };
    });
    await tryGenerateGroundedSynthesis(makeInput({ scenarioState: { ...scenarioState, directGroups: [candidateGroup] } }), {
      call: scriptedCandidate.call
    });
    assert.ok(!packetOutputs.some(output => output.kind === 'VALIDATED_JOURNAL'),
      `journal with authority ${String(authorityStatus)} and integrity overrides ${JSON.stringify(overrides)} is not trusted`);
  }
}

{
  const rateClaimCall = scriptedCall(() => ({ claims: [claim('invented-rate', 'The GST rate is 99%.')] }));
  await assert.rejects(tryGenerateGroundedSynthesis(makeInput(), { call: rateClaimCall.call }), /no supportable claims/);
  assert.equal(rateClaimCall.calls.length, 1, 'an unsupported statutory rate is rejected by deterministic source-provenance checks');
}

{
  for (const [id, text, kind] of [
    ['fullwidth-rate', 'The GST rate is ９９％.', 'RULE'],
    ['arabic-rate', 'The GST rate is ٩٩٪.', 'RULE'],
    ['limitation-rate', 'The GST rate is 99%.', 'LIMITATION']
  ]) {
    const scripted = scriptedCall(() => ({ claims: [claim(id, text, ['passage-1'], { kind })] }));
    await assert.rejects(tryGenerateGroundedSynthesis(makeInput(), { call: scripted.call }), /no supportable claims/);
    assert.equal(scripted.calls.length, 1, `${id} cannot bypass the numeric source guard`);
  }

  const factualLimitation = 'As stated in your question, the supplier invoice dated 30/10/2026 has no tax invoice attached. The recovery conditions cannot yet be checked.';
  const scripted = scriptedCall(({ system, prompt }) => {
    const packet = packetFrom(prompt);
    return { claims: [claim('fact-limitation', factualLimitation, ['passage-1'], {
      kind: 'LIMITATION', factRefs: ['fact-current-question']
    })] };
  });
  const result = await tryGenerateGroundedSynthesis(makeInput({
    query: 'The supplier invoice dated 30/10/2026 has no tax invoice attached. Can input tax be recovered?'
  }), { call: scripted.call });
  assert.ok(result);
  assert.ok(result.messageText.includes(factualLimitation), 'a limitation may repeat numeric facts cited from the current question');
}

{
  const queryWithRate = 'Is 26% the GST input tax rate for this expense?';
  const issue = makeIssue('issue-gst', { applicationStatus: 'VERIFIED' });
  const scripted = scriptedCall(({ system, prompt }) => {
    const packet = packetFrom(prompt);
    return { claims: [
      claim('number-reused-as-rate', 'The GST input tax rate for this expense is 26%.', ['passage-1'], {
        kind: 'APPLICATION', factRefs: ['fact-current-question'], issueId: 'issue-gst'
      }),
      claim('number-source-control', supportedRule)
    ] };
  });
  const result = await tryGenerateGroundedSynthesis(makeInput({ query: queryWithRate, issues: [issue] }), { call: scripted.call });
  assert.ok(result);
  assert.doesNotMatch(result.messageText, /input tax rate for this expense is 26%/,
    'a provision number and the same number in the question do not establish a statutory rate');
  assert.ok(result.verification.withheldClaimIds.includes('number-reused-as-rate'),
    'the mismatched number meaning is rejected by deterministic source-provenance checks');
}

{
  const corporateRateRecord = UNIFIED_SOURCE_REGISTRY.ITA_SUTE_PTE_TAX_EXEMPTION;
  assert.ok(corporateRateRecord, 'a separately scoped corporate tax rate source is registered');
  const corporateRateQuote = corporateRateRecord.sourceText.match(/[^.!?]+[.!?]/)?.[0]?.trim() || corporateRateRecord.sourceText.trim();
  const issue = makeIssue('issue-gst', { applicationStatus: 'VERIFIED' });
  issue.sources = [record, corporateRateRecord];
  issue.verifiedClaims = [sourceClaim, {
    recordId: corporateRateRecord.id, quote: corporateRateQuote, text: corporateRateQuote,
    supportKind: 'EXACT_SOURCE_QUOTE', canonicalUrl: corporateRateRecord.canonicalSourceUrl
  }];
  const scripted = scriptedCall(({ system, prompt }) => {
    const packet = packetFrom(prompt);
    return { claims: [
      claim('neighboring-tax-rate', 'The GST input tax rate is 17%.', ['passage-1', 'passage-2'], {
        kind: 'APPLICATION', factRefs: ['fact-current-question'], issueId: 'issue-gst'
      }),
      claim('number-source-control', supportedRule)
    ] };
  });
  const result = await tryGenerateGroundedSynthesis(makeInput({
    query: 'Does the GST input tax rate equal 17% for this expense?', issues: [issue]
  }), { call: scripted.call });
  assert.ok(result);
  assert.doesNotMatch(result.messageText, /GST input tax rate is 17%/,
    'a 17% corporate income tax rate in a neighbouring source sentence cannot establish a GST rate');
}

{
  const calculation = { netAmount: 1000, rate: 0.09, outputTax: 90, invoiceTotal: 1090, currency: 'SGD', sourceRecordId: record.id, effectiveDate: '2026-11-03' };
  const issue = makeIssue('issue-gst', { applicationStatus: 'VERIFIED' });
  const scripted = scriptedCall(({ system, prompt }) => {
    const packet = packetFrom(prompt);
    const output = packet.trustedDeterministicOutputs.find(item => item.kind === 'GST_CALCULATION');
    return { claims: [
      claim('wrong-field-amount', 'The invoice total is SGD 90.00.', ['passage-1', output.id], { issueId: 'issue-gst' }),
      claim('number-source-control', supportedRule)
    ] };
  });
  const result = await tryGenerateGroundedSynthesis(makeInput({ calculation, issues: [issue] }), { call: scripted.call });
  assert.ok(result);
  assert.doesNotMatch(result.messageText, /invoice total is SGD 90/,
    'an amount in a deterministic calculation cannot support a different amount field');
}

{
  const calculation = { netAmount: 1000, rate: 0.09, outputTax: 90, invoiceTotal: 1090, currency: 'SGD', sourceRecordId: record.id, effectiveDate: '2026-11-03' };
  for (const text of [
    'The output tax shows the invoice total is SGD 90.',
    'The output tax is not SGD 90.'
  ]) {
    const scripted = scriptedCall(({ system, prompt }) => {
      const packet = packetFrom(prompt);
      const output = packet.trustedDeterministicOutputs.find(item => item.kind === 'GST_CALCULATION');
      return { claims: [claim(`ambiguous-output-${text.length}`, text, ['passage-1', output.id])] };
    });
    await assert.rejects(tryGenerateGroundedSynthesis(makeInput({ calculation }), { call: scripted.call }), /no supportable claims/);
    assert.equal(scripted.calls.length, 1, 'mixed-field or negated deterministic output narration is rejected after one generation');
  }
}

{
  const issue = makeIssue('issue-gst');
  const scripted = scriptedCall(({ system, prompt }) => {
    const packet = packetFrom(prompt);
    return { claims: [claim('provision-with-unrelated-number', 'Regulation 26 establishes a GST rate of 17%.')] };
  });
  await assert.rejects(tryGenerateGroundedSynthesis(makeInput({ issues: [issue] }), { call: scripted.call }), /no supportable claims/);
  assert.equal(scripted.calls.length, 1, 'a known legal provision reference cannot bypass numeric validation');
}

{
  const scripted = scriptedCall(({ system, prompt }) => {
    const packet = packetFrom(prompt);
    return { claims: [claim('invented-subclauses', 'Regulations 26(a) and 27(z) permit unconditional recovery.')] };
  });
  await assert.rejects(tryGenerateGroundedSynthesis(makeInput(), { call: scripted.call }), /no supportable claims/);
  assert.equal(scripted.calls.length, 1, 'provision alphabetic subclauses must match exactly');
}

{
  const calculation = { netAmount: 1000, rate: 0.09, outputTax: 90, invoiceTotal: 1090, currency: 'SGD', sourceRecordId: record.id, effectiveDate: '2026-11-03' };
  const issue = makeIssue('issue-gst', { applicationStatus: 'VERIFIED' });
  for (const text of ['The output tax is SGD -90.', 'As stated in your question, the payroll date is 30/10/2026.']) {
    const scripted = scriptedCall(({ system, prompt }) => {
      const packet = packetFrom(prompt);
      const output = packet.trustedDeterministicOutputs.find(item => item.kind === 'GST_CALCULATION');
      return { claims: [
        claim(`mismatched-number-${text.length}`, text, ['passage-1', output.id], {
          kind: 'LIMITATION', factRefs: ['fact-current-question'], issueId: 'issue-gst'
        }),
        claim('number-source-control', supportedRule)
      ] };
    });
    const result = await tryGenerateGroundedSynthesis(makeInput({
      calculation, issues: [issue], query: 'The supplier invoice dated 30/10/2026 has no tax invoice attached.'
    }), { call: scripted.call });
    assert.ok(result);
    assert.ok(!result.messageText.includes(text), 'a changed sign or relabelled date cannot reuse a matching numeric value');
  }
}

{
  const calculation = { netAmount: 1000, rate: 0.09, outputTax: 90, invoiceTotal: 1090, currency: 'SGD', sourceRecordId: record.id, effectiveDate: '2026-11-03' };
  const issue = makeIssue('issue-gst', { applicationStatus: 'VERIFIED' });
  const scripted = scriptedCall(({ system, prompt }) => {
    const packet = packetFrom(prompt);
    const output = packet.trustedDeterministicOutputs.find(item => item.kind === 'GST_CALCULATION');
    return { claims: [claim('matching-output-field', 'The output tax is SGD 90.', ['passage-1', output.id], {
      kind: 'APPLICATION', factRefs: ['fact-current-question'], issueId: 'issue-gst'
    })] };
  });
  const result = await tryGenerateGroundedSynthesis(makeInput({
    calculation, issues: [issue], evidenceQuality: { eligibleRecords: [record], missingFacts: [], targetDate: '2026-11-03' }
  }), { call: scripted.call });
  assert.ok(result);
  assert.match(result.messageText, /output tax is SGD 90/i,
    'an amount stated with its matching deterministic field and currency remains usable');
}

{
  for (const text of [
    'Debit expense and credit cash for the purchase.',
    'Dr Expense; Cr Bank.',
    'Debiting expense and crediting bank posts the purchase.',
    'Dr Expense 100; Cr Bank 100.',
    'Record this by debiting inventory and crediting trade payables.',
    'The posting is Dr Inventory, Cr Trade Payables.',
    'The treatment is to Dr Inventory / Cr Trade Payables.',
    'For the expense, Dr Office Supplies and Cr Bank.',
    'Debit inventory.',
    'Credit trade payables.',
    'Post Dr Inventory.'
  ]) {
    const scripted = scriptedCall(() => ({ claims: [claim('journal', text)] }));
    await assert.rejects(tryGenerateGroundedSynthesis(makeInput(), { call: scripted.call }), /no supportable claims/);
    assert.equal(scripted.calls.length, 1, `journal instructions are deterministically blocked: ${text}`);
  }

  for (const text of ['The supplier issued a tax credit note.', 'The trial balance includes a credit balance.']) {
    const scripted = scriptedCall(() => ({ claims: [claim('credit-narrative', text)] }));
    const result = await tryGenerateGroundedSynthesis(makeInput(), { call: scripted.call });
    assert.ok(result.messageText.includes(text), `journal guard does not block a credit-note or credit-balance explanation: ${text}`);
  }
}

{
  const malformed = scriptedCall(() => '{"claims":[');
  await assert.rejects(tryGenerateGroundedSynthesis(makeInput(), { call: malformed.call }), error =>
    /response contract/.test(error.message) && !/verdicts/.test(error.message) &&
    classifyAdvisoryFailure(error) === 'INVALID_RESPONSE');

  const failures = [
    { error: new Error('401 unauthorized; secret credential and provider body must not leak'), category: 'AUTH_OR_PERMISSION' },
    { error: new Error('429 rate limit; secret credential and provider body must not leak'), category: 'RATE_LIMIT' },
    { error: Object.assign(new Error('This operation was aborted; secret credential and provider body must not leak'), { name: 'AbortError' }), category: 'TIMEOUT' }
  ];
  for (const failure of failures) {
    const unsafeTransport = scriptedCall(() => { throw failure.error; });
    await assert.rejects(tryGenerateGroundedSynthesis(makeInput(), { call: unsafeTransport.call }), error =>
      classifyAdvisoryFailure(error) === failure.category && !/credential|provider body/.test(error.message));
  }
}

{
  const providerCases = [
    { activeProvider: 'openai', openai: { apiKey: 'mock-openai-token', model: 'gpt-test' }, gemini: {}, azure: {} },
    { activeProvider: 'gemini', openai: {}, gemini: { apiKey: 'mock-gemini-token', model: 'gemini-test' }, azure: {} },
    { activeProvider: 'azure', openai: {}, gemini: {}, azure: { apiKey: 'mock-azure-token', endpoint: 'https://mock.example', deploymentName: 'azure-test' } }
  ];
  for (const activeProvider of providerCases) {
    const scripted = scriptedCall(() => ({ claims: [claim('rule', supportedRule)] }));
    const result = await tryGenerateGroundedSynthesis(makeInput({ provider: activeProvider }), { call: scripted.call });
    assert.ok(result);
    assert.ok(scripted.calls.every(call => call.provider === activeProvider), 'generation uses the active provider settings');
    assert.equal(result.verification.providerCalls, 1);
  }
}

function makeCapturedOfficialSource({ id, authority, title, url, quote }) {
  return {
    id,
    authority,
    authorityName: authority,
    sourceAuthority: authority,
    sourcePublisher: authority === 'MOM' ? 'Ministry of Manpower' : 'ACRA',
    documentTitle: title,
    legalOrStandardInstrument: title,
    paragraphOrSection: title,
    officialSourceUrl: url,
    canonicalSourceUrl: url,
    urlVerificationStatus: 'VERIFIED',
    sourceText: quote,
    sourceType: 'OFFICIAL_GUIDANCE',
    evidenceTier: 'OFFICIAL_GUIDANCE'
  };
}

function makeNumericSourceIssue({ issueId, authority, domain, subject, sourceQuotes }) {
  const sources = sourceQuotes.map(item => item.source);
  return {
    ...makeIssue(issueId, { subject }),
    subject,
    population: authority === 'MOM' ? 'EMPLOYER' : 'COMPANY',
    domain,
    operation: 'EXPLAIN_RULE',
    evidenceRequirement: 'AUTHORITATIVE_SOURCE',
    governingAuthority: authority,
    evidenceStatus: 'VERIFIED',
    applicationStatus: 'NOT_REQUIRED',
    applicationReason: '',
    verifiedClaims: sourceQuotes.map(({ source, quote }) => ({
      recordId: source.id,
      quote,
      text: quote,
      supportKind: 'EXACT_SOURCE_QUOTE',
      canonicalUrl: source.canonicalSourceUrl,
      sourceAdmissionOptions: { targetDate: '2026-11-08' }
    })),
    sources,
    gaps: []
  };
}

const ADMITTED_DOCUMENT_TEST_DATE = '2026-11-09';

function makeAdmittedNarrativeSource({ id, authority, title, url, domain, topicId, sourceText }) {
  const documentHash = createHash('sha256').update(sourceText).digest('hex');
  return {
    ...makeCapturedOfficialSource({ id, authority, title, url, quote: sourceText }),
    authorityName: authority === 'CPF' ? 'Central Provident Fund Board (CPF Board)' : 'Ministry of Manpower',
    sourcePublisher: authority === 'CPF' ? 'Central Provident Fund Board (CPF Board)' : 'Ministry of Manpower',
    legalOrStandardInstrument: authority + ' official guidance',
    standardOrActCode: authority + ' official guidance',
    paragraphOrSection: title,
    sourceText, domain, jurisdiction: 'Singapore', tags: [topicId],
    sourceStatus: 'NEEDS_REVIEW', sourceType: 'OFFICIAL_GUIDANCE', evidenceTier: 'OFFICIAL_GUIDANCE',
    isVerbatimText: false, provenance: 'LIVE_EXTERNAL', lifecycleState: 'CANDIDATE',
    verificationMethod: 'LIVE_OFFICIAL_TOPIC_VERIFIED', extractionStatus: 'PARTIAL',
    retrievedAt: ADMITTED_DOCUMENT_TEST_DATE + 'T13:58:45.677Z',
    documentHash, contentHash: documentHash, recordRole: 'DISCOVERED_EVIDENCE', groundingEligible: true,
    urlVerificationStatus: 'VERIFIED', urlVerifiedDate: ADMITTED_DOCUMENT_TEST_DATE,
    sourceLocator: { heading: title, document: title, sourceType: 'HTML' }
  };
}

function makeCurrentAdmittedNarrativeIssue({ issueId, authority, domain, subject, population, source, legacyQuote }) {
  const issue = makeNumericSourceIssue({
    issueId, authority, domain, subject,
    sourceQuotes: legacyQuote ? [{ source, quote: legacyQuote }] : []
  });
  issue.population = population;
  issue.sourceSections = authority === 'CPF' ? ['CPF_CONTRIBUTIONS'] : ['MOM_EMPLOYMENT'];
  issue.lifecycle = { requested: true, mapped: true, retrievalAttempted: true, evidenceFound: true, admitted: true, verified: true, covered: true };
  issue.admittedDocumentSources = [source];
  issue.admittedDocumentTargetDate = ADMITTED_DOCUMENT_TEST_DATE;
  issue.admittedDocumentContexts = [{
    recordId: source.id, documentHash: source.documentHash, canonicalUrl: source.canonicalSourceUrl,
    targetDate: ADMITTED_DOCUMENT_TEST_DATE, completeness: 'COMPLETE', sourceText: source.sourceText
  }];
  issue.verifiedClaims = issue.verifiedClaims.map(value => ({
    ...value, sourceAdmissionOptions: { targetDate: ADMITTED_DOCUMENT_TEST_DATE }
  }));
  const passed = [{ predicate: 'capturedAdmissionCheck', passed: true }];
  issue.admissionDiagnostics = {
    retrievalTraceStatus: 'AVAILABLE', retrievalTraceOptionalMetadataStatus: 'VALID',
    candidates: [{
      recordId: source.id, documentHash: source.documentHash, admitted: true,
      provenancePaths: {
        reviewedLocal: { attempted: false, admitted: false, predicates: [] },
        liveExternal: { attempted: true, admitted: true, predicates: passed },
        managedDocument: { attempted: false, admitted: false, predicates: [] }
      },
      predicates: passed,
      topics: [{ topicId: source.tags[0], predicates: passed, admitted: true }]
    }]
  };
  return issue;
}

function plannedNarrativeIssue(issue) {
  return {
    id: issue.issueId, subject: issue.subject, population: issue.population, domain: issue.domain,
    operation: issue.operation, governingAuthorities: [issue.governingAuthority],
    contextualAuthorities: [], mappedTopicIds: issue.admittedDocumentSources?.[0]?.tags?.[0]
      ? [issue.admittedDocumentSources[0].tags[0]] : [],
    evidenceRequirement: issue.evidenceRequirement, confidence: 0.95, status: 'MAPPED'
  };
}

async function runNumericProductionClaims({ query: queryText, issues, candidates }) {
  let admittedPassages;
  const scripted = scriptedCall(({ prompt }) => {
    const packet = packetFrom(prompt);
    admittedPassages = packet.evidencePassages;
    return {
      claims: candidates.map(({ id, text, issueId, supportPassageIds }) => {
        const passageIds = supportPassageIds ?? admittedPassages
          .filter(passage => passage.issueId === issueId)
          .map(passage => passage.id);
        return claim(id, text, passageIds, { issueId, kind: 'RULE' });
      })
    };
  });
  const sources = issues.flatMap(issue => issue.sources);
  const result = await tryGenerateGroundedSynthesis(makeInput({
    query: queryText,
    issues,
    evidenceQuality: { eligibleRecords: sources, missingFacts: [], targetDate: '2026-11-08' }
  }), { call: scripted.call });
  return { result, scripted, admittedPassages };
}

{
  const momUrl = 'https://www.mom.gov.sg/employment-practices/hours-of-work-overtime-and-rest-days';
  const momQuote = 'For overtime work, your employer must pay you at least 1.5 times the hourly basic rate of pay. Payment must be made within 14 days after the last day of the salary period.';
  const momSource = makeCapturedOfficialSource({
    id: 'LIVE_TOPIC_mom_overtime_e44be0399cf0',
    authority: 'MOM',
    title: 'Hours of work, overtime and rest day',
    url: momUrl,
    quote: momQuote
  });
  const issue = makeNumericSourceIssue({
    issueId: 'issue-mom-captured',
    authority: 'MOM',
    domain: 'MOM_EMPLOYMENT',
    subject: 'overtime rate and payment deadline',
    sourceQuotes: [{ source: momSource, quote: momQuote }]
  });
  const capturedCandidate = 'For overtime work, your employer must pay you at least 1.5 times the hourly basic rate of pay, and payment must be made within 14 days after the last day of the salary period according to the Ministry of Manpower Hours of work, overtime and rest day guidance.';
  const { result, admittedPassages } = await runNumericProductionClaims({
    query: 'What overtime rate applies and when must it be paid?',
    issues: [issue],
    candidates: [{ id: 'captured-mom-c1', text: capturedCandidate, issueId: issue.issueId }]
  });
  assert.equal(admittedPassages[0]?.id, 'passage-1');
  assert.equal(admittedPassages[0]?.completeAdmittedPassage, momQuote);

  assert.ok(result.messageText.includes('1.5 times the hourly basic rate of pay'));
  assert.ok(result.messageText.includes('within 14 days after the last day of the salary period'));
  assert.deepEqual(result.verification.admittedClaimIds, ['captured-mom-c1']);
  assert.deepEqual(result.verification.claims.find(item => item.claimId === 'captured-mom-c1')?.admittedPassageIds, ['passage-1']);
  assert.ok(result.officialAnswerLinks.some(link => link.url === momUrl),
    'the captured MOM rule retains its verified canonical citation through production synthesis');
}

{
  const momUrl = 'https://www.mom.gov.sg/employment-practices/hours-of-work-overtime-and-rest-days';
  const quote = 'Overtime is payable at 1.5 times the hourly rate. Overtime is due within 14 days after the salary period.';
  const source = makeCapturedOfficialSource({
    id: 'LIVE_TOPIC_mom_overtime_scope_control',
    authority: 'MOM',
    title: 'Hours of work, overtime and rest day',
    url: momUrl,
    quote
  });
  const issue = makeNumericSourceIssue({
    issueId: 'issue-mom-coordination',
    authority: 'MOM',
    domain: 'MOM_EMPLOYMENT',
    subject: 'overtime rate and payment deadline',
    sourceQuotes: [{ source, quote }]
  });
  const variants = [
    'Overtime is payable at 1.5 times the hourly rate and is due within 14 days after the salary period.',
    'Overtime is payable at 1.5 times the hourly rate, and is due within 14 days after the salary period.'
  ];
  const { result, admittedPassages } = await runNumericProductionClaims({
    query: 'State the overtime rate and payment deadline.',
    issues: [issue],
    candidates: variants.map((text, index) => ({
      id: 'coordinated-mom-' + (index ? 'comma' : 'plain'),
      text,
      issueId: issue.issueId
    }))
  });
  assert.equal(admittedPassages[0]?.completeAdmittedPassage, quote);
  assert.deepEqual(result.verification.admittedClaimIds, ['coordinated-mom-plain', 'coordinated-mom-comma'],
    'both punctuation forms keep the rate and deadline predicates in their own numeric contexts');
  assert.ok(variants.every(text => result.messageText.includes(text)));
  assert.ok(result.officialAnswerLinks.some(link => link.url === momUrl));
}

{
  const momUrl = 'https://www.mom.gov.sg/employment-practices/hours-of-work-overtime-and-rest-days';
  const claimText = 'Payment within one hundred and twenty days must be made after the salary period.';
  const sourceTwenty = 'Payment within 20 days must be made after the salary period.';
  const sourceOneTwenty = 'Payment within 120 days must be made after the salary period.';
  const sourceTwentyRecord = makeCapturedOfficialSource({
    id: 'LIVE_TOPIC_mom_payment_deadline_twenty',
    authority: 'MOM',
    title: 'Salary payment deadline',
    url: momUrl,
    quote: sourceTwenty
  });
  const sourceOneTwentyRecord = makeCapturedOfficialSource({
    id: 'LIVE_TOPIC_mom_payment_deadline_one_twenty',
    authority: 'MOM',
    title: 'Salary payment deadline',
    url: momUrl,
    quote: sourceOneTwenty
  });
  const issueTwenty = makeNumericSourceIssue({
    issueId: 'issue-payment-twenty',
    authority: 'MOM',
    domain: 'MOM_EMPLOYMENT',
    subject: 'twenty-day salary payment deadline',
    sourceQuotes: [{ source: sourceTwentyRecord, quote: sourceTwenty }]
  });
  const issueOneTwenty = makeNumericSourceIssue({
    issueId: 'issue-payment-one-twenty',
    authority: 'MOM',
    domain: 'MOM_EMPLOYMENT',
    subject: 'one-hundred-and-twenty-day salary payment deadline',
    sourceQuotes: [{ source: sourceOneTwentyRecord, quote: sourceOneTwenty }]
  });
  const { result } = await runNumericProductionClaims({
    query: 'What is the salary payment deadline in the two cases?',
    issues: [issueTwenty, issueOneTwenty],
    candidates: [
      { id: 'worded-120-vs-source-20', text: claimText, issueId: issueTwenty.issueId },
      { id: 'worded-120-vs-source-120', text: claimText, issueId: issueOneTwenty.issueId }
    ]
  });
  assert.ok(result.verification.withheldClaimIds.includes('worded-120-vs-source-20'),
    'splitting at the number word “and” cannot turn 120 days into a supported 20-day claim');
  assert.ok(result.verification.admittedClaimIds.includes('worded-120-vs-source-120'),
    'the complete number-word span still matches the equivalent 120-day source assertion');
}
{
  const acraUrl = 'https://www.acra.gov.sg/register/business/registering-different-business-structures/local-company/appointing-company-directors-other-key-officers/';
  const acraQuote = 'A secretary must be appointed within six months of successful registration. The position cannot be empty for more than six months. Otherwise, the director may face a fine of up to $1,000.';
  const acraHash = '481b564b5411d2e05eab4267d940f7d76a898c9121854ae360a345a68533662b';
  const sourceLocator = {
    heading: 'Step 4.3: Choosing company directors & other key officers | Accounting and Corporate Regulatory Authority',
    document: 'Step 4.3: Choosing company directors & other key officers | Accounting and Corporate Regulatory Authority',
    sourceType: 'HTML'
  };
  const acraSource = {
    ...makeCapturedOfficialSource({
      id: 'LIVE_TOPIC_acra_company-secretary_481b564b5411',
      authority: 'ACRA',
      title: 'Step 4.3: Choosing company directors & other key officers | Accounting and Corporate Regulatory Authority',
      url: acraUrl,
      quote: acraQuote
    }),
    domain: 'ACRA_CORP',
    provenance: 'LIVE_EXTERNAL',
    documentHash: acraHash,
    contentHash: acraHash,
    sourceLocator
  };
  const differentRecord = { ...acraSource, id: 'LIVE_TOPIC_acra_company-secretary_other-record' };
  const revisedRecord = {
    ...acraSource,
    documentHash: 'a'.repeat(64),
    contentHash: 'a'.repeat(64)
  };
  const differentQuote = 'The position cannot be empty for more than six months.';
  const sourceIssue = makeNumericSourceIssue({
    issueId: 'issue_a395c45b',
    authority: 'ACRA',
    domain: 'ACRA_CORPORATE',
    subject: 'sole director acting as company secretary eligibility',
    sourceQuotes: [{ source: acraSource, quote: acraQuote }]
  });
  const targetIssue = makeNumericSourceIssue({
    issueId: 'issue_64e23e2c',
    authority: 'ACRA',
    domain: 'ACRA_CORPORATE',
    subject: 'company secretary appointment procedure and filing requirements',
    sourceQuotes: [{ source: acraSource, quote: acraQuote }]
  });
  const differentQuoteIssue = makeNumericSourceIssue({
    issueId: 'issue-different-quote',
    authority: 'ACRA',
    domain: 'ACRA_CORPORATE',
    subject: 'company secretary membership requirement',
    sourceQuotes: [{ source: acraSource, quote: differentQuote }]
  });
  const differentRecordIssue = makeNumericSourceIssue({
    issueId: 'issue-different-record',
    authority: 'ACRA',
    domain: 'ACRA_CORPORATE',
    subject: 'company secretary appointment procedure',
    sourceQuotes: [{ source: differentRecord, quote: acraQuote }]
  });
  const revisedIssue = makeNumericSourceIssue({
    issueId: 'issue-different-revision',
    authority: 'ACRA',
    domain: 'ACRA_CORPORATE',
    subject: 'company secretary appointment requirements',
    sourceQuotes: [{ source: revisedRecord, quote: acraQuote }]
  });
  const noCounterpartIssue = makeNumericSourceIssue({
    issueId: 'issue-no-counterpart',
    authority: 'ACRA',
    domain: 'ACRA_CORPORATE',
    subject: 'company secretary appointment requirements',
    sourceQuotes: []
  });
  const capturedCandidate = 'A secretary must be appointed within six months of successful registration, and the position cannot be empty for more than six months, otherwise the director may face a fine of up to $1,000.';
  const { result, admittedPassages, scripted } = await runNumericProductionClaims({
    query: 'When must a company appoint a secretary and how long may the office remain vacant?',
    issues: [sourceIssue, targetIssue, differentQuoteIssue, differentRecordIssue, revisedIssue, noCounterpartIssue],
    candidates: [
      { id: 'c4', text: capturedCandidate, issueId: targetIssue.issueId, supportPassageIds: ['passage-1'] },
      { id: 'c4-two-aliases', text: capturedCandidate, issueId: targetIssue.issueId, supportPassageIds: ['passage-1', 'passage-2'] },
      { id: 'duplicate-c4-support', text: capturedCandidate, issueId: targetIssue.issueId, supportPassageIds: ['passage-1', 'passage-1'] },
      { id: 'different-quote', text: capturedCandidate, issueId: differentQuoteIssue.issueId, supportPassageIds: ['passage-1'] },
      { id: 'different-record', text: capturedCandidate, issueId: differentRecordIssue.issueId, supportPassageIds: ['passage-1'] },
      { id: 'different-revision', text: capturedCandidate, issueId: revisedIssue.issueId, supportPassageIds: ['passage-1'] },
      { id: 'no-target-counterpart', text: capturedCandidate, issueId: noCounterpartIssue.issueId, supportPassageIds: ['passage-1'] }
    ]
  });
  assert.deepEqual(admittedPassages.map(passage => passage.id), ['passage-1', 'passage-2', 'passage-3', 'passage-4', 'passage-5']);
  assert.deepEqual(result.verification.admittedClaimIds, ['c4', 'c4-two-aliases']);
  assert.ok(result.verification.withheldClaimIds.includes('duplicate-c4-support'),
    'duplicate raw IDs remain invalid even though distinct aliases can canonicalize to one target');
  assert.deepEqual(result.verification.claims.find(item => item.claimId === 'c4-two-aliases')?.admittedPassageIds, ['passage-2'],
    'two distinct source IDs that both resolve to the same exact issue passage are safely deduplicated');
  assert.deepEqual(result.verification.claims.find(item => item.claimId === 'c4')?.admittedPassageIds, ['passage-2'],
    'the c4 support is canonicalized to the independently admitted passage in its explicit issue');
  const verificationCall = scripted.calls.find(call => call.system.startsWith('EVIDENCE_GROUNDED_SUPPORT_VERIFICATION'));
  assert.ok(verificationCall);
  const verificationPacket = packetFrom(verificationCall.prompt);
  assert.deepEqual(verificationPacket.claims.find(item => item.claimId === 'c4')?.citedPassages.map(passage => passage.id), ['passage-2'],
    'semantic verification receives the canonical target-issue passage ID');
  assert.ok(result.messageText.includes('fine of up to $1,000'));
  assert.ok(result.officialAnswerLinks.some(link => link.url === acraUrl),
    'the canonical target-issue passage retains the captured official ACRA citation');
  for (const claimId of ['duplicate-c4-support', 'different-quote', 'different-record', 'different-revision', 'no-target-counterpart']) {
    assert.ok(result.verification.withheldClaimIds.includes(claimId), claimId + ' cannot reuse a merely similar passage from another issue');
  }
}

{
  const acraUrl = 'https://www.acra.gov.sg/register/business/registering-different-business-structures/local-company/appointing-company-directors-other-key-officers/';
  const acraQuote = 'A secretary must be appointed within six months of successful registration. The position cannot be empty for more than six months. Otherwise, the director may face a fine of up to $1,000.';
  const acraSource = makeCapturedOfficialSource({
    id: 'LIVE_TOPIC_acra_company-secretary_481b564b5411',
    authority: 'ACRA',
    title: 'Choosing company directors and other key officers',
    url: acraUrl,
    quote: acraQuote
  });
  const issue = makeNumericSourceIssue({
    issueId: 'issue-acra-captured',
    authority: 'ACRA',
    domain: 'ACRA_CORPORATE',
    subject: 'company secretary appointment and vacancy requirements',
    sourceQuotes: [{ source: acraSource, quote: acraQuote }]
  });
  const capturedCandidate = 'A secretary must be appointed within six months of successful registration, and the position cannot be empty for more than six months, otherwise the director may face a fine of up to $1,000.';
  const { result, admittedPassages } = await runNumericProductionClaims({
    query: 'When must a company appoint a secretary and what is the vacancy limit?',
    issues: [issue],
    candidates: [{ id: 'captured-acra-c4', text: capturedCandidate, issueId: issue.issueId }]
  });
  assert.equal(admittedPassages[0]?.id, 'passage-1');
  assert.equal(admittedPassages[0]?.completeAdmittedPassage, acraQuote);
  assert.ok(result.messageText.includes('appointed within six months of successful registration'));
  assert.ok(result.messageText.includes('cannot be empty for more than six months'));
  assert.ok(result.messageText.includes('fine of up to $1,000'));
  assert.deepEqual(result.verification.admittedClaimIds, ['captured-acra-c4']);
  assert.deepEqual(result.verification.claims.find(item => item.claimId === 'captured-acra-c4')?.admittedPassageIds, ['passage-1']);
  assert.ok(result.officialAnswerLinks.some(link => link.url === acraUrl),
    'the captured ACRA rule retains its verified canonical citation through production synthesis');
}

{
  const momUrl = 'https://www.mom.gov.sg/employment-practices/hours-of-work-overtime-and-rest-days';
  const acraUrl = 'https://www.acra.gov.sg/register/business/registering-different-business-structures/local-company/appointing-company-directors-other-key-officers/';
  const momRate = 'Overtime work is paid at 1.5 times the hourly rate.';
  const momDeadline = 'Payment is due within 14 days after the salary period.';
  const unrelatedRule = 'A secretary must be appointed within six months of registration.';
  const momSourceOne = makeCapturedOfficialSource({
    id: 'LIVE_TOPIC_mom_overtime_rate_control',
    authority: 'MOM',
    title: 'Hours of work, overtime and rest day',
    url: momUrl,
    quote: momRate
  });
  const momSourceTwo = makeCapturedOfficialSource({
    id: 'LIVE_TOPIC_mom_overtime_deadline_control',
    authority: 'MOM',
    title: 'Hours of work, overtime and rest day',
    url: momUrl,
    quote: momDeadline
  });
  const acraSource = makeCapturedOfficialSource({
    id: 'LIVE_TOPIC_acra_company_secretary_control',
    authority: 'ACRA',
    title: 'Choosing company directors and other key officers',
    url: acraUrl,
    quote: unrelatedRule
  });
  const momIssue = makeNumericSourceIssue({
    issueId: 'issue-mom-split',
    authority: 'MOM',
    domain: 'MOM_EMPLOYMENT',
    subject: 'overtime rate and payment deadline',
    sourceQuotes: [
      { source: momSourceOne, quote: momRate },
      { source: momSourceTwo, quote: momDeadline }
    ]
  });
  const acraIssue = makeNumericSourceIssue({
    issueId: 'issue-acra-other',
    authority: 'ACRA',
    domain: 'ACRA_CORPORATE',
    subject: 'company secretary appointment',
    sourceQuotes: [{ source: acraSource, quote: unrelatedRule }]
  });
  const combinedOvertimeClaim = 'Overtime work is paid at 1.5 times the hourly rate and payment is due within 14 days after the salary period.';
  const { result, admittedPassages } = await runNumericProductionClaims({
    query: 'Explain the overtime rules and secretary appointment deadline.',
    issues: [momIssue, acraIssue],
    candidates: [
      { id: 'split-source-numbers', text: combinedOvertimeClaim, issueId: momIssue.issueId },
      { id: 'uncited-numeric-rule', text: combinedOvertimeClaim, issueId: momIssue.issueId, supportPassageIds: [] },
      {
        id: 'cross-issue-numeric-rule',
        text: 'Overtime work is paid at 1.5 times the hourly rate and a secretary must be appointed within six months of registration.',
        issueId: momIssue.issueId,
        supportPassageIds: ['passage-1', 'passage-3']
      },
      { id: 'unrelated-source-control', text: unrelatedRule, issueId: acraIssue.issueId }
    ]
  });
  assert.deepEqual(admittedPassages.map(passage => passage.id), ['passage-1', 'passage-2', 'passage-3']);
  assert.ok(result.messageText.includes(unrelatedRule), 'the independently cited unrelated source rule remains available');
  for (const claimId of ['split-source-numbers', 'uncited-numeric-rule', 'cross-issue-numeric-rule']) {
    assert.ok(result.verification.withheldClaimIds.includes(claimId), claimId + ' remains withheld by the production bundle validator');
  }
  assert.ok(result.verification.admittedClaimIds.includes('unrelated-source-control'));
  assert.ok(result.officialAnswerLinks.some(link => link.url === acraUrl));
}

{
  const queryText = 'Explain CPF contribution payment responsibility and the official overtime payment method.';
  const cpfLegacy = 'CPF contributions are payable on wages.';
  const cpfRemittance = 'You need to pay total CPF contributions (comprising of the employer and employee’s shares) to the CPF Board. You’re entitled to recover the employee’s share of CPF contributions when paying your employee’s wages for the month.';
  const cpfNote = 'Note: If your employee earns above $50 but not more than $500 per month, there is no employee’s share of CPF contributions. You will still need to pay the employer’s share of CPF contributions.';
  const cpfCsn = 'You need to have a CSN to submit CPF contributions.';
  const cpfTopic = 'iras-authority-query-issue-cpf-cpf-contribution-payment-responsibility';
  const cpfSource = makeAdmittedNarrativeSource({
    id: 'LIVE_TOPIC_iras-authority-query-issue-cpf-cpf-contribution-payment-responsibility_test',
    authority: 'CPF', title: 'CPFB | Employer obligations',
    url: 'https://www.cpf.gov.sg/employer/employer-obligations', domain: 'CPF_BOARD', topicId: cpfTopic,
    sourceText: [cpfLegacy, cpfRemittance, cpfNote, cpfCsn].join('\n\n')
  });
  const cpfIssue = makeCurrentAdmittedNarrativeIssue({
    issueId: 'issue-cpf-document-context', authority: 'CPF', domain: 'CPF_PAYROLL',
    subject: 'CPF contribution payment responsibility', population: 'EMPLOYER', source: cpfSource, legacyQuote: cpfLegacy
  });
  const momLegacy = 'Overtime work is all work in excess of the normal hours of work (excluding breaks).';
  const momRate = 'For overtime work, your employer must pay you at least 1.5 times the hourly basic rate of pay. Payment must be made within 14 days after the last day of the salary period.';
  const momTopic = 'mom_overtime';
  const momSource = makeAdmittedNarrativeSource({
    id: 'LIVE_TOPIC_mom_overtime_test', authority: 'MOM', title: 'Hours of work, overtime and rest day',
    url: 'https://www.mom.gov.sg/employment-practices/hours-of-work-overtime-and-rest-days',
    domain: 'MOM_EMPLOYMENT', topicId: momTopic, sourceText: [momLegacy, momRate].join('\n\n')
  });
  const momIssue = makeCurrentAdmittedNarrativeIssue({
    issueId: 'issue-mom-document-context', authority: 'MOM', domain: 'MOM_EMPLOYMENT',
    subject: 'overtime payment method and deadline', population: 'EMPLOYEE', source: momSource, legacyQuote: momLegacy
  });
  const irasIssue = makeNumericSourceIssue({
    issueId: 'issue-gst-legacy-claim-group', authority: 'IRAS', domain: 'IRAS_GST',
    subject: 'input tax recovery', sourceQuotes: []
  });
  irasIssue.population = 'BUSINESS';
  const issues = [cpfIssue, momIssue, irasIssue];
  const irasContextIssue = plannedNarrativeIssue(irasIssue);
  const legacyClaimContext = {
    evidenceQuality: { eligibleRecords: [record], missingFacts: [], targetDate: ADMITTED_DOCUMENT_TEST_DATE,
      status: 'SUFFICIENT', uncoveredTopicIds: [] },
    classification: classifyQuestion(queryText), userFacts: [], missingFacts: [], assumptions: [],
    primaryEvidence: [record], officialGuidance: [], curatedSummaries: [], applicationRules: [], currentInformationRequired: false,
    authorityIssue: { authority: 'IRAS', issue: irasContextIssue, requestedConcepts: [] }
  };
  const candidates = [
    { id: 'cpf-remittance', text: cpfRemittance, issueId: cpfIssue.issueId },
    { id: 'cpf-csn', text: cpfCsn, issueId: cpfIssue.issueId },
    { id: 'mom-overtime-payment', text: momRate, issueId: momIssue.issueId }
  ];
  let generationPacket;
  const scripted = scriptedCall(({ prompt }) => {
    generationPacket = packetFrom(prompt);
    return { claims: candidates.map(item => {
      const passage = generationPacket.evidencePassages.find(value => value.completeAdmittedPassage === item.text);
      assert.ok(passage, item.id + ' must be offered as a complete admitted source excerpt');
      return claim(item.id, item.text, [passage.id], { issueId: item.issueId, kind: 'RULE' });
    }) };
  }, ({ prompt }) => {
    const verification = packetFrom(prompt);
    return { verdicts: verification.claims.map(item => ({ claimId: item.claimId, support: 'SUPPORTED', claimType: 'RULE' })) };
  });
  const result = await tryGenerateGroundedSynthesis(makeInput({
    query: queryText, issues, issuePlanIssues: issues.map(plannedNarrativeIssue),
    claimVerification: { accepted: [sourceClaim], rejected: [] },
    context: legacyClaimContext,
    evidenceQuality: { eligibleRecords: [], missingFacts: [], targetDate: ADMITTED_DOCUMENT_TEST_DATE }
  }), { call: scripted.call });
  assert.ok(result);
  assert.deepEqual(generationPacket.evidencePassages.slice(0, 3).map(item => item.completeAdmittedPassage), [cpfLegacy, momLegacy, quote],
    'workstream and response-claim legacy passages keep their global order before all document excerpts');
  assert.deepEqual(generationPacket.evidencePassages.slice(0, 3).map(item => item.id), ['passage-1', 'passage-2', 'passage-3']);
  assert.equal(generationPacket.evidencePassages[3]?.id, 'passage-4');
  assert.equal(generationPacket.evidencePassages[3]?.completeAdmittedPassage, cpfRemittance,
    'the complete CPF employer-and-employee remittance and recovery paragraph reaches primary generation');
  assert.ok(generationPacket.evidencePassages.some(item => item.completeAdmittedPassage === momRate),
    'the complete MOM overtime rate and payroll timing paragraph reaches primary generation');
  const verificationCall = scripted.calls.find(item => item.system.startsWith('EVIDENCE_GROUNDED_SUPPORT_VERIFICATION'));
  assert.ok(verificationCall, 'exact document excerpts still use the existing batched support check');
  const verificationPacket = packetFrom(verificationCall.prompt);
  assert.equal(verificationPacket.claims.length, 3);
  assert.equal(verificationPacket.documentContexts.length, 2,
    'full context is included once per admitted document even when two claims cite the same CPF record');
  const cpfContext = verificationPacket.documentContexts.find(item => item.sourceRecordId === cpfSource.id);
  assert.ok(cpfContext?.fullSameDocumentContext.includes(cpfNote), 'same-document qualifications are available to support verification');
  const cpfClaims = verificationPacket.claims.filter(item => item.claimId.startsWith('cpf-'));
  assert.equal(new Set(cpfClaims.flatMap(item => item.documentContextRefs)).size, 1, 'both CPF claims reference the same single context record');
  assert.equal(result.verification.semanticVerificationCalls, 1);
  assert.equal(result.verification.providerCalls, 2);
  assert.deepEqual(result.verification.admittedClaimIds, ['cpf-remittance', 'cpf-csn', 'mom-overtime-payment']);
}

{
  const queryText = 'What is the employer responsible for paying to CPF Board?';
  const legacyQuote = 'Employers must pay CPF contributions to the CPF Board.';
  const documentOnlyQualification = 'The employer may recover the employee share when paying the employee wages for the month.';
  const source = makeAdmittedNarrativeSource({
    id: 'LIVE_TOPIC_cpf_missing_issue_plan_test', authority: 'CPF', title: 'CPFB | Employer obligations',
    url: 'https://www.cpf.gov.sg/employer/employer-obligations', domain: 'CPF_BOARD',
    topicId: 'cpf_contribution_rates', sourceText: [legacyQuote, documentOnlyQualification].join('\n\n')
  });
  const issue = makeCurrentAdmittedNarrativeIssue({
    issueId: 'issue-cpf-missing-plan', authority: 'CPF', domain: 'CPF_PAYROLL',
    subject: 'CPF employer payment responsibility', population: 'EMPLOYER', source, legacyQuote
  });

  for (const malformedPlan of ['missing issues array', 'missing issue plan']) {
    let generationPacket;
    let legacyPassage;
    let augmentationIncluded;
    const scripted = scriptedCall(({ prompt }) => {
      generationPacket = packetFrom(prompt);
      legacyPassage = generationPacket.evidencePassages.find(item =>
        item.issueId === issue.issueId && item.sourceRecordId === source.id && item.completeAdmittedPassage === legacyQuote);
      augmentationIncluded = generationPacket.evidencePassages.some(item =>
        item.completeAdmittedPassage === documentOnlyQualification);
      return { claims: legacyPassage ? [claim('legacy-cpf-responsibility', legacyQuote, [legacyPassage.id], {
        issueId: issue.issueId, kind: 'RULE'
      })] : [] };
    });
    const input = makeInput({
      query: queryText, issues: [issue], issuePlan: {},
      evidenceQuality: { eligibleRecords: [], missingFacts: [], targetDate: ADMITTED_DOCUMENT_TEST_DATE }
    });
    if (malformedPlan === 'missing issue plan') delete input.workstreams.issuePlan;
    const result = await tryGenerateGroundedSynthesis(input, { call: scripted.call });
    assert.ok(legacyPassage, `${malformedPlan}: the legacy verified passage remains available`);
    assert.equal(augmentationIncluded, false,
      `${malformedPlan}: malformed workstream planning disables full-document augmentation`);
    assert.ok(result, `${malformedPlan}: a legacy verified claim remains usable`);
    assert.match(result.messageText, /Employers must pay CPF contributions to the CPF Board/);
    assert.equal(scripted.calls.length, 1, `${malformedPlan}: the unchanged legacy quote stays on the normal single-call path`);
  }
}

{
  const queryText = 'How may an employer recover the employee share?';
  const excerpt = 'Employers may recover the employee’s share of CPF contributions.';
  const qualification = 'Recovery of the employee’s share may occur only when the employer pays the employee’s wages for the month.';
  const topic = 'cpf_contribution_rates';
  const source = makeAdmittedNarrativeSource({
    id: 'LIVE_TOPIC_cpf_recovery_context_test', authority: 'CPF', title: 'CPFB | Employer obligations',
    url: 'https://www.cpf.gov.sg/employer/employer-obligations', domain: 'CPF_BOARD', topicId: topic,
    sourceText: [excerpt, qualification].join('\n\n')
  });
  const issue = makeCurrentAdmittedNarrativeIssue({
    issueId: 'issue-cpf-context-qualification', authority: 'CPF', domain: 'CPF_PAYROLL',
    subject: 'CPF contribution recovery', population: 'EMPLOYER', source, legacyQuote: undefined
  });
  const claimText = 'Employers may recover the employee’s share after the monthly wages have already been paid.';
  const scripted = scriptedCall(({ prompt }) => {
    const packet = packetFrom(prompt);
    const passage = packet.evidencePassages.find(item => item.completeAdmittedPassage === excerpt);
    assert.ok(passage, 'the literal excerpt is admitted separately from its later qualification');
    return { claims: [claim('cpf-overbroad-recovery', claimText, [passage.id], { issueId: issue.issueId, kind: 'RULE' })] };
  }, ({ prompt }) => {
    const verification = packetFrom(prompt);
    const context = verification.documentContexts.find(item => item.sourceRecordId === source.id);
    assert.ok(context?.fullSameDocumentContext.includes(qualification));
    return { verdicts: verification.claims.map(item => ({ claimId: item.claimId, support: 'UNSUPPORTED', claimType: 'RULE' })) };
  });
  await assert.rejects(tryGenerateGroundedSynthesis(makeInput({
    query: queryText, issues: [issue], issuePlanIssues: [plannedNarrativeIssue(issue)],
    evidenceQuality: { eligibleRecords: [], missingFacts: [], targetDate: ADMITTED_DOCUMENT_TEST_DATE }
  }), { call: scripted.call }), /no supportable claims/);
  assert.equal(scripted.calls.length, 2, 'an overbroad claim against a literal document excerpt is withheld by the one support batch');
}

{
  const queryText = 'Explain the CPF recovery rule.';
  const excerpt = 'Employers may recover the employee’s share of CPF contributions.';
  const topic = 'cpf_contribution_rates';
  const source = makeAdmittedNarrativeSource({
    id: 'LIVE_TOPIC_cpf_malformed_verdict_test', authority: 'CPF', title: 'CPFB | Employer obligations',
    url: 'https://www.cpf.gov.sg/employer/employer-obligations', domain: 'CPF_BOARD', topicId: topic, sourceText: excerpt
  });
  const issue = makeCurrentAdmittedNarrativeIssue({
    issueId: 'issue-cpf-malformed-verdict', authority: 'CPF', domain: 'CPF_PAYROLL',
    subject: 'CPF contribution recovery', population: 'EMPLOYER', source, legacyQuote: undefined
  });
  const scripted = scriptedCall(({ prompt }) => {
    const packet = packetFrom(prompt);
    const passage = packet.evidencePassages.find(item => item.completeAdmittedPassage === excerpt);
    return { claims: [claim('cpf-malformed-verdict', excerpt, [passage.id], { issueId: issue.issueId, kind: 'RULE' })] };
  }, () => ({ verdicts: [{ claimId: 'cpf-malformed-verdict', support: 'SUPPORTED', claimType: 'RULE', extra: true }] }));
  await assert.rejects(tryGenerateGroundedSynthesis(makeInput({
    query: queryText, issues: [issue], issuePlanIssues: [plannedNarrativeIssue(issue)],
    evidenceQuality: { eligibleRecords: [], missingFacts: [], targetDate: ADMITTED_DOCUMENT_TEST_DATE }
  }), { call: scripted.call }), /no supportable claims/);
  assert.equal(scripted.calls.length, 2, 'a malformed semantic verdict leaves document-based claims unverified and withheld');
}

{
  const invalidCases = [
    ['wrong authority', (source, issue) => { source.authority = 'MOM'; }],
    ['wrong domain', (source, issue) => { source.domain = 'MOM_EMPLOYMENT'; }],
    ['wrong hash', (source, issue) => { source.documentHash = 'e'.repeat(64); }],
    ['not admitted', (source, issue) => { issue.admissionDiagnostics.candidates[0].admitted = false; }],
    ['missing candidate provenance', (source, issue) => { delete issue.admissionDiagnostics.candidates[0].provenancePaths; }],
    ['non HTML source', (source, issue) => { source.sourceLocator.sourceType = 'PDF'; }],
    ['missing complete context', (source, issue) => { delete issue.admittedDocumentContexts; }],
    ['context hash mismatch', (source, issue) => { issue.admittedDocumentContexts[0].documentHash = 'c'.repeat(64); }],
    ['context URL mismatch', (source, issue) => { issue.admittedDocumentContexts[0].canonicalUrl = 'https://www.cpf.gov.sg/other'; }],
    ['context date mismatch', (source, issue) => { issue.admittedDocumentContexts[0].targetDate = '2026-11-08'; }]
  ];
  for (const [label, mutate] of invalidCases) {
    const source = makeAdmittedNarrativeSource({
      id: 'LIVE_TOPIC_cpf_invalid_' + label.replace(/\W+/g, '_'), authority: 'CPF', title: 'CPFB | Employer obligations',
      url: 'https://www.cpf.gov.sg/employer/employer-obligations', domain: 'CPF_BOARD', topicId: 'cpf_contribution_rates',
      sourceText: 'Employers must pay CPF contributions.'
    });
    const issue = makeCurrentAdmittedNarrativeIssue({
      issueId: 'issue-cpf-invalid-' + label.replace(/\W+/g, '_'), authority: 'CPF', domain: 'CPF_PAYROLL',
      subject: 'CPF contribution obligation', population: 'EMPLOYER', source, legacyQuote: undefined
    });
    mutate(source, issue);
    const scripted = scriptedCall(() => ({ claims: [] }));
    const result = await tryGenerateGroundedSynthesis(makeInput({
      query: 'What does the CPF Board require?', issues: [issue], issuePlanIssues: [plannedNarrativeIssue(issue)],
      evidenceQuality: { eligibleRecords: [], missingFacts: [], targetDate: ADMITTED_DOCUMENT_TEST_DATE }
    }), { call: scripted.call });
    assert.equal(result, undefined, label + ' cannot add an admitted document passage');
    assert.equal(scripted.calls.length, 0, label + ' fails before any provider call');
  }
  const source = makeAdmittedNarrativeSource({
    id: 'LIVE_TOPIC_cpf_stale_query_test', authority: 'CPF', title: 'CPFB | Employer obligations',
    url: 'https://www.cpf.gov.sg/employer/employer-obligations', domain: 'CPF_BOARD', topicId: 'cpf_contribution_rates',
    sourceText: 'Employers must pay CPF contributions.'
  });
  const issue = makeCurrentAdmittedNarrativeIssue({
    issueId: 'issue-cpf-stale-query', authority: 'CPF', domain: 'CPF_PAYROLL',
    subject: 'CPF contribution obligation', population: 'EMPLOYER', source, legacyQuote: undefined
  });
  const stale = scriptedCall(() => ({ claims: [] }));
  const result = await tryGenerateGroundedSynthesis(makeInput({
    query: 'What does the CPF Board require?', workstreamQuery: 'A previous query',
    issues: [issue], issuePlanIssues: [plannedNarrativeIssue(issue)],
    evidenceQuality: { eligibleRecords: [], missingFacts: [], targetDate: ADMITTED_DOCUMENT_TEST_DATE }
  }), { call: stale.call });
  assert.equal(result, undefined, 'a prior query’s document admission cannot augment the current packet');
  assert.equal(stale.calls.length, 0);
}

console.log('PASS: evidence-grounded synthesis admission, deterministic guards, scoped gaps, and provider diagnostics');
