// One-shot launcher for the frozen post-repair IRAS capture and nine-case semantic run.
// --check is offline and read-only. Live modes require new human authorization and
// independent resource review bound to this exact namespace and launcher.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile } from 'node:fs/promises';
import dgram from 'node:dgram';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import path from 'node:path';
import tls from 'node:tls';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = 'D:/Accounting';
const GIT = 'C:/Users/Admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/native/git/cmd/git.exe';
const REVIEWED_COMMIT = '66bdb77777f945f19d17cfe1559f4d6f9f9acfae';
const BRANCH = 'codex/multi-authority-workstreams';
const ARTIFACT_ROOT = 'artifacts/iras-v4-acceptance-repaired-2026-10-06/post-repair-2026-10-08';
const PREPARATION = `${ARTIFACT_ROOT}/preparation`;
const EXECUTION = `${ARTIFACT_ROOT}/execution`;
const CAPTURE = `${ARTIFACT_ROOT}/official-capture`;
const SEMANTIC_NAMESPACE = 'artifacts/iras-v4-acceptance-repaired-2026-10-06/semantic-run-v4-post-repair-2026-10-08';
const LAUNCHER_PATH = `${EXECUTION}/launch.mjs`;
const RUNNER_PATH = `${PREPARATION}/runner-configuration.json`;
const PREREGISTRATION_PATH = `${PREPARATION}/preregistration.json`;
const ACTIVATION_PATH = `${PREPARATION}/activation-configuration.json`;
const FREEZE_VALIDATION_PATH = `${PREPARATION}/freeze-validation.json`;
const AUTHORIZATION_REQUEST_PATH = `${PREPARATION}/authorization-request.json`;
const AUTHORIZATION_PATH = `${EXECUTION}/authorization.json`;
const APPROVAL_EVIDENCE_PATH = `${EXECUTION}/approval-evidence.json`;
const RESOURCE_PROJECTION_PATH = `${EXECUTION}/resource-projection.json`;
const RESOURCE_REVIEW_PATH = `${EXECUTION}/resource-authorization-review.json`;
const CAPTURE_OUTPUTS = Object.freeze({
  marker: `${CAPTURE}/capture-reserved.json`,
  journal: `${CAPTURE}/capture-partial.jsonl`,
  payload: `${CAPTURE}/capture-payload.json`,
  evidenceLock: `${CAPTURE}/evidence-lock.json`,
  result: `${CAPTURE}/capture-result.json`
});
const MODEL = 'gemini-3.5-flash-lite';
const THREAD_ID = '01a11bd1-82cd-7d90-bc8f-2e7a6b764aa1';
const EXPECTED_FREEZE_VALIDATION_SHA256 = 'e27209aef958ddc8512edb09fe108544da26c9cd76c0aa8c5f52b88ce8666442';
const EXPECTED_AUTHORIZATION_REQUEST_SHA256 = '56ed641e0d787a74ee42326b477b5e19a889d82e3b08f093b7794a0771b9149c';
const EXPECTED_RESOURCE_PROJECTION_SHA256 = '934a8ac5f93731d959bfc4256f7a907753268770b731c5810b42b0f91cd6de88';
const EXPECTED_RUNNER_CONFIGURATION_SHA256 = 'f7712ede781edb10e6057d17d1d3a373d48b2f6825c7793377ccbcaf85f69852';
const EXPECTED_PREREGISTRATION_SHA256 = 'feafc2a67e0cf56da4f71d3d6424b1ef23b0b4344a4e27e39d403eec62451aeb';
const EXPECTED_ACTIVATION_SHA256 = '9e0f55d7d4e72555f51cf9f280cf5e959b8cadd1245c2e08a8e515f772c1b1fc';
const EXPECTED_CAPTURE_INVENTORY_SHA256 = '131b62d87bd13dfd53e1613b914179f7d472ad32df37f12ad946977ac0dff5bf';
const FROZEN_BINDINGS = Object.freeze({
  [RUNNER_PATH]: EXPECTED_RUNNER_CONFIGURATION_SHA256,
  [PREREGISTRATION_PATH]: EXPECTED_PREREGISTRATION_SHA256,
  [ACTIVATION_PATH]: EXPECTED_ACTIVATION_SHA256
});
const EXPECTED_QUOTA_SCOPE = 'Current explicit human quota confirmation for gemini-3.5-flash-lite, exactly nine one-per-case calls, configured credential, 8000 ms timeout, zero retries or probes, 15250 ms minimum start gap, and no additional requests; fresh allowance gate required.';
const EXECUTION_INPUTS = Object.freeze([
  LAUNCHER_PATH,
  RUNNER_PATH,
  PREREGISTRATION_PATH,
  ACTIVATION_PATH,
  FREEZE_VALIDATION_PATH,
  AUTHORIZATION_REQUEST_PATH,
  RESOURCE_PROJECTION_PATH,
  APPROVAL_EVIDENCE_PATH,
  AUTHORIZATION_PATH,
  RESOURCE_REVIEW_PATH
]);
const CAPTURE_FAILURE_CODE_RE = /^[A-Z][A-Z0-9_:-]{0,119}$/;
const sha256 = value => createHash('sha256').update(value).digest('hex');
const abs = relative => path.resolve(ROOT, relative);
const logPhase = (phase, status, details = {}) => console.log(JSON.stringify({ phase, status, ...details }));
const codedError = code => Object.assign(new Error(code), { code });

function parseMode(args) {
  assert.ok(Array.isArray(args) && args.length <= 1, 'INVALID_LAUNCH_ARGUMENTS');
  const argument = args[0] || '--check';
  assert.ok(['--check', '--capture', '--semantic'].includes(argument), 'INVALID_LAUNCH_ARGUMENTS');
  return argument.slice(2);
}

function safeFailureCode(error, fallback = 'EXECUTION_FAILED') {
  const candidate = String(error?.code === 'ERR_ASSERTION' ? error?.message : error?.code || error?.message || '')
    .split(/[\r\n]/, 1)[0].trim();
  return CAPTURE_FAILURE_CODE_RE.test(candidate) ? candidate : fallback;
}

function assertRelativePath(relative) {
  assert.equal(typeof relative, 'string', 'LAUNCH_PATH_INVALID');
  assert.ok(relative.length > 0 && !path.isAbsolute(relative), 'LAUNCH_PATH_INVALID');
  assert.ok(!relative.split(/[\\/]+/).includes('..'), 'LAUNCH_PATH_TRAVERSAL');
  const absolute = abs(relative);
  const fromRoot = path.relative(path.resolve(ROOT), absolute);
  assert.ok(fromRoot && !fromRoot.startsWith('..') && !path.isAbsolute(fromRoot), 'LAUNCH_PATH_OUTSIDE_ROOT');
  return absolute;
}

async function assertNoSymlinkPath(relative, { allowMissing = false } = {}) {
  const absolute = assertRelativePath(relative);
  const fromRoot = path.relative(path.resolve(ROOT), absolute);
  let cursor = path.resolve(ROOT);
  for (const part of fromRoot.split(path.sep)) {
    cursor = path.join(cursor, part);
    try {
      const info = await lstat(cursor);
      assert.equal(info.isSymbolicLink(), false, 'LAUNCH_SYMLINK_PATH_REJECTED');
    } catch (error) {
      if (allowMissing && error?.code === 'ENOENT') return false;
      throw error;
    }
  }
  return true;
}

async function readRaw(relative) {
  await assertNoSymlinkPath(relative);
  return await readFile(abs(relative));
}

async function readJson(relative) {
  const bytes = await readRaw(relative);
  let value;
  try { value = JSON.parse(bytes.toString('utf8')); }
  catch { throw codedError('FROZEN_JSON_INVALID'); }
  assert.ok(value && typeof value === 'object' && !Array.isArray(value), 'FROZEN_JSON_INVALID');
  return { value, bytes, sha256: sha256(bytes) };
}

async function assertAbsent(relative) {
  await assertNoSymlinkPath(relative, { allowMissing: true });
  try {
    await lstat(abs(relative));
    throw codedError('OUTPUT_ALREADY_EXISTS');
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw error;
  }
}

async function assertPresentFile(relative) {
  await assertNoSymlinkPath(relative);
  const info = await lstat(abs(relative));
  assert.ok(info.isFile(), 'INPUT_NOT_REGULAR_FILE');
}

export function assertRawSha256(raw, expectedSha256, failureCode = 'PINNED_INPUT_HASH_MISMATCH') {
  assert.match(String(expectedSha256 || ''), /^[a-f0-9]{64}$/, 'PINNED_INPUT_HASH_INVALID');
  assert.equal(sha256(raw), expectedSha256, failureCode);
  return true;
}

