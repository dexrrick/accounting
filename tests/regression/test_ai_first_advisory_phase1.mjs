import assert from 'node:assert/strict';
import React from 'react';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  buildAdvisoryConversation,
  classifyAdvisoryFailure,
  generateAiFirstAdvisory,
  isAiFirstAdvisoryEligible,
  isHighRiskAdvisoryClaim
} from '../../src/services/aiFirstAdvisory.ts';
import { processAccountingQuery } from '../../src/services/geminiService.ts';
import { UNIFIED_SOURCE_REGISTRY } from '../../src/standards/unifiedSourceModel.ts';
import { isAnswerGroundingEligibleSource } from '../../src/retrieval/sourceRetriever.ts';
import { hasVerifiedSourceUrlProvenance } from '../../src/standards/approvedSourceRegistry.ts';
import { ChatPanel } from '../../src/components/ChatPanel.tsx';
import { buildRetryConversationHistory, canRetryFailedAnswer } from '../../src/services/conversationBoundary.ts';

const cases = [
  {
    question: 'What is accrual accounting, and how does it differ from cash accounting?',
    answer: {
      directAnswer: 'Accrual accounting recognizes economic activity as it occurs, while cash accounting follows cash receipts and payments.',
      explanation: ['Accrual accounting helps present obligations and income in the periods they relate to.', 'Cash accounting can be simpler but may obscure unpaid balances.'],
      accountingTreatment: [], conditions: [], sourceIds: ['made-up-source-id']
    }
  },
  {
    question: 'Explain GST input tax and output tax, including the conditions that matter for a business.',
    answer: {
      directAnswer: 'Input tax relates to GST on a business purchase; output tax relates to GST on a business supply.',
      explanation: ['A business should distinguish the GST charged on supplies from GST incurred on purchases.', 'GST is 9 percent for this transaction and must be remitted by 30 November.'],
      accountingTreatment: [], conditions: ['Recovery depends on the purchase purpose and the applicable restrictions.'], sourceIds: []
    }
  }
];

