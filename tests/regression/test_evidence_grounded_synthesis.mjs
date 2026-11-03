import assert from 'node:assert/strict';
import { UNIFIED_SOURCE_REGISTRY } from '../../src/standards/unifiedSourceModel.ts';
import { classifyQuestion } from '../../src/classification/questionClassifier.ts';
import { evaluateEvidenceQuality } from '../../src/retrieval/evidenceQualityGate.ts';
import { classifyAdvisoryFailure } from '../../src/services/aiFirstAdvisory.ts';
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
    operation: 'RECOVER',
    evidenceRequirement: 'APPLICATION',
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
      ...(options.calculation ? { calculation: options.calculation } : {})
    },
    ...(options.context ? { context: options.context } : {}),
    workstreams: {
      query: queryText,
      issuePlan: {},
      requestCompletenessContext: {},
      workstreams: issues.map((issue, index) => ({
        id: `workstream-${index + 1}`, authority: 'IRAS', domain: 'IRAS_GST', sourceSections: [],
        populations: [issue.population], issues: [issue], evidenceStatus: issue.evidenceStatus,
        applicationStatus: issue.applicationStatus, verifiedClaims: issue.verifiedClaims, sources: issue.sources, gaps: issue.gaps
      })),
      evidenceStatus: issues.some(issue => issue.evidenceStatus === 'VERIFIED') ? 'VERIFIED' : 'INSUFFICIENT',
      applicationStatus: issues.some(issue => issue.applicationStatus === 'UNRESOLVED') ? 'UNRESOLVED' : 'VERIFIED',
      status: 'CONDITIONAL', gaps: options.workstreamGaps || []
    }
  };
}

function claim(id, text, supportIds = ['passage-1'], overrides = {}) {
  return { id, kind: 'RULE', text, supportIds, factRefs: [], ...overrides };
}

function reviewFor(claims, verdictById = {}) {
  return {
    verdicts: claims.map(item => ({
      claimId: item.id,
      verdict: verdictById[item.id] || 'SUPPORTED',
      supportingEvidenceIds: item.supportIds,
      supportingFactRefs: item.factRefs,
      reason: verdictById[item.id] === 'CONTRADICTED' ? 'The cited passage does not establish this conclusion.' : 'The cited material supports the scoped claim.'
    }))
  };
}

function scriptedCall(handler) {
  const calls = [];
  const call = async (prompt, system, activeProvider, options) => {
    calls.push({ prompt, system, provider: activeProvider, options });
    const value = await handler({ prompt, system, provider: activeProvider, index: calls.length });
    return typeof value === 'string' ? value : JSON.stringify(value);
  };
  return { call, calls };
}

function packetFrom(prompt) {
  return JSON.parse(prompt);
}

