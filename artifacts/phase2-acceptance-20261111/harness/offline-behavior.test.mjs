import test from 'node:test';
import assert from 'node:assert/strict';
import { awaitActive, classifyModelStage, createRequestQueue, resolveCaseStatus, validateParentCapture, validateRevisionSnapshot } from './run-live.mjs';

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

test('offline runner pacing, cap, stop, and stage behavior', async () => {
  let oldTransportCalls = 0;
  const oldApp = new AbortController();
  const oldRunner = new AbortController();
  const oldWait = deferred();
  const oldPath = (async () => {
    await oldWait.promise;
    if (oldRunner.signal.aborted) throw new Error('runner timeout');
    oldTransportCalls += 1;
  })();
  oldApp.abort();
  oldWait.resolve();
  await oldPath;
  assert.equal(oldTransportCalls, 1, 'historical app-signal omission dispatches after pacing');

  let transportCalls = 0;
  const app = new AbortController();
  const runner = new AbortController();
  const wait = deferred();
  const guardedPath = (async () => {
    await awaitActive(wait.promise, [app.signal, runner.signal]);
    transportCalls += 1;
  })();
  app.abort();
  wait.resolve();
  await assert.rejects(guardedPath, { name: 'AbortError' });
  assert.equal(transportCalls, 0, 'shared runner guard prevents transport dispatch');

  const queue = createRequestQueue(2);
  const first = await queue.acquire([]);
  assert.equal(first.commit(), 1);
  const controller = new AbortController();
  const waiting = queue.acquire([controller.signal]);
  controller.abort();
  first.release();
  await assert.rejects(waiting, { name: 'AbortError' });
  const second = await queue.acquire([]);
  assert.equal(second.commit(), 2);
  second.release();
  const concurrentQueue = createRequestQueue(2);
  const concurrent = await Promise.allSettled(Array.from({ length: 5 }, async () => {
    const permit = await concurrentQueue.acquire([]);
    const number = permit.commit();
    await Promise.resolve();
    permit.release();
    return number;
  }));
  assert.equal(concurrent.filter(result => result.status === 'fulfilled').length, 2);
  assert.equal(concurrentQueue.count, 2);
  const denied = concurrent.filter(result => result.status === 'rejected');
  assert.equal(denied.length, 3);
  assert.ok(denied.every(result => result.reason.code === 'MODEL_REQUEST_CAP_REACHED'));

  assert.equal(classifyModelStage('Interpret the user question only.'), 'understanding');
  assert.equal(classifyModelStage('EVIDENCE_GROUNDED_SYNTHESIS\nbody'), 'evidence-grounded-synthesis');
  assert.equal(classifyModelStage('EVIDENCE_GROUNDED_SUPPORT_VERIFICATION\nbody'), 'evidence-grounded-support-verification');
  assert.equal(classifyModelStage('[4. AUTHORITATIVE PRIMARY SOURCE EVIDENCE]'), 'answer-generation');
  assert.equal(classifyModelStage('other stage'), 'other');

  assert.equal(resolveCaseStatus('COMPLETED', { capReached: true }), 'INCONCLUSIVE_MODEL_REQUEST_CAP');
  assert.equal(resolveCaseStatus('COMPLETED', { pacingFailure: true }), 'INCONCLUSIVE_PACING_FAILURE');
  assert.equal(resolveCaseStatus('COMPLETED', { providerFailure: true }), 'INCONCLUSIVE_PROVIDER_FAILURE');
  assert.equal(resolveCaseStatus('COMPLETED', {}), 'COMPLETED');
  assert.equal(resolveCaseStatus('COMPLETED', { revisionFailure: true }), 'INCONCLUSIVE_REVISION_CHANGED');

  const head = 'a'.repeat(40);
  const parentCase = { id: 'mom-parent', question: 'Original parent question.' };
  const followup = { parentCaseId: parentCase.id };
  const capture = {
    caseId: parentCase.id, question: parentCase.question, expectedHead: head,
    sourceRevision: { head, dirty: false, untrackedSourceFiles: [] },
    stopRemainingCases: false, status: 'COMPLETED',
    finalResponse: { messageText: 'Captured answer.', advisoryFailureStatus: null },
    noJournalCheck: { noJournalProduced: true }
  };
  assert.equal(validateParentCapture(followup, parentCase, capture, head), capture);
  const invalidCaptures = [
    { ...capture, caseId: 'different-case' },
    { ...capture, question: 'Different question.' },
    { ...capture, sourceRevision: { ...capture.sourceRevision, head: 'b'.repeat(40) } },
    { ...capture, sourceRevision: { ...capture.sourceRevision, dirty: true } },
    { ...capture, sourceRevision: { ...capture.sourceRevision, untrackedSourceFiles: ['src/untracked.ts'] } },
    { ...capture, stopRemainingCases: true },
    { ...capture, status: 'INCONCLUSIVE_PROVIDER_FAILURE' },
    { ...capture, finalResponse: { ...capture.finalResponse, advisoryFailureStatus: 'OTHER' } },
    { ...capture, finalResponse: { advisoryFailureStatus: null } },
    { ...capture, noJournalCheck: { noJournalProduced: false } }
  ];
  for (const invalid of invalidCaptures) assert.throws(() => validateParentCapture(followup, parentCase, invalid, head));

  assert.equal(validateRevisionSnapshot(head, { head, trackedDirty: false, untrackedSourceFiles: [] }).head, head);
  for (const drift of [
    { head: 'b'.repeat(40), trackedDirty: false, untrackedSourceFiles: [] },
    { head, trackedDirty: true, untrackedSourceFiles: [] },
    { head, trackedDirty: false, untrackedSourceFiles: ['src/new.ts'] },
    { head, trackedDirty: false }
  ]) assert.throws(() => validateRevisionSnapshot(head, drift), { code: 'FROZEN_REVISION_CHANGED' });
});