for (const scenario of cases) {
  assert.equal(isAiFirstAdvisoryEligible(scenario.question, { activeProvider: 'openai', openai: { apiKey: 'test-key-123456789', model: 'gpt-test' }, azure: {}, gemini: {} }, false, null), true, `expected advisory routing: ${scenario.question}`);
}
assert.equal(isAiFirstAdvisoryEligible('How much GST is payable on SGD 1,000?', { activeProvider: 'openai', openai: { apiKey: 'test-key-123456789', model: 'gpt-test' }, azure: {}, gemini: {} }, false, null), false, 'numeric calculation remains with the deterministic workflow');
assert.equal(isAiFirstAdvisoryEligible('Prepare a double entry for the equipment purchase.', { activeProvider: 'openai', openai: { apiKey: 'test-key-123456789', model: 'gpt-test' }, azure: {}, gemini: {} }, false, null), false, 'posting requests remain with the journal workflow');
assert.equal(isAiFirstAdvisoryEligible('Explain input tax credits and compare them with an expense reversal.', { activeProvider: 'openai', openai: { apiKey: 'test-key-123456789', model: 'gpt-test' }, azure: {}, gemini: {} }, false, null), true, 'conceptual questions can mention credits and reversals without initiating state changes');
const activeScenario = { scenarioType: 'UNRECOGNIZED', rawQuery: '', transactionTitle: 'Supplier payable', functionalCurrency: 'SGD', transactionCurrency: 'SGD', directGroups: [], missingFields: [], isComplete: true };
for (const request of ['Can you settle the payable?', 'Could you update the supplier name to Acme?', 'Can you correct the amount?']) {
  assert.equal(isAiFirstAdvisoryEligible(request, { activeProvider: 'openai', openai: { apiKey: 'test-key-123456789', model: 'gpt-test' }, azure: {}, gemini: {} }, false, activeScenario), false, `state-changing follow-up remains outside advisory routing: ${request}`);
}
assert.equal(isAiFirstAdvisoryEligible('Explain how settlement works.', { activeProvider: 'openai', openai: { apiKey: 'test-key-123456789', model: 'gpt-test' }, azure: {}, gemini: {} }, false, activeScenario), true, 'an explanation about settlement remains advisory');
assert.equal(isAiFirstAdvisoryEligible('Can I recover GST on a private motor car?', { activeProvider: 'openai', openai: { apiKey: 'test-key-123456789', model: 'gpt-test' }, azure: {}, gemini: {} }, false, null), false, 'case-specific statutory applicability remains on the governed route');
for (const question of [
  'What is the GST treatment of our private motor car purchase?',
  'Explain whether GST is recoverable on my private motor car.',
  'What is the GST treatment of this purchase?',
  'Does the company qualify for this tax relief?'
]) assert.equal(isAiFirstAdvisoryEligible(question, { activeProvider: 'openai', openai: { apiKey: 'test-key-123456789', model: 'gpt-test' }, azure: {}, gemini: {} }, false, null), false, `case-specific statutory outcome stays evidence-governed: ${question}`);
assert.equal(isAiFirstAdvisoryEligible('Explain how GST input tax works.', { activeProvider: 'openai', openai: { apiKey: 'test-key-123456789', model: 'gpt-test' }, azure: {}, gemini: {} }, false, null), true, 'general input tax concepts remain advisory-eligible');
for (const question of [
  'What documents are required to claim GST input tax?',
  'What paperwork do businesses need when claiming GST?',
  'What evidence does IRAS ask for to recover input tax?',
  'Which records must a business retain to claim GST input tax?',
  'What documents are required by ACRA?',
  'Which records must an employer keep under the Employment Act?',
  'Which reports must a fund manager submit to MAS?',
  'What documents are required by CPF Board?',
  'Explain whether a client qualifies for GST recovery.',
  'Explain whether ABC Pte Ltd qualifies for GST recovery.',
  'Explain whether John qualifies for tax relief.',
  'What is the GST treatment of a client expense?',
  'Can our customer claim this tax relief?'
]) assert.equal(isAiFirstAdvisoryEligible(question, { activeProvider: 'openai', openai: { apiKey: 'test-key-123456789', model: 'gpt-test' }, azure: {}, gemini: {} }, false, null), false, `statutory requirements and third-party applications remain evidence-governed: ${question}`);
assert.equal(isAiFirstAdvisoryEligible('What documents should I attach to this general explanation?', { activeProvider: 'openai', openai: { apiKey: 'test-key-123456789', model: 'gpt-test' }, azure: {}, gemini: {} }, false, null), true, 'non-statutory document wording does not block a conceptual question');
assert.equal(isAiFirstAdvisoryEligible('Explain what ACRA does.', { activeProvider: 'openai', openai: { apiKey: 'test-key-123456789', model: 'gpt-test' }, azure: {}, gemini: {} }, false, null), true, 'authority concepts remain eligible absent a request for a specific requirement');
assert.equal(isAiFirstAdvisoryEligible('Explain the difference between input tax and output tax to a client.', { activeProvider: 'openai', openai: { apiKey: 'test-key-123456789', model: 'gpt-test' }, azure: {}, gemini: {} }, false, null), true, 'mentioning an audience does not make a conceptual explanation case-specific');
assert.equal(isAiFirstAdvisoryEligible('Explain the difference between input tax and output tax for a client.', { activeProvider: 'openai', openai: { apiKey: 'test-key-123456789', model: 'gpt-test' }, azure: {}, gemini: {} }, false, null), true, 'a client audience phrase does not itself request case-specific application');
assert.equal(classifyAdvisoryFailure(Object.assign(new Error('This operation was aborted'), { name: 'AbortError' })), 'TIMEOUT', 'native AbortError is reported as a timeout');
assert.equal(classifyAdvisoryFailure(new Error('Hosted Gemini access token is invalid. Check Settings.')), 'AUTH_OR_PERMISSION', 'invalid hosted credentials are categorized as an authentication failure');
assert.equal(classifyAdvisoryFailure(new Error('The complete question and relevant context exceed the advisory context budget.')), 'CONTEXT_LIMIT');
assert.equal(classifyAdvisoryFailure(new Error('Unexpected internal issue.')), 'OTHER');
assert.equal(isAiFirstAdvisoryEligible('When do we need to file IR21?', { activeProvider: 'openai', openai: { apiKey: 'test-key-123456789', model: 'gpt-test' }, azure: {}, gemini: {} }, false, null), false, 'material filing deadlines remain on the evidence-governed route');
assert.equal(isAiFirstAdvisoryEligible('Employee received a bonus in April for June payroll. When should it be reported?', { activeProvider: 'openai', openai: { apiKey: 'test-key-123456789', model: 'gpt-test' }, azure: {}, gemini: {} }, false, null), false, 'case-specific statutory reporting timing remains evidence-governed');
assert.equal(isAiFirstAdvisoryEligible('What individual tax relief categories are available?', { activeProvider: 'openai', openai: { apiKey: 'test-key-123456789', model: 'gpt-test' }, azure: {}, gemini: {} }, false, null), false, 'requests for statutory categories retain the authoritative list workflow');