const supportedRule = quote;
{
  const scripted = scriptedCall(({ system, prompt }) => {
    const packet = packetFrom(prompt);
    if (system.includes('EVIDENCE_GROUNDED_REVIEW')) {
      return reviewFor(packet.claims);
    }
    return { claims: [claim('rule-1', supportedRule)] };
  });
  const result = await tryGenerateGroundedSynthesis(makeInput(), { call: scripted.call });
  assert.ok(result);
  assert.match(result.messageText, /Regulations 26 and 27 generally disallow input tax/);
  assert.match(result.messageText, /\[IRAS:/, 'the inline citation comes from the verified record, not generated text');
  assert.equal(result.officialAnswerLinks[0]?.url, record.canonicalSourceUrl);
  assert.match(result.messageText, /applicability remains unresolved/i);
  assert.match(result.messageText, /purchase purpose was not provided/i);
  assert.equal(result.verification.semanticReview, 'INDEPENDENT_MODEL_ASSESSMENT');
  assert.equal(result.verification.sourceAdmission, 'EXISTING_PIPELINE_ADMITTED');
  assert.equal(result.verification.providerCalls, 2);
  assert.equal(result.verification.providerAttempts, 2);
  assert.ok(result.verification.providerElapsedMs >= 0);
  const generationPacket = packetFrom(scripted.calls[0].prompt);
  assert.equal(generationPacket.evidencePassages[0].targetDate, '2026-11-03');
  assert.equal(generationPacket.evidencePassages[0].issueId, 'issue-gst');
  assert.equal(generationPacket.evidencePassages[0].completeAdmittedPassage, quote);
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
    currentInformationRequired: false
  };
  const scripted = scriptedCall(({ system, prompt }) => {
    const packet = packetFrom(prompt);
    if (system.includes('EVIDENCE_GROUNDED_REVIEW')) return reviewFor(packet.claims);
    return { claims: packet.evidencePassages.map((passage, index) => claim(
      `passage-claim-${index + 1}`, passage.completeAdmittedPassage, [passage.id], { issueId: passage.issueId }
    )) };
  });
  const result = await tryGenerateGroundedSynthesis(makeInput({ query: contextQuery, context }), { call: scripted.call });
  assert.ok(result);
  const passages = packetFrom(scripted.calls[0].prompt).evidencePassages;
  assert.ok(passages.length >= 2, 'workstream evidence and locally selected IRAS context evidence are both retained');
  assert.equal(new Set(passages.map(passage => passage.id)).size, passages.length, 'merged passage IDs stay unique');
  assert.match(result.messageText, /Regulations 26 and 27 generally disallow/);
  assert.match(result.messageText, /Business purpose alone does not make a blocked claim recoverable/);
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
    if (system.includes('TARGETED_REVISION')) return { claims: [] };
    if (system.includes('EVIDENCE_GROUNDED_REVIEW')) return { verdicts: [] };
    return { claims: [claim('bad-id', 'The passage proves this claim.', ['invented-source-id'])] };
  });
  await assert.rejects(
    tryGenerateGroundedSynthesis(makeInput(), { call: scripted.call }),
    error => /no supportable claims/.test(error.message) && !/invented-source-id/.test(error.message)
  );
  assert.equal(scripted.calls.filter(call => call.system.includes('TARGETED_REVISION')).length, 1);
  assert.equal(scripted.calls.filter(call => call.system.includes('EVIDENCE_GROUNDED_REVIEW')).length, 0,
    'invalid support IDs are rejected before semantic review');
}