async function loadPreparedContext({ live = false } = {}) {
  const launcher = await readRaw(LAUNCHER_PATH);
  const basePaths = [RUNNER_PATH, PREREGISTRATION_PATH, ACTIVATION_PATH, FREEZE_VALIDATION_PATH,
    AUTHORIZATION_REQUEST_PATH, RESOURCE_PROJECTION_PATH];
  const baseReads = await Promise.all(basePaths.map(readJson));
  const byPath = Object.fromEntries(basePaths.map((relative, index) => [relative, baseReads[index]]));
  assertRawSha256(byPath[RUNNER_PATH].bytes, FROZEN_BINDINGS[RUNNER_PATH], 'FROZEN_RUNNER_RAW_HASH_MISMATCH');
  assertRawSha256(byPath[PREREGISTRATION_PATH].bytes, FROZEN_BINDINGS[PREREGISTRATION_PATH],
    'FROZEN_PREREGISTRATION_RAW_HASH_MISMATCH');
  assertRawSha256(byPath[ACTIVATION_PATH].bytes, FROZEN_BINDINGS[ACTIVATION_PATH],
    'FROZEN_ACTIVATION_RAW_HASH_MISMATCH');
  assertRawSha256(byPath[FREEZE_VALIDATION_PATH].bytes, EXPECTED_FREEZE_VALIDATION_SHA256,
    'FREEZE_VALIDATION_HASH_MISMATCH');
  assertRawSha256(byPath[AUTHORIZATION_REQUEST_PATH].bytes, EXPECTED_AUTHORIZATION_REQUEST_SHA256,
    'AUTHORIZATION_REQUEST_HASH_MISMATCH');
  assertRawSha256(byPath[RESOURCE_PROJECTION_PATH].bytes, EXPECTED_RESOURCE_PROJECTION_SHA256,
    'RESOURCE_PROJECTION_HASH_MISMATCH');

  const runner = byPath[RUNNER_PATH];
  const preregistration = byPath[PREREGISTRATION_PATH];
  const activation = byPath[ACTIVATION_PATH];
  const freezeValidation = byPath[FREEZE_VALIDATION_PATH];
  const authorizationRequest = byPath[AUTHORIZATION_REQUEST_PATH];
  const resourceProjection = byPath[RESOURCE_PROJECTION_PATH];
  const runnerBody = { ...runner.value };
  delete runnerBody.integrityBindingSha256;
  assert.equal(runner.value.integrityBindingSha256, sha256(Buffer.from(JSON.stringify(runnerBody))),
    'RUNNER_CONFIGURATION_BODY_TAMPERED');
  assert.equal(runner.value.profile, 'iras-v4-runner-integrity');
  assert.equal(runner.value.status, 'FROZEN_RUNNER_CONFIGURATION');
  assert.equal(runner.value.reviewedCommit, REVIEWED_COMMIT);
  assert.equal(runner.value.branch, BRANCH);
  assert.equal(runner.value.semanticNamespace, SEMANTIC_NAMESPACE);
  assert.equal(runner.value.captureInventory, null);
  assert.equal(runner.value.productionEvidenceAdapterSha256, null);
  assert.equal(runner.value.preregistrationSha256, null);
  assert.ok(Array.isArray(runner.value.fileRows), 'FROZEN_FILE_ROWS_REQUIRED');
  assert.equal(runner.value.fileRows.length, 594, 'FROZEN_FILE_ROW_COUNT_MISMATCH');
  assert.equal(new Set(runner.value.fileRows.map(row => row.path)).size, 594, 'FROZEN_FILE_PATHS_NOT_UNIQUE');
  assert.equal(runner.value.fileInventorySha256, sha256(Buffer.from(JSON.stringify(runner.value.fileRows))),
    'FROZEN_FILE_INVENTORY_HASH_MISMATCH');
  for (const row of runner.value.fileRows) {
    assertRelativePath(row.path);
    assert.match(String(row.sha256 || ''), /^[a-f0-9]{64}$/, 'FROZEN_FILE_HASH_INVALID');
    assert.match(String(row.gitBlob || ''), /^[a-f0-9]{40}$/, 'FROZEN_FILE_GIT_BLOB_INVALID');
    assert.equal(row.gitBlob, row.reviewedBlob, 'FROZEN_FILE_REVIEWED_BLOB_MISMATCH');
    assertRawSha256(await readRaw(row.path), row.sha256, 'FROZEN_BOUND_FILE_HASH_MISMATCH');
  }

  const prereg = preregistration.value;
  assert.equal(prereg.profile, 'iras-first-targeted-acceptance-v4');
  assert.equal(prereg.frozen, true);
  assert.equal(prereg.status, 'FROZEN_PREREGISTRATION');
  assert.equal(prereg.targetedAcceptanceExecuted, false);
  assert.ok(Array.isArray(prereg.promptFingerprints), 'FROZEN_PROMPT_ROWS_REQUIRED');
  assert.equal(prereg.promptFingerprints.length, 9, 'FROZEN_PROMPT_ROW_COUNT_MISMATCH');
  assert.equal(new Set(prereg.promptFingerprints.map(row => row.caseId)).size, 9, 'FROZEN_CASE_IDS_NOT_UNIQUE');
  assert.deepEqual(runner.value.designFingerprints.promptFingerprints, prereg.promptFingerprints,
    'FROZEN_PROMPT_CROSS_BINDING_MISMATCH');
  assert.equal(runner.value.designFingerprints.evaluationFingerprintSha256, prereg.evaluationFingerprintSha256,
    'FROZEN_EVALUATION_CROSS_BINDING_MISMATCH');
  assert.deepEqual({
    contractSha256: runner.value.designFingerprints.contractSha256,
    productionFingerprintSha256: runner.value.designFingerprints.productionFingerprintSha256,
    sourceFingerprintSha256: runner.value.designFingerprints.sourceFingerprintSha256,
    schemaPromptFingerprintSha256: runner.value.designFingerprints.schemaPromptFingerprintSha256,
    protectedHistorySha256: runner.value.designFingerprints.protectedHistorySha256,
    evaluationFingerprintSha256: runner.value.designFingerprints.evaluationFingerprintSha256,
    promptFingerprints: runner.value.designFingerprints.promptFingerprints
  }, {
    contractSha256: prereg.contractSha256,
    productionFingerprintSha256: prereg.productionFingerprintSha256,
    sourceFingerprintSha256: prereg.sourceFingerprintSha256,
    schemaPromptFingerprintSha256: prereg.schemaPromptFingerprintSha256,
    protectedHistorySha256: prereg.protectedHistorySha256,
    evaluationFingerprintSha256: prereg.evaluationFingerprintSha256,
    promptFingerprints: prereg.promptFingerprints
  }, 'FROZEN_PREREGISTRATION_CROSS_BINDING_MISMATCH');
  assert.equal(sha256(Buffer.from(JSON.stringify(prereg.promptFingerprints))), prereg.schemaPromptFingerprintSha256,
    'FROZEN_PROMPT_FINGERPRINT_DIGEST_MISMATCH');

  const activationBody = { ...activation.value };
  delete activationBody.activationConfigurationSha256;
  assert.equal(activation.value.activationConfigurationSha256, sha256(Buffer.from(JSON.stringify(activationBody))),
    'FROZEN_ACTIVATION_BODY_TAMPERED');
  assert.equal(activation.value.profile, 'iras-v4-capture-activation');
  assert.equal(activation.value.status, 'FROZEN_ACTIVATION_CONFIGURATION');
  assert.equal(activation.value.frozen, true);
  assert.equal(activation.value.runnerConfigurationPath, RUNNER_PATH);
  assert.equal(activation.value.preregistrationPath, PREREGISTRATION_PATH);
  assert.equal(activation.value.preregistrationSha256, preregistration.sha256);
  assert.equal(activation.value.runnerIntegrityBindingSha256, runner.value.integrityBindingSha256);
  assert.equal(activation.value.activationInputsSha256, prereg.activationInputsSha256);
  assert.ok(Array.isArray(activation.value.captureInventory), 'FROZEN_CAPTURE_INVENTORY_REQUIRED');
  assert.equal(activation.value.captureInventory.length, 15, 'FROZEN_CAPTURE_INVENTORY_COUNT_MISMATCH');
  assert.equal(sha256(Buffer.from(JSON.stringify(activation.value.captureInventory))), EXPECTED_CAPTURE_INVENTORY_SHA256,
    'FROZEN_CAPTURE_INVENTORY_HASH_MISMATCH');
  assert.equal(activation.value.captureInventorySha256, EXPECTED_CAPTURE_INVENTORY_SHA256);
  assert.ok(activation.value.captureInventory.every(row => row.method === 'GET' &&
    ['SOURCE', 'DISCOVERY'].includes(row.purpose) &&
    ['iras.gov.sg', 'www.iras.gov.sg'].includes(new URL(row.url).hostname)),
  'FROZEN_CAPTURE_INVENTORY_SCOPE_INVALID');
  assert.equal(activation.value.captureInventory.filter(row => row.purpose === 'SOURCE').length, 9);
  assert.equal(activation.value.captureInventory.filter(row => row.purpose === 'DISCOVERY').length, 6);

  const freeze = freezeValidation.value;
  assert.equal(freeze.status, 'OFFLINE_POST_REPAIR_BINDINGS_PREPARED_APPROVAL_PENDING');
  assert.equal(freeze.approvalStatus, 'PENDING');
  assert.equal(freeze.reviewedCommit, REVIEWED_COMMIT);
  assert.equal(freeze.semanticNamespace, SEMANTIC_NAMESPACE);
  assert.equal(freeze.namespaceAbsent, true);
  assert.equal(freeze.priorAuthorizationReused, false);
  assert.equal(freeze.captureInventorySha256, EXPECTED_CAPTURE_INVENTORY_SHA256);
  assert.equal(freeze.captureInventoryCount, 15);
  assert.equal(freeze.promptRowsVerified, 9);
  assert.equal(freeze.liveCallsMade, 0);
  assert.equal(freeze.modelCallsMade, 0);
  assert.equal(freeze.capturesMade, 0);
  assert.equal(freeze.reservationOrDispatchOccurred, false);
  assert.equal(freeze.protectedInputsUnchanged, true);
  const protectedBefore = freeze.protectedInputSha256?.before;
  const protectedAfter = freeze.protectedInputSha256?.after;
  assert.ok(protectedBefore && typeof protectedBefore === 'object' && !Array.isArray(protectedBefore),
    'PROTECTED_INPUT_HASHES_MISSING');
  assert.deepEqual(protectedAfter, protectedBefore, 'PROTECTED_INPUTS_CHANGED_DURING_FREEZE');
  assert.equal(Object.keys(protectedBefore).length, 36, 'PROTECTED_INPUT_HASH_COUNT_MISMATCH');
  for (const [relative, expected] of Object.entries(protectedBefore)) {
    assertRelativePath(relative);
    assertRawSha256(await readRaw(relative), expected, 'PROTECTED_INPUT_HASH_MISMATCH');
  }

  const request = authorizationRequest.value;
  assert.equal(request.profile, 'iras-v4-new-post-repair-run-authorization-request');
  assert.equal(request.status, 'AWAITING_NEW_HUMAN_AUTHORIZATION_AND_RESOURCE_WINDOW');
  assert.equal(request.freshNamespace, SEMANTIC_NAMESPACE);
  assert.equal(request.reviewedCommit, REVIEWED_COMMIT);
  assert.equal(request.authorizationGranted, false);
  assert.equal(request.priorAuthorizationReusable, false);
  assert.equal(request.fullAcceptanceProven, false);
  assert.deepEqual(request.verifiedBindingSha256, FROZEN_BINDINGS, 'AUTHORIZATION_REQUEST_BINDINGS_MISMATCH');
  assert.equal(request.captureInventorySha256, EXPECTED_CAPTURE_INVENTORY_SHA256);
  assert.equal(request.semanticScope.maximumResponseBytes, 65_536);
  assert.equal(request.semanticScope.timeoutMs, 8_000);
  assert.equal(request.semanticScope.maximumCalls, 9);
  assert.equal(request.semanticScope.retries, 0);
  assert.equal(request.semanticScope.minimumStartGapMs, 15_250);
  assert.equal(request.semanticScope.liveSourceRetrieval, false);
  assert.equal(request.semanticScope.model, MODEL);
  assert.equal(request.semanticScope.callsPerCase, 1);
  assert.deepEqual(request.requestedActions, [
    'One fresh code-bound official IRAS capture of the same reviewed 15 request identities',
    'One new fixed nine-case Gemini acceptance attempt after fresh source, capability, allowance and quota checks pass'
  ], 'AUTHORIZATION_REQUEST_ACTIONS_MISMATCH');
  assert.equal(request.previousRetry, 'FAILED_CONSUMED_4_RESPONSES_2_PASS_2_FAIL_5_NOT_RUN');
  assert.equal(request.sourceScope.approvedIdentities, 15);
  assert.equal(request.sourceScope.maximumPlannedRequests, 15);
  assert.equal(request.sourceScope.maximumPlannedRequestsPerFamily, 4);
  assert.equal(request.sourceScope.defaultExecutorMaximumRequestsPerFamily, 10);
  assert.equal(request.sourceScope.maximumCaptureAgeHours, 24);
  assert.equal(request.sourceScope.defaultExecutorMaximumRequests, 60);
  assert.equal(request.sourceScope.transportRetries, 0);
  assert.equal(request.sourceScope.inventoryExpanded, false);
  assert.deepEqual(request.sourceScope.sourceHosts, ['iras.gov.sg', 'www.iras.gov.sg']);

  const projection = resourceProjection.value;
  assert.equal(projection.profile, 'iras-v4-fresh-execution-resource-projection');
  assert.equal(projection.status, 'INDEPENDENTLY_REVIEWED_PLANNING_ESTIMATE');
  assert.equal(projection.fiveHourCostPercentagePoints, 40);
  assert.equal(projection.weeklyCostPercentagePoints, 15);
  assert.equal(projection.reserveAfterProjectionMinimumFiveHourPercent, 8);
  assert.equal(projection.reserveAfterProjectionMinimumWeeklyPercent, 4);
  assert.equal(projection.checkpointAtRemainingPercent, 10);
  assert.equal(projection.finishAboveRemainingPercent, 5);
  assert.equal(projection.observationMaximumAgeMs, 300_000);
  assert.equal(projection.actualAllowanceMustBeMonitored, true);
  assert.equal(projection.observationRequiredAfterExpensiveValidation, true);
  assert.equal(projection.stopIfBoundNoLongerSupported, true);
  assert.equal(projection.historical80ProjectionChanged, false);
  assert.match(projection.scope, /no extra capture, probes or retries/i);
  assert.equal(projection.evidence.nextScopeHasNoImplementation, true);

  const hashes = {
    [LAUNCHER_PATH]: sha256(launcher),
    [RUNNER_PATH]: runner.sha256,
    [PREREGISTRATION_PATH]: preregistration.sha256,
    [ACTIVATION_PATH]: activation.sha256,
    [FREEZE_VALIDATION_PATH]: freezeValidation.sha256,
    [AUTHORIZATION_REQUEST_PATH]: authorizationRequest.sha256,
    [RESOURCE_PROJECTION_PATH]: resourceProjection.sha256
  };
  let authorization = null;
  let approvalEvidence = null;
  let resourceReview = null;
  if (live) {
    const liveReads = await Promise.all([readJson(AUTHORIZATION_PATH), readJson(APPROVAL_EVIDENCE_PATH),
      readJson(RESOURCE_REVIEW_PATH)]);
    [authorization, approvalEvidence, resourceReview] = liveReads;
    hashes[AUTHORIZATION_PATH] = authorization.sha256;
    hashes[APPROVAL_EVIDENCE_PATH] = approvalEvidence.sha256;
    hashes[RESOURCE_REVIEW_PATH] = resourceReview.sha256;
  }
  return Object.freeze({
    launcherSha256: hashes[LAUNCHER_PATH],
    hashes: Object.freeze({ ...hashes }),
    protectedInputHashes: Object.freeze({ ...protectedBefore }),
    runnerConfiguration: runner.value,
    preregistration: prereg,
    preregistrationSha256: preregistration.sha256,
    activation: activation.value,
    activationSha256: activation.sha256,
    authorizationRequest: request,
    authorizationRequestSha256: authorizationRequest.sha256,
    authorization: authorization?.value ?? null,
    authorizationSha256: authorization?.sha256 ?? null,
    approvalEvidence: approvalEvidence?.value ?? null,
    approvalEvidenceSha256: approvalEvidence?.sha256 ?? null,
    resourceProjection: projection,
    resourceProjectionSha256: resourceProjection.sha256,
    resourceReview: resourceReview?.value ?? null,
    resourceReviewSha256: resourceReview?.sha256 ?? null,
    freezeValidationSha256: freezeValidation.sha256,
    captureInventory: activation.value.captureInventory
  });
}

