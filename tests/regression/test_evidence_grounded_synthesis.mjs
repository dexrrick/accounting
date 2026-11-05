import assert from 'node:assert/strict';
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
      issuePlan: { issues: options.issuePlanIssues || [] },
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
  assert.match(result.messageText, /applicability remains unresolved/i);
  assert.match(result.messageText, /purchase purpose was not provided/i);
  assert.equal(result.verification.claimValidation, 'DETERMINISTIC_PACKET_CHECKS');
  assert.equal(result.verification.sourceAdmission, 'EXISTING_PIPELINE_ADMITTED');
  assert.equal(result.verification.providerCalls, 1, 'an exact admitted rule quote stays on the single generation call');
  assert.equal(result.verification.providerAttempts, 1);
  assert.equal(result.verification.admittedClaimIds[0], 'rule-1');
  assert.ok(result.verification.providerElapsedMs >= 0);
  const generationPacket = packetFrom(scripted.calls[0].prompt);
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
  const scripted = scriptedCall(({ system, prompt }) => {
    const packet = packetFrom(prompt);
    return { claims: [goodRule, unconditional] };
  });
  const result = await tryGenerateGroundedSynthesis(makeInput(), { call: scripted.call });
  assert.ok(result);
  assert.match(result.messageText, /Regulations 26 and 27 generally disallow/);
  assert.match(result.messageText, /Some requested conclusions could not be supported/);
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
  assert.match(result.messageText, /Applicability remains unresolved for GST registration evidence\./i);
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
  assert.match(result.messageText, /Whether input tax recovery eligibility applies to your circumstances remains unresolved/,
    'a supported rule alone cannot answer a planned eligibility issue');
  assert.match(result.messageText, /Whether GST registration filing duty applies to your circumstances remains unresolved/,
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
    try {
      await tryGenerateGroundedSynthesis(makeInput({ ...inputOptions, ...overrides }), { call: controlScript.call });
    } catch (error) {
      assert.match(String(error), /produced no supportable claims/,
        'a conservative global gap withholds the unsupported definitive application');
    }
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
  assert.match(result.messageText, /Whether CPF contribution month applies to your circumstances remains unresolved/,
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

console.log('PASS: evidence-grounded synthesis admission, deterministic guards, scoped gaps, and provider diagnostics');
