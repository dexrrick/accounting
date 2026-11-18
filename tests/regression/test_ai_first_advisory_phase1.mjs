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
import { classifyQuestion } from '../../src/classification/questionClassifier.ts';
import { processAccountingQuery } from '../../src/services/geminiService.ts';
import { parseAccountingQuery } from '../../src/engine/scenarioParser.ts';
import { UNIFIED_SOURCE_REGISTRY } from '../../src/standards/unifiedSourceModel.ts';
import { isAnswerGroundingEligibleSource } from '../../src/retrieval/sourceRetriever.ts';
import { hasVerifiedSourceUrlProvenance } from '../../src/standards/approvedSourceRegistry.ts';
import { ChatPanel } from '../../src/components/ChatPanel.tsx';
import { JournalTable } from '../../src/components/JournalTable.tsx';
import {
  assessConversationRelation,
  buildAnalysisConversationHistory,
  buildRetryConversationHistory,
  canRetryFailedAnswer,
  hasAffirmativeResetDirective,
  hasExplicitPriorFactReference,
  startsNewAccountingScenario
} from '../../src/services/conversationBoundary.ts';
import { isShortSemanticFollowUp } from '../../src/services/semanticQuestionUnderstanding.ts';
import { getDisplayableUncommittedJournalGroups, selectAccountingScenarioForRequest, updateCommittedJournalScenario } from '../../src/services/committedJournal.ts';
import { resolveFactAmendment, isSingleMonthlySalaryAmendment } from '../../src/services/factAmendmentService.ts';

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
const journalRoutingProvider = { activeProvider: 'openai', openai: { apiKey: 'test-key-123456789', model: 'gpt-test' }, azure: {}, gemini: {} };
const negativeJournalAdvisories = [
  'Explain accrual accounting versus cash accounting for a small business with unpaid supplier invoices. Give a practical explanation; I am not asking for a journal entry.',
  'Explain how the accountant should register an asset at cost in the fixed asset register and on acquisition in the general ledger. How do the register and ledger relate? No journal amounts are needed.'
];
for (const question of negativeJournalAdvisories) {
  const classification = classifyQuestion(question);
  assert.equal(classification.journalEntryRequired, false, `negative journal wording must not request entries: ${question}`);
  assert.equal(classification.calculationRequired, false, `negative journal wording must not request calculations: ${question}`);
  assert.equal(isAiFirstAdvisoryEligible(question, journalRoutingProvider, false, null), true,
    `a conceptual accounting explanation with no journal request remains AI-first eligible: ${question}`);
}
assert.equal(classifyQuestion('Explain accrual accounting, but I am not asking for a journal entry; prepare a double entry for the equipment purchase.').journalEntryRequired, true,
  'an explicit positive journal request remains active alongside a negative phrase');
assert.equal(classifyQuestion('Prepare a double entry for the equipment purchase; no journal entry is needed.').journalEntryRequired, true,
  'a negative phrase does not cancel a separate positive journal request');
assert.equal(classifyQuestion('No journal entry is needed.').journalEntryRequired, false,
  'a singular journal-entry statement of no need does not trigger the journal workflow');
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
  'A return is required.',
  'The company must complete the return.',
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
for (const risky of [
  'An operating licence is optional for this company.',
  'The business may operate without an operating licence.',
  'The company is exempt from obtaining an operating licence.',
  'The business can operate without a permit.',
  'The company may operate without regulatory registration.'
]) assert.equal(isHighRiskAdvisoryClaim(risky), true, `definitive licensing permissions and exemptions should be withheld: ${risky}`);
for (const safe of [
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
  'The company must accrue fees for the auditor appointment because an accrual is necessary.'
]) assert.equal(isHighRiskAdvisoryClaim(safe), false, `commercial licensing and accounting instructions remain available: ${safe}`);
assert.equal(isHighRiskAdvisoryClaim('The software licence is required to run the application, and the company must submit its GST return.'), true,
  'commercial licensing wording does not suppress a separate statutory filing obligation in the same sentence');
assert.equal(isHighRiskAdvisoryClaim('A software licence is required to run the application, and an operating licence is required to trade.'), true,
  'a commercial licence does not mask a separate operating licence requirement in the same sentence');
for (const risky of [
  'The company must appoint a company secretary.',
  'The company must appoint directors.',
  'The company must appoint auditors.',
  'The company must appoint statutory auditors.',
  'Directors must be appointed.',
  'Appointment of company secretaries is required.',
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
  'The company is not required to appoint an auditor.'
]) assert.equal(isHighRiskAdvisoryClaim(risky), true, `statutory appointment and government registration conclusions remain gated: ${risky}`);
assert.equal(isHighRiskAdvisoryClaim('The bookkeeper must register the asset in the fixed asset register, and the business must register with the regulator.'), true,
  'an accounting-register update does not suppress a separate government registration obligation in the same sentence');
assert.equal(isHighRiskAdvisoryClaim('The company must register with ACRA and note it in the general ledger.'), true,
  'a later accounting-ledger reference does not exempt a statutory registration obligation');
assert.equal(isHighRiskAdvisoryClaim('The company must return the leased equipment to the supplier, and must register with ACRA.'), true,
  'a commercial equipment return does not mask a separate statutory registration obligation');
for (const mixedRegistration of [
  'The company must register with ACRA and note the asset at cost in the fixed asset register.',
  'The bookkeeper must register the asset on acquisition in the general ledger, and the company must register with ACRA.',
  'The business must register its premises with the regulator, then note the asset in the general ledger.'
]) assert.equal(isHighRiskAdvisoryClaim(mixedRegistration), true,
  `an accounting ledger detail does not suppress a separate government registration obligation: ${mixedRegistration}`);
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
    const question = providerIndex === 2 ? 'How does that differ from output tax?' : scenario.question;
    const priorTransaction = providerIndex === 2
      ? 'The company recorded GST on an equipment purchase.'
      : 'Previous question: what is the transaction context?';
    const priorAssistantAnswer = providerIndex === 2
      ? 'Prior complete answer: input tax relates to GST on business purchases; output tax relates to business supplies.'
      : 'Prior complete answer: accrued expense remains payable until settled.';
    const history = [
      { id: 'prior-user', sender: 'user', timestamp: '', text: priorTransaction },
      { id: 'prior-answer', sender: 'assistant', timestamp: '', text: 'Short preview', fullText: priorAssistantAnswer },
      { id: 'current-user', sender: 'user', timestamp: '', text: question }
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

    const response = await processAccountingQuery(question, null, 'SFRS_I', adapter.settings, 'unused', history);
    assert.equal(response.displayFullAnswer, true, 'AI-first response is marked for full display');
    assert.match(response.messageText, /# Direct Answer/, 'complete structured advisory reaches the chat response');
    assert.match(response.messageText, /# Explanation/, 'professional explanation is retained');
    assert.doesNotMatch(response.messageText, /9 percent|30 November/, 'exact rate and filing date are withheld while safe explanation remains');
    assert.deepEqual(response.scenarioState.directGroups, [], 'advisory answer cannot create a journal');
  }

  const aiFirstPayload = {
    directAnswer: 'Accrual accounting records activity when it occurs. The business must renew its operating licence every year. The company must appoint directors.',
    explanation: ['The business may operate without an operating licence.', 'The company must appoint auditors.', 'The business can operate without a permit.', 'The company may operate without regulatory registration.'],
    accountingTreatment: ['An operating licence is optional for this company.', 'The bookkeeper must register the asset in the general ledger. The bookkeeper must register the new asset in the fixed asset register. The accountant must register the asset at cost in the fixed asset register. The bookkeeper must register the asset on acquisition in the general ledger.'],
    conditions: ['The expense belongs in the period it relates to. The company is exempt from obtaining an operating licence. The company must return the leased equipment to the supplier.'],
    sourceIds: []
  };
  globalThis.fetch = async () => new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify(aiFirstPayload) } }]
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  const aiFirstResponse = await processAccountingQuery(cases[0].question, null, 'SFRS_I', adapters[2].settings, 'unused', []);
  assert.equal(aiFirstResponse.displayFullAnswer, true, 'the explanatory accounting question exercises the AI-first path');
  assert.match(aiFirstResponse.messageText, /Accrual accounting records activity when it occurs/);
  assert.match(aiFirstResponse.messageText, /expense belongs in the period it relates to/);
  assert.match(aiFirstResponse.messageText, /register the asset in the general ledger/,
    'ordinary asset registration in the general ledger remains visible');
  assert.match(aiFirstResponse.messageText, /register the new asset in the fixed asset register/,
    'registering a new asset in the fixed asset register remains visible');
  assert.match(aiFirstResponse.messageText, /register the asset at cost in the fixed asset register/,
    'an at-cost qualifier does not hide a fixed-asset register instruction');
  assert.match(aiFirstResponse.messageText, /register the asset on acquisition in the general ledger/,
    'an on-acquisition qualifier does not hide a general-ledger instruction');
  assert.match(aiFirstResponse.messageText, /return the leased equipment to the supplier/,
    'a commercial equipment return remains visible');
  assert.doesNotMatch(aiFirstResponse.messageText, /renew its operating licence|may operate without an operating licence|licence is optional|exempt from obtaining an operating licence|appoint directors|appoint auditors|operate without a permit|operate without regulatory registration/i,
    'AI-first output applies the shared statutory check to direct answer, explanation, treatment, and conditions');

  for (const unsafeClaim of [
    'The business may operate without an operating licence.',
    'The company must appoint directors. The company must appoint auditors. The business can operate without a permit.',
    'The company may operate without regulatory registration.',
    'The company must register with ACRA and note it in the general ledger.',
    'The company must return the leased equipment to the supplier, and must register with ACRA.',
    'The company must register with ACRA and note the asset at cost in the fixed asset register.',
    'The bookkeeper must register the asset on acquisition in the general ledger, and the company must register with ACRA.',
    'The business must register its premises with the regulator, then note the asset in the general ledger.'
  ]) {
    globalThis.fetch = async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        directAnswer: unsafeClaim, explanation: [], accountingTreatment: [], conditions: [], sourceIds: []
      }) } }]
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    const allUnsafeResponse = await processAccountingQuery(cases[0].question, null, 'SFRS_I', adapters[2].settings, 'unused', []);
    assert.equal(allUnsafeResponse.advisoryFailureStatus, 'INVALID_RESPONSE',
      `an all-unsafe AI-first payload is rejected: ${unsafeClaim}`);
    assert.doesNotMatch(allUnsafeResponse.messageText, /may operate without an operating licence|appoint directors|appoint auditors|operate without a permit|register with ACRA|register the asset at cost|register the asset on acquisition|register its premises|return the leased equipment/i,
      `unsupported statutory claims are withheld: ${unsafeClaim}`);
  }
} finally {
  globalThis.fetch = originalFetch;
}

assert.equal(calls.length, 3, 'one generation call is made per provider without a separate classification call');
assert.deepEqual(new Set(calls.map(call => call.provider)), new Set(['gemini', 'azure', 'openai']));
for (const call of calls) {
  assert.ok(call.prompt.includes(call.provider === 'openai' ? 'How does that differ from output tax?' : cases[0].question), 'the provider receives the complete original question');
  assert.ok(call.prompt.includes('Prior complete answer'), 'the provider receives the relevant full assistant history');
  assert.ok(call.prompt.includes('SELECTED SOURCE RECORDS'), 'retrieval context has a separate prompt section');
}