for (const safe of [
  'Accrual accounting recognizes activity when it occurs.',
  'A business may have different input and output tax positions.',
  'Recovery depends on the purchase purpose and applicable restrictions.',
  'The contribution is recorded as an expense in the relevant period.',
  'A credit can reduce the amount a customer owes.',
  'Eligibility for input tax recovery depends on the purchase purpose and applicable restrictions.',
  'The conditions for tax eligibility can vary with the nature of a supply.'
]) assert.equal(isHighRiskAdvisoryClaim(safe), false, `qualitative explanation should remain: ${safe}`);
for (const risky of [
  'The applicable rate is 9 percent.',
  'The return is due within thirty days.',
  'The filing deadline is 31 March 2026.',
  'IAS 16 paragraph 7 says this is permitted.',
  'Calculate the total as 1,200.',
  'Debit expense and credit cash for the transaction.',
  'You can recover GST on your private motor car.',
  'Our business may be able to claim this input tax.'
]) assert.equal(isHighRiskAdvisoryClaim(risky), true, `high-risk claim should be withheld: ${risky}`);
for (const risky of [
  'A valid tax invoice is mandatory to support an input tax claim.',
  'ABC Pte Ltd qualifies for GST recovery.'
]) assert.equal(isHighRiskAdvisoryClaim(risky), true, `specific legal applicability claims should be withheld: ${risky}`);
for (const risky of ['The applicable rate is ９ percent.', 'The filing deadline is ３１ March ２０２６.']) {
  assert.equal(isHighRiskAdvisoryClaim(risky), true, `compatibility and Unicode digits should not bypass risk checks: ${risky}`);
}

const oldTurns = [
  { id: 'old-user', sender: 'user', timestamp: '', text: 'Earlier issue about a supplier invoice.' },
  { id: 'old-assistant', sender: 'assistant', timestamp: '', text: '### Direct Answer\n\nThe invoice is recognized when the related goods are received. The liability remains until settlement.' },
  { id: 'long-user', sender: 'user', timestamp: '', text: 'Older detail '.repeat(500) },
  ...Array.from({ length: 12 }, (_item, index) => index % 2 === 0
    ? { id: `recent-user-${index}`, sender: 'user', timestamp: '', text: `Recent question ${index}` }
    : { id: `recent-assistant-${index}`, sender: 'assistant', timestamp: '', text: 'Short preview', fullText: index === 11 ? 'The full professional answer retained the material condition and explanation.' : `Recent answer ${index}` }),
  { id: 'current', sender: 'user', timestamp: '', text: cases[0].question }
];
const bounded = buildAdvisoryConversation(oldTurns, cases[0].question, 400);
assert.ok(bounded.estimatedTokens <= 400, 'conversation context fits its token budget');
assert.equal(bounded.turns.some(turn => turn.role === 'user' && turn.text === cases[0].question), false, 'current question is supplied once, separately');
assert.ok(bounded.turns.some(turn => turn.text.includes('full professional answer')), 'assistant history uses the full answer instead of its preview');
assert.ok(bounded.extractiveSummary.includes('verbatim'), 'older context is labelled as extractive');
assert.ok(bounded.omittedMessages > 0, 'context budget records omitted turns');

const compactHistory = Array.from({ length: 18 }, (_item, index) => ({
  id: `turn-${index}`, sender: index % 2 ? 'assistant' : 'user', timestamp: '', text: (`Fact${index} `).repeat(5)
}));
const compacted = buildAdvisoryConversation(compactHistory, 'current follow-up', 100);
const compactedLines = [compacted.extractiveSummary, ...compacted.turns.map(turn => `${turn.role === 'user' ? 'Earlier user' : 'Earlier assistant'}: ${turn.text}`)].filter(Boolean);
assert.ok(compacted.estimatedTokens <= 100, 'history estimates the assembled text exactly within budget');
assert.equal(compacted.estimatedTokens, Math.ceil(new TextEncoder().encode(compactedLines.join('\n\n')).length / 4), 'history token estimate does not double-count extracts');
assert.match(compacted.extractiveSummary, /omitted due to the context budget/, 'a short omission notice survives when older turns do not fit');
const mentionedIndexes = [...compacted.extractiveSummary, ...compacted.turns.map(turn => turn.text)].join('\n').match(/Fact\d+/g) || [];
assert.ok(mentionedIndexes.length > 0, 'selected older extractive snippets remain useful');
assert.deepEqual(mentionedIndexes.map(value => Number(value.slice(4))), [...mentionedIndexes.map(value => Number(value.slice(4)))].sort((a, b) => a - b), 'selected conversation excerpts remain chronologically ordered');
const summarizedCount = (compacted.extractiveSummary.match(/Earlier (?:user question|assistant opening)/g) || []).length;
assert.equal(compacted.omittedMessages, 18 - compacted.turns.length - summarizedCount, 'each omitted message is counted once and represented snippets are not double-counted');

