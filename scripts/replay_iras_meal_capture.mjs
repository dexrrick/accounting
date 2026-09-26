// Replays genuine captured Gemini output through production post-processing.
// No provider, retrieval, or credential access is performed by this script.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { parseAccountingQuery } from '../src/engine/scenarioParser.ts';
import { postProcessAIResponse } from '../src/services/groundingContextBuilder.ts';
import { defaultSourceRetriever } from '../src/retrieval/sourceRetriever.ts';

const directory = 'docs/evaluation/iras-live-2026-09-26';
const records = (await readFile(`${directory}/mixed-meal-default-capture.jsonl`, 'utf8'))
  .trim().split(/\r?\n/).map(JSON.parse);
const capture = records.find(record => record.recordType === 'case');
assert.ok(capture?.gemini.answerCandidateText, 'A genuine generated answer is required.');
const capturedContext = capture.groundingContextSupplied;
const context = { ...capturedContext, primaryEvidence: [], officialGuidance: [], curatedSummaries: [] };
for (const captured of capturedContext.evidence) {
  const record = defaultSourceRetriever.getSourceById(captured.id);
  assert.ok(record, `Captured local record must still exist: ${captured.id}`);
  assert.equal(record.sourceText, captured.sourceText, 'Replay cannot substitute different evidence.');
  assert.equal(record.sourceStatus, captured.sourceStatus, 'Replay cannot upgrade source validation.');
  if (record.evidenceTier === 'PRIMARY_SOURCE' && ['VERIFIED', 'HISTORICAL'].includes(record.sourceStatus) && record.isVerbatimText) {
    context.primaryEvidence.push(record);
  } else if (record.evidenceTier === 'OFFICIAL_GUIDANCE') {
    context.officialGuidance.push(record);
  } else {
    context.curatedSummaries.push(record);
  }
}
const parsed = JSON.parse(capture.gemini.answerCandidateText);
globalThis.fetch = async () => { throw new Error('Network access is forbidden during captured-answer replay.'); };
const deterministicScenario = await parseAccountingQuery(capture.question, null);
const replay = postProcessAIResponse(parsed, null, capture.question, context, deterministicScenario, 'SFRS_I');
const journalAmounts = response => (response.scenarioState?.directGroups || []).map(group =>
  group.lines.map(line => ({ accountName: line.accountName, debit: line.debit, credit: line.credit })));
assert.deepEqual(journalAmounts(replay), journalAmounts(capture.finalResponse), 'Valid original journal must survive unchanged.');
assert.ok(replay.messageText.includes('business entertaining expenses are recognized as operating expenses in profit or loss when incurred'));
assert.doesNotMatch(replay.messageText, /input tax on business entertainment[^.]*generally disallowed/i);
assert.match(replay.messageText, /Before assessing a claim, confirm:/);
for (const group of replay.scenarioState.directGroups || []) {
  assert.equal(group.lines.reduce((sum, line) => sum + line.debit, 0), group.lines.reduce((sum, line) => sum + line.credit, 0));
}
await writeFile(`${directory}/mixed-meal-guard-replay.json`, JSON.stringify({
  kind: 'DETERMINISTIC_REPLAY_OF_REAL_CAPTURE',
  newLiveProviderRun: false,
  sourceCapture: 'mixed-meal-default-capture.jsonl',
  caseId: capture.caseId,
  checkedAt: new Date().toISOString(),
  checks: { originalEvidenceUnchanged: true, unsupportedClaimCorrected: true, accountingTextPreserved: true, journalAmountsUnchanged: true, journalBalanced: true },
  originalGeminiCandidate: parsed,
  finalResponse: replay
}, null, 2) + '\n');
console.log('Captured Gemini answer replay passed: unsupported claim corrected; accounting and balanced SGD 200 journal preserved.');
