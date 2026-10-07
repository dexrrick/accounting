import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, open, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = 'D:/Accounting';
const GIT = 'C:/Users/Admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/native/git/cmd/git.exe';
const BASE = 'artifacts/iras-v4-acceptance-repaired-2026-10-06';
const PREP = `${BASE}/preparation`;
const EXEC = `${BASE}/execution`;
const CAPTURE = `${BASE}/official-capture-recovery-2026-10-07`;
const PREVIOUS = `${BASE}/official-capture`;
const SEMANTIC = `${BASE}/semantic-run-v4`;
const RUNNER = `${PREP}/runner-configuration.json`;
const PREREG = `${PREP}/preregistration.json`;
const ACTIVATION = `${PREP}/activation-configuration.json`;
const FREEZE = `${PREP}/freeze-validation.json`;
const PLAN = `${EXEC}/capture-recovery-plan.json`;
const LOCK = `${CAPTURE}/evidence-lock.json`;
const RESULT = `${EXEC}/capture-recovery-completion.json`;
const FAILURE = `${EXEC}/capture-recovery-completion-failure.json`;
const BLOCKER = 'docs/evaluation/multi-authority-workstreams/iras-v4-negative-controls-2026-10-06/block-external-network.mjs';
const LAUNCHER = 'scripts/iras_v4_capture_replay_runner.mjs';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const abs = relative => path.resolve(ROOT, relative);
const CAPTURE_INPUTS = ['capture-reserved.json', 'capture-partial.jsonl', 'capture-payload.json', 'capture-result.json']
  .map(name => `${CAPTURE}/${name}`);
const ORIGINAL_INPUTS = [`${PREVIOUS}/capture-reserved.json`, `${PREVIOUS}/capture-partial.jsonl`];
const ERROR_CODE = /^[A-Z][A-Z0-9_:-]{0,119}$/;

async function assertPath(relative, allowMissingLast = false) {
  let current = ROOT;
  const parts = relative.split(/[\\/]+/);
  for (let i = 0; i < parts.length; i += 1) {
    current = path.join(current, parts[i]);
    try { assert.equal((await lstat(current)).isSymbolicLink(), false, 'FINALIZER_SYMLINK_REJECTED'); }
    catch (error) { if (allowMissingLast && i === parts.length - 1 && error?.code === 'ENOENT') return; throw error; }
  }
}
async function bytes(relative) {
  await assertPath(relative);
  assert.ok((await lstat(abs(relative))).isFile(), 'FINALIZER_INPUT_NOT_FILE');
  return await readFile(abs(relative));
}
async function json(relative) { return JSON.parse((await bytes(relative)).toString('utf8')); }
async function absent(relative) {
  await assertPath(relative, true);
  try { await lstat(abs(relative)); throw new Error('FINALIZER_OUTPUT_EXISTS'); }
  catch (error) { if (error?.code !== 'ENOENT') throw error; }
}
async function exclusiveJson(relative, value) {
  await assertPath(relative, true);
  const handle = await open(abs(relative), 'wx');
  try { await handle.writeFile(JSON.stringify(value, null, 2) + '\n'); await handle.sync(); }
  finally { await handle.close(); }
}
async function hashes(paths) { return Object.fromEntries(await Promise.all(paths.map(async p => [p, sha(await bytes(p))]))); }