const originalFetch = globalThis.fetch;
const calls = [];
const adapters = [
  { name: 'gemini', settings: { activeProvider: 'gemini', gemini: { apiKey: 'test-gemini-key-123456789', model: 'gemini-test' }, azure: {}, openai: {} } },
  { name: 'azure', settings: { activeProvider: 'azure', azure: { endpoint: 'https://test-resource.example', apiKey: 'test-azure-key', deploymentName: 'azure-test', apiVersion: '2024-08-01-preview' }, gemini: {}, openai: {} } },
  { name: 'openai', settings: { activeProvider: 'openai', openai: { apiKey: 'test-openai-key-123456789', model: 'openai-test' }, azure: {}, gemini: {} } }
];

try {
  for (let providerIndex = 0; providerIndex < adapters.length; providerIndex += 1) {
    const adapter = adapters[providerIndex];
    const scenario = cases[providerIndex === 2 ? 1 : 0];
    const history = [
      { id: 'prior-user', sender: 'user', timestamp: '', text: 'Previous question: what is the transaction context?' },
      { id: 'prior-answer', sender: 'assistant', timestamp: '', text: 'Short preview', fullText: 'Prior complete answer: accrued expense remains payable until settled.' },
      { id: 'current-user', sender: 'user', timestamp: '', text: scenario.question }
    ];
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      const request = JSON.parse(init.body);
      let prompt;
      if (url.includes('generativelanguage.googleapis.com')) prompt = request.contents.flatMap(item => item.parts).map(part => part.text || '').join('\n');
      else prompt = request.messages.at(-1).content;
      calls.push({ provider: adapter.name, url, prompt });
      const responseText = JSON.stringify(scenario.answer);
      const responseBody = adapter.name === 'gemini'
        ? { candidates: [{ content: { parts: [{ text: responseText }] } }] }
        : { choices: [{ message: { content: responseText } }] };
      return new Response(JSON.stringify(responseBody), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };

    const response = await processAccountingQuery(scenario.question, null, 'SFRS_I', adapter.settings, 'unused', history);
    assert.equal(response.displayFullAnswer, true, 'AI-first response is marked for full display');
    assert.match(response.messageText, /# Direct Answer/, 'complete structured advisory reaches the chat response');
    assert.match(response.messageText, /# Explanation/, 'professional explanation is retained');
    assert.doesNotMatch(response.messageText, /9 percent|30 November/, 'exact rate and filing date are withheld while safe explanation remains');
    assert.deepEqual(response.scenarioState.directGroups, [], 'advisory answer cannot create a journal');
  }
} finally {
  globalThis.fetch = originalFetch;
}

assert.equal(calls.length, 3, 'one generation call is made per provider without a separate classification call');
assert.deepEqual(new Set(calls.map(call => call.provider)), new Set(['gemini', 'azure', 'openai']));
for (const call of calls) {
  assert.ok(call.prompt.includes(call.provider === 'openai' ? cases[1].question : cases[0].question), 'the provider receives the complete original question');
  assert.ok(call.prompt.includes('Prior complete answer'), 'the provider receives the relevant full assistant history');
  assert.ok(call.prompt.includes('SELECTED SOURCE RECORDS'), 'retrieval context has a separate prompt section');
}

const applicabilityFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = String(input);
  const request = JSON.parse(init.body);
  const responseText = JSON.stringify({ directAnswer: 'The company is exempt from audit.', explanation: [], accountingTreatment: [], conditions: [], sourceIds: [] });
  const responseBody = { choices: [{ message: { content: responseText } }] };
  if (url.includes('generativelanguage.googleapis.com')) return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: responseText }] } }] }), { status: 200 });
  void request;
  return new Response(JSON.stringify(responseBody), { status: 200, headers: { 'Content-Type': 'application/json' } });
};
try {
  const applicationResponse = await processAccountingQuery('Can I recover GST on a private motor car?', null, 'SFRS_I', adapters[2].settings, 'unused', []);
  assert.notEqual(applicationResponse.displayFullAnswer, true, 'case-specific legal applicability stays on the existing governed route');
} finally {
  globalThis.fetch = applicabilityFetch;
}

