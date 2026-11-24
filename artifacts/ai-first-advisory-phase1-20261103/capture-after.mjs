import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { processAccountingQuery } from '../../src/services/geminiService.ts';
import { SafeChatAnswer } from '../../src/components/SafeChatAnswer.tsx';
const baseline = JSON.parse(await fs.readFile(new URL('./baseline-examples.json', import.meta.url), 'utf8'));
const explanations = [
  {
    directAnswer: 'Accrual accounting recognizes economic activity as it occurs, while cash accounting follows cash receipts and payments.',
    explanation: ['Under accrual accounting, an expense can be recognized before it is paid, with an outstanding liability until settlement. Revenue and cash collection can also occur in different periods.', 'Cash accounting tracks receipts and payments. That can make cash movements easier to follow, but it can omit outstanding balances from the picture of performance.'],
    accountingTreatment: ['Choose the applicable reporting basis before deciding how the activity is recognized. An accrual explanation does not itself authorize a journal or establish missing transaction facts.'],
    conditions: ['The appropriate application depends on the reporting framework and the facts of the transaction.'], sourceIds: []
  },
  {
    directAnswer: 'Input tax relates to GST on business purchases; output tax relates to GST on business supplies.',
    explanation: ['A business should distinguish GST charged on its supplies from GST incurred on purchases. These are different sides of the GST position.', 'Recovery of purchase GST depends on the purpose of the purchase and the applicable restrictions. A business expense is not automatically a recoverable GST amount.'],
    accountingTreatment: ['Consider whether purchase GST is recoverable before deciding whether it forms part of the cost or remains a recoverable balance.'],
    conditions: ['Registration, the nature of the supply and purchase, supporting documents and the relevant period can affect the conclusion.', 'GST is 9 percent and the filing deadline is 30 November.'], sourceIds: ['fabricated-source']
  }
];
const results = [];
for (const [index, entry] of baseline.results.entries()) {
  const calls = [];
  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(options?.body || '{}');
    const prompt = body.contents?.[0]?.parts?.[0]?.text || '';
    calls.push({ inputCharacters: JSON.stringify(body).length, currentQuestionOccurrences: prompt.split(entry.question).length - 1, priorFullAnswerPresent: prompt.includes('Earlier complete answer retained the unresolved applicability condition.'), provider: 'mock-gemini' });
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(explanations[index]) }] } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const response = await processAccountingQuery(entry.question, null, 'SFRS_I', 'mock-phase1-key-not-a-secret', undefined, [
    { id: 'prior-user', sender: 'user', timestamp: '', text: 'Please keep the unresolved applicability condition in view.' },
    { id: 'prior-answer', sender: 'assistant', timestamp: '', text: 'Preview', fullText: 'Earlier complete answer retained the unresolved applicability condition.' },
    { id: 'current', sender: 'user', timestamp: '', text: entry.question }
  ]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].currentQuestionOccurrences, 1);
  assert.equal(calls[0].priorFullAnswerPresent, true);
  assert.equal(response.displayFullAnswer, true);
  const html = renderToStaticMarkup(React.createElement(SafeChatAnswer, { text: response.messageText, trustedLinks: response.scenarioState.officialAnswerLinks || [] }));
  assert.match(html, /Direct Answer/);
  assert.match(html, /Explanation/);
  assert.doesNotMatch(response.messageText, /9 percent|30 November|fabricated-source/);
  results.push({ question: entry.question, before: entry.messageText, after: response.messageText, displayFullAnswer: response.displayFullAnswer, calls, renderedHtmlCharacters: html.length });
}
await fs.writeFile(new URL('./before-after-examples.json', import.meta.url), JSON.stringify({ kind: 'MOCKED_ROUTING_AND_CONTEXT_EVIDENCE_NOT_LIVE_MODEL_QUALITY', baseline: baseline.baseline, results }, null, 2));
console.log('Identical-question before/after and context evidence passed.');