let phase = 'PREFLIGHT';
let mayWriteFailure = false;
let sourceHashes;
try {
  assert.equal(Number(process.versions.node.split('.')[0]), 22, 'FINALIZER_REQUIRES_NODE_22');
  assert.equal(path.resolve(process.cwd()), path.resolve(ROOT), 'FINALIZER_WRONG_ROOT');
  assert.equal(path.resolve(process.env.CODEX_GIT_EXECUTABLE || ''), path.resolve(GIT), 'FINALIZER_GIT_PATH_MISMATCH');
  await import(pathToFileURL(abs(BLOCKER)).href);
  const runner = await import(pathToFileURL(abs(LAUNCHER)).href);
  const [freezeBytes, freeze, plan, binding, preregBytes, activationBytes, activation, captureBytes, journalBytes,
    markerBytes, failureBytes, captureResult] = await Promise.all([
    bytes(FREEZE), json(FREEZE), json(PLAN), json(RUNNER), bytes(PREREG), bytes(ACTIVATION), json(ACTIVATION),
    bytes(`${CAPTURE}/capture-payload.json`), bytes(`${CAPTURE}/capture-partial.jsonl`),
    bytes(`${CAPTURE}/capture-reserved.json`), bytes(`${CAPTURE}/capture-result.json`), json(`${CAPTURE}/capture-result.json`)
  ]);
  assert.equal(sha(freezeBytes), 'c381c4728cdd1ae0788576e938114109c6c1314b4738c4c3e16e16dbc7d99ec1');
  assert.deepEqual(Object.keys(freeze.bindings).sort(), [RUNNER, PREREG, ACTIVATION].sort());
  assert.equal(sha(await bytes(RUNNER)), freeze.bindings[RUNNER]);
  assert.equal(sha(preregBytes), freeze.bindings[PREREG]);
  assert.equal(sha(activationBytes), freeze.bindings[ACTIVATION]);
  assert.equal(plan.status, 'INDEPENDENTLY_REVIEWED_AUTHORIZED_RECOVERY');
  assert.equal(plan.recoveryCaptureDirectory, CAPTURE);
  assert.equal(plan.previousCaptureDirectory, PREVIOUS);
  assert.equal(plan.semanticNamespace, SEMANTIC);
  assert.equal(plan.transportRetries, 0);
  assert.equal(plan.retainedResponseCount, 11);
  assert.equal(plan.maximumUnresolvedPreviousRequests, 1);
  assert.equal(plan.freshApprovedRequestCount, 15);
  assert.equal(plan.retainedResponseCount + plan.maximumUnresolvedPreviousRequests + plan.freshApprovedRequestCount, 27);
  assert.ok(plan.aggregateMaximumRequests === 27 && plan.aggregateMaximumRequests <= plan.originalMaximumRequests && plan.originalMaximumRequests === 60);
  assert.ok(plan.aggregateMaximumRequestsPerFamily === 6 && plan.aggregateMaximumRequestsPerFamily <= plan.originalMaximumRequestsPerFamily && plan.originalMaximumRequestsPerFamily === 10);
  assert.equal(plan.captureInventorySha256, freeze.captureInventorySha256);
  assert.equal(captureResult.status, 'FAILED_NO_AUTOMATIC_RETRY');
  assert.equal(captureResult.failureCode, 'CAPTURE_PAYLOAD_DOCUMENT_MISMATCH');
  const oldHashes = await hashes(ORIGINAL_INPUTS);
  assert.equal(oldHashes[ORIGINAL_INPUTS[0]], plan.previousReservedMarkerSha256);
  assert.equal(oldHashes[ORIGINAL_INPUTS[1]], plan.previousJournalSha256);
  assert.equal((await bytes(ORIGINAL_INPUTS[1])).toString('utf8').trim().split(/\r?\n/).length, 11);
  await absent(LOCK); await absent(RESULT); await absent(FAILURE); await absent(SEMANTIC); mayWriteFailure = true;
  sourceHashes = await hashes([...CAPTURE_INPUTS, ...ORIGINAL_INPUTS]);
  assert.equal(sha(captureBytes), sourceHashes[`${CAPTURE}/capture-payload.json`]);
  const payload = JSON.parse(captureBytes.toString('utf8'));
  const journal = journalBytes.toString('utf8').trim().split(/\r?\n/).map(line => JSON.parse(line));
  assert.equal(sha(markerBytes), sourceHashes[`${CAPTURE}/capture-reserved.json`]);
  assert.equal(sha(failureBytes), sourceHashes[`${CAPTURE}/capture-result.json`]);
  assert.deepEqual(journal, payload.entries);
  assert.equal(payload.captureStatus, 'COMPLETE'); assert.equal(payload.synthetic, false);
  assert.equal(payload.requestCount, 15); assert.equal(payload.entries.length, 15);
  const inventory = activation.captureInventory.filter(row => row.purpose !== 'REDIRECT');
  assert.equal(inventory.length, 15);
  for (let i = 0; i < inventory.length; i += 1) {
    const wanted = inventory[i], entry = payload.entries[i];
    assert.deepEqual(entry.request, { family: wanted.family, url: wanted.url, method: wanted.method, headers: wanted.headers });
    assert.equal(entry.inventoryPurpose, wanted.purpose);
    assert.equal(entry.actualUrl, wanted.url); assert.equal(entry.status, 200); assert.equal(entry.failure, null);
  }
  phase = 'CAPTURE_PAYLOAD_VALIDATION';
  const capability = await runner.loadReviewedV4ExecutionCapability({ activationConfigurationPath: abs(ACTIVATION), root: ROOT, gitExecutable: GIT });
  assert.equal(capability.captureInventorySha256, plan.captureInventorySha256);
  const prereg = JSON.parse(preregBytes.toString('utf8'));
  const validation = runner.validateCapturePayload(payload, {
    expectedIntegrityBindingSha256: binding.integrityBindingSha256, expectedPreregistrationSha256: sha(preregBytes),
    expectedActivationConfigurationSha256: capability.activationConfigurationSha256,
    expectedActivationConfigurationFileSha256: capability.activationConfigurationFileSha256,
    expectedCaptureInventory: inventory, syntheticMode: false, requireComplete: true
  });
  phase = 'FROZEN_REPLAY_VALIDATION';
  const replay = runner.createReplayTransport({ payload, integrityLatch: () => {}, expectedIntegrityBindingSha256: binding.integrityBindingSha256,
    expectedPreregistrationSha256: sha(preregBytes), executionCapability: capability,
    activationConfigurationSha256: capability.activationConfigurationSha256, expectedCaptureInventory: inventory });
  const retriever = runner.bindProductionControlledRetriever({ transport: replay });
  const replayed = await capability.runV4CapturePlan({ captureInventory: inventory, webRetriever: retriever, withEvidenceFamily: replay.withEvidenceFamily });
  replay.assertHealthy(); assert.equal(replay.replayLookupCount, 15); assert.equal(replayed.rows.length, 15);
  for (let i = 0; i < replayed.rows.length; i += 1) {
    const row = replayed.rows[i], wanted = inventory[i], entry = payload.entries[i];
    const textBytes = Buffer.from(Buffer.from(entry.bodyBase64, 'base64').toString('utf8'), 'utf8');
    assert.equal(row.status, 'SUCCESS'); assert.equal(row.httpStatus, 200); assert.equal(row.url, wanted.url);
    assert.equal(row.finalUrl, wanted.url); assert.deepEqual(row.sourceRecordIds, wanted.provenance.sourceRecordIds);
    assert.deepEqual(row.topicIds, wanted.provenance.topicIds); assert.equal(row.contentBytes, textBytes.length);
    assert.equal(row.contentSha256, sha(textBytes));
  }
  assert.deepEqual(await hashes([...CAPTURE_INPUTS, ...ORIGINAL_INPUTS]), sourceHashes);
  phase = 'EVIDENCE_LOCK';
  const locked = await runner.writeFrozenEvidenceLock({ outputPath: abs(LOCK), payloadPath: abs(`${CAPTURE}/capture-payload.json`),
    runnerConfigurationPath: abs(RUNNER), activationConfigurationPath: abs(ACTIVATION), preregistrationPath: abs(PREREG),
    gitExecutable: GIT, root: ROOT });
  assert.deepEqual(await hashes([...CAPTURE_INPUTS, ...ORIGINAL_INPUTS]), sourceHashes);
  phase = 'COMPLETION_RECORD';
  const completion = { profile: 'iras-v4-recovery-capture-finalization', status: 'CAPTURE_EVIDENCE_LOCKED_SEMANTIC_HELD',
    recoveryPlanSha256: sha(await bytes(PLAN)), capturePayloadSha256: sourceHashes[`${CAPTURE}/capture-payload.json`],
    captureJournalSha256: sourceHashes[`${CAPTURE}/capture-partial.jsonl`], captureMarkerSha256: sourceHashes[`${CAPTURE}/capture-reserved.json`],
    failedCaptureResultSha256: sourceHashes[`${CAPTURE}/capture-result.json`], evidenceLockSha256: locked.sha256,
    captureInventorySha256: capability.captureInventorySha256, captureRequestCount: 15, successfulReplayLookupCount: replay.replayLookupCount,
    sourceEvidenceExpiresAtUtc: new Date(Date.parse(validation.earliestAcquisitionAt) + 24 * 60 * 60_000).toISOString(),
    semanticStatus: 'HELD_RESOURCE', semanticCalls: 0, providerApiCalls: 0, networkBlocked: true, finalizedAtUtc: new Date().toISOString() };
  await exclusiveJson(RESULT, completion);
} catch (error) {
  if (mayWriteFailure) {
    const raw = String(error?.code === 'ERR_ASSERTION' ? error?.message : error?.code || error?.message || 'FINALIZATION_FAILED').split(/[\r\n]/, 1)[0].trim();
    const failure = { profile: 'iras-v4-recovery-capture-finalization', status: 'FAILED', phase,
      failureCode: ERROR_CODE.test(raw) ? raw : 'FINALIZATION_FAILED', recordedAtUtc: new Date().toISOString() };
    try { await exclusiveJson(FAILURE, failure); } catch { /* preserve all existing outputs */ }
  }
  throw error;
}
