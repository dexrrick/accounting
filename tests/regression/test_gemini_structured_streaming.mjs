import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { executeStructuredLlmCall } from '../../src/services/aiTransport.ts';
import { processAccountingQuery } from '../../src/services/geminiService.ts';
import { ChatPanel } from '../../src/components/ChatPanel.tsx';

const API_KEY = 'test-gemini-api-key-123456';
const PROMPT = 'question prompt';
const SYSTEM = 'system instruction';
const MODEL = 'gemini-stream-test';
const SCHEMA = { type: 'object', properties: { answer: { type: 'string' } }, required: ['answer'] };
const originalFetch = globalThis.fetch;
const encoder = new TextEncoder();

function requestBody() {
  return {
    contents: [{ role: 'user', parts: [{ text: PROMPT }] }],
    generationConfig: {
      responseFormat: { text: { mimeType: 'APPLICATION_JSON', schema: SCHEMA } },
      temperature: 0.1
    },
    systemInstruction: { parts: [{ text: SYSTEM }] }
  };
}

function responseWithSse(chunks, options = {}) {
  return new Response(new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(typeof chunk === 'string' ? encoder.encode(chunk) : chunk);
      controller.close();
    },
    cancel: options.onCancel
  }), { status: 200, headers: { 'content-type': 'text/event-stream; charset=utf-8' } });
}

function candidateFrame(text, finishReason) {
  return JSON.stringify({ candidates: [{ content: { parts: [{ text }] }, ...(finishReason ? { finishReason } : {}) }] });
}

function installFetch(handler) {
  const requests = [];
  globalThis.fetch = async (input, init) => {
    const request = { url: String(input), init };
    requests.push(request);
    return handler(request, requests.length - 1);
  };
  return requests;
}

function streamingOptions(onProgress, extra = {}) {
  return { model: MODEL, jsonMode: true, responseJsonSchema: SCHEMA, onProgress, ...extra };
}