{
  const goodRule = claim('rule-supported', supportedRule);
  const unconditional = claim('application-needs-facts', 'This client qualifies to recover the input tax for this expense.', ['passage-1'], {
    kind: 'APPLICATION', factRefs: ['fact-current-question'], issueId: 'issue-gst'
  });
  const revisedApplication = {
    ...unconditional,
    text: 'The client may be able to recover the input tax if the expense is not disallowed and the ordinary input tax conditions are met; the purchase purpose and supporting records still need to be confirmed.'
  };
  const scripted = scriptedCall(({ system, prompt }) => {
    const packet = packetFrom(prompt);
    if (system.includes('TARGETED_REVISION')) return { claims: [revisedApplication] };
    if (system.includes('EVIDENCE_GROUNDED_REVIEW')) {
      const verdicts = packet.claims.map(item => ({
        claimId: item.id,
        verdict: item.id === 'application-needs-facts' && !item.text.includes('if the expense') ? 'CONTRADICTED' : 'SUPPORTED',
        supportingEvidenceIds: item.supportIds,
        supportingFactRefs: item.factRefs,
        reason: item.id === 'application-needs-facts' && !item.text.includes('if the expense') ? 'Material purchase facts are missing.' : 'Supported by the cited material.'
      }));
      return { verdicts };
    }
    return { claims: [goodRule, unconditional] };
  });
  const result = await tryGenerateGroundedSynthesis(makeInput(), { call: scripted.call });
  assert.ok(result);
  assert.match(result.messageText, /Regulations 26 and 27 generally disallow/);
  assert.match(result.messageText, /may be able to recover[\s\S]*if the expense is not disallowed/);
  assert.equal(result.verification.revisionAttempts, 1);
  assert.equal(result.verification.providerCalls, 4);
  assert.equal(result.verification.reviewedClaimCount, 2,
    'the initial supported rule and newly repaired application are each reviewed once');
  assert.equal(result.verification.claims.find(item => item.claimId === 'rule-supported')?.outcome, 'SUPPORTED');
  assert.ok(!result.messageText.includes('This client qualifies to recover'));
  assert.ok(result.messageText.includes('The purchase purpose was not provided.'));
  const revisedReview = scripted.calls.filter(call => call.system.includes('EVIDENCE_GROUNDED_REVIEW')).at(-1);
  assert.deepEqual(packetFrom(revisedReview.prompt).claims.map(item => item.id), ['application-needs-facts'],
    'the second review evaluates only repaired claims and does not reopen an initially supported claim');
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
    claim('application-categorical-after-condition',
      'The relevant facts remain unresolved. The client may recover GST if the applicable conditions hold; the client qualifies for recovery.',
      ['passage-1'], { kind: 'APPLICATION', factRefs: ['fact-current-question'], issueId: 'issue-gst' }),
    claim('application-categorical-after-conjunction',
      'The relevant facts remain unresolved. The client may recover GST if the applicable conditions hold, and the client qualifies for recovery.',
      ['passage-1'], { kind: 'APPLICATION', factRefs: ['fact-current-question'], issueId: 'issue-gst' })
  ];
  const scripted = scriptedCall(({ system, prompt }) => {
    const packet = packetFrom(prompt);
    if (system.includes('EVIDENCE_GROUNDED_REVIEW')) return reviewFor(packet.claims);
    if (system.includes('TARGETED_REVISION')) return { claims: [] };
    return { claims: [claim('rule-kept', supportedRule), ...definitiveApplications] };
  });
  const result = await tryGenerateGroundedSynthesis(makeInput(), { call: scripted.call });
  assert.ok(result);
  assert.match(result.messageText, /Regulations 26 and 27 generally disallow/);
  for (const unsafe of definitiveApplications) {
    assert.ok(!result.messageText.includes(unsafe.text),
      'a caveat later in the sentence or an unrelated condition cannot make a categorical application conditional');
  }
  const reviewedClaims = scripted.calls.filter(call => call.system.includes('EVIDENCE_GROUNDED_REVIEW'))
    .flatMap(call => packetFrom(call.prompt).claims.map(item => item.id));
  assert.ok(definitiveApplications.every(item => !reviewedClaims.includes(item.id)),
    'deterministic validation removes the categorical application before the approving reviewer sees it');
}

{
  const goodRule = claim('rule-kept', supportedRule);
  const rejectedApplication = claim('application-rejected', 'This client qualifies for the GST recovery.', ['passage-1'], {
    kind: 'APPLICATION', factRefs: ['fact-current-question'], issueId: 'issue-gst'
  });
  const deterministicallyInvalidRepair = {
    ...rejectedApplication,
    text: 'A repaired claim cannot cite a source outside this issue.',
    supportIds: ['unknown-passage-id']
  };
  const scripted = scriptedCall(({ system, prompt }) => {
    const packet = packetFrom(prompt);
    if (system.includes('TARGETED_REVISION')) return { claims: [deterministicallyInvalidRepair] };
    if (system.includes('EVIDENCE_GROUNDED_REVIEW')) {
      if (scripted.calls.filter(call => call.system.includes('EVIDENCE_GROUNDED_REVIEW')).length === 1) {
        return reviewFor(packet.claims, { 'application-rejected': 'CONTRADICTED' });
      }
      return reviewFor(packet.claims);
    }
    return { claims: [goodRule, rejectedApplication] };
  });
  const result = await tryGenerateGroundedSynthesis(makeInput(), { call: scripted.call });
  assert.ok(result);
  assert.match(result.messageText, /Regulations 26 and 27 generally disallow/);
  assert.ok(!result.messageText.includes('A repaired claim cannot cite'));
  const reviewedRepairIds = scripted.calls.filter(call => call.system.includes('EVIDENCE_GROUNDED_REVIEW'))
    .flatMap(call => packetFrom(call.prompt).claims.map(item => item.text));
  assert.ok(!reviewedRepairIds.includes(deterministicallyInvalidRepair.text),
    'deterministically invalid repaired claims never reach another semantic review');
  assert.ok(result.verification.withheldClaimIds.includes('application-rejected'));
}