const verifiedRecord = Object.values(UNIFIED_SOURCE_REGISTRY).find(record =>
  record.sourceStatus === 'VERIFIED' && record.provenance === 'LOCAL_STATIC' && record.canonicalSourceUrl &&
  hasVerifiedSourceUrlProvenance(record) && isAnswerGroundingEligibleSource(record)
);
assert.ok(verifiedRecord, 'test fixture has a locally admitted source with a verified canonical URL');
const fakeGrounding = {
  classification: { intent: 'STATUTORY_ADVISORY', primaryDomain: 'ACCOUNTING', authorities: [], topicIds: [], domains: [], multiAuthority: false, currentInformationRequired: false, accountingAnalysisRequired: true, taxAnalysisRequired: false, regulatoryAnalysisRequired: false, calculationRequired: false, journalEntryRequired: false, missingFacts: [], reasoning: '' },
  userFacts: [], missingFacts: [], assumptions: [], primaryEvidence: [verifiedRecord], officialGuidance: [], curatedSummaries: [], applicationRules: [], currentInformationRequired: false
};
const linked = await generateAiFirstAdvisory(cases[0].question, null, 'SFRS_I', adapters[2].settings, [], {
  buildContext: async () => fakeGrounding,
  call: async () => JSON.stringify({ directAnswer: 'The concepts describe different timing bases. Accrual accounting follows the underlying activity.', explanation: ['This is a distinct explanatory paragraph.'], accountingTreatment: ['This is a separate accounting treatment.'], conditions: ['Consider which reporting basis the entity applies.'], sourceIds: [verifiedRecord.id, 'fabricated-id'] })
});
assert.ok(linked.messageText.includes(`](${verifiedRecord.canonicalSourceUrl})`), 'links are built from the admitted source record URL');
assert.doesNotMatch(linked.messageText, /fabricated-id/, 'model-created source IDs are discarded');
assert.match(linked.messageText, /The concepts describe different timing bases\. Accrual accounting follows the underlying activity\./, 'all safe direct-answer sentences are retained');
assert.match(linked.messageText, /distinct explanatory paragraph/, 'the first explanation is retained');
assert.match(linked.messageText, /separate accounting treatment/, 'accounting treatment has its own section');
assert.match(linked.messageText, /which reporting basis/, 'conditions have their own section');
assert.equal(linked.scenarioState.rawQuery, cases[0].question, 'advisory follow-up updates the current query while preserving scenario context');
assert.match(linked.messageText, /Related Official Guidance/, 'verified URL identity is presented as related guidance, not verified claim support');

const categoricalApplication = await generateAiFirstAdvisory(cases[0].question, null, 'SFRS_I', adapters[2].settings, [], {
  buildContext: async () => fakeGrounding,
  call: async () => JSON.stringify({
    directAnswer: 'The company is exempt from audit.',
    explanation: ['Private motor car GST is always recoverable.'],
    accountingTreatment: [],
    conditions: ['The relevant factors include the purchase purpose and the surrounding business context.'],
    sourceIds: []
  })
});
assert.doesNotMatch(categoricalApplication.messageText, /company is exempt|always recoverable/i, 'categorical statutory conclusions are withheld');
assert.match(categoricalApplication.messageText, /purchase purpose and the surrounding business context/, 'qualitative factors remain available');

await assert.rejects(() => generateAiFirstAdvisory(cases[0].question, null, 'SFRS_I', adapters[0].settings, [], {
  buildContext: async () => fakeGrounding,
  call: async () => '{malformed JSON'
}), /response contract/);
await assert.rejects(() => generateAiFirstAdvisory(cases[0].question, null, 'SFRS_I', adapters[0].settings, [], {
  buildContext: async () => fakeGrounding,
  call: async () => { throw new Error('provider unavailable'); }
}), /provider unavailable/);

