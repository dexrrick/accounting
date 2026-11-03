import fs from 'node:fs/promises';
import { processAccountingQuery } from '../../src/services/geminiService.ts';
const questions = [
  'What is accrual accounting, and how does it differ from cash accounting?',
  'Explain GST input tax and output tax, including the conditions that matter for a business.'
];
const calls = [];
globalThis.fetch = async (url, options) => {
  const body = JSON.parse(options?.body || '{}');
  calls.push({ url: String(url).split('?')[0], inputCharacters: JSON.stringify(body).length });
  const payload = JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ directAnswer: 'General explanatory context: accrual accounting records economic activity when it occurs; cash accounting follows cash receipts and payments.', keyRules: [], caveats: [], statuteReferences: [] }) }] } }] });
  return new Response(String(url).includes('streamGenerateContent') ? `data: ${payload}\n\n` : payload, { status: 200, headers: { 'content-type': String(url).includes('streamGenerateContent') ? 'text/event-stream' : 'application/json' } });
};
const results = [];
for (const question of questions) {
  const start = calls.length;
  const response = await processAccountingQuery(question, null, 'SFRS_I', 'mock-phase1-key-not-a-secret');
  results.push({ question, messageText: response.messageText, scenarioType: response.scenarioState.scenarioType, calls: calls.slice(start) });
}
await fs.writeFile(new URL('./baseline-examples.json', import.meta.url), JSON.stringify({ baseline: '863daf4299540ed0a50d808b07c1ee0e617b284b', kind: 'MOCKED_PROVIDER_ROUTING_NOT_LIVE_ANSWER_QUALITY', results }, null, 2));
console.log('Baseline examples saved.');