export function assertNewAuthorizationEnvelope(auth) {
  const granted = auth && typeof auth === 'object' &&
    auth.profile === 'iras-v4-post-repair-execution-authorization' &&
    auth.status === 'EXPLICITLY_AUTHORIZED_FIXED_SCOPE' &&
    auth.templateOnly === false &&
    auth.authorizationGranted === true &&
    auth.officialSourceCaptureAuthorized === true &&
    auth.geminiAcceptanceAuthorized === true &&
    auth.quotaConfirmedByHuman === true &&
    auth.newAuthorizationForCurrentNamespace === true &&
    auth.noPreviousAuthorizationReused === true &&
    auth.reviewedCommit === REVIEWED_COMMIT && auth.branch === BRANCH &&
    auth.semanticNamespace === SEMANTIC_NAMESPACE &&
    auth.authorizationRequestSha256 === EXPECTED_AUTHORIZATION_REQUEST_SHA256 &&
    auth.runnerConfigurationSha256 === EXPECTED_RUNNER_CONFIGURATION_SHA256 &&
    auth.preregistrationSha256 === EXPECTED_PREREGISTRATION_SHA256 &&
    auth.activationConfigurationSha256 === EXPECTED_ACTIVATION_SHA256 &&
    auth.freezeValidationSha256 === EXPECTED_FREEZE_VALIDATION_SHA256 &&
    auth.captureInventorySha256 === EXPECTED_CAPTURE_INVENTORY_SHA256 &&
    auth.resourceProjectionSha256 === EXPECTED_RESOURCE_PROJECTION_SHA256 &&
    auth.model === MODEL && auth.authorizedGeminiCalls === 9 && auth.transportTimeoutMs === 8_000 &&
    auth.minimumStartGapMs === 15_250 && auth.retries === 0 && auth.providerProbesAuthorized === 0 &&
    auth.captureRequestCount === 15 && auth.approvalEvidenceSha256 && auth.launcherSha256 &&
    typeof auth.userInstruction === 'string' && auth.userInstruction.trim().length > 0 &&
    Number.isFinite(Date.parse(auth.authorizedAtUtc || '')) &&
    /^[a-f0-9]{64}$/.test(String(auth.approvalEvidenceSha256)) &&
    /^[a-f0-9]{64}$/.test(String(auth.launcherSha256)) &&
    auth.priorAuthorizationReusable === false && auth.quotaConfirmationScope === EXPECTED_QUOTA_SCOPE;
  if (!granted) throw codedError('NEW_EXPLICIT_AUTHORIZATION_REQUIRED');
  return true;
}