const offlineQuestion = 'Explain how settlement works.';
const preRequestScenario = { ...activeScenario, rawQuery: offlineQuestion, transactionTitle: 'Supplier payable before retry' };
const retryUserMessage = { id: 'retry-user', sender: 'user', timestamp: '', text: offlineQuestion };
const failedAnswerText = 'Earlier offline answer from failed request must not enter the retry context.';
const laterTransactionText = 'Later unrelated transaction: the company bought a new machine for SGD 250,000.';
const completeRetryHistory = [
  { id: 'retry-prior-user', sender: 'user', timestamp: '', text: 'What was the prior supplier invoice context?' },
  { id: 'retry-prior-answer', sender: 'assistant', timestamp: '', text: 'Short preview', fullText: 'The prior supplier invoice context was an accrual payable that remains unpaid.' },
  retryUserMessage,
  { id: 'retry-failed-answer', sender: 'assistant', timestamp: '', text: failedAnswerText },
  { id: 'later-user', sender: 'user', timestamp: '', text: laterTransactionText }
];
const retryHistory = buildRetryConversationHistory(completeRetryHistory, retryUserMessage.id);
assert.deepEqual(retryHistory.map(message => message.id), ['retry-prior-user', 'retry-prior-answer', 'retry-user'], 'retry history ends at the original user turn');
assert.equal(canRetryFailedAnswer(completeRetryHistory, retryUserMessage.id), false,
  'a failed turn cannot be retried once any later user request has changed the active scenario');
assert.equal(canRetryFailedAnswer(retryHistory, retryUserMessage.id), true,
  'an unanswered failed turn remains retryable while it is still the latest user request');