try {
  {
    const progress = [];
    let releaseFinalFrame;
    let resolveProgress;
    const progressSeen = new Promise(resolve => { resolveProgress = resolve; });
    const finalFrameGate = new Promise(resolve => { releaseFinalFrame = resolve; });
    const firstCandidate = JSON.stringify({ content: { parts: [{ text: '{"answer":"🚀' }] } });
    const firstFrame = `data: {"candidates":[\r\ndata: ${firstCandidate}]}\r\n\r\n`;
    const firstBytes = encoder.encode(firstFrame);
    const rocket = encoder.encode('🚀');
    let rocketIndex = -1;
    for (let i = 0; i <= firstBytes.length - rocket.length; i += 1) {
      if (rocket.every((byte, offset) => firstBytes[i + offset] === byte)) { rocketIndex = i; break; }
    }
    assert.ok(rocketIndex >= 0, 'multibyte text fixture contains the rocket character');
    const finalFrames = [
      `data: ${candidateFrame(' revenue"}', 'STOP')}\r\n\r\n`,
      'data: {"usageMetadata":{"candidatesTokenCount":1}}\r\n\r\n',
      'data: [DONE]\r\n\r\n'
    ].join('');
    const requests = installFetch(() => new Response(new ReadableStream({
      async start(controller) {
        controller.enqueue(firstBytes.slice(0, rocketIndex + 1));
        controller.enqueue(firstBytes.slice(rocketIndex + 1));
        await finalFrameGate;
        controller.enqueue(encoder.encode(finalFrames));
        controller.close();
      }
    }), { status: 200, headers: { 'content-type': 'text/event-stream; charset=utf-8' } }));

    let settled = false;
    const resultPromise = executeStructuredLlmCall(PROMPT, SYSTEM, API_KEY, streamingOptions(stage => {
      progress.push(stage);
      resolveProgress();
    })).then(result => { settled = true; return result; });
    await progressSeen;
    assert.deepEqual(progress, ['receiving'], 'only a constant, non-content stage is emitted');
    assert.equal(settled, false, 'progress arrives before the final candidate frame');
    assert.equal(JSON.stringify(progress).includes('🚀'), false, 'progress contains no generated text');
    releaseFinalFrame();
    assert.equal(await resultPromise, '{"answer":"🚀 revenue"}');
    assert.equal(requests.length, 1, 'streaming uses exactly one provider request');
    assert.equal(requests[0].url, `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:streamGenerateContent?alt=sse`);
    assert.deepEqual(JSON.parse(requests[0].init.body), requestBody(), 'streaming preserves the structured request body and schema');
  }

  {
    const requests = installFetch(() => new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: '{"answer":"buffered"}' }] } }]
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const progress = [];
    assert.equal(await executeStructuredLlmCall(PROMPT, SYSTEM, API_KEY, {
      model: MODEL, jsonMode: true, responseJsonSchema: SCHEMA
    }), '{"answer":"buffered"}');
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, 'no observer keeps the existing buffered endpoint');
    assert.deepEqual(progress, []);
  }

  {
    const requests = installFetch(() => new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: '{"answer":"json fallback"}' }] } }]
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const progress = [];
    assert.equal(await executeStructuredLlmCall(PROMPT, SYSTEM, API_KEY, streamingOptions(stage => progress.push(stage))), '{"answer":"json fallback"}');
    assert.equal(requests.length, 1, 'JSON content-type fallback consumes the same response without retry');
    assert.equal(requests[0].url, `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:streamGenerateContent?alt=sse`);
    assert.deepEqual(JSON.parse(requests[0].init.body), requestBody());
    assert.deepEqual(progress, ['receiving']);
  }

  for (const observer of [
    () => { throw new Error('observer failure'); },
    () => Promise.reject(new Error('observer rejection'))
  ]) {
    const requests = installFetch(() => responseWithSse([
      `data: ${candidateFrame('{"answer":"observer isolation"}', 'STOP')}\r\n\r\n`
    ]));
    assert.equal(await executeStructuredLlmCall(PROMPT, SYSTEM, API_KEY, streamingOptions(observer)), '{"answer":"observer isolation"}');
    assert.equal(requests.length, 1, 'observer failures cannot add a retry');
  }

  for (const [label, payload] of [
    ['malformed SSE JSON', '{not json}'],
    ['provider error frame', JSON.stringify({ error: { message: 'private response text' } })],
    ['safety finish', candidateFrame('{"answer":"blocked"}', 'SAFETY')],
    ['token-limit finish', candidateFrame('{"answer":"truncated"}', 'MAX_TOKENS')],
    ['missing terminal finish', candidateFrame('{"answer":"partial"}')]
  ]) {
    installFetch(() => responseWithSse([`data: ${payload.replaceAll('\n', '\ndata: ')}\r\n\r\n`]));
    const emitted = [];
    await assert.rejects(
      executeStructuredLlmCall(PROMPT, SYSTEM, API_KEY, streamingOptions(stage => emitted.push(stage))),
      undefined,
      label
    );
    assert.ok(emitted.every(stage => stage === 'receiving'), `${label}: no provider content is emitted`);
  }

  {
    installFetch(() => responseWithSse([
      `data: ${candidateFrame('{"answer":"complete"}', 'STOP')}\r\n\r\n`,
      `data: ${candidateFrame('late text')}\r\n\r\n`
    ]));
    const emitted = [];
    await assert.rejects(
      executeStructuredLlmCall(PROMPT, SYSTEM, API_KEY, streamingOptions(stage => emitted.push(stage))),
      undefined,
      'candidate content after STOP is rejected'
    );
    assert.deepEqual(emitted, ['receiving'], 'late candidate content is never emitted');
  }

  {
    let resolveProgress;
    const progressSeen = new Promise(resolve => { resolveProgress = resolve; });
    let cancelled = false;
    installFetch(() => new Response(new ReadableStream({
      start(controller) { controller.enqueue(encoder.encode(`data: ${candidateFrame('{"answer":"partial"}')}\r\n\r\n`)); },
      cancel() { cancelled = true; }
    }), { status: 200, headers: { 'content-type': 'text/event-stream' } }));
    const controller = new AbortController();
    const pending = executeStructuredLlmCall(PROMPT, SYSTEM, API_KEY, streamingOptions(() => resolveProgress(), { signal: controller.signal }));
    await progressSeen;
    controller.abort();
    await assert.rejects(pending, error => error?.name === 'AbortError', 'aborted streams are discarded');
    assert.equal(cancelled, true, 'abort cancels the stream reader');
  }

  {
    const question = 'What is accrual accounting, and how does it differ from cash accounting?';
    const provider = { activeProvider: 'gemini', gemini: { apiKey: API_KEY, model: MODEL }, azure: {}, openai: {} };
    const responseText = JSON.stringify({
      directAnswer: 'Accrual accounting records activity as it occurs, while cash accounting follows receipts and payments.',
      explanation: ['The methods recognize activity at different times.'],
      accountingTreatment: [], conditions: [], sourceIds: []
    });

    const defaultRequests = installFetch(() => new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: responseText }] } }]
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const defaultAnswer = await processAccountingQuery(question, null, 'SFRS_I', provider, MODEL, []);
    assert.equal(defaultAnswer.displayFullAnswer, true, 'the actual AI-first path returns its validated full answer');
    assert.equal(defaultRequests.length, 1);
    assert.match(defaultRequests[0].url, /:generateContent$/, 'processAccountingQuery remains buffered when diagnostics are omitted');

    const progress = [];
    const optedInRequests = installFetch(() => responseWithSse([
      `data: ${candidateFrame(responseText.slice(0, 30))}\r\n\r\n`,
      `data: ${candidateFrame(responseText.slice(30), 'STOP')}\r\n\r\n`
    ]));
    const answer = await processAccountingQuery(question, null, 'SFRS_I', provider, MODEL, [], undefined, {
      onProgress: stage => progress.push(stage)
    });
    progress.push('settled');
    assert.equal(answer.displayFullAnswer, true);
    assert.match(answer.messageText, /Accrual accounting records activity as it occurs/);
    assert.deepEqual(progress, ['receiving', 'checking', 'settled'], 'checking precedes the validated answer becoming available');
    assert.equal(optedInRequests.length, 1, 'opt-in progress preserves the single provider call');
    assert.match(optedInRequests[0].url, /:streamGenerateContent\?alt=sse$/);
  }

  {
    const previousLocalStorage = globalThis.localStorage;
    globalThis.localStorage = { getItem: () => null, setItem: () => undefined };
    try {
      const markup = renderToStaticMarkup(React.createElement(ChatPanel, {
        messages: [{ id: 'user-turn', sender: 'user', timestamp: '', text: 'Check the response.' }],
        onSendMessage: () => undefined, onRetryMessage: () => undefined, onRetryAiAnswer: () => undefined,
        onSelectSuggestion: () => undefined, onResolveRelation: () => undefined,
        isLoading: true, progressStage: 'checking', isAwaitingRelation: false,
        outputPreference: { journal: false, statutory: false }, onOutputPreferenceChange: () => undefined
      }));
      assert.match(markup, /role="status" aria-live="polite"/);
      assert.match(markup, /Checking the answer/);
      assert.doesNotMatch(markup, /UNVERIFIED_DRAFT_CONTENT/);
    } finally {
      if (previousLocalStorage === undefined) delete globalThis.localStorage;
      else globalThis.localStorage = previousLocalStorage;
    }
  }

  console.log('Gemini structured streaming is opt-in, buffered by default, terminal-checked, and emits no generated content as progress.');
} finally {
  globalThis.fetch = originalFetch;
}