{
  const goodRule = claim('rule-kept', supportedRule);
  const rejectedApplication = claim('application-rejected', 'This client qualifies for the GST recovery.', ['passage-1'], {
    kind: 'APPLICATION', factRefs: ['fact-current-question'], issueId: 'issue-gst'
  });
  const scripted = scriptedCall(({ system, prompt }) => {
    const packet = packetFrom(prompt);
    if (system.includes('TARGETED_REVISION')) throw new Error('429 rate limit secret provider response');
    if (system.includes('EVIDENCE_GROUNDED_REVIEW')) return reviewFor(packet.claims, { 'application-rejected': 'CONTRADICTED' });
    return { claims: [goodRule, rejectedApplication] };
  });
  const result = await tryGenerateGroundedSynthesis(makeInput(), { call: scripted.call });
  assert.ok(result);
  assert.match(result.messageText, /Regulations 26 and 27 generally disallow/);
  assert.match(result.messageText, /requested conclusions could not be supported/i);
  assert.ok(!result.messageText.includes('secret provider response'));
  assert.ok(result.messageText.includes(supportedRule), 'the already supported claim remains unchanged after a revision failure');
  assert.deepEqual(result.verification.supportedClaimIds, ['rule-kept']);
  assert.equal(result.verification.revisionFailureStatus, 'RATE_LIMIT');
  assert.equal(result.verification.providerCalls, 3);
}

{
  const rejectedClaim = claim('only-rejected', 'This client qualifies for the GST recovery.', ['passage-1'], {
    kind: 'APPLICATION', factRefs: ['fact-current-question'], issueId: 'issue-gst'
  });
  const scripted = scriptedCall(({ system, prompt }) => {
    if (system.includes('TARGETED_REVISION')) throw new Error('429 rate limit; raw provider body and secret token');
    const packet = packetFrom(prompt);
    if (system.includes('EVIDENCE_GROUNDED_REVIEW')) return reviewFor(packet.claims, { 'only-rejected': 'CONTRADICTED' });
    return { claims: [rejectedClaim] };
  });
  await assert.rejects(tryGenerateGroundedSynthesis(makeInput(), { call: scripted.call }), error =>
    classifyAdvisoryFailure(error) === 'RATE_LIMIT' && !/raw provider body|secret token/.test(error.message));
  assert.equal(scripted.calls.length, 2,
    'deterministic unresolved-application validation withholds the categorical claim before semantic review');
}