try {
  for (const adapter of adapters) {
    for (const [status, expectedFailure] of [[401, 'AUTH_OR_PERMISSION'], [429, 'RATE_LIMIT']]) {
      const failedCalls = [];
      globalThis.fetch = async input => {
        failedCalls.push(String(input));
        return new Response(JSON.stringify({ error: { message: 'provider secret body must stay hidden', credential: 'private-key-value' } }), { status });
      };
      const response = await processAccountingQuery(offlineQuestion, preRequestScenario, 'SFRS_I', adapter.settings, 'unused', retryHistory);
      assert.equal(failedCalls.length, 1, `${adapter.name} advisory failure does not trigger another provider call`);
      assert.equal(response.advisoryFailureStatus, expectedFailure, `${adapter.name} HTTP ${status} is categorized safely`);
      assert.ok(response.messageText, `${adapter.name} failure retains the offline response`);
      assert.doesNotMatch(response.messageText, /provider secret body|private-key-value/, `${adapter.name} response body and credentials are not shown`);
    }

    const malformedCalls = [];
    globalThis.fetch = async input => {
      malformedCalls.push(String(input));
      return new Response('{}', { status: 200 });
    };
    const malformedResponse = await processAccountingQuery(offlineQuestion, preRequestScenario, 'SFRS_I', adapter.settings, 'unused', retryHistory);
    assert.equal(malformedCalls.length, 1, `${adapter.name} malformed result does not retry automatically`);
    assert.equal(malformedResponse.advisoryFailureStatus, 'INVALID_RESPONSE', `${adapter.name} malformed result gets a safe status`);
    assert.doesNotMatch(malformedResponse.messageText, /private-key-value|provider secret body/);
  }

  for (const [error, expectedFailure] of [
    [new Error('The Gemini request timed out.'), 'TIMEOUT'],
    [new TypeError('Failed to fetch'), 'NETWORK']
  ]) {
    globalThis.fetch = async () => { throw error; };
    const response = await processAccountingQuery(offlineQuestion, preRequestScenario, 'SFRS_I', adapters[0].settings, 'unused', retryHistory);
    assert.equal(response.advisoryFailureStatus, expectedFailure, 'timeout and network errors receive a safe status');
    assert.ok(response.messageText, 'timeout and network errors preserve the offline answer');
  }

  const noProviderCalls = [];
  globalThis.fetch = async input => { noProviderCalls.push(String(input)); throw new Error('No provider call expected.'); };
  const noProviderResponse = await processAccountingQuery(offlineQuestion, preRequestScenario, 'SFRS_I', undefined, 'unused', retryHistory);
  assert.equal(noProviderCalls.length, 0, 'no-provider behavior remains fully offline');
  assert.equal(noProviderResponse.advisoryFailureStatus, undefined, 'no-provider behavior does not report an advisory generation failure');

  let retryPrompt = '';
  globalThis.fetch = async (_input, init) => {
    const request = JSON.parse(init.body);
    retryPrompt = String(request.messages?.at(-1)?.content || '');
    const responseText = JSON.stringify({ directAnswer: 'Settlement clears a payable when payment is made.', explanation: ['This safe explanation remains available.'], accountingTreatment: [], conditions: [], sourceIds: [] });
    return new Response(JSON.stringify({ choices: [{ message: { content: responseText } }] }), { status: 200 });
  };
  const retryResponse = await processAccountingQuery(offlineQuestion, preRequestScenario, 'SFRS_I', adapters[2].settings, 'unused', retryHistory);
  assert.equal(retryResponse.advisoryFailureStatus, undefined, 'a successful explicit retry clears the failure state');
  assert.equal(retryResponse.displayFullAnswer, true, 'an explicit retry returns the full advisory answer');
  assert.equal(retryResponse.scenarioState.transactionTitle, preRequestScenario.transactionTitle, 'retry preserves the scenario from before the failed attempt');
  assert.ok(retryPrompt.includes(offlineQuestion), 'retry resubmits the original question');
  assert.ok(retryPrompt.includes('accrual payable that remains unpaid'), 'retry retains the context that preceded the failed request');
  assert.doesNotMatch(retryPrompt, new RegExp(failedAnswerText), 'retry omits the failed response');
  assert.doesNotMatch(retryPrompt, new RegExp(laterTransactionText), 'retry omits later unrelated transactions');
  assert.equal(retryPrompt.split(offlineQuestion).length - 1, 1, 'retry includes the original question once');

  globalThis.localStorage = { getItem: () => null, setItem: () => undefined };
  const failureMarkup = renderToStaticMarkup(React.createElement(ChatPanel, {
    messages: [retryUserMessage, {
      id: 'offline-fallback', sender: 'assistant', timestamp: '', text: 'Offline guidance retained.',
      advisoryFailureStatus: 'AUTH_OR_PERMISSION',
      advisoryRetryPayload: { text: offlineQuestion, scenarioSnapshot: preRequestScenario, originalUserMessageId: retryUserMessage.id }
    }],
    onSendMessage: () => undefined, onRetryMessage: () => undefined, onRetryAiAnswer: () => undefined,
    onSelectSuggestion: () => undefined, onResolveRelation: () => undefined,
    isLoading: false, isAwaitingRelation: false,
    outputPreference: { journal: false, statutory: false }, onOutputPreferenceChange: () => undefined
  }));
  assert.match(failureMarkup, /provider rejected authentication or permission/i, 'the UI exposes a safe, specific failure reason');
  assert.match(failureMarkup, /Retry AI answer/, 'the UI offers an explicit AI retry separately from image retry');
  assert.match(failureMarkup, /Offline guidance retained/, 'the offline response remains visible with the failure status');
  assert.doesNotMatch(failureMarkup, /private-key-value|provider secret body/);
  const historicalFailureMarkup = renderToStaticMarkup(React.createElement(ChatPanel, {
    messages: [
      retryUserMessage,
      {
        id: 'offline-fallback', sender: 'assistant', timestamp: '', text: 'Offline guidance retained.',
        advisoryFailureStatus: 'AUTH_OR_PERMISSION',
        advisoryRetryPayload: { text: offlineQuestion, scenarioSnapshot: preRequestScenario, originalUserMessageId: retryUserMessage.id }
      },
      { id: 'later-user', sender: 'user', timestamp: '', text: laterTransactionText }
    ],
    onSendMessage: () => undefined, onRetryMessage: () => undefined, onRetryAiAnswer: () => undefined,
    onSelectSuggestion: () => undefined, onResolveRelation: () => undefined,
    isLoading: false, isAwaitingRelation: false,
    outputPreference: { journal: false, statutory: false }, onOutputPreferenceChange: () => undefined
  }));
  assert.doesNotMatch(historicalFailureMarkup, /Retry AI answer/,
    'the UI hides the retry action after a later transaction is sent');

  const appSource = await readFile(new URL('../../src/App.tsx', import.meta.url), 'utf8');
  const appJavaScript = ts.transpileModule(appSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true }
  }).outputText;
  const stateSlots = [];
  let stateCursor = 0;
  let nextTimestamp = 1;
  let chatProps;
  let inputProps;
  const nextUserMessageIdTime = class extends Date { static now() { return nextTimestamp++; } };
  const chatPanelComponent = function ChatPanelStub() {};
  const inputPanelComponent = function InputHandlerPanelStub() {};
  const components = new Map([
    ['./components/ChatPanel', { ChatPanel: chatPanelComponent }],
    ['./components/InputHandlerPanel', { InputHandlerPanel: inputPanelComponent }]
  ]);
  const fakeReact = {
    createElement(type, props, ...children) {
      if (type === chatPanelComponent) chatProps = props;
      if (type === inputPanelComponent) inputProps = props;
      return { type, props, children };
    },
    useState(initial) {
      const index = stateCursor++;
      if (!(index in stateSlots)) stateSlots[index] = typeof initial === 'function' ? initial() : initial;
      return [stateSlots[index], value => {
        stateSlots[index] = typeof value === 'function' ? value(stateSlots[index]) : value;
      }];
    },
    useEffect() {}
  };
  const reactExports = { __esModule: true, default: fakeReact, useState: fakeReact.useState, useEffect: fakeReact.useEffect };
  const appCalls = [];
  const scenarioA = { scenarioType: 'EXPENSE', rawQuery: offlineQuestion, transactionTitle: 'Transaction A', functionalCurrency: 'SGD', transactionCurrency: 'SGD', directGroups: [], missingFields: [], isComplete: true };
  const scenarioB = { ...scenarioA, rawQuery: laterTransactionText, transactionTitle: 'Transaction B' };
  const serviceStub = {
    processAccountingQuery: async (...args) => {
      appCalls.push(args);
      return appCalls.length === 1
        ? { messageText: 'Offline answer for transaction A.', scenarioState: scenarioA, advisoryFailureStatus: 'NETWORK' }
        : { messageText: 'Completed answer for transaction B.', scenarioState: scenarioB };
    }
  };
  const boundarySource = await readFile(new URL('../../src/services/conversationBoundary.ts', import.meta.url), 'utf8');
  const boundaryModule = { exports: {} };
  const boundaryRequire = id => ({})[id];
  vm.runInNewContext(ts.transpileModule(boundarySource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText, { module: boundaryModule, exports: boundaryModule.exports, require: boundaryRequire });
  const componentStub = new Proxy({}, { get: (_, name) => function ComponentStub() { void name; } });
  const moduleStubs = {
    react: reactExports,
    './services/geminiService': serviceStub,
    './services/conversationBoundary': boundaryModule.exports,
    './types/provider': { loadProviderSettings: () => ({ activeProvider: 'openai', openai: {}, azure: {}, gemini: { model: 'test' } }), saveProviderSettings() {} },
    './engine/accountingEngine': { calculateDoubleEntries: () => ({ groups: [] }) },
    './utils/dateUtils': { getSingaporeTimestamp: () => '' },
    './utils/chatPresentation': { createChatPreview: text => text, extractOfficialAnswerLinks: () => [] },
    './utils/irasEvidencePresentation': { hasCurrentIrasEvidencePresentation: () => false },
    './utils/authorityEvidencePresentation': { hasCurrentAuthorityEvidencePresentation: () => false },
    './retrieval/regulatoryUpdateScheduler': { runDueRegulatoryChecks() {} },
    './components/ChatPanel': components.get('./components/ChatPanel'),
    './components/InputHandlerPanel': components.get('./components/InputHandlerPanel'),
    'lucide-react': componentStub
  };
  const appRequire = id => moduleStubs[id] || componentStub;
  const appModule = { exports: {} };
  const appContext = {
    module: appModule, exports: appModule.exports, require: appRequire,
    localStorage: { getItem: () => null, setItem() {} }, Date: nextUserMessageIdTime,
    setInterval() { return 0; }, clearInterval() {}, console
  };
  vm.runInNewContext(appJavaScript, appContext);
  const renderApp = () => { stateCursor = 0; appModule.exports.App(); return { chatProps, inputProps }; };
  let appUi = renderApp();
  await appUi.chatProps.onSendMessage(offlineQuestion);
  appUi = renderApp();
  const failedTurn = appUi.chatProps.messages.find(message => message.advisoryRetryPayload)?.advisoryRetryPayload;
  assert.ok(failedTurn, 'App retains a retry action for transaction A while it is current');
  await appUi.chatProps.onSendMessage(`New question: ${laterTransactionText}`);
  appUi = renderApp();
  const messagesBeforeHistoricalRetry = appUi.chatProps.messages;
  const activeScenarioBeforeHistoricalRetry = appUi.inputProps.scenario;
  appUi.chatProps.onRetryAiAnswer(failedTurn.text, failedTurn.scenarioSnapshot, failedTurn.originalUserMessageId);
  appUi = renderApp();
  assert.equal(appCalls.length, 2, 'App refuses the historical retry before it can call the accounting service');
  assert.equal(appUi.inputProps.scenario.transactionTitle, 'Transaction B', 'the latest transaction remains the active accounting scenario');
  assert.strictEqual(appUi.inputProps.scenario, activeScenarioBeforeHistoricalRetry, 'the retry does not replace current scenario state');
  assert.strictEqual(appUi.chatProps.messages, messagesBeforeHistoricalRetry, 'the retry does not append a stale assistant answer');
} finally {
  globalThis.fetch = originalFetch;
  delete globalThis.localStorage;
}

console.log('AI-first advisory regression passed: statutory routing, provider-safe failures, offline fallback, explicit retry and chat status.');