async function rejectMissingNewAuthorization() {
  let present = false;
  try { present = await assertNoSymlinkPath(AUTHORIZATION_PATH, { allowMissing: true }); }
  catch { throw codedError('NEW_EXPLICIT_AUTHORIZATION_REQUIRED'); }
  if (!present) throw codedError('NEW_EXPLICIT_AUTHORIZATION_REQUIRED');
  let raw;
  try { raw = await readFile(abs(AUTHORIZATION_PATH)); }
  catch { throw codedError('NEW_EXPLICIT_AUTHORIZATION_REQUIRED'); }
  let auth;
  try { auth = JSON.parse(raw.toString('utf8')); }
  catch { throw codedError('NEW_EXPLICIT_AUTHORIZATION_REQUIRED'); }
  assertNewAuthorizationEnvelope(auth);
  assertRawSha256(await readRaw(LAUNCHER_PATH), auth.launcherSha256, 'NEW_EXPLICIT_AUTHORIZATION_REQUIRED');
  return Object.freeze({ value: auth, sha256: sha256(raw) });
}

function assertLiveAuthorization(context, authorizationRead) {
  const auth = context.authorization;
  const evidence = context.approvalEvidence;
  assert.equal(context.authorizationSha256, authorizationRead.sha256, 'NEW_EXPLICIT_AUTHORIZATION_REQUIRED');
  assert.equal(auth.launcherSha256, context.launcherSha256, 'NEW_EXPLICIT_AUTHORIZATION_REQUIRED');
  assert.equal(auth.approvalEvidenceSha256, context.approvalEvidenceSha256, 'NEW_EXPLICIT_AUTHORIZATION_REQUIRED');
  assert.equal(auth.userInstruction, evidence.userInstruction, 'NEW_EXPLICIT_AUTHORIZATION_REQUIRED');
  assert.equal(auth.authorizedAtUtc, evidence.authorizedAtUtc, 'NEW_EXPLICIT_AUTHORIZATION_REQUIRED');
  assert.equal(evidence.profile, 'current-post-repair-human-approval');
  assert.equal(evidence.status, 'EXPLICIT_HUMAN_APPROVAL_RECORDED');
  assert.equal(evidence.templateOnly, false);
  assert.equal(evidence.source, 'current Codex chat user message');
  assert.equal(evidence.threadId, THREAD_ID);
  assert.equal(evidence.semanticNamespace, SEMANTIC_NAMESPACE);
  assert.equal(evidence.authorizationRequestSha256, context.authorizationRequestSha256);
  assert.ok(typeof evidence.userInstruction === 'string' && evidence.userInstruction.trim().length > 0);
  assert.ok(Number.isFinite(Date.parse(evidence.observedAtUtc || '')));
  assert.ok(Number.isFinite(Date.parse(evidence.authorizedAtUtc || '')));
  assert.equal(evidence.officialSourceCaptureAuthorized, true);
  assert.equal(evidence.geminiAcceptanceAuthorized, true);
  assert.equal(evidence.quotaConfirmedByHuman, true);
  assert.equal(evidence.quotaConfirmationScope, EXPECTED_QUOTA_SCOPE);
  assert.equal(auth.authorizationRequestSha256, context.authorizationRequestSha256);
  assert.equal(auth.resourceProjectionSha256, context.resourceProjectionSha256);
  assert.equal(auth.semanticNamespace, SEMANTIC_NAMESPACE);
  assert.equal(auth.reviewedCommit, REVIEWED_COMMIT);
  assert.equal(auth.branch, BRANCH);
  assert.equal(auth.captureInventorySha256, EXPECTED_CAPTURE_INVENTORY_SHA256);
  assert.equal(auth.officialSourceCaptureAuthorized, true);
  assert.equal(auth.geminiAcceptanceAuthorized, true);
  assert.equal(auth.quotaConfirmedByHuman, true);
  assert.equal(auth.userInstruction, evidence.userInstruction);
  assert.equal(auth.quotaConfirmationScope, EXPECTED_QUOTA_SCOPE);
  assert.equal(auth.noPreviousAuthorizationReused, true);
  assert.equal(auth.priorAuthorizationReusable, false);
  assert.equal(auth.priorQuotaConfirmationAuthorizationSha256, undefined);
  assert.equal(auth.priorQuotaUserInstruction, undefined);

  const review = context.resourceReview;
  assert.equal(review.profile, 'iras-v4-post-repair-resource-authorization-review');
  assert.equal(review.status, 'INDEPENDENT_RESOURCE_REVIEW_COMPLETE');
  assert.equal(review.templateOnly, false);
  assert.equal(review.disposition, 'APPROVED_FOR_FIXED_SCOPE');
  assert.equal(review.independentReviewer, true);
  assert.ok(typeof review.reviewer === 'string' && review.reviewer.trim().length > 0);
  assert.ok(Number.isFinite(Date.parse(review.reviewedAtUtc || '')));
  assert.equal(review.authorizationSha256, context.authorizationSha256);
  assert.equal(review.approvalEvidenceSha256, context.approvalEvidenceSha256);
  assert.equal(review.authorizationRequestSha256, context.authorizationRequestSha256);
  assert.equal(review.semanticNamespace, SEMANTIC_NAMESPACE);
  assert.equal(review.reviewedCommit, REVIEWED_COMMIT);
  assert.equal(review.launcherSha256, context.launcherSha256);
  assert.equal(review.resourceProjectionSha256, context.resourceProjectionSha256);
  assert.equal(review.captureInventorySha256, EXPECTED_CAPTURE_INVENTORY_SHA256);
  assert.equal(review.quotaConfirmationScope, EXPECTED_QUOTA_SCOPE);
  assert.equal(review.quotaSource, 'current post-repair approval evidence; no provider probe or inferred higher capacity');
  assert.deepEqual(review.verifiedBindingSha256, FROZEN_BINDINGS);
  assert.equal(review.freshAllowanceObservationRequired, true);
  assert.equal(review.providerQuotaProbeAuthorized, false);
  assert.equal(review.automaticRetryAuthorized, false);
  assert.equal(review.additionalCaptureAuthorized, false);
  assert.deepEqual(review.planningEstimate, {
    fiveHourCostPercentagePoints: 40,
    weeklyCostPercentagePoints: 15,
    reserveAfterProjectionMinimumFiveHourPercent: 8,
    reserveAfterProjectionMinimumWeeklyPercent: 4,
    checkpointAtRemainingPercent: 10,
    finishAboveRemainingPercent: 5
  });
  return true;
}
async function assertContextStable(context) {
  for (const relative of Object.keys(context.hashes)) {
    const current = sha256(await readRaw(relative));
    assert.equal(current, context.hashes[relative], 'FROZEN_EXECUTION_INPUT_CHANGED');
  }
  for (const [relative, expected] of Object.entries(context.protectedInputHashes)) {
    assert.equal(sha256(await readRaw(relative)), expected, 'PROTECTED_EXECUTION_INPUT_CHANGED');
  }
}

async function assertCaptureOutputsAbsent() {
  for (const relative of Object.values(CAPTURE_OUTPUTS)) await assertAbsent(relative);
}

async function assertSemanticNamespaceAbsent() {
  await assertAbsent(SEMANTIC_NAMESPACE);
}