{
  const boundaryCalls = [];
  const boundaryFetch = globalThis.fetch;
  const priorTransaction = 'The previous supplier invoice was SGD 7,500 and remains unpaid.';
  const priorAnswer = 'Prior complete answer: the expense is accrued and the payable remains until settlement.';
  const independentQuestion = 'Explain how accounting applies to the new machine the company purchased for SGD 100,000.';
  const followUpQuestion = 'How does that apply to the invoice?';
  const previousHistory = [
    { id: 'boundary-prior-user', sender: 'user', timestamp: '', text: priorTransaction },
    { id: 'boundary-prior-answer', sender: 'assistant', timestamp: '', text: 'Short preview', fullText: priorAnswer }
  ];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const request = JSON.parse(init.body);
    const prompt = url.includes('generativelanguage.googleapis.com')
      ? request.contents.flatMap(item => item.parts).map(part => part.text || '').join('\n')
      : request.messages.at(-1).content;
    boundaryCalls.push({ url, prompt });
    const responseText = JSON.stringify({
      directAnswer: 'Accrual accounting recognizes activity as it occurs.',
      explanation: ['The treatment follows the facts of the current question.'],
      accountingTreatment: [], conditions: [], sourceIds: []
    });
    return new Response(JSON.stringify({ choices: [{ message: { content: responseText } }] }), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    });
  };
  try {
    const independentHistory = [
      ...previousHistory,
      { id: 'boundary-independent-user', sender: 'user', timestamp: '', text: independentQuestion }
    ];
    const independent = await processAccountingQuery(
      independentQuestion, activeScenario, 'SFRS_I', adapters[2].settings, 'unused', independentHistory
    );
    assert.equal(independent.displayFullAnswer, true, 'the independent advisory request reaches the AI-first path');
    assert.equal(boundaryCalls.length, 1);
    assert.ok(!boundaryCalls[0].prompt.includes(priorTransaction) && !boundaryCalls[0].prompt.includes(priorAnswer),
      'a new independent accounting scenario excludes unrelated transaction history from the advisory call');

    const followUpHistory = [
      ...previousHistory,
      { id: 'boundary-follow-up-user', sender: 'user', timestamp: '', text: followUpQuestion }
    ];
    const followUp = await processAccountingQuery(
      followUpQuestion, activeScenario, 'SFRS_I', adapters[2].settings, 'unused', followUpHistory
    );
    assert.equal(followUp.displayFullAnswer, true, 'a contextual follow-up still reaches the AI-first path');
    assert.equal(boundaryCalls.length, 2);
    assert.ok(boundaryCalls[1].prompt.includes(priorTransaction) && boundaryCalls[1].prompt.includes(priorAnswer),
      'a genuine follow-up retains the relevant transaction context');

    const acraQuestion = 'Explain what ACRA does.';
    const acraUserTurn = { id: 'boundary-acra-user', sender: 'user', timestamp: '', text: acraQuestion };
    const acraHistory = [...previousHistory, acraUserTurn];
    const acraResponse = await processAccountingQuery(
      acraQuestion, activeScenario, 'SFRS_I', adapters[2].settings, 'unused', acraHistory
    );
    assert.equal(acraResponse.displayFullAnswer, true, 'a standalone ACRA explanation reaches AI-first advisory');
    assert.equal(acraResponse.conversationBoundaryMessageId, acraUserTurn.id,
      'the standalone AI-first advisory establishes its conversation boundary before returning');
    const acraCall = boundaryCalls.at(-1);
    assert.ok(!acraCall.prompt.includes(priorTransaction) && !acraCall.prompt.includes(priorAnswer),
      'AI-first advisory excludes the older unrelated transaction and answer');

    const acraWithoutScenario = await processAccountingQuery(
      acraQuestion, null, 'SFRS_I', adapters[2].settings, 'unused', acraHistory
    );
    assert.equal(acraWithoutScenario.conversationBoundaryMessageId, acraUserTurn.id,
      'a standalone ACRA question establishes its boundary even when the caller has no active scenario');
    const acraWithoutScenarioCall = boundaryCalls.at(-1);
    assert.ok(!acraWithoutScenarioCall.prompt.includes(priorTransaction) && !acraWithoutScenarioCall.prompt.includes(priorAnswer),
      'an ACRA question with no active scenario still excludes unrelated conversation history');

    const acraFollowUp = 'Could you explain that in more detail?';
    const acraFollowUpTurn = { id: 'boundary-acra-follow-up-user', sender: 'user', timestamp: '', text: acraFollowUp };
    const scopedAcraFollowUpHistory = buildAnalysisConversationHistory([
      ...acraHistory,
      { id: 'boundary-acra-answer', sender: 'assistant', timestamp: '', text: acraResponse.messageText, fullText: acraResponse.messageText },
      acraFollowUpTurn
    ], acraResponse.conversationBoundaryMessageId);
    const acraFollowUpResponse = await processAccountingQuery(
      acraFollowUp, acraResponse.scenarioState, 'SFRS_I', adapters[2].settings, 'unused', scopedAcraFollowUpHistory
    );
    assert.equal(acraFollowUpResponse.displayFullAnswer, true, 'a contextual AI-first follow-up retains advisory handling');
    const acraFollowUpCall = boundaryCalls.at(-1);
    assert.ok(acraFollowUpCall.prompt.includes(acraQuestion) && acraFollowUpCall.prompt.includes('Direct Answer'),
      'the contextual follow-up retains the scoped ACRA question and answer');
    assert.ok(!acraFollowUpCall.prompt.includes(priorTransaction) && !acraFollowUpCall.prompt.includes(priorAnswer),
      'the contextual follow-up still excludes the older transaction history');

    const contextualIrasQuestion = 'Regarding our earlier expense, what are the IRAS deduction rules? The transaction was the supplier invoice we discussed earlier and remains unpaid. Please explain how the facts already provided in that earlier discussion may affect the general deduction rules, and identify any material information I would still need to confirm.';
    assert.ok(contextualIrasQuestion.length > 260,
      'the explicit prior-fact test exceeds the short follow-up length limit');
    assert.equal(hasExplicitPriorFactReference(contextualIrasQuestion), true,
      'a longer statutory question explicitly referring to an earlier expense retains context');
    assert.equal(assessConversationRelation(contextualIrasQuestion, activeScenario), 'RELATED',
      'the App recognizes an explicit reference to earlier facts as a continuation');
    assert.equal(startsNewAccountingScenario(
      'Regarding our earlier equipment purchase, the company bought a machine for SGD 100,000. What IRAS deduction rules apply?',
      activeScenario
    ), false, 'a contextual statutory question may repeat purchase wording and amounts without resetting the scenario');
    assert.equal(hasExplicitPriorFactReference('New question regarding our earlier expense: what are the IRAS rules?'), false,
      'an explicit new question takes precedence over an earlier-fact reference');
    assert.equal(hasExplicitPriorFactReference('Ignore the earlier expense and explain the general IRAS rules.'), false,
      'an explicit instruction to ignore earlier facts clears contextual retention');
    const newPurchaseWithHistoricalReference =
      'We bought new equipment for SGD 100,000 to replace our previous asset described earlier.';
    assert.equal(hasExplicitPriorFactReference(newPurchaseWithHistoricalReference), false,
      'a complete new transaction remains independent when it mentions an earlier asset');
    assert.equal(startsNewAccountingScenario(newPurchaseWithHistoricalReference, activeScenario), true,
      'a complete new purchase still starts a separate transaction despite its historical reference');
    const clearlySeparatePurchase =
      'What are the IRAS deduction rules for a new machine purchased for SGD 100,000, separate from our earlier expense?';
    assert.equal(hasExplicitPriorFactReference(clearlySeparatePurchase), false,
      'a clearly separate new transaction does not inherit an earlier expense reference');
    assert.equal(startsNewAccountingScenario(clearlySeparatePurchase, activeScenario), true,
      'a complete machine purchase remains independent when the question explicitly separates it from the prior expense');
    const newPurchaseComparedWithEarlierExpense =
      'What are the IRAS deduction rules for a new machine purchased for SGD 100,000, like our earlier expense?';
    assert.equal(hasExplicitPriorFactReference(newPurchaseComparedWithEarlierExpense), true,
      'the question still has an explicit historical reference for advisory scoping');
    assert.equal(startsNewAccountingScenario(newPurchaseComparedWithEarlierExpense, activeScenario), true,
      'a question-led new purchase does not inherit context merely because it mentions an earlier expense');
    const subsequentPurchaseWithHistoricalReference =
      'Regarding our previous machine purchase, we subsequently bought a new machine for SGD 100,000. What IRAS deduction rules apply to this purchase?';
    assert.equal(hasExplicitPriorFactReference(subsequentPurchaseWithHistoricalReference), true,
      'a new purchase can still refer to an earlier machine purchase');
    assert.equal(startsNewAccountingScenario(subsequentPurchaseWithHistoricalReference, activeScenario), true,
      'an explicit subsequent purchase takes priority over the retrospective lead-in');
    assert.equal(assessConversationRelation(subsequentPurchaseWithHistoricalReference, activeScenario), 'NEW',
      'the App starts a new analysis for the subsequent purchase');
    const additionalPurchaseWithoutTimeMarker =
      'Regarding our previous machine purchase, we bought another machine for SGD 100,000. What IRAS deduction rules apply?';
    assert.equal(startsNewAccountingScenario(additionalPurchaseWithoutTimeMarker, activeScenario), true,
      'an explicitly additional machine purchase starts a new scenario without requiring a temporal marker');
    const independentPurchaseWithLaterHistoricalMention =
      'Please explain how IRAS deduction rules apply to a new machine purchased for SGD 100,000, considering our earlier invoice.';
    assert.equal(hasExplicitPriorFactReference(independentPurchaseWithLaterHistoricalMention), true,
      'an independent purchase may still mention an earlier invoice');
    assert.equal(startsNewAccountingScenario(independentPurchaseWithLaterHistoricalMention, activeScenario), true,
      'a later mention of an earlier invoice does not suppress an independent transaction boundary');
    const subsequentQuestionAfterPriorLead =
      'Regarding our previous machine purchase, this is a separate question: we purchased a machine for SGD 100,000. What IRAS rules apply?';
    assert.equal(hasExplicitPriorFactReference(subsequentQuestionAfterPriorLead), false,
      'an explicit separate question clears its earlier machine reference');
    assert.equal(startsNewAccountingScenario(subsequentQuestionAfterPriorLead, activeScenario), true,
      'a separate transaction after the earlier-machine lead starts a new scenario');
    const newQuestionAfterPriorInvoice =
      'Please explain the earlier invoice. New question: we purchased a machine for SGD 100,000. What IRAS rules apply?';
    assert.equal(hasExplicitPriorFactReference(newQuestionAfterPriorInvoice), false,
      'an explicit new question clears its earlier-invoice reference');
    assert.equal(startsNewAccountingScenario(newQuestionAfterPriorInvoice, activeScenario), true,
      'a new purchase after the earlier-invoice lead starts a new scenario');
    const historicalRestatementWithHypothetical =
      'Regarding our previous machine purchase, the company bought a machine for SGD 100,000. What if we considered the new machine as well?';
    assert.equal(startsNewAccountingScenario(historicalRestatementWithHypothetical, activeScenario), false,
      'a hypothetical clause with a new-machine mention does not change a prior-fact restatement into a new transaction');

    // Finding 2: Separate purchases after prior references vs hypothetical variations
    const separateEquipmentAfterVendorInvoice =
      'Regarding our previous vendor invoice, we also purchased equipment for SGD 100,000. How should we account for the additional purchase?';
    assert.equal(startsNewAccountingScenario(separateEquipmentAfterVendorInvoice, activeScenario), true,
      'a separate equipment purchase after a previous vendor invoice starts a new scenario');
    assert.equal(assessConversationRelation(separateEquipmentAfterVendorInvoice, activeScenario), 'NEW',
      'a separate equipment purchase after a previous vendor invoice is classified as NEW');
    const subsequentNewEquipmentPurchase =
      'Regarding our previous machine purchase, we subsequently purchased new equipment for SGD 100,000. What IRAS rules apply?';
    assert.equal(startsNewAccountingScenario(subsequentNewEquipmentPurchase, activeScenario), true,
      'a subsequent new equipment purchase starts a new scenario');
    assert.equal(assessConversationRelation(subsequentNewEquipmentPurchase, activeScenario), 'NEW',
      'a subsequent new equipment purchase is classified as NEW');
    const hypotheticalSubsequentPurchase =
      'Regarding our previous machine purchase, suppose we subsequently purchased another machine for SGD 100,000. What IRAS rules apply?';
    assert.equal(startsNewAccountingScenario(hypotheticalSubsequentPurchase, activeScenario), false,
      'suppose-prefixed hypothetical subsequent purchase does not start a new scenario');
    const interrogativeHypotheticalSubsequentPurchase =
      'Regarding our previous machine purchase, what would happen if we subsequently purchased another machine for SGD 100,000?';
    assert.equal(startsNewAccountingScenario(interrogativeHypotheticalSubsequentPurchase, activeScenario), false,
      'interrogative conditional hypothetical subsequent purchase does not start a new scenario');

    // Finding 3: Historical accounting period statutory questions are not treated as conversation references
    const priorUnpaidExpensesYa2026 = 'What IRAS deduction rules apply to prior unpaid expenses for YA 2026?';
    const thePriorUnpaidExpensesYa2026 = 'What IRAS deduction rules apply to the prior unpaid expenses for YA 2026?';
    for (const historicalPeriodQuestion of [priorUnpaidExpensesYa2026, thePriorUnpaidExpensesYa2026]) {
      assert.equal(hasExplicitPriorFactReference(historicalPeriodQuestion), false,
        `historical accounting period statutory question is not treated as an explicit prior-fact reference: ${historicalPeriodQuestion}`);
      assert.equal(isShortSemanticFollowUp(historicalPeriodQuestion), false,
        `historical accounting period statutory question is not treated as a short semantic follow-up: ${historicalPeriodQuestion}`);
    }

    // Finding 2: Independent transactions mentioning prior-year/earlier-period/previous-year items must prompt as AMBIGUOUS
    for (const independentHistoricalTx of [
      'We received SGD 5,000 from a customer for a prior-year invoice. What accounting entry is required?',
      'We received SGD 5,000 from a customer for a previous-year invoice. What accounting entry is required?',
      'We received SGD 5,000 from a customer for the prior year invoice. What accounting entry is required?',
      'We paid SGD 3,000 for an earlier-period utility bill. What journal entry is required?'
    ]) {
      assert.equal(isShortSemanticFollowUp(independentHistoricalTx), false,
        `prior/earlier/previous period modifier is not treated as a short follow-up: ${independentHistoricalTx}`);
      assert.equal(hasExplicitPriorFactReference(independentHistoricalTx), false,
        `prior/earlier/previous period modifier is not treated as an explicit prior-turn reference: ${independentHistoricalTx}`);
      assert.equal(assessConversationRelation(independentHistoricalTx, activeScenario), 'AMBIGUOUS',
        `independent transaction mentioning prior/earlier/previous period prompts instead of attaching as RELATED: ${independentHistoricalTx}`);
    }

    const contextualIrasTurn = {
      id: 'boundary-contextual-iras-user', sender: 'user', timestamp: '', text: contextualIrasQuestion
    };
    const contextualIrasHistory = [...previousHistory, contextualIrasTurn];
    const contextualIrasCallStart = boundaryCalls.length;
    const contextualIrasResponse = await processAccountingQuery(
      contextualIrasQuestion, activeScenario, 'SFRS_I', adapters[2].settings, 'unused', contextualIrasHistory
    );
    const contextualIrasCalls = boundaryCalls.slice(contextualIrasCallStart);
    assert.ok(contextualIrasCalls.some(call => call.prompt.includes(priorTransaction) && call.prompt.includes(priorAnswer)),
      'IRAS statutory interpretation and answer generation retain the referenced transaction facts');
    assert.ok(contextualIrasCalls.some(call => call.prompt.includes(contextualIrasQuestion)),
      'the contextual statutory prompt preserves the user’s original wording');
    assert.equal(contextualIrasResponse.conversationBoundaryMessageId, undefined,
      'an explicitly contextual statutory question does not establish a new history boundary');

    const explicitlyContextualIrasQuestions = [
      'For the previous expense, what are the IRAS deduction rules? The expense was the supplier invoice from the earlier discussion, and the payable remains unpaid. Please connect the facts I supplied previously to the current general rules, explain which prior details could matter, and identify any material information I should still confirm before reaching a conclusion.',
      'Please explain the earlier invoice and its IRAS deduction rules. It was the supplier invoice from our previous discussion, and it remains unpaid. Please connect the facts already supplied to this question, explain which earlier details could affect the general deduction analysis, and identify any material information I should still confirm before reaching a conclusion.'
    ];
    for (const [index, question] of explicitlyContextualIrasQuestions.entries()) {
      assert.ok(question.length > 260, 'the explicit follow-up exceeds the short semantic follow-up limit');
      assert.equal(hasExplicitPriorFactReference(question), true,
        'an explicitly named prior expense or invoice is recognized as contextual');
      assert.equal(assessConversationRelation(question, activeScenario), 'RELATED',
        'the App keeps an explicitly named prior expense or invoice in the current analysis');
      const turn = { id: `boundary-prior-fact-iras-${index}`, sender: 'user', timestamp: '', text: question };
      const callsBeforeQuestion = boundaryCalls.length;
      const response = await processAccountingQuery(
        question, activeScenario, 'SFRS_I', adapters[2].settings, 'unused', [...previousHistory, turn]
      );
      const questionCalls = boundaryCalls.slice(callsBeforeQuestion);
      assert.ok(questionCalls.some(call => call.prompt.includes(priorTransaction) && call.prompt.includes(priorAnswer)),
        'the explicit statutory follow-up sends the earlier transaction facts to the provider');
      assert.ok(questionCalls.some(call => call.prompt.includes(question)),
        'the provider prompt preserves the original contextual question');
      assert.equal(response.conversationBoundaryMessageId, undefined,
        'the explicit statutory follow-up does not reset conversation history');
    }

    const subsequentPurchaseTurn = {
      id: 'boundary-subsequent-purchase-user',
      sender: 'user',
      timestamp: '',
      text: subsequentPurchaseWithHistoricalReference
    };
    const callsBeforeSubsequentPurchase = boundaryCalls.length;
    const subsequentPurchaseResponse = await processAccountingQuery(
      subsequentPurchaseWithHistoricalReference,
      activeScenario,
      'SFRS_I',
      adapters[2].settings,
      'unused',
      [...previousHistory, subsequentPurchaseTurn]
    );
    const subsequentPurchaseCalls = boundaryCalls.slice(callsBeforeSubsequentPurchase);
    assert.equal(subsequentPurchaseResponse.conversationBoundaryMessageId, subsequentPurchaseTurn.id,
      'the explicitly subsequent purchase establishes a new conversation boundary');
    assert.ok(subsequentPurchaseCalls.some(call => call.prompt.includes(subsequentPurchaseWithHistoricalReference)),
      'the new purchase reaches statutory advice with the original question');
    assert.ok(subsequentPurchaseCalls.every(call =>
      !call.prompt.includes(priorTransaction) && !call.prompt.includes(priorAnswer)
    ), 'the subsequent purchase excludes earlier transaction facts from provider prompts');

    for (const [index, question] of [
      subsequentQuestionAfterPriorLead,
      newQuestionAfterPriorInvoice
    ].entries()) {
      const turn = { id: `boundary-explicit-new-purchase-${index}`, sender: 'user', timestamp: '', text: question };
      const callsBeforeQuestion = boundaryCalls.length;
      const response = await processAccountingQuery(
        question, activeScenario, 'SFRS_I', adapters[2].settings, 'unused', [...previousHistory, turn]
      );
      const questionCalls = boundaryCalls.slice(callsBeforeQuestion);
      assert.equal(response.conversationBoundaryMessageId, turn.id,
        'an explicit new-question boundary is retained by the public service');
      assert.ok(questionCalls.some(call => call.prompt.includes(question)),
        'the new transaction reaches the provider with the original question');
      assert.ok(questionCalls.every(call =>
        !call.prompt.includes(priorTransaction) && !call.prompt.includes(priorAnswer)
      ), 'explicitly separate transaction prompts omit earlier invoice facts');
    }

    const separateEquipmentTurn = {
      id: 'boundary-separate-equipment-after-vendor-invoice',
      sender: 'user',
      timestamp: '',
      text: separateEquipmentAfterVendorInvoice
    };
    const callsBeforeSeparateEquipment = boundaryCalls.length;
    const separateEquipmentResponse = await processAccountingQuery(
      separateEquipmentAfterVendorInvoice,
      activeScenario,
      'SFRS_I',
      adapters[2].settings,
      'unused',
      [...previousHistory, separateEquipmentTurn]
    );
    const separateEquipmentCalls = boundaryCalls.slice(callsBeforeSeparateEquipment);
    assert.equal(separateEquipmentResponse.conversationBoundaryMessageId, separateEquipmentTurn.id,
      'separate equipment purchase after prior vendor invoice establishes a new conversationBoundaryMessageId');
    assert.notEqual(separateEquipmentResponse.scenarioState?.transactionTitle, activeScenario.transactionTitle,
      'separate equipment purchase does not inherit the earlier transaction scenario');
    assert.ok(separateEquipmentCalls.every(call =>
      !call.prompt.includes(priorTransaction) && !call.prompt.includes(priorAnswer)
    ), 'separate equipment purchase excludes earlier vendor invoice facts from provider prompts');

    const historicalYa2026Turn = {
      id: 'boundary-historical-ya2026-user',
      sender: 'user',
      timestamp: '',
      text: priorUnpaidExpensesYa2026
    };
    const callsBeforeHistoricalYa2026 = boundaryCalls.length;
    const historicalYa2026Response = await processAccountingQuery(
      priorUnpaidExpensesYa2026,
      activeScenario,
      'SFRS_I',
      adapters[2].settings,
      'unused',
      [...previousHistory, historicalYa2026Turn]
    );
    const historicalYa2026Calls = boundaryCalls.slice(callsBeforeHistoricalYa2026);
    assert.equal(historicalYa2026Response.conversationBoundaryMessageId, historicalYa2026Turn.id,
      'independent YA 2026 statutory question establishes its own conversation boundary');
    assert.ok(historicalYa2026Calls.length > 0,
      'independent YA 2026 statutory question reaches the provider');
    assert.ok(historicalYa2026Calls.every(call =>
      !call.prompt.includes(priorTransaction) && !call.prompt.includes(priorAnswer)
    ), 'independent YA 2026 statutory question excludes priorTransaction and priorAnswer from provider prompts');

    const interpretationQuestion = 'What documents are required by ACRA?';
    const interpretationHistory = [
      ...previousHistory,
      { id: 'boundary-cpf-user', sender: 'user', timestamp: '', text: interpretationQuestion }
    ];
    const callsBeforeInterpretation = boundaryCalls.length;
    await processAccountingQuery(
      interpretationQuestion, activeScenario, 'SFRS_I', adapters[2].settings, 'unused', interpretationHistory
    );
    assert.ok(boundaryCalls.length > callsBeforeInterpretation,
      'a governed statutory question invokes semantic interpretation with the mocked provider');
    const interpretationCall = boundaryCalls[callsBeforeInterpretation];
    assert.match(interpretationCall.prompt, /Interpret this question:/,
      'the test inspects the semantic interpretation request rather than only later evidence or generation');
    assert.ok(!interpretationCall.prompt.includes(priorTransaction) && !interpretationCall.prompt.includes(priorAnswer),
      'semantic interpretation never receives the prior unrelated transaction history');

    const rateCorrection = 'Actually the CPF contribution rate is 17%';
    const incompletePayrollScenario = {
      scenarioType: 'PAYROLL_CPF_SALARY', rawQuery: 'The employee salary is awaiting confirmation.',
      transactionTitle: 'Pending payroll facts', amount: 6000, functionalCurrency: 'SGD', transactionCurrency: 'SGD',
      directGroups: [], isComplete: false,
      missingFields: [{ fieldKey: 'salary', fieldName: 'Monthly salary', prompt: 'Please confirm the monthly salary.', whyNeeded: 'The payroll journal requires a confirmed salary.' }]
    };
    assert.equal(resolveFactAmendment(rateCorrection, incompletePayrollScenario).amendments?.[0]?.field, 'monthlySalary',
      'the negative control reproduces the generic amount parser mislabeling a CPF rate as salary');
    const rateUserTurn = { id: 'boundary-cpf-rate-user', sender: 'user', timestamp: '', text: rateCorrection };
    const rateHistory = [...previousHistory, rateUserTurn];
    const callsBeforeRateCorrection = boundaryCalls.length;
    const rateCorrectionResponse = await processAccountingQuery(
      rateCorrection, incompletePayrollScenario, 'SFRS_I', adapters[2].settings, 'unused', rateHistory
    );
    assert.equal(rateCorrectionResponse.conversationBoundaryMessageId, rateUserTurn.id,
      'a CPF rate statement does not retain an incomplete payroll scenario as a salary amendment');
    const rateInterpretationCall = boundaryCalls[callsBeforeRateCorrection];
    assert.match(rateInterpretationCall.prompt, /Interpret this question:/,
      'the CPF rate reaches semantic interpretation');
    assert.ok(!rateInterpretationCall.prompt.includes(priorTransaction) && !rateInterpretationCall.prompt.includes(priorAnswer),
      'semantic interpretation excludes old accounting history after the CPF rate correction');

    const statutoryQuestion = 'What are CPF contribution deadlines in Singapore?';
    const statutoryUserTurn = { id: 'boundary-standalone-statutory-user', sender: 'user', timestamp: '', text: statutoryQuestion };
    const statutoryHistory = [...previousHistory, statutoryUserTurn];
    const statutoryResponse = await processAccountingQuery(
      statutoryQuestion, null, 'SFRS_I', undefined, 'unused', statutoryHistory
    );
    assert.equal(statutoryResponse.scenarioState.queryIntent, 'STATUTORY_ADVISORY',
      'the test query follows the standalone statutory advisory path');
    assert.equal(statutoryResponse.conversationBoundaryMessageId, statutoryUserTurn.id,
      'the service returns the user turn selected as the standalone advisory boundary');
    const statutoryFollowUpQuestion = 'What about those deadlines?';
    const statutoryFollowUpTurn = { id: 'boundary-statutory-follow-up-user', sender: 'user', timestamp: '', text: statutoryFollowUpQuestion };
    const scopedStatutoryFollowUpHistory = buildAnalysisConversationHistory([
      ...statutoryHistory,
      { id: 'boundary-standalone-statutory-answer', sender: 'assistant', timestamp: '', text: statutoryResponse.messageText },
      statutoryFollowUpTurn
    ], statutoryResponse.conversationBoundaryMessageId);
    assert.deepEqual(scopedStatutoryFollowUpHistory.map(message => message.id), [
      statutoryUserTurn.id, 'boundary-standalone-statutory-answer', statutoryFollowUpTurn.id
    ], 'the follow-up history starts at the service-selected statutory boundary and excludes older analysis');
    const statutoryFollowUp = await processAccountingQuery(
      statutoryFollowUpQuestion, statutoryResponse.scenarioState, 'SFRS_I', undefined, 'unused', scopedStatutoryFollowUpHistory
    );
    assert.equal(statutoryFollowUp.scenarioState.rawQuery, statutoryFollowUpQuestion,
      'the contextual statutory follow-up is processed with the scoped history');

    // P1: Contextual references in follow-ups retain scoped employee facts and active scenario without resetting boundary
    const employeeSetupQuestion = 'For an employee aged 58 years old who is a second-year Singapore PR in 2026, what CPF rules apply?';
    const employeeSetupTurn = { id: 'boundary-employee-setup-user', sender: 'user', timestamp: '', text: employeeSetupQuestion };
    const employeeSetupScenario = {
      scenarioType: 'PAYROLL_CPF_SALARY',
      rawQuery: employeeSetupQuestion,
      transactionTitle: 'Employee CPF facts (58 years old, second-year Singapore PR, 2026)',
      amount: 5000,
      functionalCurrency: 'SGD',
      transactionCurrency: 'SGD',
      directGroups: [],
      missingFields: [],
      isComplete: true
    };
    const employeeSetupHistory = [...previousHistory, employeeSetupTurn];
    const employeeSetupResponse = await processAccountingQuery(
      employeeSetupQuestion, activeScenario, 'SFRS_I', adapters[2].settings, 'unused', employeeSetupHistory
    );
    assert.equal(employeeSetupResponse.conversationBoundaryMessageId, employeeSetupTurn.id,
      'the initial employee CPF inquiry establishes its boundary at the employee turn');
    const employeeSetupAnswerTurn = {
      id: 'boundary-employee-setup-answer',
      sender: 'assistant',
      timestamp: '',
      text: employeeSetupResponse.messageText,
      fullText: employeeSetupResponse.messageText
    };
    const employeeRateFollowUp = 'What CPF rates apply to the employee we just discussed?';
    assert.equal(
      assessConversationRelation(employeeRateFollowUp, employeeSetupScenario, employeeSetupScenario),
      'RELATED',
      'assessConversationRelation classifies an explicit contextual employee follow-up as RELATED'
    );
    assert.equal(
      assessConversationRelation(
        'What CPF rates apply to a 58-year-old employee? Ignore the employee we discussed earlier.',
        employeeSetupScenario,
        employeeSetupScenario
      ),
      'NEW',
      'assessConversationRelation classifies an explicit ignore instruction as NEW'
    );
    const employeeRateTurn = { id: 'boundary-employee-rate-user', sender: 'user', timestamp: '', text: employeeRateFollowUp };
    const scopedEmployeeRateHistory = buildAnalysisConversationHistory([
      ...employeeSetupHistory,
      employeeSetupAnswerTurn,
      employeeRateTurn
    ], employeeSetupResponse.conversationBoundaryMessageId);
    const callsBeforeEmployeeRate = boundaryCalls.length;
    const employeeRateResponse = await processAccountingQuery(
      employeeRateFollowUp, employeeSetupScenario, 'SFRS_I', adapters[2].settings, 'unused', scopedEmployeeRateHistory
    );
    assert.equal(employeeRateResponse.conversationBoundaryMessageId, undefined,
      'contextual employee follow-up does not reset conversationBoundaryMessageId');
    assert.ok(boundaryCalls.length > callsBeforeEmployeeRate, 'employee follow-up reaches the provider');
    const employeeRatePrompt = boundaryCalls.slice(callsBeforeEmployeeRate).map(call => call.prompt).join('\n');
    assert.ok(
      employeeRatePrompt.includes('58 years old') &&
      employeeRatePrompt.includes('second-year Singapore PR') &&
      employeeRatePrompt.includes('2026'),
      'contextual employee follow-up retains scoped age, PR status, and contribution-year facts'
    );
    assert.ok(
      employeeRatePrompt.includes(employeeSetupScenario.transactionTitle),
      'contextual employee follow-up retains the active scenario context'
    );
    assert.ok(
      !employeeRatePrompt.includes(priorTransaction) && !employeeRatePrompt.includes(priorAnswer),
      'contextual employee follow-up excludes older unrelated transaction history before the boundary'
    );

    for (const contextualQuery of [
      'What CPF rates apply to these employees?',
      'How does GST apply to the above transaction?',
      'What is the tax treatment in our earlier example?'
    ]) {
      const contextualTurn = { id: `boundary-contextual-${contextualQuery.length}`, sender: 'user', timestamp: '', text: contextualQuery };
      const scopedContextualHistory = buildAnalysisConversationHistory([
        ...employeeSetupHistory,
        employeeSetupAnswerTurn,
        contextualTurn
      ], employeeSetupResponse.conversationBoundaryMessageId);
      const callsBeforeContextual = boundaryCalls.length;
      const contextualResponse = await processAccountingQuery(
        contextualQuery, employeeSetupScenario, 'SFRS_I', adapters[2].settings, 'unused', scopedContextualHistory
      );
      assert.equal(contextualResponse.conversationBoundaryMessageId, undefined,
        `contextual reference follow-up retains boundary: ${contextualQuery}`);
      const contextualPrompts = boundaryCalls.slice(callsBeforeContextual).map(call => call.prompt).join('\n');
      assert.ok(
        contextualPrompts.includes('58 years old') &&
        contextualPrompts.includes('second-year Singapore PR') &&
        contextualPrompts.includes('2026'),
        `scoped employee facts remain in prompt for: ${contextualQuery}`
      );
      assert.ok(
        !contextualPrompts.includes(priorTransaction) && !contextualPrompts.includes(priorAnswer),
        `older pre-boundary transaction stays excluded for: ${contextualQuery}`
      );
    }

    const employeeObligationFollowUp = 'What CPF obligations apply to the employee we just discussed?';
    const employeeObligationTurn = { id: 'boundary-employee-obligation-user', sender: 'user', timestamp: '', text: employeeObligationFollowUp };
    const scopedObligationHistory = buildAnalysisConversationHistory([
      ...employeeSetupHistory,
      employeeSetupAnswerTurn,
      employeeObligationTurn
    ], employeeSetupResponse.conversationBoundaryMessageId);
    const callsBeforeObligation = boundaryCalls.length;
    const employeeObligationResponse = await processAccountingQuery(
      employeeObligationFollowUp, employeeSetupScenario, 'SFRS_I', adapters[2].settings, 'unused', scopedObligationHistory
    );
    assert.equal(employeeObligationResponse.conversationBoundaryMessageId, undefined,
      'governed statutory obligation follow-up does not reset conversationBoundaryMessageId');
    assert.ok(boundaryCalls.length > callsBeforeObligation,
      'governed statutory obligation follow-up invokes semantic interpretation');
    const obligationPrompt = boundaryCalls[callsBeforeObligation].prompt;
    assert.match(obligationPrompt, /Interpret this question:/,
      'governed statutory obligation follow-up sends scoped history to semantic interpretation');
    assert.ok(
      obligationPrompt.includes('58 years old') &&
      obligationPrompt.includes('second-year Singapore PR') &&
      obligationPrompt.includes('2026'),
      'semantic interpretation retains scoped employee age, PR status, and contribution year'
    );
    assert.ok(
      !obligationPrompt.includes(priorTransaction) && !obligationPrompt.includes(priorAnswer),
      'semantic interpretation excludes older pre-boundary transaction history'
    );

    // Finding 1: Negated or quoted reset directives retain scoped employee context; affirmative reset directives establish a new boundary
    const negatedResetQueries = [
      "Does that CPF rule apply? Don't forget that she is a second-year Singapore PR.",
      "Does that CPF rule apply? I don't want you to forget the earlier employee details.",
      'Does that CPF rule apply? Do not say "forget the earlier employee details".',
      'Does that apply? Please do not disregard the earlier employee details.',
      'Does that CPF rule apply? Please do not ignore or disregard the earlier employee details.',
      "Does that CPF rule apply? Don't ever forget that she is a second-year Singapore PR."
    ];
    for (const negatedResetQuery of negatedResetQueries) {
      assert.equal(hasAffirmativeResetDirective(negatedResetQuery), false,
        `negated reset directive is not treated as affirmative reset: ${negatedResetQuery}`);
      assert.equal(isShortSemanticFollowUp(negatedResetQuery), true,
        `negated reset directive remains a short semantic follow-up: ${negatedResetQuery}`);
      assert.equal(assessConversationRelation(negatedResetQuery, employeeSetupScenario, employeeSetupScenario), 'RELATED',
        `negated reset directive stays RELATED: ${negatedResetQuery}`);
    }
    for (const [index, retainedResetQuery] of [
      negatedResetQueries[0],
      negatedResetQueries[1],
      negatedResetQueries[2]
    ].entries()) {
      const retainedTurn = { id: `boundary-negated-forget-user-${index}`, sender: 'user', timestamp: '', text: retainedResetQuery };
      const scopedRetainedHistory = buildAnalysisConversationHistory([
        ...employeeSetupHistory,
        employeeSetupAnswerTurn,
        retainedTurn
      ], employeeSetupResponse.conversationBoundaryMessageId);
      const callsBeforeRetained = boundaryCalls.length;
      const retainedResponse = await processAccountingQuery(
        retainedResetQuery, employeeSetupScenario, 'SFRS_I', adapters[2].settings, 'unused', scopedRetainedHistory
      );
      assert.equal(retainedResponse.conversationBoundaryMessageId, undefined,
        `negated/quoted forget follow-up does not reset conversationBoundaryMessageId: ${retainedResetQuery}`);
      assert.ok(boundaryCalls.length > callsBeforeRetained,
        `negated/quoted forget follow-up reaches the provider: ${retainedResetQuery}`);
      const retainedPrompt = boundaryCalls.slice(callsBeforeRetained).map(call => call.prompt).join('\n');
      assert.ok(
        retainedPrompt.includes('58 years old') &&
        retainedPrompt.includes('second-year Singapore PR') &&
        retainedPrompt.includes('2026'),
        `negated/quoted forget follow-up retains scoped employee facts in provider prompt: ${retainedResetQuery}`
      );
      assert.ok(
        retainedPrompt.includes(employeeSetupScenario.transactionTitle),
        `negated/quoted forget follow-up retains active scenario in provider prompt: ${retainedResetQuery}`
      );
      assert.ok(
        !retainedPrompt.includes(priorTransaction) && !retainedPrompt.includes(priorAnswer),
        `negated/quoted forget follow-up still excludes pre-boundary transaction history: ${retainedResetQuery}`
      );
    }

    const affirmativeForgetQuery = 'Does that CPF rule apply? Forget that she is a second-year Singapore PR.';
    assert.equal(hasAffirmativeResetDirective(affirmativeForgetQuery), true);
    assert.equal(isShortSemanticFollowUp(affirmativeForgetQuery), false);
    assert.equal(assessConversationRelation(affirmativeForgetQuery, employeeSetupScenario, employeeSetupScenario), 'NEW');
    const affirmativeForgetTurn = { id: 'boundary-affirmative-forget-user', sender: 'user', timestamp: '', text: affirmativeForgetQuery };
    const affirmativeForgetHistory = [
      ...employeeSetupHistory,
      employeeSetupAnswerTurn,
      affirmativeForgetTurn
    ];
    const callsBeforeAffirmativeForget = boundaryCalls.length;
    const affirmativeForgetResponse = await processAccountingQuery(
      affirmativeForgetQuery, employeeSetupScenario, 'SFRS_I', adapters[2].settings, 'unused', affirmativeForgetHistory
    );
    assert.equal(affirmativeForgetResponse.conversationBoundaryMessageId, affirmativeForgetTurn.id,
      'affirmative forget reset establishes a new conversationBoundaryMessageId');
    const affirmativeForgetPrompt = boundaryCalls.slice(callsBeforeAffirmativeForget).map(call => call.prompt).join('\n');
    assert.ok(
      !affirmativeForgetPrompt.includes('58 years old') &&
      !affirmativeForgetPrompt.includes(employeeSetupScenario.transactionTitle),
      'affirmative forget reset clears prior employee history and active scenario from provider prompt'
    );

    // Finding 3: Detailed (>260 chars) contextual statutory follow-up retains employee context vs >300-char new employee transaction
    const detailedEmployeeFollowUp =
      'What CPF contribution rates apply to the employee we discussed if her monthly ordinary wages are SGD 5,000 and she also receives an annual bonus, and which employee facts from our earlier discussion still need to be confirmed before calculating the exact employer and employee CPF contributions for the year?';
    assert.ok(detailedEmployeeFollowUp.length > 300);
    assert.equal(isShortSemanticFollowUp(detailedEmployeeFollowUp), false,
      'detailed employee follow-up exceeds the 260-character short follow-up limit');
    assert.equal(hasExplicitPriorFactReference(detailedEmployeeFollowUp), true,
      'detailed employee follow-up is recognized via explicit prior-fact reference');
    assert.equal(assessConversationRelation(detailedEmployeeFollowUp, employeeSetupScenario, employeeSetupScenario), 'RELATED',
      'detailed employee follow-up is classified as RELATED');
    const detailedEmployeeTurn = { id: 'boundary-detailed-employee-user', sender: 'user', timestamp: '', text: detailedEmployeeFollowUp };
    const scopedDetailedEmployeeHistory = buildAnalysisConversationHistory([
      ...employeeSetupHistory,
      employeeSetupAnswerTurn,
      detailedEmployeeTurn
    ], employeeSetupResponse.conversationBoundaryMessageId);
    const callsBeforeDetailedEmployee = boundaryCalls.length;
    const detailedEmployeeResponse = await processAccountingQuery(
      detailedEmployeeFollowUp, employeeSetupScenario, 'SFRS_I', adapters[2].settings, 'unused', scopedDetailedEmployeeHistory
    );
    assert.equal(detailedEmployeeResponse.conversationBoundaryMessageId, undefined,
      'detailed contextual employee follow-up leaves conversationBoundaryMessageId as undefined');
    const detailedEmployeePrompt = boundaryCalls.slice(callsBeforeDetailedEmployee).map(call => call.prompt).join('\n');
    assert.ok(
      detailedEmployeePrompt.includes('58 years old') &&
      detailedEmployeePrompt.includes('second-year Singapore PR') &&
      detailedEmployeePrompt.includes('2026'),
      'detailed contextual employee follow-up retains scoped employee facts in provider prompt'
    );
    assert.ok(
      detailedEmployeePrompt.includes(employeeSetupScenario.transactionTitle),
      'detailed contextual employee follow-up retains active scenario in provider prompt'
    );
    assert.ok(
      !detailedEmployeePrompt.includes(priorTransaction) && !detailedEmployeePrompt.includes(priorAnswer),
      'detailed contextual employee follow-up excludes pre-boundary transaction history'
    );

    const longSeparateNewEmployee =
      'We hired a new employee on a monthly salary of SGD 5,000, separate from the employee we discussed earlier, and she will also receive a fixed monthly transport allowance and an annual performance bonus once her probation period ends. Which CPF contribution rates and wage ceiling rules apply to this new employment arrangement in Singapore?';
    assert.ok(longSeparateNewEmployee.length > 300);
    assert.equal(hasExplicitPriorFactReference(longSeparateNewEmployee), false);
    assert.equal(startsNewAccountingScenario(longSeparateNewEmployee, employeeSetupScenario), true);
    assert.equal(assessConversationRelation(longSeparateNewEmployee, employeeSetupScenario, employeeSetupScenario), 'NEW');

    // Finding 4: Hiring another employee or another worker starts a new accounting scenario
    for (const anotherHireQuery of [
      'We hired another employee for SGD 5,000 per month. What CPF rate applies?',
      'We hired another worker for SGD 4,500 per month. What CPF rate applies?'
    ]) {
      assert.equal(startsNewAccountingScenario(anotherHireQuery, employeeSetupScenario), true,
        `hiring another employee/worker starts a new accounting scenario: ${anotherHireQuery}`);
      assert.equal(assessConversationRelation(anotherHireQuery, employeeSetupScenario, employeeSetupScenario), 'NEW',
        `hiring another employee/worker is classified as NEW: ${anotherHireQuery}`);
    }

    const payrollInitTurn = {
      id: 'boundary-payroll-init-user',
      sender: 'user',
      timestamp: '',
      text: 'Calculate CPF for our employee earning $6,000 a month in 2026.'
    };
    const payrollClarificationReply = 'He is 58 years old and is a second-year Singapore PR';
    const payrollClarificationTurn = {
      id: 'boundary-payroll-clarification-user',
      sender: 'user',
      timestamp: '',
      text: payrollClarificationReply
    };
    const payrollClarificationHistory = [
      payrollInitTurn,
      { id: 'boundary-payroll-init-answer', sender: 'assistant', timestamp: '', text: 'Please confirm the employee age and residency status.' },
      payrollClarificationTurn
    ];
    const payrollClarificationResponse = await processAccountingQuery(
      payrollClarificationReply, incompletePayrollScenario, 'SFRS_I', adapters[2].settings, 'unused', payrollClarificationHistory
    );
    assert.equal(payrollClarificationResponse.conversationBoundaryMessageId, undefined,
      'factual clarification reply on an incomplete payroll scenario retains conversation context');
    const payrollPostClarificationFollowUpTurn = {
      id: 'boundary-payroll-post-clarification-follow-up',
      sender: 'user',
      timestamp: '',
      text: employeeRateFollowUp
    };
    const callsBeforePostClarification = boundaryCalls.length;
    const postClarificationResponse = await processAccountingQuery(
      employeeRateFollowUp,
      incompletePayrollScenario,
      'SFRS_I',
      adapters[2].settings,
      'unused',
      [
        ...payrollClarificationHistory,
        {
          id: 'boundary-payroll-clarification-answer',
          sender: 'assistant',
          timestamp: '',
          text: payrollClarificationResponse.messageText,
          fullText: payrollClarificationResponse.messageText
        },
        payrollPostClarificationFollowUpTurn
      ]
    );
    assert.equal(postClarificationResponse.conversationBoundaryMessageId, undefined,
      'follow-up after factual clarification reply retains the conversation boundary');
    const postClarificationPrompt = boundaryCalls.slice(callsBeforePostClarification).map(call => call.prompt).join('\n');
    assert.ok(
      postClarificationPrompt.includes('58 years old') &&
      postClarificationPrompt.includes('second-year Singapore PR') &&
      postClarificationPrompt.includes('2026'),
      'follow-up after factual clarification reply retains the clarified employee facts and initial payroll year'
    );

    // P2: Evaluate AI-first eligibility after clearing stale activeScenario for independent statutory requests
    const acraChangeQuestion = "Can you explain how to change the company's registered address with ACRA?";
    assert.equal(
      isAiFirstAdvisoryEligible(acraChangeQuestion, adapters[2].settings, false, activeScenario),
      false,
      'pre-check confirms stale activeScenario with state-change verb "change" previously blocked AI-first eligibility'
    );
    assert.equal(
      isAiFirstAdvisoryEligible(acraChangeQuestion, adapters[2].settings, false, null),
      true,
      'clearing activeScenario makes the independent ACRA explanation AI-first eligible'
    );
    const acraChangeTurn = { id: 'boundary-acra-change-user', sender: 'user', timestamp: '', text: acraChangeQuestion };
    const acraChangeHistory = [...previousHistory, acraChangeTurn];
    const callsBeforeAcraChange = boundaryCalls.length;
    const acraChangeResponse = await processAccountingQuery(
      acraChangeQuestion, activeScenario, 'SFRS_I', adapters[2].settings, 'unused', acraChangeHistory
    );
    assert.equal(acraChangeResponse.conversationBoundaryMessageId, acraChangeTurn.id,
      'independent ACRA change explanation establishes its boundary at the new ACRA turn');
    assert.equal(acraChangeResponse.displayFullAnswer, true,
      'independent ACRA change explanation is accepted by AI-first advisory after clearing stale context');
    assert.equal(boundaryCalls.length - callsBeforeAcraChange, 1,
      'AI-first advisory makes only 1 provider call without falling back through semantic interpretation');
    const acraChangePrompt = boundaryCalls.at(-1).prompt;
    assert.ok(
      !acraChangePrompt.includes(priorTransaction) &&
      !acraChangePrompt.includes(priorAnswer) &&
      !acraChangePrompt.includes(activeScenario.transactionTitle),
      'AI-first prompt excludes both prior transaction history and cleared activeScenario'
    );
  } finally {
    globalThis.fetch = boundaryFetch;
  }
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
  assert.equal(applicationResponse.answerPath, 'AI_GROUNDED_SYNTHESIS_FALLBACK',
    'case-specific legal applicability remains on the governed fallback after invalid synthesis');
  assert.notEqual(applicationResponse.answerPath, 'AI_FIRST_ADVISORY',
    'the unchecked AI-first answer is not used for a case-specific eligibility request');
  assert.equal(applicationResponse.advisoryFailureStatus, 'INVALID_RESPONSE',
    'the malformed synthesis retains its specific safe failure cause');
  assert.equal(applicationResponse.displayFullAnswer, true, 'the complete safe evidence fallback is displayed');
  assert.ok(applicationResponse.messageText.length > 0, 'the governed fallback remains useful and visible');
  assert.doesNotMatch(applicationResponse.messageText, /The company is exempt from audit\./,
    'the injected, unsupported original model claim is not shown');
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
  let journalProps;
  const nextUserMessageIdTime = class extends Date { static now() { return nextTimestamp++; } };
  const chatPanelComponent = function ChatPanelStub() {};
  const inputPanelComponent = function InputHandlerPanelStub() {};
  const journalTableComponent = function JournalTableStub() {};
  const components = new Map([
    ['./components/ChatPanel', { ChatPanel: chatPanelComponent }],
    ['./components/InputHandlerPanel', { InputHandlerPanel: inputPanelComponent }],
    ['./components/JournalTable', { JournalTable: journalTableComponent }]
  ]);
  const fakeReact = {
    createElement(type, props, ...children) {
      if (type === chatPanelComponent) chatProps = props;
      if (type === inputPanelComponent) inputProps = props;
      if (type === journalTableComponent) journalProps = props;
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
  let resolveDeferredProcessing;
  const scenarioA = { scenarioType: 'EXPENSE', rawQuery: offlineQuestion, transactionTitle: 'Transaction A', functionalCurrency: 'SGD', transactionCurrency: 'SGD', directGroups: [], missingFields: [], isComplete: true };
  const scenarioB = { ...scenarioA, rawQuery: laterTransactionText, transactionTitle: 'Transaction B' };
  const emptyScenario = { scenarioType: 'UNRECOGNIZED', rawQuery: '', transactionTitle: 'No current scenario', functionalCurrency: 'SGD', transactionCurrency: 'SGD', directGroups: [], missingFields: [], isComplete: false };
  const makeGroup = (id, title, authorityStatus, amount) => ({
    id, eventDate: '2026-10-01', title, summary: title,
    lines: [
      { id: id + '-debit', accountCode: '6000', accountName: 'Salary expense', category: 'EXPENSE', debit: amount, credit: 0, lineExplanation: title },
      { id: id + '-credit', accountCode: '2100', accountName: 'Salary payable', category: 'LIABILITY', debit: 0, credit: amount, lineExplanation: title }
    ],
    totalDebit: amount, totalCredit: amount, isBalanced: true, citations: [], rationalePoints: [], authorityStatus
  });
  const proposalScenario = {
    scenarioType: 'PAYROLL_CPF_SALARY', rawQuery: 'Proposal', transactionTitle: 'Proposed payroll', amount: 72000,
    functionalCurrency: 'USD', transactionCurrency: 'USD', isComplete: true, missingFields: [],
    assumptions: [{ id: 'assumption-usd', field: 'currency', assumedValue: 'USD', basisOrRationale: 'User-provided scenario', materiality: 'LOW' }],
    directGroups: [
      makeGroup('trusted-companion', 'Current trusted companion', 'DETERMINISTIC', 72000),
      makeGroup('collision', 'Proposed payroll entry', 'AI_PROPOSED', 72000)
    ]
  };
  const deterministicScenario = {
    ...proposalScenario, rawQuery: 'Confirmed payroll', transactionTitle: 'Confirmed payroll', amount: 60000, functionalCurrency: 'SGD', transactionCurrency: 'SGD',
    assumptions: [{ id: 'assumption-sgd', field: 'currency', assumedValue: 'SGD', basisOrRationale: 'User-provided scenario', materiality: 'LOW' }],
    directGroups: [makeGroup('collision', 'Committed payroll entry', 'DETERMINISTIC', 60000)]
  };
  const incompleteDeterministicScenario = {
    ...deterministicScenario, isComplete: false, committedDirectGroups: undefined
  };
  const salaryCorrection = 'Actually the monthly salary for CPF is 72k a month';
  const unrelatedConfirmedScenario = {
    ...deterministicScenario,
    scenarioType: 'GENERAL_EXPENSE',
    rawQuery: 'Paid an unrelated consulting expense of SGD 2,000',
    transactionTitle: 'Unrelated consulting expense',
    directGroups: [makeGroup('unrelated-confirmed', 'Unrelated confirmed journal', 'DETERMINISTIC', 2000)]
  };
  assert.strictEqual(selectAccountingScenarioForRequest(salaryCorrection, unrelatedConfirmedScenario, deterministicScenario), deterministicScenario,
    'a payroll salary correction stays bound to its committed payroll even when another confirmed journal is active');
  assert.strictEqual(selectAccountingScenarioForRequest(salaryCorrection, proposalScenario, deterministicScenario), deterministicScenario,
    'a payroll salary correction uses committed payroll facts instead of an AI-proposed active result');
  assert.strictEqual(selectAccountingScenarioForRequest('prepare the journal entry', incompleteDeterministicScenario, deterministicScenario), deterministicScenario,
    'an incomplete deterministic group does not replace the retained committed journal as accounting context');
  assert.strictEqual(selectAccountingScenarioForRequest('prepare the journal entry', {
    ...proposalScenario, directGroups: [makeGroup('proposal-only', 'Proposal only', 'AI_PROPOSED', 72000)]
  }, deterministicScenario), deterministicScenario,
  'an AI proposal alone does not qualify as a confirmed journal for a journal request');
  assert.deepEqual(getDisplayableUncommittedJournalGroups({
    ...proposalScenario,
    directGroups: [...proposalScenario.directGroups, { ...makeGroup('invalid', 'Invalid group', 'DETERMINISTIC', 72000), lines: [] }]
  }, 'SFRS_I'), [], 'an invalid group hides the entire proposal collection instead of producing an incomplete journal');

  const proposalRecallResponse = await processAccountingQuery(
    'show the double entry', null, 'SFRS_I', undefined, 'unused', [], undefined, undefined, proposalScenario
  );
  assert.match(proposalRecallResponse.messageText, /AI-Proposed Journal \(Not Confirmed\)/,
    'service recall clearly distinguishes a validated proposal from a committed journal');
  assert.doesNotMatch(proposalRecallResponse.messageText, /No Double Entry Available Yet/,
    'proposal recall does not contradict the visible proposal with an empty-journal heading');
  assert.equal(proposalRecallResponse.scenarioState.committedDirectGroups, undefined,
    'proposal recall does not mark the AI proposal as committed');
  const activeProposalRecallResponse = await processAccountingQuery(
    'show the double entry', proposalScenario, 'SFRS_I', undefined, 'unused', []
  );
  assert.match(activeProposalRecallResponse.messageText, /AI-Proposed Journal \(Not Confirmed\)/,
    'direct service callers also receive an unconfirmed explanation for a current AI proposal');
  assert.equal(activeProposalRecallResponse.scenarioState.committedDirectGroups, undefined,
    'direct service callers cannot promote an AI proposal to committed journal state');

  const equipmentScenario = await parseAccountingQuery(
    'My company incurred $50,000 on a piece of equipment. Give me the journal entry and tell me whether it is tax deductible.', null
  );
  assert.equal(equipmentScenario.scenarioType, 'BUSINESS_EQUIPMENT_ACQUISITION',
    'the App regression uses the real equipment-acquisition parser result');
  assert.equal(equipmentScenario.isComplete, true, 'the equipment scenario is complete under its conditional assumptions');
  const equipmentGroup = equipmentScenario.directGroups[0];
  assert.equal(equipmentGroup.authorityStatus, 'CONDITIONAL');
  const aiProposedEquipmentCompanion = {
    ...equipmentGroup,
    id: 'app-equipment-ai-proposed-companion',
    title: 'AI-proposed equipment companion',
    summary: 'A separate AI-proposed equipment event',
    authorityStatus: 'AI_PROPOSED',
    totalDebit: 1000,
    totalCredit: 1000,
    lines: equipmentGroup.lines.map((line, index) => ({
      ...line,
      id: `app-equipment-ai-proposed-line-${index + 1}`,
      debit: index === 0 ? 1000 : 0,
      credit: index === 0 ? 0 : 1000
    }))
  };
  const mixedConditionalProposalScenario = {
    ...equipmentScenario,
    directGroups: [equipmentGroup, aiProposedEquipmentCompanion]
  };
  const mixedDirectProposalRecall = await processAccountingQuery(
    'show the double entry', null, 'SFRS_I', undefined, 'unused', [], undefined, undefined, mixedConditionalProposalScenario
  );
  assert.match(mixedDirectProposalRecall.messageText, /Mixed Unconfirmed Journal \(Conditional and AI-Proposed\)/,
    'mixed CONDITIONAL and AI_PROPOSED recall uses an explicit mixed unconfirmed heading');
  assert.match(mixedDirectProposalRecall.messageText, /conditional entries that depend on current assumptions and unverified AI-proposed entries/i,
    'mixed recall explains both conditional assumption-dependent entries and unverified AI-proposed entries');
  assert.deepEqual(mixedDirectProposalRecall.scenarioState.directGroups.map(group => group.authorityStatus), ['CONDITIONAL', 'AI_PROPOSED'],
    'mixed recall preserves each group’s individual authorityStatus');
  assert.equal(mixedDirectProposalRecall.scenarioState.committedDirectGroups, undefined,
    'mixed unconfirmed recall leaves committedDirectGroups undefined');
  const mixedDirectActiveRecall = await processAccountingQuery(
    'show the double entry', mixedConditionalProposalScenario, 'SFRS_I', undefined, 'unused', []
  );
  assert.match(mixedDirectActiveRecall.messageText, /Mixed Unconfirmed Journal \(Conditional and AI-Proposed\)/,
    'active mixed CONDITIONAL and AI_PROPOSED recall also uses the mixed unconfirmed heading');
  assert.deepEqual(mixedDirectActiveRecall.scenarioState.directGroups.map(group => group.authorityStatus), ['CONDITIONAL', 'AI_PROPOSED']);
  assert.equal(mixedDirectActiveRecall.scenarioState.committedDirectGroups, undefined);

  const incompleteRecallResponse = await processAccountingQuery(
    'show the double entry', incompleteDeterministicScenario, 'SFRS_I', undefined, 'unused', []
  );
  assert.match(incompleteRecallResponse.messageText, /No Double Entry Available Yet/,
    'ordinary deterministic groups from an incomplete scenario are not described as committed');
  const retainedSnapshotResponse = await processAccountingQuery(
    'show the double entry', {
      ...incompleteDeterministicScenario,
      committedDirectGroups: deterministicScenario.directGroups
    }, 'SFRS_I', undefined, 'unused', []
  );
  assert.match(retainedSnapshotResponse.messageText, /most recent committed journal/i,
    'an explicitly retained committed snapshot remains recallable if the active scenario is incomplete');

  const serviceStub = {
    processAccountingQuery: async (...args) => {
      appCalls.push(args);
      const [query, requestScenario] = args;
      if (query === 'retry scoped question') {
        return appCalls.filter(call => call[0] === query).length === 1
          ? { messageText: 'Retryable answer.', scenarioState: scenarioB, advisoryFailureStatus: 'NETWORK' }
          : { messageText: 'Retried answer.', scenarioState: scenarioB };
      }
      if (query === 'deferred follow-up while processing') {
        return new Promise(resolve => { resolveDeferredProcessing = resolve; });
      }
      if (query === 'What are annual filing deadlines?') {
        return {
          messageText: 'The statutory answer is shown here.',
          scenarioState: { ...emptyScenario, queryIntent: 'STATUTORY_ADVISORY' },
          conversationBoundaryMessageId: args[5].find(message => message.sender === 'user' && message.text === query)?.id
        };
      }
      if (query === 'What did you say about the deadline?') {
        return { messageText: 'The follow-up answer.', scenarioState: emptyScenario };
      }
      if (/^(?:show|where is) the double entry$/i.test(query.trim())) {
        const proposal = args[8];
      if (proposal) {
          return processAccountingQuery(...args);
        }
        const hasConditional = proposal?.directGroups?.some(group => group.authorityStatus === 'CONDITIONAL');
        return requestScenario
          ? { messageText: 'Committed journal recalled.', scenarioState: requestScenario }
          : proposal
            ? { messageText: hasConditional ? 'Conditional Journal (Unconfirmed).' : 'AI-Proposed Journal (Not Confirmed).', scenarioState: proposal }
            : { messageText: 'No confirmed journal.', scenarioState: emptyScenario };
      }
      if (query === 'Actually the monthly salary for CPF is 72k a month') {
        return { messageText: 'Corrected payroll.', scenarioState: { ...deterministicScenario, amount: 72000, directGroups: [makeGroup('collision', 'Corrected payroll entry', 'DETERMINISTIC', 72000)] } };
      }
      if (appCalls.length === 1) return { messageText: 'Offline answer for transaction A.', scenarioState: scenarioA, advisoryFailureStatus: 'NETWORK' };
      return { messageText: 'Completed answer for transaction B.', scenarioState: scenarioB };
    }
  };
  const boundarySource = await readFile(new URL('../../src/services/conversationBoundary.ts', import.meta.url), 'utf8');
  const boundaryModule = { exports: {} };
  const boundaryRequire = id => id === './factAmendmentService'
    ? { resolveFactAmendment, isSingleMonthlySalaryAmendment }
    : ({})[id];
  vm.runInNewContext(ts.transpileModule(boundarySource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText, { module: boundaryModule, exports: boundaryModule.exports, require: boundaryRequire });
  const componentStub = new Proxy({}, { get: (_, name) => function ComponentStub() { void name; } });
  const moduleStubs = {
    react: reactExports,
    './services/geminiService': serviceStub,
    './services/conversationBoundary': boundaryModule.exports,
    './services/committedJournal': { getDisplayableUncommittedJournalGroups, selectAccountingScenarioForRequest, updateCommittedJournalScenario },
    './types/provider': { loadProviderSettings: () => ({ activeProvider: 'openai', openai: {}, azure: {}, gemini: { model: 'test' } }), saveProviderSettings() {} },
    './engine/accountingEngine': { calculateDoubleEntries: scenario => ({ groups: scenario.directGroups || [], financialImpact: { totalAssetsDelta: 0, totalLiabilitiesDelta: 0, totalEquityDelta: 0, pnlImpact: 0, ociImpact: 0, functionalCurrency: scenario.functionalCurrency || 'SGD' } }) },
    './utils/dateUtils': { getSingaporeTimestamp: () => '' },
    './utils/chatPresentation': { createChatPreview: text => text, extractOfficialAnswerLinks: () => [] },
    './utils/irasEvidencePresentation': { hasCurrentIrasEvidencePresentation: () => false },
    './utils/authorityEvidencePresentation': { hasCurrentAuthorityEvidencePresentation: () => false },
    './retrieval/regulatoryUpdateScheduler': { runDueRegulatoryChecks() {} },
    './components/ChatPanel': components.get('./components/ChatPanel'),
    './components/InputHandlerPanel': components.get('./components/InputHandlerPanel'),
    './components/JournalTable': components.get('./components/JournalTable'),
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
  const renderApp = () => { stateCursor = 0; appModule.exports.App(); return { chatProps, inputProps, journalProps }; };
  let appUi = renderApp();
  await appUi.chatProps.onSendMessage(offlineQuestion);
  appUi = renderApp();
  const failedTurn = appUi.chatProps.messages.find(message => message.advisoryRetryPayload)?.advisoryRetryPayload;
  assert.ok(failedTurn, 'App retains a retry action for transaction A while it is current');
  assert.deepEqual(Array.from(appCalls[0][5], message => message.text), [offlineQuestion],
    'the first request in an analysis contains only its own question');
  await appUi.chatProps.onSendMessage(`New question: ${laterTransactionText}`);
  appUi = renderApp();
  const newAnalysisQuestion = `New question: ${laterTransactionText}`;
  assert.deepEqual(Array.from(appCalls[1][5], message => message.text), [newAnalysisQuestion],
    'an explicit new analysis starts a fresh model history');
  await appUi.chatProps.onSendMessage('What did we discuss above?');
  appUi = renderApp();
  assert.deepEqual(Array.from(appCalls[2][5], message => message.text), [
    newAnalysisQuestion, 'Completed answer for transaction B.', 'What did we discuss above?'
  ], 'follow-ups retain messages from the current analysis and exclude older analysis history');
  const unrelatedNarrative = 'We paid a supplier $5,000 for consulting services';
  await appUi.chatProps.onSendMessage(unrelatedNarrative);
  appUi = renderApp();
  assert.ok(appUi.chatProps.messages.some(message => message.relationPrompt), 'an unrelated complete transaction still asks whether it is related');
  await appUi.chatProps.onResolveRelation(false);
  await new Promise(resolve => setTimeout(resolve, 0));
  appUi = renderApp();
  assert.deepEqual(Array.from(appCalls[3][5], message => message.text), [unrelatedNarrative],
    'choosing a separate analysis sends only the pending question and excludes the relation prompt');
  await appUi.chatProps.onSendMessage('Could you explain that?');
  appUi = renderApp();
  assert.deepEqual(Array.from(appCalls[4][5], message => message.text), [
    unrelatedNarrative, 'Completed answer for transaction B.', 'Could you explain that?'
  ], 'follow-ups after a separate-analysis choice stay within that new analysis');
  await appUi.chatProps.onSendMessage('retry scoped question');
  appUi = renderApp();
  const scopedFailure = appUi.chatProps.messages.find(message => message.advisoryRetryPayload && message.advisoryRetryPayload.text === 'retry scoped question')?.advisoryRetryPayload;
  assert.ok(scopedFailure, 'the current analysis retains its own retryable failure');
  const beforeScopedRetry = appCalls.length;
  appUi.chatProps.onRetryAiAnswer(scopedFailure.text, scopedFailure.scenarioSnapshot, scopedFailure.originalUserMessageId);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(appCalls.length, beforeScopedRetry + 1, 'a current-analysis retry still reaches the service');
  assert.deepEqual(Array.from(appCalls.at(-1)[5], message => message.text), [
    unrelatedNarrative, 'Completed answer for transaction B.', 'Could you explain that?',
    'Completed answer for transaction B.', 'retry scoped question'
  ], 'a retry includes only the current analysis prefix');
  appUi = renderApp();
  appUi.inputProps.onResetToDefaults();
  appUi = renderApp();
  const beforeResetRetry = appCalls.length;
  appUi.chatProps.onRetryAiAnswer(scopedFailure.text, scopedFailure.scenarioSnapshot, scopedFailure.originalUserMessageId);
  assert.equal(appCalls.length, beforeResetRetry, 'reset invalidates retries from the prior analysis');
  await appUi.chatProps.onSendMessage('A new question after reset');
  appUi = renderApp();
  assert.deepEqual(Array.from(appCalls.at(-1)[5], message => message.text), ['A new question after reset'],
    'the first post-reset request excludes earlier analysis messages');
  assert.ok(appUi.chatProps.messages.length > 8, 'reset preserves the visible chat transcript');
  const messagesBeforeHistoricalRetry = appUi.chatProps.messages;
  const activeScenarioBeforeHistoricalRetry = appUi.inputProps.scenario;
  appUi.chatProps.onRetryAiAnswer(failedTurn.text, failedTurn.scenarioSnapshot, failedTurn.originalUserMessageId);
  appUi = renderApp();
  assert.equal(appCalls.length, beforeResetRetry + 1, 'App refuses a historical retry before calling the accounting service');
  assert.equal(appUi.inputProps.scenario.transactionTitle, 'Transaction B', 'the latest transaction remains the active accounting scenario');
  assert.strictEqual(appUi.inputProps.scenario, activeScenarioBeforeHistoricalRetry, 'the retry does not replace current scenario state');
  assert.strictEqual(appUi.chatProps.messages, messagesBeforeHistoricalRetry, 'the retry does not append a stale assistant answer');

  await appUi.chatProps.onSendMessage('We paid a customer $3,000 for a separate service');
  appUi = renderApp();
  assert.ok(appUi.chatProps.isAwaitingRelation, 'the ambiguous transaction awaits a relation choice');
  appUi.inputProps.onResetToDefaults();
  appUi = renderApp();
  const callsBeforeCancelledRelation = appCalls.length;
  appUi.chatProps.onResolveRelation(true);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(appCalls.length, callsBeforeCancelledRelation, 'reset cancels a pending relation choice before it can send stale context');
  assert.equal(appUi.chatProps.isAwaitingRelation, false, 'reset clears the pending relation prompt');
  await appUi.chatProps.onSendMessage('A fresh analysis after pending reset');
  appUi = renderApp();
  assert.deepEqual(Array.from(appCalls.at(-1)[5], message => message.text), ['A fresh analysis after pending reset'],
    'the first question after cancelling a pending relation starts a clean history');
  await appUi.chatProps.onSendMessage('Can you expand on that?');
  appUi = renderApp();
  assert.deepEqual(Array.from(appCalls.at(-1)[5], message => message.text), [
    'A fresh analysis after pending reset', 'Completed answer for transaction B.', 'Can you expand on that?'
  ], 'a follow-up after the cancelled relation remains scoped to the fresh analysis');
  const deferredRequest = appUi.chatProps.onSendMessage('deferred follow-up while processing');
  appUi = renderApp();
  assert.equal(appUi.inputProps.resetDisabled, true, 'the reset control is disabled while processing');
  appUi.inputProps.onResetToDefaults();
  appUi = renderApp();
  assert.equal(appUi.inputProps.scenario.transactionTitle, 'Transaction B',
    'the reset handler also ignores a reset while a request is in flight');
  resolveDeferredProcessing({ messageText: 'Deferred answer completed.', scenarioState: scenarioB });
  await deferredRequest;
  appUi = renderApp();
  await appUi.chatProps.onSendMessage('Follow up after deferred response');
  appUi = renderApp();
  assert.deepEqual(Array.from(appCalls.at(-1)[5], message => message.text), [
    'A fresh analysis after pending reset', 'Completed answer for transaction B.', 'Can you expand on that?',
    'Completed answer for transaction B.', 'deferred follow-up while processing', 'Deferred answer completed.',
    'Follow up after deferred response'
  ], 'the next follow-up retains current-analysis history after a response completes');

  assert.equal(updateCommittedJournalScenario(null, proposalScenario, 'SFRS_I'), null,
    'a balanced AI proposal is excluded from the committed snapshot');
  assert.equal(selectAccountingScenarioForRequest('show the double entry', proposalScenario, null), null,
    'pure journal recall does not promote an AI proposal when no committed snapshot exists');
  assert.equal(getDisplayableUncommittedJournalGroups(proposalScenario, 'SFRS_I').length, 2,
    'a complete mixed result displays all valid current groups when it includes an AI proposal');
  appUi.inputProps.onResetToDefaults();
  appUi = renderApp();
  appUi.inputProps.onScenarioChange(proposalScenario);
  appUi = renderApp();
  assert.deepEqual(appUi.journalProps.groups.map(group => group.title), ['Current trusted companion', 'Proposed payroll entry'],
    'the App displays both the trusted companion and current proposal when no committed journal exists');
  assert.equal(appUi.journalProps.functionalCurrency, 'USD', 'proposal display uses its own currency');
  assert.equal(appUi.journalProps.assumptions[0].id, 'assumption-usd', 'proposal display uses its own assumptions');
  const proposalMarkup = renderToStaticMarkup(React.createElement(JournalTable, appUi.journalProps));
  assert.match(proposalMarkup, /AI Proposed/, 'the UI keeps the existing AI Proposed warning visible');
  await appUi.chatProps.onSendMessage('show the double entry');
  appUi = renderApp();
  assert.equal(appCalls.at(-1)[1], null, 'recalling a journal with no committed snapshot sends no committed context');
  assert.deepEqual(appUi.journalProps.groups.map(group => group.title), ['Current trusted companion', 'Proposed payroll entry'],
    'a pure recall keeps the active AI proposal visibly marked as proposed');

  appUi.inputProps.onScenarioChange(deterministicScenario);
  appUi = renderApp();
  appUi.inputProps.onScenarioChange(proposalScenario);
  appUi = renderApp();
  assert.deepEqual(appUi.journalProps.groups.map(group => group.title), ['Current trusted companion', 'Proposed payroll entry'],
    'all current groups are displayed separately when the proposal shares an ID with an older committed journal');
  assert.equal(appUi.journalProps.functionalCurrency, 'USD', 'proposal display preserves its currency when IDs collide');
  assert.equal(appUi.journalProps.assumptions[0].id, 'assumption-usd', 'proposal display preserves its assumptions when IDs collide');
  await appUi.chatProps.onSendMessage('show the double entry');
  appUi = renderApp();
  assert.strictEqual(appCalls.at(-1)[8], proposalScenario,
    'App supplies the current proposal separately when an older committed journal exists');
  assert.match(appUi.chatProps.messages.at(-1).fullText, /AI-Proposed Journal \(Not Confirmed\)/,
    'real service recall describes the current proposal rather than the older committed journal');
  assert.deepEqual(appUi.journalProps.groups.map(group => group.title), ['Current trusted companion', 'Proposed payroll entry'],
    'pure recall keeps the current proposed groups visible alongside the older committed snapshot');
  assert.equal(appUi.journalProps.functionalCurrency, 'USD', 'the current proposal recall preserves its currency');
  assert.equal(appUi.journalProps.groups[1].totalDebit, 72000, 'the current proposal recall preserves its amount');

  const correctionPromptCount = appUi.chatProps.messages.filter(message => message.relationPrompt).length;
  assert.equal(assessConversationRelation(salaryCorrection, deterministicScenario, deterministicScenario), 'RELATED',
    'the exact salary correction is identified as related to the existing payroll');
  assert.equal(assessConversationRelation('New analysis: ' + salaryCorrection, deterministicScenario, deterministicScenario), 'NEW',
    'an explicit request for a new analysis takes priority over the correction wording');
  await appUi.chatProps.onSendMessage(salaryCorrection);
  appUi = renderApp();
  assert.equal(appUi.chatProps.messages.filter(message => message.relationPrompt).length, correctionPromptCount,
    'the salary correction proceeds without a new relation confirmation after payroll recall');
  assert.equal(appUi.inputProps.scenario.amount, 72000, 'the App applies the corrected salary value');
  assert.equal(appCalls.at(-1)[1].amount, 60000, 'the correction request uses the previously committed salary facts');
  assert.equal(appCalls.at(-1)[1].scenarioType, 'PAYROLL_CPF_SALARY', 'the correction is routed with payroll context');
  assert.deepEqual(appUi.journalProps.groups.map(group => group.totalDebit), [72000],
    'the corrected App journal balances at the corrected amount');
  await appUi.chatProps.onSendMessage('What did you say about the deadline?');
  appUi = renderApp();
  assert.equal(appUi.inputProps.scenario.directGroups.length, 0,
    'the advisory-only response replaces the current scenario with no journal');
  assert.deepEqual(appUi.journalProps.groups.map(group => group.title), ['Corrected payroll entry'],
    'the last committed journal remains available while the advisory-only response is current');
  await appUi.chatProps.onSendMessage('show the double entry');
  appUi = renderApp();
  assert.deepEqual(appUi.journalProps.groups.map(group => group.title), ['Corrected payroll entry'],
    'journal recall still returns the prior committed entry after an advisory-only response');
  assert.equal(appUi.journalProps.groups[0].totalDebit, 72000,
    'the advisory-only response preserves the last committed amount');

  appUi.inputProps.onResetToDefaults();
  appUi = renderApp();
  await appUi.chatProps.onSendMessage('Start proposal recall analysis');
  appUi = renderApp();
  appUi.inputProps.onScenarioChange(proposalScenario);
  appUi = renderApp();
  await appUi.chatProps.onSendMessage('show the double entry');
  appUi = renderApp();
  assert.equal(appCalls.at(-1)[8], proposalScenario,
    'the App passes the active proposal separately for read-only journal recall');
  assert.match(appUi.chatProps.messages.at(-1).text, /AI-Proposed Journal \(Not Confirmed\)/,
    'the recall response matches the proposal shown in the journal table');
  assert.doesNotMatch(appUi.chatProps.messages.at(-1).text, /No Double Entry Available Yet/);
  assert.match(renderToStaticMarkup(React.createElement(JournalTable, appUi.journalProps)), /AI Proposed/,
    'recalling the proposal retains the existing warning in the journal table');

  const deterministicEquipmentCompanion = {
    ...equipmentGroup,
    id: 'app-equipment-deterministic-companion',
    title: 'Deterministic equipment companion',
    summary: 'A separate deterministic equipment event',
    authorityStatus: 'DETERMINISTIC',
    totalDebit: 1000,
    totalCredit: 1000,
    lines: equipmentGroup.lines.map((line, index) => ({
      ...line,
      id: `app-equipment-companion-line-${index + 1}`,
      debit: index === 0 ? 1000 : 0,
      credit: index === 0 ? 0 : 1000
    }))
  };
  const mixedEquipmentScenario = {
    ...equipmentScenario,
    directGroups: [equipmentGroup, deterministicEquipmentCompanion]
  };
  const conditionalEquipmentScenario = {
    ...equipmentScenario,
    directGroups: [equipmentGroup]
  };
  appUi.inputProps.onResetToDefaults();
  appUi = renderApp();
  appUi.inputProps.onScenarioChange(deterministicScenario);
  appUi = renderApp();
  appUi.inputProps.onScenarioChange(conditionalEquipmentScenario);
  appUi = renderApp();
  assert.deepEqual(appUi.journalProps.groups.map(group => group.authorityStatus), ['CONDITIONAL'],
    'the App displays a valid conditional-only equipment journal');
  assert.deepEqual(appUi.journalProps.groups.map(group => [group.totalDebit, group.totalCredit]), [[50000, 50000]]);
  assert.equal(appUi.journalProps.functionalCurrency, 'SGD');
  assert.match(renderToStaticMarkup(React.createElement(JournalTable, appUi.journalProps)), /Conditional Illustrative Entry/);
  await appUi.chatProps.onSendMessage('show the double entry');
  appUi = renderApp();
  assert.equal(appCalls.at(-1)[1], null,
    'a valid conditional proposal recall does not route the older committed journal as current context');
  assert.strictEqual(appCalls.at(-1)[8], conditionalEquipmentScenario);
  assert.match(appUi.chatProps.messages.at(-1).fullText, /Conditional Journal \(Unconfirmed\)/);
  assert.deepEqual(appUi.journalProps.groups.map(group => group.totalDebit), [50000]);
  assert.equal(appUi.journalProps.functionalCurrency, 'SGD');
  assert.match(renderToStaticMarkup(React.createElement(JournalTable, appUi.journalProps)), /Conditional Illustrative Entry/);

  appUi.inputProps.onResetToDefaults();
  appUi = renderApp();
  appUi.inputProps.onScenarioChange(mixedEquipmentScenario);
  appUi = renderApp();
  assert.deepEqual(appUi.journalProps.groups.map(group => group.authorityStatus), ['CONDITIONAL', 'DETERMINISTIC'],
    'the App displays the full validated mixed equipment collection');
  assert.deepEqual(appUi.journalProps.groups.map(group => [group.totalDebit, group.totalCredit]), [
    [50000, 50000], [1000, 1000]
  ], 'the App keeps each equipment group’s debit and credit amounts');
  assert.equal(appUi.journalProps.functionalCurrency, 'SGD', 'the equipment display keeps its functional currency');
  assert.match(renderToStaticMarkup(React.createElement(JournalTable, appUi.journalProps)), /Conditional Illustrative Entry/,
    'the existing conditional warning remains visible for the equipment journal');
  await appUi.chatProps.onSendMessage('show the double entry');
  appUi = renderApp();
  assert.strictEqual(appCalls.at(-1)[8], mixedEquipmentScenario,
    'App passes the active conditional equipment scenario through the read-only recall input');
  assert.match(appUi.chatProps.messages.at(-1).fullText, /Conditional Journal \(Unconfirmed\)/,
    'the App chat explains that the recalled equipment journal remains conditional');
  assert.deepEqual(appUi.journalProps.groups.map(group => group.totalDebit), [50000, 1000],
    'journal recall continues to display every validated equipment group');
  assert.equal(appUi.journalProps.functionalCurrency, 'SGD');
  assert.match(renderToStaticMarkup(React.createElement(JournalTable, appUi.journalProps)), /Conditional Illustrative Entry/,
    'the conditional warning remains visible after App-level recall');

  appUi.inputProps.onResetToDefaults();
  appUi = renderApp();
  appUi.inputProps.onScenarioChange(mixedConditionalProposalScenario);
  appUi = renderApp();
  assert.deepEqual(appUi.journalProps.groups.map(group => group.authorityStatus), ['CONDITIONAL', 'AI_PROPOSED'],
    'the App displays the mixed CONDITIONAL and AI_PROPOSED journal groups');
  const mixedPreRecallMarkup = renderToStaticMarkup(React.createElement(JournalTable, appUi.journalProps));
  assert.match(mixedPreRecallMarkup, /Conditional Illustrative Entry/);
  assert.match(mixedPreRecallMarkup, /AI Proposed/);
  await appUi.chatProps.onSendMessage('show the double entry');
  appUi = renderApp();
  assert.strictEqual(appCalls.at(-1)[8], mixedConditionalProposalScenario,
    'App passes the mixed CONDITIONAL and AI_PROPOSED scenario through the read-only recall input');
  assert.match(appUi.chatProps.messages.at(-1).fullText, /Mixed Unconfirmed Journal \(Conditional and AI-Proposed\)/,
    'App recall chat message explicitly labels the mixed unconfirmed journal');
  assert.match(appUi.chatProps.messages.at(-1).fullText, /conditional entries that depend on current assumptions and unverified AI-proposed entries/i);
  assert.deepEqual(appUi.journalProps.groups.map(group => group.authorityStatus), ['CONDITIONAL', 'AI_PROPOSED'],
    'App recall preserves each group’s individual authorityStatus');
  const mixedPostRecallMarkup = renderToStaticMarkup(React.createElement(JournalTable, appUi.journalProps));
  assert.match(mixedPostRecallMarkup, /Conditional Illustrative Entry/);
  assert.match(mixedPostRecallMarkup, /AI Proposed/);

  appUi.inputProps.onResetToDefaults();
  appUi = renderApp();
  await appUi.chatProps.onSendMessage('What are annual filing deadlines?');
  appUi = renderApp();
  assert.equal(appCalls.at(-1)[5]?.some(message => message.text === 'What are annual filing deadlines?'), true,
    `the standalone statutory question is sent to the service (${appUi.inputProps.scenario?.transactionTitle}; ${appUi.chatProps.messages.at(-1)?.text})`);
  await appUi.chatProps.onSendMessage('What did you say about the deadline?');
  appUi = renderApp();
  assert.deepEqual(Array.from(appCalls.at(-1)[5], message => message.text), [
    'What are annual filing deadlines?', 'The statutory answer is shown here.', 'What did you say about the deadline?'
  ], 'the App persists the service-selected statutory boundary for the next contextual follow-up');
} finally {
  globalThis.fetch = originalFetch;
  delete globalThis.localStorage;
}

console.log('AI-first advisory regression passed: scoped analysis history, proposal display, salary correction, provider-safe failures, offline fallback and retry.');