{
  const issues = [
    makeIssue('issue-covered', { subject: 'input tax restriction' }),
    makeIssue('issue-uncovered', { withSource: false, subject: 'GST registration evidence', applicationReason: 'No admitted source established this requirement.' })
  ];
  const scripted = scriptedCall(({ system, prompt }) => {
    const packet = packetFrom(prompt);
    if (system.includes('EVIDENCE_GROUNDED_REVIEW')) return reviewFor(packet.claims);
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
    if (system.includes('TARGETED_REVISION')) return { claims: [] };
    if (system.includes('EVIDENCE_GROUNDED_REVIEW')) return reviewFor(packet.claims);
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
  const scripted = scriptedCall(({ system, prompt }) => {
    const packet = packetFrom(prompt);
    if (system.includes('TARGETED_REVISION')) return { claims: [] };
    if (system.includes('EVIDENCE_GROUNDED_REVIEW')) return reviewFor(packet.claims);
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
  const firstReview = scripted.calls.find(call => call.system.includes('EVIDENCE_GROUNDED_REVIEW'));
  assert.ok(!packetFrom(firstReview.prompt).claims.some(item => item.id === 'gap-as-rule'),
    'a positive reviewer cannot admit a rule supported only by an evidence-gap marker');
}

{
  const issues = [makeIssue('issue-one'), makeIssue('issue-two', { targetDate: '2019-01-01' })];
  const scripted = scriptedCall(({ system }) => {
    if (system.includes('TARGETED_REVISION')) return { claims: [] };
    return { claims: [claim('cross-scope', 'The rule applies across both issues.', ['passage-2'], { issueId: 'issue-one' })] };
  });
  await assert.rejects(tryGenerateGroundedSynthesis(makeInput({ issues }), { call: scripted.call }), /no supportable claims/);
  assert.equal(scripted.calls.filter(call => call.system.includes('TARGETED_REVISION')).length, 1,
    'a claim cannot borrow an admitted quote from a different issue or date scope');
}

{
  const calculation = { netAmount: 1000, rate: 0.09, outputTax: 90, invoiceTotal: 1090, currency: 'SGD', sourceRecordId: record.id, effectiveDate: '2026-11-03' };
  const groups = [{ isBalanced: true, isHypothetical: false, title: 'Existing expense', eventDate: '2026-11-03', totalDebit: 100, totalCredit: 100, lines: [] }];
  const scenarioState = { scenarioType: 'EXPENSE', directGroups: groups, missingFacts: [], missingFields: [], isComplete: true };
  const before = structuredClone(scenarioState);
  const scripted = scriptedCall(({ system, prompt }) => {
    const packet = packetFrom(prompt);
    if (system.includes('TARGETED_REVISION')) return { claims: [] };
    if (system.includes('EVIDENCE_GROUNDED_REVIEW')) return reviewFor(packet.claims);
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
    if (system.includes('EVIDENCE_GROUNDED_REVIEW')) return reviewFor(packet.claims);
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
    if (system.includes('EVIDENCE_GROUNDED_REVIEW')) return reviewFor(packet.claims);
    const journalOutput = packet.trustedDeterministicOutputs.find(output => output.kind === 'VALIDATED_JOURNAL');
    return { claims: [claim('accounting-issue-covered', accountingNarrative, [journalOutput.id], {
      kind: 'ACCOUNTING', issueId: 'issue-accounting'
    })] };
  });
  const accountingIssueResult = await tryGenerateGroundedSynthesis(accountingIssueInput, { call: accountingIssueCall.call });
  assert.ok(accountingIssueResult.messageText.includes(accountingNarrative));
  assert.doesNotMatch(accountingIssueResult.messageText, /financial accounting treatment.*remains unresolved/i,
    'a supported issue-scoped accounting conclusion satisfies an accounting treatment request');

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
      if (system.includes('TARGETED_REVISION')) return { claims: [] };
      if (system.includes('EVIDENCE_GROUNDED_REVIEW')) return reviewFor(packet.claims);
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
  const rateClaimCall = scriptedCall(({ system }) => system.includes('TARGETED_REVISION')
    ? { claims: [] }
    : { claims: [claim('invented-rate', 'The GST rate is 99%.')] });
  await assert.rejects(tryGenerateGroundedSynthesis(makeInput(), { call: rateClaimCall.call }), /no supportable claims/);
  assert.equal(rateClaimCall.calls.filter(call => call.system.includes('EVIDENCE_GROUNDED_REVIEW')).length, 0,
    'an unsupported statutory rate is rejected before an approving semantic review');
}

{
  for (const [id, text, kind] of [
    ['fullwidth-rate', 'The GST rate is ９９％.', 'RULE'],
    ['arabic-rate', 'The GST rate is ٩٩٪.', 'RULE'],
    ['limitation-rate', 'The GST rate is 99%.', 'LIMITATION']
  ]) {
    const scripted = scriptedCall(({ system }) => system.includes('TARGETED_REVISION')
      ? { claims: [] }
      : { claims: [claim(id, text, ['passage-1'], { kind })] });
    await assert.rejects(tryGenerateGroundedSynthesis(makeInput(), { call: scripted.call }), /no supportable claims/);
    assert.equal(scripted.calls.filter(call => call.system.includes('EVIDENCE_GROUNDED_REVIEW')).length, 0,
      `${id} cannot bypass the numeric source guard`);
  }

  const factualLimitation = 'As stated in your question, the supplier invoice dated 30/10/2026 has no tax invoice attached. The recovery conditions cannot yet be checked.';
  const scripted = scriptedCall(({ system, prompt }) => {
    const packet = packetFrom(prompt);
    if (system.includes('EVIDENCE_GROUNDED_REVIEW')) return reviewFor(packet.claims);
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
    if (system.includes('TARGETED_REVISION')) return { claims: [] };
    if (system.includes('EVIDENCE_GROUNDED_REVIEW')) return reviewFor(packet.claims);
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
  assert.equal(scripted.calls.filter(call => call.system.includes('EVIDENCE_GROUNDED_REVIEW'))
    .some(call => packetFrom(call.prompt).claims.some(item => item.id === 'number-reused-as-rate')), false,
  'the mismatched number meaning is rejected before a positive semantic review can admit it');
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
    if (system.includes('TARGETED_REVISION')) return { claims: [] };
    if (system.includes('EVIDENCE_GROUNDED_REVIEW')) return reviewFor(packet.claims);
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
    if (system.includes('TARGETED_REVISION')) return { claims: [] };
    if (system.includes('EVIDENCE_GROUNDED_REVIEW')) return reviewFor(packet.claims);
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
      if (system.includes('TARGETED_REVISION')) return { claims: [] };
      if (system.includes('EVIDENCE_GROUNDED_REVIEW')) return reviewFor(packet.claims);
      const output = packet.trustedDeterministicOutputs.find(item => item.kind === 'GST_CALCULATION');
      return { claims: [claim(`ambiguous-output-${text.length}`, text, ['passage-1', output.id])] };
    });
    await assert.rejects(tryGenerateGroundedSynthesis(makeInput({ calculation }), { call: scripted.call }), /no supportable claims/);
    assert.equal(scripted.calls.filter(call => call.system.includes('EVIDENCE_GROUNDED_REVIEW')).length, 0,
      'mixed-field or negated deterministic output narration is rejected before a positive review');
  }
}

{
  const issue = makeIssue('issue-gst');
  const scripted = scriptedCall(({ system, prompt }) => {
    const packet = packetFrom(prompt);
    if (system.includes('TARGETED_REVISION')) return { claims: [] };
    if (system.includes('EVIDENCE_GROUNDED_REVIEW')) return reviewFor(packet.claims);
    return { claims: [claim('provision-with-unrelated-number', 'Regulation 26 establishes a GST rate of 17%.')] };
  });
  await assert.rejects(tryGenerateGroundedSynthesis(makeInput({ issues: [issue] }), { call: scripted.call }), /no supportable claims/);
  assert.equal(scripted.calls.filter(call => call.system.includes('EVIDENCE_GROUNDED_REVIEW')).length, 0,
    'a known legal provision reference cannot cause an unrelated rate to be stripped from numeric validation');
}

{
  const scripted = scriptedCall(({ system, prompt }) => {
    const packet = packetFrom(prompt);
    if (system.includes('TARGETED_REVISION')) return { claims: [] };
    if (system.includes('EVIDENCE_GROUNDED_REVIEW')) return reviewFor(packet.claims);
    return { claims: [claim('invented-subclauses', 'Regulations 26(a) and 27(z) permit unconditional recovery.')] };
  });
  await assert.rejects(tryGenerateGroundedSynthesis(makeInput(), { call: scripted.call }), /no supportable claims/);
  assert.equal(scripted.calls.filter(call => call.system.includes('EVIDENCE_GROUNDED_REVIEW')).length, 0,
    'provision alphabetic subclauses must match exactly; known section numbers do not authorize invented references');
}

{
  const calculation = { netAmount: 1000, rate: 0.09, outputTax: 90, invoiceTotal: 1090, currency: 'SGD', sourceRecordId: record.id, effectiveDate: '2026-11-03' };
  const issue = makeIssue('issue-gst', { applicationStatus: 'VERIFIED' });
  for (const text of ['The output tax is SGD -90.', 'As stated in your question, the payroll date is 30/10/2026.']) {
    const scripted = scriptedCall(({ system, prompt }) => {
      const packet = packetFrom(prompt);
      if (system.includes('TARGETED_REVISION')) return { claims: [] };
      if (system.includes('EVIDENCE_GROUNDED_REVIEW')) return reviewFor(packet.claims);
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
    if (system.includes('EVIDENCE_GROUNDED_REVIEW')) return reviewFor(packet.claims);
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
    'Debit inventory.',
    'Credit trade payables.',
    'Post Dr Inventory.'
  ]) {
    const scripted = scriptedCall(({ system }) => system.includes('TARGETED_REVISION')
      ? { claims: [] }
      : { claims: [claim('journal', text)] });
    await assert.rejects(tryGenerateGroundedSynthesis(makeInput(), { call: scripted.call }), /no supportable claims/);
    assert.equal(scripted.calls.length, 2, 'journal instructions are blocked before they can become a response');
    assert.equal(scripted.calls.filter(call => call.system.includes('EVIDENCE_GROUNDED_REVIEW')).length, 0,
      `journal instruction is deterministically rejected before review: ${text}`);
  }

  for (const text of ['The supplier issued a tax credit note.', 'The trial balance includes a credit balance.']) {
    const scripted = scriptedCall(({ system, prompt }) => {
      const packet = packetFrom(prompt);
      return system.includes('EVIDENCE_GROUNDED_REVIEW')
        ? reviewFor(packet.claims)
        : { claims: [claim('credit-narrative', text)] };
    });
    const result = await tryGenerateGroundedSynthesis(makeInput(), { call: scripted.call });
    assert.ok(result.messageText.includes(text), `journal guard does not block a credit-note or credit-balance explanation: ${text}`);
  }
}

{
  const malformed = scriptedCall(({ system }) => system.includes('EVIDENCE_GROUNDED_REVIEW') ? '{"verdicts":[]' : { claims: [claim('rule', supportedRule)] });
  await assert.rejects(tryGenerateGroundedSynthesis(makeInput(), { call: malformed.call }), error =>
    /semantic review response contract/.test(error.message) && !/verdicts/.test(error.message) &&
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
    const scripted = scriptedCall(({ system, prompt }) => {
      const packet = packetFrom(prompt);
      return system.includes('EVIDENCE_GROUNDED_REVIEW') ? reviewFor(packet.claims) : { claims: [claim('rule', supportedRule)] };
    });
    const result = await tryGenerateGroundedSynthesis(makeInput({ provider: activeProvider }), { call: scripted.call });
    assert.ok(result);
    assert.ok(scripted.calls.every(call => call.provider === activeProvider), 'generation and review use the active provider settings');
    assert.equal(result.verification.providerCalls, 2);
  }
}

console.log('PASS: evidence-grounded synthesis admission, independent review, scoped gaps, retry, and provider diagnostics');