function localGitEnvironment() {
  const environment = {
    GIT_TERMINAL_PROMPT: '0',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: 'NUL',
    GIT_OPTIONAL_LOCKS: '0'
  };
  for (const name of ['PATH', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP']) {
    if (process.env[name]) environment[name] = process.env[name];
  }
  return environment;
}

function git(args, options = {}) {
  return execFileSync(GIT, ['-C', ROOT, ...args], {
    encoding: 'utf8', windowsHide: true, env: localGitEnvironment(),
    ...options
  }).trim();
}

async function assertExecutionCheckout(context) {
  assert.equal(path.resolve(process.cwd()).replaceAll('\\', '/').toLowerCase(), ROOT.toLowerCase(),
    'LAUNCH_WRONG_REPOSITORY_ROOT');
  assert.equal(Number(process.versions.node.split('.')[0]), 22, 'LAUNCH_REQUIRES_NODE_22');
  assert.equal(path.resolve(process.env.CODEX_GIT_EXECUTABLE || ''), path.resolve(GIT),
    'LAUNCH_EXPLICIT_GIT_PATH_MISMATCH');
  const branch = git(['branch', '--show-current']);
  assert.equal(branch, BRANCH, 'LAUNCH_BRANCH_MISMATCH');
  execFileSync(GIT, ['-C', ROOT, 'merge-base', '--is-ancestor', REVIEWED_COMMIT, 'HEAD'],
    { stdio: 'ignore', windowsHide: true, env: localGitEnvironment() });
  const head = git(['rev-parse', 'HEAD']);
  for (const relative of EXECUTION_INPUTS) {
    const workingBlob = git(['hash-object', `--path=${relative}`, '--stdin'], { input: await readRaw(relative) });
    const committedBlob = git(['rev-parse', `HEAD:${relative}`]);
    assert.equal(workingBlob, committedBlob, 'LAUNCH_INPUT_NOT_COMMITTED_AS_REVIEWED');
  }
  return Object.freeze({ head, branch });
}

async function writeExclusiveJson(relative, document) {
  const destination = abs(relative);
  await mkdir(path.dirname(destination), { recursive: true });
  await assertNoSymlinkPath(relative, { allowMissing: true });
  const bytes = Buffer.from(JSON.stringify(document, null, 2) + '\n', 'utf8');
  const handle = await open(destination, 'wx');
  try { await handle.writeFile(bytes); await handle.sync(); }
  finally { await handle.close(); }
  return sha256(bytes);
}

async function checkMode() {
  logPhase('OFFLINE_CHECK', 'STARTED');
  blockNetworkForOfflineCheck();
  assert.equal(path.resolve(process.cwd()).replaceAll('\\', '/').toLowerCase(), ROOT.toLowerCase(),
    'LAUNCH_WRONG_REPOSITORY_ROOT');
  assert.equal(Number(process.versions.node.split('.')[0]), 22, 'LAUNCH_REQUIRES_NODE_22');
  const branch = git(['branch', '--show-current']);
  assert.equal(branch, BRANCH, 'LAUNCH_BRANCH_MISMATCH');
  execFileSync(GIT, ['-C', ROOT, 'merge-base', '--is-ancestor', REVIEWED_COMMIT, 'HEAD'],
    { stdio: 'ignore', windowsHide: true, env: localGitEnvironment() });
  const head = git(['rev-parse', 'HEAD']);
  const context = await loadPreparedContext();
  await assertCaptureOutputsAbsent();
  await assertSemanticNamespaceAbsent();
  await assertContextStable(context);
  logPhase('OFFLINE_CHECK', 'PASSED', {
    reviewedCommit: REVIEWED_COMMIT,
    head,
    branch,
    rawPreparationPinsVerified: 5,
    rawExecutionPinsVerified: 1,
    boundFilesVerified: 594,
    protectedHistoricalFilesVerified: 36,
    promptRowsCrossBound: 9,
    captureInventoryRows: context.captureInventory.length,
    authorizationStatus: 'AUTHORIZATION_PENDING',
    authorizationGranted: false,
    officialSourceCaptureAuthorized: false,
    semanticNamespace: SEMANTIC_NAMESPACE,
    liveNetworkUsed: false,
    networkBlocked: true,
    credentialRead: false,
    filesWritten: false
  });
}

function blockNetworkForOfflineCheck() {
  const blocked = () => { throw codedError('OFFLINE_NETWORK_BLOCKED'); };
  for (const [module, names] of [
    [net, ['connect', 'createConnection']],
    [http, ['request', 'get']],
    [https, ['request', 'get']],
    [tls, ['connect']],
    [dgram, ['createSocket']]
  ]) {
    for (const name of names) Object.defineProperty(module, name, { configurable: false, writable: false, value: blocked });
  }
  if (net.Socket?.prototype?.connect) {
    Object.defineProperty(net.Socket.prototype, 'connect', { configurable: false, writable: false, value: blocked });
  }
  Object.defineProperty(globalThis, 'fetch', { configurable: false, writable: false, value: blocked });
}

function assertCapturePlan(captureRun, context) {
  assert.equal(captureRun.synthetic, false, 'LIVE_CAPTURE_MODE_MISMATCH');
  assert.equal(captureRun.capture?.document?.captureStatus, 'COMPLETE', 'CAPTURE_NOT_COMPLETE');
  const expected = context.captureInventory.filter(row => row.purpose !== 'REDIRECT');
  const actual = captureRun.result?.rows;
  assert.equal(captureRun.result?.profile, 'iras-v4-capture-plan', 'CAPTURE_PLAN_PROFILE_INVALID');
  assert.ok(Array.isArray(actual), 'CAPTURE_PLAN_ROWS_MISSING');
  assert.equal(expected.length, 15);
  assert.equal(actual.length, 15, 'CAPTURE_PLAN_ROW_COUNT_MISMATCH');
  for (let index = 0; index < expected.length; index += 1) {
    const wanted = expected[index];
    const row = actual[index];
    assert.equal(row.family, wanted.family, 'CAPTURE_PLAN_FAMILY_MISMATCH');
    assert.equal(row.purpose, wanted.purpose, 'CAPTURE_PLAN_PURPOSE_MISMATCH');
    assert.equal(row.url, wanted.url, 'CAPTURE_PLAN_URL_MISMATCH');
    assert.deepEqual(row.sourceRecordIds, wanted.provenance.sourceRecordIds, 'CAPTURE_PLAN_SOURCE_BINDING_MISMATCH');
    assert.deepEqual(row.topicIds, wanted.provenance.topicIds, 'CAPTURE_PLAN_TOPIC_BINDING_MISMATCH');
    assert.equal(row.status, 'SUCCESS', 'CAPTURE_PLAN_REQUEST_FAILED');
    assert.ok(Number.isInteger(row.httpStatus) && row.httpStatus >= 200 && row.httpStatus < 400,
      'CAPTURE_PLAN_HTTP_STATUS_INVALID');
    assert.ok(Number.isSafeInteger(row.contentBytes) && row.contentBytes >= 0, 'CAPTURE_PLAN_CONTENT_SIZE_INVALID');
    if (row.contentSha256 !== null) assert.match(String(row.contentSha256), /^[a-f0-9]{64}$/);
  }
  return actual.map(row => ({ family: row.family, purpose: row.purpose, status: row.status,
    httpStatus: row.httpStatus, contentBytes: row.contentBytes, contentSha256: row.contentSha256 }));
}

function assertCaptureDocumentMatchesSerialized(actual, document) {
  assert.deepEqual(actual, JSON.parse(JSON.stringify(document)), 'CAPTURE_PAYLOAD_DOCUMENT_MISMATCH');
}

function assertCaptureSerializationGuards(document) {
  const serialized = JSON.parse(JSON.stringify(document));
  assert.ok(Object.hasOwn(document.provenance, 'productionRetriever'),
    'CAPTURE_PRODUCTION_RETRIEVER_PROPERTY_REQUIRED');
  assert.equal(document.provenance.productionRetriever, undefined,
    'CAPTURE_PRODUCTION_RETRIEVER_EXPECTED_UNDEFINED');
  assert.equal(Object.hasOwn(serialized.provenance, 'productionRetriever'), false,
    'CAPTURE_JSON_UNDEFINED_PROPERTY_NOT_OMITTED');
  assert.ok(Array.isArray(serialized.entries) && serialized.entries.length > 0, 'CAPTURE_SERIALIZATION_ENTRIES_REQUIRED');

  const changedBody = structuredClone(serialized);
  changedBody.entries[0].bodyBase64 = `${changedBody.entries[0].bodyBase64}x`;
  assert.throws(() => assertCaptureDocumentMatchesSerialized(changedBody, document),
    error => error?.code === 'ERR_ASSERTION', 'CAPTURE_SERIALIZATION_BODY_GUARD_FAILED');

  const changedProvenance = structuredClone(serialized);
  changedProvenance.provenance.sourceRegistrySha256 = `${changedProvenance.provenance.sourceRegistrySha256}x`;
  assert.throws(() => assertCaptureDocumentMatchesSerialized(changedProvenance, document),
    error => error?.code === 'ERR_ASSERTION', 'CAPTURE_SERIALIZATION_PROVENANCE_GUARD_FAILED');
}

async function runCapture(context) {
  const checkout = await assertExecutionCheckout(context);
  await assertCaptureOutputsAbsent();
  await assertSemanticNamespaceAbsent();
  logPhase('FROZEN_RUNNER_AND_ACTIVATION_VALIDATION', 'STARTED', { head: checkout.head });
  const runner = await import(pathToFileURL(abs('scripts/iras_v4_capture_replay_runner.mjs')).href);
  const capability = await runner.loadReviewedV4ExecutionCapability({
    activationConfigurationPath: abs(ACTIVATION_PATH), root: ROOT, gitExecutable: GIT
  });
  const permit = await runner.validateReviewedAcquisitionPermit({
    runnerConfigurationPath: abs(RUNNER_PATH), activationConfigurationPath: abs(ACTIVATION_PATH),
    root: ROOT, gitExecutable: GIT
  });
  assert.equal(permit.captureInventorySha256, context.authorization.captureInventorySha256,
    'ACQUISITION_PERMIT_INVENTORY_MISMATCH');
  assert.equal(permit.integrityBindingSha256, context.runnerConfiguration.integrityBindingSha256,
    'ACQUISITION_PERMIT_RUNNER_BINDING_MISMATCH');
  assert.equal(capability.activationConfigurationSha256, permit.activationConfigurationSha256,
    'EXECUTION_CAPABILITY_ACTIVATION_MISMATCH');
  await assertContextStable(context);
  logPhase('FROZEN_RUNNER_AND_ACTIVATION_VALIDATION', 'PASSED', { inventoryRows: permit.captureInventory.length });

  const boundFiles = new Map(context.runnerConfiguration.fileRows.map(row => [row.path, row.sha256]));
  const provenance = {
    sourceRegistrySha256: boundFiles.get('src/standards/approvedSourceRegistry.ts'),
    sourceMapSha256: boundFiles.get('src/standards/unifiedSourceModel.ts'),
    discoveryPolicySha256: boundFiles.get('src/retrieval/officialSitemapDiscovery.ts')
  };
  assert.ok(Object.values(provenance).every(value => /^[a-f0-9]{64}$/.test(String(value))),
    'CAPTURE_PROVENANCE_BINDING_MISSING');
  logPhase('CAPTURE_TRANSPORT_CONSTRUCTION', 'STARTED');
  const transport = runner.createCaptureTransport({
    markerPath: abs(CAPTURE_OUTPUTS.marker),
    journalPath: abs(CAPTURE_OUTPUTS.journal),
    payloadPath: abs(CAPTURE_OUTPUTS.payload),
    integrityBindingSha256: context.runnerConfiguration.integrityBindingSha256,
    preregistrationSha256: context.preregistrationSha256,
    runnerConfigurationPath: abs(RUNNER_PATH),
    activationConfigurationPath: abs(ACTIVATION_PATH),
    preregistrationPath: abs(PREREGISTRATION_PATH),
    gitExecutable: GIT,
    provenance,
    acquisitionPermit: permit,
    executionCapability: capability,
    root: ROOT
  });
  assert.equal(transport.synthetic, false);
  logPhase('CAPTURE_TRANSPORT_CONSTRUCTION', 'PASSED');

  let captureStarted = false;
  let phase = 'CAPTURE_PRE_DISPATCH';
  try {
    await assertContextStable(context);
    phase = 'OFFICIAL_IRAS_CAPTURE';
    captureStarted = true;
    logPhase(phase, 'STARTED', { authorizedInventoryRows: permit.captureInventory.length });
    const captureRun = await runner.runBoundedCapture({
      transport,
      runnerConfigurationPath: abs(RUNNER_PATH),
      activationConfigurationPath: abs(ACTIVATION_PATH),
      executionCapability: capability,
      preregistrationPath: abs(PREREGISTRATION_PATH),
      root: ROOT,
      gitExecutable: GIT
    });
    const planRows = assertCapturePlan(captureRun, context);
    logPhase('CAPTURE_PLAN_VALIDATION', 'PASSED', { successfulPlanRows: planRows.length });

    phase = 'CAPTURE_PAYLOAD_VALIDATION';
    const loaded = await runner.loadCapturePayload(abs(CAPTURE_OUTPUTS.payload), ROOT);
    assert.equal(loaded.sha256, captureRun.capture.sha256, 'CAPTURE_PAYLOAD_HASH_MISMATCH');
    assertCaptureSerializationGuards(captureRun.capture.document);
    assertCaptureDocumentMatchesSerialized(loaded.payload, captureRun.capture.document);
    const validated = runner.validateCapturePayload(loaded.payload, {
      now: new Date(),
      expectedIntegrityBindingSha256: context.runnerConfiguration.integrityBindingSha256,
      expectedPreregistrationSha256: context.preregistrationSha256,
      expectedActivationConfigurationSha256: context.activation.activationConfigurationSha256,
      expectedActivationConfigurationFileSha256: context.activationSha256,
      expectedCaptureInventory: context.captureInventory,
      syntheticMode: false,
      requireComplete: true
    });
    assert.equal(loaded.payload.requestCount, 15, 'CAPTURE_PAYLOAD_REQUEST_COUNT_MISMATCH');
    assert.equal(loaded.payload.entries.length, 15, 'CAPTURE_PAYLOAD_ENTRY_COUNT_MISMATCH');
    assert.equal(validated.entryCount, 15, 'CAPTURE_PAYLOAD_VALIDATED_COUNT_MISMATCH');
    logPhase(phase, 'PASSED', { completeRequestCount: validated.entryCount });

    phase = 'FROZEN_EVIDENCE_LOCK';
    logPhase(phase, 'STARTED');
    const locked = await runner.writeFrozenEvidenceLock({
      outputPath: abs(CAPTURE_OUTPUTS.evidenceLock),
      payloadPath: abs(CAPTURE_OUTPUTS.payload),
      runnerConfigurationPath: abs(RUNNER_PATH),
      activationConfigurationPath: abs(ACTIVATION_PATH),
      gitExecutable: GIT,
      preregistrationPath: abs(PREREGISTRATION_PATH),
      root: ROOT
    });
    await assertContextStable(context);
    const result = {
      profile: 'iras-v4-fresh-capture-launch-result',
      status: 'CAPTURED_AND_LOCKED',
      executionMode: 'BOUNDED_OFFICIAL_IRAS_CAPTURE_ONLY',
      reviewedCommit: REVIEWED_COMMIT,
      headAtLaunch: checkout.head,
      semanticNamespace: SEMANTIC_NAMESPACE,
      launcherSha256: context.launcherSha256,
      authorizationSha256: context.authorizationSha256,
      resourceProjectionSha256: context.resourceProjectionSha256,
      resourceReviewSha256: context.resourceReviewSha256,
      freezeValidationSha256: context.freezeValidationSha256,
      captureInventorySha256: context.authorization.captureInventorySha256,
      requestCount: validated.entryCount,
      planRows,
      capturePayloadSha256: loaded.sha256,
      evidenceLockSha256: locked.sha256,
      capturedAt: locked.lock.capturedAt,
      sourceReferenceDate: locked.lock.sourceReferenceDate,
      semanticCalls: 0,
      providerCredentialRead: false,
      completedAtUtc: new Date().toISOString()
    };
    await writeExclusiveJson(CAPTURE_OUTPUTS.result, result);
    logPhase(phase, 'PASSED', { evidenceLockSha256: locked.sha256 });
    logPhase('CAPTURE', 'COMPLETE', { requestCount: result.requestCount, evidenceLockSha256: locked.sha256 });
  } catch (error) {
    if (captureStarted) {
      const failure = {
        profile: 'iras-v4-fresh-capture-launch-result',
        status: 'FAILED_NO_AUTOMATIC_RETRY',
        executionMode: 'BOUNDED_OFFICIAL_IRAS_CAPTURE_ONLY',
        reviewedCommit: REVIEWED_COMMIT,
        semanticNamespace: SEMANTIC_NAMESPACE,
        launcherSha256: context.launcherSha256,
        authorizationSha256: context.authorizationSha256,
        resourceProjectionSha256: context.resourceProjectionSha256,
        resourceReviewSha256: context.resourceReviewSha256,
        freezeValidationSha256: context.freezeValidationSha256,
        phase,
        failureCode: safeFailureCode(error, 'CAPTURE_FAILED'),
        providerCredentialRead: false,
        completedAtUtc: new Date().toISOString()
      };
      try { await writeExclusiveJson(CAPTURE_OUTPUTS.result, failure); }
      catch { logPhase('CAPTURE_RESULT', 'NOT_WRITTEN'); }
    }
    throw error;
  }
}

function decodeUsageToolResult(result) {
  assert.ok(result && typeof result === 'object' && result.isError !== true, 'USAGE_LIMITS_UNREADABLE');
  if (result.structuredContent && typeof result.structuredContent === 'object') return result.structuredContent;
  const textRows = Array.isArray(result.content) ? result.content.filter(row => row?.type === 'text') : [];
  assert.equal(textRows.length, 1, 'USAGE_LIMITS_UNREADABLE');
  try { return JSON.parse(textRows[0].text); }
  catch { throw codedError('USAGE_LIMITS_UNREADABLE'); }
}

function assertFreshAllowance(response, context, requestTimestamp, credentialSha256) {
  assert.equal(response.profile, 'iras-v4-fresh-execution-gate-response', 'GATE_RESPONSE_PROFILE_INVALID');
  assert.equal(response.requestId, context.requestId, 'GATE_RESPONSE_ID_MISMATCH');
  assert.equal(response.launcherSha256, context.launcherSha256, 'GATE_RESPONSE_LAUNCHER_MISMATCH');
  assert.equal(response.authorizationSha256, context.authorizationSha256, 'GATE_RESPONSE_AUTHORIZATION_MISMATCH');
  assert.equal(response.authorizationRequestSha256, context.hashes[AUTHORIZATION_REQUEST_PATH],
    'GATE_RESPONSE_AUTHORIZATION_REQUEST_MISMATCH');
  assert.equal(response.resourceProjectionSha256, context.resourceProjectionSha256, 'GATE_RESPONSE_PROJECTION_MISMATCH');
  assert.equal(response.resourceReviewSha256, context.resourceReviewSha256, 'GATE_RESPONSE_RESOURCE_REVIEW_MISMATCH');
  assert.equal(response.freezeValidationSha256, context.freezeValidationSha256, 'GATE_RESPONSE_FREEZE_MISMATCH');
  assert.equal(response.preregistrationSha256, context.preregistrationSha256, 'GATE_RESPONSE_PREREGISTRATION_MISMATCH');
  assert.equal(response.credentialSha256, credentialSha256, 'GATE_RESPONSE_CREDENTIAL_MISMATCH');
  assert.equal(response.model, MODEL, 'GATE_RESPONSE_MODEL_MISMATCH');
  assert.equal(response.authorizedGeminiCalls, 9, 'GATE_RESPONSE_CALL_COUNT_MISMATCH');
  assert.equal(response.retries, 0, 'GATE_RESPONSE_RETRY_POLICY_MISMATCH');
  assert.equal(response.quotaConfirmedByHuman, true, 'HUMAN_QUOTA_CONFIRMATION_REQUIRED');
  assert.equal(response.userInstruction, context.authorization.userInstruction, 'GATE_RESPONSE_USER_AUTHORIZATION_MISMATCH');
  assert.equal(response.quotaConfirmationScope, context.authorization.quotaConfirmationScope,
    'GATE_RESPONSE_QUOTA_SCOPE_MISMATCH');
  const requestedAt = Date.parse(requestTimestamp);
  const suppliedAt = Date.parse(response.suppliedAtUtc || '');
  const observation = response.usageObservation;
  const observedAt = Date.parse(observation?.observedAtUtc || '');
  const now = Date.now();
  assert.ok(Number.isFinite(requestedAt) && Number.isFinite(suppliedAt) && suppliedAt >= requestedAt && suppliedAt <= now,
    'GATE_RESPONSE_TIMESTAMP_INVALID');
  assert.ok(Number.isFinite(observedAt) && observedAt >= requestedAt && observedAt <= now &&
    now - observedAt <= context.resourceProjection.observationMaximumAgeMs,
  'USAGE_LIMITS_STALE_OR_PRE_REQUEST');
  assert.equal(observation.sourceTool, 'mcp__codex_app__get_usage_limits', 'USAGE_LIMITS_SOURCE_INVALID');
  const usage = decodeUsageToolResult(observation.toolResult);
  assert.equal(usage.ordinaryUsageAllowed, true, 'USAGE_LIMITS_NOT_AVAILABLE');
  const fiveHour = usage.rateLimitsByLimitId?.codex?.primary;
  const weekly = usage.rateLimitsByLimitId?.codex?.secondary;
  assert.equal(fiveHour?.windowDurationMins, 300, 'USAGE_FIVE_HOUR_WINDOW_INVALID');
  assert.equal(weekly?.windowDurationMins, 10_080, 'USAGE_WEEKLY_WINDOW_INVALID');
  const used = [fiveHour?.usedPercent, weekly?.usedPercent];
  assert.ok(used.every(value => Number.isFinite(value) && value >= 0 && value <= 100), 'USAGE_LIMITS_UNREADABLE');
  const remainingFiveHour = 100 - fiveHour.usedPercent;
  const remainingWeekly = 100 - weekly.usedPercent;
  const afterFiveHour = remainingFiveHour - context.resourceProjection.fiveHourCostPercentagePoints;
  const afterWeekly = remainingWeekly - context.resourceProjection.weeklyCostPercentagePoints;
  assert.ok(remainingFiveHour > context.resourceProjection.finishAboveRemainingPercent,
    'USER_FIVE_HOUR_REMAINING_FLOOR_NOT_MET');
  assert.ok(remainingFiveHour >= context.resourceProjection.checkpointAtRemainingPercent,
    'FIVE_HOUR_RESOURCE_CHECKPOINT_REQUIRED');
  assert.ok(afterFiveHour >= context.resourceProjection.reserveAfterProjectionMinimumFiveHourPercent,
    'PROJECTED_FIVE_HOUR_RESERVE_NOT_MET');
  assert.ok(afterWeekly >= context.resourceProjection.reserveAfterProjectionMinimumWeeklyPercent,
    'PROJECTED_WEEKLY_RESERVE_NOT_MET');
  return Object.freeze({
    source: 'codex',
    readable: true,
    observedAt: observation.observedAtUtc,
    fiveHourRemainingPercent: remainingFiveHour,
    weeklyRemainingPercent: remainingWeekly,
    projectedFiveHourCostPercentagePoints: context.resourceProjection.fiveHourCostPercentagePoints,
    projectedWeeklyCostPercentagePoints: context.resourceProjection.weeklyCostPercentagePoints,
    projectedFiveHourRemainingPercent: afterFiveHour,
    projectedWeeklyRemainingPercent: afterWeekly
  });
}

async function waitForFreshGate(context, credentialSha256) {
  const requestId = randomUUID();
  const requestedAtUtc = new Date().toISOString();
  const requestPath = `${EXECUTION}/gate-request-${requestId}.json`;
  const responsePath = `${EXECUTION}/gate-response-${requestId}.json`;
  await assertAbsent(responsePath);
  const request = {
    profile: 'iras-v4-fresh-execution-gate-request',
    requestId,
    requestedAtUtc,
    responsePath,
    launcherSha256: context.launcherSha256,
    authorizationSha256: context.authorizationSha256,
    authorizationRequestSha256: context.hashes[AUTHORIZATION_REQUEST_PATH],
    resourceProjectionSha256: context.resourceProjectionSha256,
    resourceReviewSha256: context.resourceReviewSha256,
    freezeValidationSha256: context.freezeValidationSha256,
    preregistrationSha256: context.preregistrationSha256,
    credentialSha256,
    semanticNamespace: SEMANTIC_NAMESPACE,
    model: MODEL,
    authorizedGeminiCalls: 9,
    retries: 0,
    requiredUsageTool: 'mcp__codex_app__get_usage_limits',
    requiredUsageWindowsMinutes: [300, 10_080],
    maximumUsageObservationAgeMs: context.resourceProjection.observationMaximumAgeMs,
    quotaConfirmedByHuman: true,
    userInstruction: context.authorization.userInstruction,
    quotaConfirmationScope: context.authorization.quotaConfirmationScope
  };
  await assertContextStable(context);
  await writeExclusiveJson(requestPath, request);
  logPhase('AWAITING_FRESH_GATES', 'STARTED', { requestId, requestPath, responsePath, timeoutSeconds: 300 });
  const deadline = Date.now() + 300_000;
  let responseBytes;
  while (Date.now() < deadline) {
    try {
      const metadata = await lstat(abs(responsePath));
      assert.ok(metadata.isFile() && !metadata.isSymbolicLink(), 'GATE_RESPONSE_NOT_REGULAR_FILE');
      responseBytes = await readFile(abs(responsePath));
      break;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw codedError('GATE_RESPONSE_UNREADABLE');
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  if (!responseBytes) throw codedError('GATE_RESPONSE_TIMEOUT');
  let response;
  try { response = JSON.parse(responseBytes.toString('utf8')); }
  catch { throw codedError('GATE_RESPONSE_INVALID'); }
  const allowance = assertFreshAllowance(response, { ...context, requestId }, requestedAtUtc, credentialSha256);
  await assertContextStable(context);
  return { allowance, gateResponseSha256: sha256(responseBytes), requestId };
}

async function sharedAllowanceReader(context) {
  // This callback is reached only after the branded runner validates the frozen
  // runner, activation, capture lock and payload and confirms the fresh namespace.
  const credential = process.env.GEMINI_API_KEY;
  assert.ok(typeof credential === 'string' && credential.trim().length > 10, 'GEMINI_CREDENTIAL_UNAVAILABLE');
  const credentialSha256 = sha256(Buffer.from(credential, 'utf8'));
  const gates = await waitForFreshGate(context, credentialSha256);
  return gates.allowance;
}

async function validateCapturedEvidence(runner, context) {
  for (const relative of [CAPTURE_OUTPUTS.marker, CAPTURE_OUTPUTS.journal, CAPTURE_OUTPUTS.payload,
    CAPTURE_OUTPUTS.evidenceLock, CAPTURE_OUTPUTS.result]) await assertPresentFile(relative);
  const [captureResult, payloadRead, lockRead] = await Promise.all([
    readJson(CAPTURE_OUTPUTS.result),
    readJson(CAPTURE_OUTPUTS.payload),
    readJson(CAPTURE_OUTPUTS.evidenceLock)
  ]);
  const report = captureResult.value;
  assert.equal(report.profile, 'iras-v4-fresh-capture-launch-result');
  assert.equal(report.status, 'CAPTURED_AND_LOCKED', 'FRESH_CAPTURE_NOT_SUCCESSFULLY_LOCKED');
  assert.equal(report.executionMode, 'BOUNDED_OFFICIAL_IRAS_CAPTURE_ONLY');
  assert.equal(report.launcherSha256, context.launcherSha256, 'CAPTURE_LAUNCHER_BINDING_MISMATCH');
  assert.equal(report.authorizationSha256, context.authorizationSha256, 'CAPTURE_AUTHORIZATION_BINDING_MISMATCH');
  assert.equal(report.resourceProjectionSha256, context.resourceProjectionSha256, 'CAPTURE_PROJECTION_BINDING_MISMATCH');
  assert.equal(report.resourceReviewSha256, context.resourceReviewSha256, 'CAPTURE_REVIEW_BINDING_MISMATCH');
  assert.equal(report.freezeValidationSha256, context.freezeValidationSha256, 'CAPTURE_FREEZE_BINDING_MISMATCH');
  assert.equal(report.captureInventorySha256, context.authorization.captureInventorySha256);
  assert.equal(report.semanticNamespace, SEMANTIC_NAMESPACE);
  assert.equal(report.semanticCalls, 0);
  assert.equal(report.providerCredentialRead, false);
  assert.equal(report.requestCount, 15);
  assert.equal(report.planRows?.length, 15);
  assert.ok(report.planRows.every(row => row.status === 'SUCCESS'), 'FRESH_CAPTURE_PLAN_NOT_COMPLETE');
  assert.equal(report.capturePayloadSha256, payloadRead.sha256, 'CAPTURE_RESULT_PAYLOAD_HASH_MISMATCH');
  assert.equal(report.evidenceLockSha256, lockRead.sha256, 'CAPTURE_RESULT_LOCK_HASH_MISMATCH');
  const payloadValidation = runner.validateCapturePayload(payloadRead.value, {
    now: new Date(),
    expectedIntegrityBindingSha256: context.runnerConfiguration.integrityBindingSha256,
    expectedPreregistrationSha256: context.preregistrationSha256,
    expectedActivationConfigurationSha256: context.activation.activationConfigurationSha256,
    expectedActivationConfigurationFileSha256: context.activationSha256,
    expectedCaptureInventory: context.captureInventory,
    syntheticMode: false,
    requireComplete: true
  });
  assert.equal(payloadValidation.entryCount, 15);
  assert.equal(payloadRead.value.requestCount, 15);
  assert.equal(lockRead.value.capturePayloadSha256, payloadRead.sha256, 'EVIDENCE_LOCK_PAYLOAD_HASH_MISMATCH');
  assert.equal(lockRead.value.preregistrationSha256, context.preregistrationSha256,
    'EVIDENCE_LOCK_PREREGISTRATION_MISMATCH');
  assert.equal(lockRead.value.runnerIntegrityBindingSha256, context.runnerConfiguration.integrityBindingSha256,
    'EVIDENCE_LOCK_RUNNER_BINDING_MISMATCH');
  const captureTime = Date.parse(payloadValidation.earliestAcquisitionAt);
  assert.ok(Number.isFinite(captureTime) && captureTime <= Date.now() && Date.now() - captureTime < 24 * 60 * 60_000,
    'FRESH_CAPTURE_EXPIRED');
  return Object.freeze({ report, captureResultSha256: captureResult.sha256, payloadSha256: payloadRead.sha256,
    evidenceLockSha256: lockRead.sha256 });
}

async function runSemantic(context) {
  const checkout = await assertExecutionCheckout(context);
  await assertSemanticNamespaceAbsent();
  logPhase('FRESH_CAPTURE_VALIDATION', 'STARTED');
  const runner = await import(pathToFileURL(abs('scripts/iras_v4_capture_replay_runner.mjs')).href);
  const capture = await validateCapturedEvidence(runner, context);
  logPhase('FRESH_CAPTURE_VALIDATION', 'PASSED', { requestCount: 15, evidenceLockSha256: capture.evidenceLockSha256 });

  logPhase('FROZEN_EXECUTION_CAPABILITY_VALIDATION', 'STARTED', { head: checkout.head });
  const executionCapability = await runner.loadReviewedV4ExecutionCapability({
    activationConfigurationPath: abs(ACTIVATION_PATH), root: ROOT, gitExecutable: GIT
  });
  await assertContextStable(context);
  logPhase('FROZEN_EXECUTION_CAPABILITY_VALIDATION', 'PASSED');

  logPhase('SEMANTIC_ACCEPTANCE', 'STARTED', { authorizedCalls: 9, retries: 0, model: MODEL });
  const result = await runner.runBoundedV4SemanticPhase({
    root: ROOT,
    gitExecutable: GIT,
    runnerConfigurationPath: abs(RUNNER_PATH),
    activationConfigurationPath: abs(ACTIVATION_PATH),
    executionCapability,
    preregistrationPath: abs(PREREGISTRATION_PATH),
    evidenceLockPath: abs(CAPTURE_OUTPUTS.evidenceLock),
    capturePayloadPath: abs(CAPTURE_OUTPUTS.payload),
    namespaceDirectory: abs(SEMANTIC_NAMESPACE),
    authorizedGeminiCalls: 9,
    sharedAllowanceReader: async () => await sharedAllowanceReader(context)
  });
  if (result.acceptanceStatus !== 'PASSED') {
    const failedRows = Array.isArray(result.rows) ? result.rows.filter(row => row.status !== 'PASSED' || row.failure) : [];
    logPhase('SEMANTIC_ACCEPTANCE_RESULT', 'FAILED', {
      acceptanceStatus: result.acceptanceStatus ?? null,
      firstFailure: result.firstFailure ?? failedRows[0]?.failure?.stage ?? failedRows[0]?.firstFailure ?? null,
      failedRows: failedRows.map(row => ({
        caseId: row.caseId ?? null,
        status: row.status ?? null,
        firstFailure: row.failure?.stage ?? row.firstFailure ?? null
      })),
      callCounts: result.callCounts ?? null
    });
  }
  const expectedCalls = Object.fromEntries(context.preregistration.promptFingerprints.map(row => [row.caseId, 1]));
  assert.equal(Object.keys(expectedCalls).length, 9, 'FROZEN_SEMANTIC_CASE_COUNT_INVALID');
  assert.deepEqual(result.callCounts, expectedCalls, 'SEMANTIC_CALL_COUNTS_MISMATCH');
  assert.equal(result.rows.length, 9, 'SEMANTIC_RESULT_ROW_COUNT_MISMATCH');
  assert.equal(result.acceptanceStatus, 'PASSED', 'SEMANTIC_ACCEPTANCE_NOT_PASSED');
  assert.equal(result.synthetic, false, 'SEMANTIC_RESULT_SYNTHETIC');
  await assertContextStable(context);
  logPhase('SEMANTIC_ACCEPTANCE', 'PASSED', {
    acceptanceStatus: result.acceptanceStatus,
    caseCount: result.rows.length,
    callCounts: result.callCounts,
    consumedNamespace: SEMANTIC_NAMESPACE
  });
}

async function main() {
  const mode = parseMode(process.argv.slice(2));
  if (mode === 'check') return await checkMode();
  const authorizationRead = await rejectMissingNewAuthorization();
  logPhase('PRELAUNCH_BINDING_CHECK', 'STARTED', { mode, newAuthorizationPresent: true });
  const context = await loadPreparedContext({ live: true });
  assertLiveAuthorization(context, authorizationRead);
  await assertExecutionCheckout(context);
  await assertContextStable(context);
  if (mode === 'capture') await runCapture(context);
  else await runSemantic(context);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    logPhase('LAUNCH', 'FAILED_NO_AUTOMATIC_RETRY', { failureCode: safeFailureCode(error) });
    process.exitCode = 1;
  }
}
