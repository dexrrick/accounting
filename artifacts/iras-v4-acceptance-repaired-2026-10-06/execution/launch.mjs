// One-shot launcher for the reviewed fresh IRAS capture and nine-case semantic run.
// --check and --validate-capture are offline/read-only and never inspect credentials.
// Capture and semantic modes require the reviewed checkout, exact authorization, and frozen inputs.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = 'D:/Accounting';
const GIT = 'C:/Users/Admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/native/git/cmd/git.exe';
const REVIEWED_COMMIT = 'a9924a8931209fa6df723e8faaefc21914368d82';
const BRANCH = 'codex/multi-authority-workstreams';
const ARTIFACT_ROOT = 'artifacts/iras-v4-acceptance-repaired-2026-10-06';
const PREPARATION = `${ARTIFACT_ROOT}/preparation`;
const EXECUTION = `${ARTIFACT_ROOT}/execution`;
const PREVIOUS_CAPTURE = `${ARTIFACT_ROOT}/official-capture`;
const CAPTURE = `${ARTIFACT_ROOT}/official-capture-recovery-2026-10-07`;
const SEMANTIC_NAMESPACE = `${ARTIFACT_ROOT}/semantic-run-v4`;
const LAUNCHER_PATH = `${EXECUTION}/launch.mjs`;
const RUNNER_PATH = `${PREPARATION}/runner-configuration.json`;
const PREREGISTRATION_PATH = `${PREPARATION}/preregistration.json`;
const ACTIVATION_PATH = `${PREPARATION}/activation-configuration.json`;
const FREEZE_VALIDATION_PATH = `${PREPARATION}/freeze-validation.json`;
const AUTHORIZATION_REQUEST_PATH = `${PREPARATION}/authorization-request.json`;
const AUTHORIZATION_PATH = `${EXECUTION}/authorization.json`;
const RESOURCE_PROJECTION_PATH = `${EXECUTION}/resource-projection.json`;
const RESOURCE_REVIEW_PATH = `${EXECUTION}/resource-authorization-review.json`;
const RECOVERY_PLAN_PATH = `${EXECUTION}/capture-recovery-plan.json`;
const RECOVERY_FINALIZER_PATH = `${EXECUTION}/finalize-recovery.mjs`;
const RECOVERY_COMPLETION_PATH = `${EXECUTION}/capture-recovery-completion.json`;
const RECOVERY_PAYLOAD_AUDIT_PATH = `${EXECUTION}/recovery-complete-payload-audit.json`;
const RECOVERY_SEAL_PATH = `${EXECUTION}/supervisor-evidence-seal-verification.json`;
const CAPTURE_OUTPUTS = Object.freeze({
  marker: `${CAPTURE}/capture-reserved.json`,
  journal: `${CAPTURE}/capture-partial.jsonl`,
  payload: `${CAPTURE}/capture-payload.json`,
  evidenceLock: `${CAPTURE}/evidence-lock.json`,
  result: `${CAPTURE}/capture-result.json`
});
const MODEL = 'gemini-3.5-flash-lite';
const EXPECTED_FREEZE_VALIDATION_SHA256 = 'c381c4728cdd1ae0788576e938114109c6c1314b4738c4c3e16e16dbc7d99ec1';
const EXPECTED_AUTHORIZATION_REQUEST_SHA256 = 'aab2a82dc05d53d2a2e5b07c4ecec092085fbbc47ba526b1c8a7166e9be6e0b0';
const EXPECTED_RECOVERY_COMPLETION_SHA256 = 'c600656f163d60729bd7605874322d74cc0e87d2fa612ea36c8c496ec5c5dd7a';
const EXPECTED_RECOVERY_FINALIZER_SHA256 = '766fcc4eb49c82e9e04ade312a42ea833709639c39c76c584a5b7b5de6b862ed';
const EXPECTED_INTERRUPTED_CAPTURE_LAUNCHER_SHA256 = 'eb54f4a0e148a17babc83a47f445d14f65fa2fd031c09513ee55ef3993af784a';
const EXPECTED_RECOVERY_PAYLOAD_AUDIT_SHA256 = '422cdfa6862fa955b0fb0aee4936bebc3387ad058a3b2eee22022dcb45fa7c00';
const EXPECTED_RECOVERY_SEAL_SHA256 = '8c30fa2d4c27a5f48f279ce266c98dbe295d955e7085ad4ea388afa85f2532e7';
const NETWORK_BLOCKER_PATH = 'docs/evaluation/multi-authority-workstreams/iras-v4-negative-controls-2026-10-06/block-external-network.mjs';
const FROZEN_BINDINGS = Object.freeze({
  [RUNNER_PATH]: 'c28d78859dce8ab2907ee50baddf5f4b424ed2328ccf6cbee4115a9bd9eaf078',
  [PREREGISTRATION_PATH]: '0f6e0e99f7751fb230c39d4172adda9ceb777d97303ba38e5e42c4cf3382a265',
  [ACTIVATION_PATH]: 'b61044862f157a93c4529a054309ade4da03666f96bf6d77111a3e46a53b2c3b'
});
const EXPECTED_USER_INSTRUCTION = 'yes go ahead and do so\nquota is enough';
const EXPECTED_QUOTA_SCOPE = 'Reviewed fixed model, configured project credential and nine-call run; no provider probe or inferred higher capacity';
const EXECUTION_INPUTS = Object.freeze([
  LAUNCHER_PATH,
  RUNNER_PATH,
  PREREGISTRATION_PATH,
  ACTIVATION_PATH,
  FREEZE_VALIDATION_PATH,
  AUTHORIZATION_REQUEST_PATH,
  AUTHORIZATION_PATH,
  RESOURCE_PROJECTION_PATH,
  RESOURCE_REVIEW_PATH,
  RECOVERY_PLAN_PATH,
  RECOVERY_FINALIZER_PATH,
  RECOVERY_PAYLOAD_AUDIT_PATH,
  RECOVERY_SEAL_PATH
]);
const CAPTURE_FAILURE_CODE_RE = /^[A-Z][A-Z0-9_:-]{0,119}$/;
const sha256 = value => createHash('sha256').update(value).digest('hex');
const abs = relative => path.resolve(ROOT, relative);
const logPhase = (phase, status, details = {}) => console.log(JSON.stringify({ phase, status, ...details }));
const codedError = code => Object.assign(new Error(code), { code });

function parseMode(args) {
  assert.ok(Array.isArray(args) && args.length <= 1, 'INVALID_LAUNCH_ARGUMENTS');
  const argument = args[0] || '--check';
  assert.ok(['--check', '--capture', '--semantic', '--validate-capture'].includes(argument), 'INVALID_LAUNCH_ARGUMENTS');
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

async function loadPreparedContext() {
  const launcherBytes = await readRaw(LAUNCHER_PATH);
  const recoveryFinalizerBytes = await readRaw(RECOVERY_FINALIZER_PATH);
  assert.equal(sha256(recoveryFinalizerBytes), EXPECTED_RECOVERY_FINALIZER_SHA256,
    'RECOVERY_FINALIZER_HASH_MISMATCH');
  const [runner, preregistration, activation, freezeValidation, authorizationRequest, authorization,
    resourceProjection, resourceReview, recoveryPlan, recoveryPayloadAudit, recoverySeal] = await Promise.all([
    readJson(RUNNER_PATH), readJson(PREREGISTRATION_PATH), readJson(ACTIVATION_PATH),
    readJson(FREEZE_VALIDATION_PATH), readJson(AUTHORIZATION_REQUEST_PATH), readJson(AUTHORIZATION_PATH),
    readJson(RESOURCE_PROJECTION_PATH), readJson(RESOURCE_REVIEW_PATH), readJson(RECOVERY_PLAN_PATH),
    readJson(RECOVERY_PAYLOAD_AUDIT_PATH), readJson(RECOVERY_SEAL_PATH)
  ]);
  assert.equal(runner.sha256, FROZEN_BINDINGS[RUNNER_PATH], 'FROZEN_RUNNER_RAW_HASH_MISMATCH');
  assert.equal(preregistration.sha256, FROZEN_BINDINGS[PREREGISTRATION_PATH], 'FROZEN_PREREGISTRATION_RAW_HASH_MISMATCH');
  assert.equal(activation.sha256, FROZEN_BINDINGS[ACTIVATION_PATH], 'FROZEN_ACTIVATION_RAW_HASH_MISMATCH');
  assert.equal(freezeValidation.sha256, EXPECTED_FREEZE_VALIDATION_SHA256, 'FREEZE_VALIDATION_HASH_MISMATCH');
  assert.equal(authorizationRequest.sha256, EXPECTED_AUTHORIZATION_REQUEST_SHA256, 'AUTHORIZATION_REQUEST_HASH_MISMATCH');
  assert.deepEqual(freezeValidation.value.bindings, FROZEN_BINDINGS, 'FREEZE_VALIDATION_BINDINGS_MISMATCH');
  assert.deepEqual(authorization.value.verifiedBindingSha256, FROZEN_BINDINGS, 'AUTHORIZED_BINDINGS_MISMATCH');
  assert.equal(freezeValidation.value.status, 'OFFLINE_BINDINGS_VERIFIED_CAPTURE_AND_SEMANTIC_EXECUTION_HELD');
  assert.equal(freezeValidation.value.reviewedCommit, REVIEWED_COMMIT);
  assert.equal(freezeValidation.value.semanticNamespace, SEMANTIC_NAMESPACE);
  assert.equal(freezeValidation.value.namespaceAbsent, true);
  assert.equal(freezeValidation.value.captureInventorySha256, authorization.value.captureInventorySha256);
  assert.equal(freezeValidation.value.captureInventoryCount, 15);
  assert.equal(freezeValidation.value.liveCallsMade, 0);
  assert.equal(freezeValidation.value.capturesMade, 0);
  assert.equal(freezeValidation.value.reservationOrDispatchOccurred, false);
  assert.equal(freezeValidation.value.protectedInputsUnchanged, true);

  assert.equal(runner.value.profile, 'iras-v4-runner-integrity');
  assert.equal(runner.value.status, 'FROZEN_RUNNER_CONFIGURATION');
  assert.equal(runner.value.reviewedCommit, REVIEWED_COMMIT);
  assert.equal(runner.value.branch, BRANCH);
  assert.equal(runner.value.semanticNamespace, SEMANTIC_NAMESPACE);
  assert.equal(runner.value.captureInventory, null);
  assert.equal(runner.value.productionEvidenceAdapterSha256, null);
  assert.equal(runner.value.preregistrationSha256, null);
  assert.equal(preregistration.value.profile, 'iras-first-targeted-acceptance-v4');
  assert.equal(preregistration.value.frozen, true);
  assert.equal(activation.value.profile, 'iras-v4-capture-activation');
  assert.equal(activation.value.status, 'FROZEN_ACTIVATION_CONFIGURATION');
  assert.equal(activation.value.frozen, true);
  assert.equal(activation.value.runnerConfigurationPath, RUNNER_PATH);
  assert.equal(activation.value.preregistrationPath, PREREGISTRATION_PATH);
  assert.equal(activation.value.preregistrationSha256, preregistration.sha256);
  assert.equal(activation.value.runnerIntegrityBindingSha256, runner.value.integrityBindingSha256);
  assert.ok(Array.isArray(activation.value.captureInventory), 'FROZEN_CAPTURE_INVENTORY_REQUIRED');
  assert.equal(activation.value.captureInventory.length, 15, 'FROZEN_CAPTURE_INVENTORY_COUNT_MISMATCH');
  assert.equal(sha256(Buffer.from(JSON.stringify(activation.value.captureInventory))),
    activation.value.captureInventorySha256, 'FROZEN_CAPTURE_INVENTORY_HASH_MISMATCH');
  assert.equal(activation.value.captureInventorySha256, authorization.value.captureInventorySha256);
  assert.ok(activation.value.captureInventory.every(row => row.method === 'GET' &&
    ['SOURCE', 'DISCOVERY'].includes(row.purpose) &&
    ['iras.gov.sg', 'www.iras.gov.sg'].includes(new URL(row.url).hostname)),
  'FROZEN_CAPTURE_INVENTORY_SCOPE_INVALID');
  assert.equal(activation.value.captureInventory.filter(row => row.purpose === 'SOURCE').length, 9);
  assert.equal(activation.value.captureInventory.filter(row => row.purpose === 'DISCOVERY').length, 6);

  const auth = authorization.value;
  assert.equal(auth.profile, 'iras-v4-fresh-execution-authorization');
  assert.equal(auth.authorizationGranted, true);
  assert.equal(auth.officialSourceCaptureAuthorized, true);
  assert.equal(auth.geminiAcceptanceAuthorized, true);
  assert.equal(auth.noPreviousAuthorizationReused, true);
  assert.equal(auth.reviewedCommit, REVIEWED_COMMIT);
  assert.equal(auth.semanticNamespace, SEMANTIC_NAMESPACE);
  assert.equal(auth.authorizationRequestSha256, authorizationRequest.sha256);
  assert.equal(auth.captureInventorySha256, activation.value.captureInventorySha256);
  assert.equal(auth.model, MODEL);
  assert.equal(auth.authorizedGeminiCalls, 9);
  assert.equal(auth.retries, 0);
  assert.equal(auth.quotaConfirmedByHuman, true);
  assert.equal(auth.userInstruction, EXPECTED_USER_INSTRUCTION);
  assert.equal(auth.quotaConfirmationScope, EXPECTED_QUOTA_SCOPE);
  assert.ok(Number.isFinite(Date.parse(auth.authorizedAtUtc)), 'AUTHORIZATION_TIMESTAMP_INVALID');

  const projection = resourceProjection.value;
  assert.equal(projection.profile, 'iras-v4-fresh-execution-resource-projection');
  assert.equal(projection.status, 'INDEPENDENTLY_REVIEWED_PLANNING_ESTIMATE');
  assert.equal(projection.fiveHourCostPercentagePoints, 40);
  assert.equal(projection.weeklyCostPercentagePoints, 15);
  assert.equal(projection.reserveAfterProjectionMinimumFiveHourPercent, 8);
  assert.equal(projection.reserveAfterProjectionMinimumWeeklyPercent, 4);
  assert.equal(projection.finishAboveRemainingPercent, 5);
  assert.equal(projection.checkpointAtRemainingPercent, 10);
  assert.equal(projection.observationMaximumAgeMs, 300_000);
  assert.equal(projection.actualAllowanceMustBeMonitored, true);
  assert.equal(projection.observationRequiredAfterExpensiveValidation, true);
  assert.equal(projection.stopIfBoundNoLongerSupported, true);
  assert.equal(projection.historical80ProjectionChanged, false);
  assert.equal(projection.evidence?.nextScopeHasNoImplementation, true);
  assert.match(projection.scope, /no remedial coding, retries or extra capture/i);

  assert.equal(resourceReview.value.profile, 'iras-v4-fresh-resource-authorization-review');
  assert.equal(resourceReview.value.disposition, 'ACCEPTABLE_NO_MATERIAL_FINDINGS');
  assert.equal(resourceReview.value.projectionSha256, resourceProjection.sha256);
  assert.equal(resourceReview.value.authorizationSha256, authorization.sha256);
  assert.equal(resourceReview.value.quotaSource,
    'Current explicit human confirmation; no provider probe or new numerical capacity inferred');

  const recovery = recoveryPlan.value;
  assert.equal(recovery.profile, 'iras-v4-interrupted-capture-recovery');
  assert.equal(recovery.status, 'INDEPENDENTLY_REVIEWED_AUTHORIZED_RECOVERY');
  assert.equal(recovery.semanticNamespace, SEMANTIC_NAMESPACE);
  assert.equal(recovery.previousCaptureDirectory, PREVIOUS_CAPTURE);
  assert.equal(recovery.recoveryCaptureDirectory, CAPTURE);
  assert.equal(recovery.previousReservedNamespaceMustNotBeReused, true);
  assert.equal(recovery.captureInventorySha256, activation.value.captureInventorySha256);
  assert.equal(recovery.transportRetries, 0);
  assert.equal(recovery.missingFamily, 'withholding-tax');
  assert.equal(recovery.missingRequestCount, 4);
  assert.equal(recovery.retainedResponsesAllHttp200, true);
  assert.equal(recovery.previousCaptureProcessRunning, false);
  assert.equal(recovery.terminationCause, 'UNDETERMINED_NO_COMPLETE_PAYLOAD_OR_EVIDENCE_LOCK');
  assert.equal(recovery.originalMaximumRequests, 60);
  assert.equal(recovery.originalMaximumRequestsPerFamily, 10);
  assert.equal(recovery.retainedResponseCount, 11);
  assert.equal(recovery.maximumUnresolvedPreviousRequests, 1);
  assert.equal(recovery.freshApprovedRequestCount, activation.value.captureInventory.length);
  assert.equal(recovery.aggregateMaximumRequests, 27);
  assert.equal(recovery.retainedResponseCount + recovery.maximumUnresolvedPreviousRequests +
    recovery.freshApprovedRequestCount, recovery.aggregateMaximumRequests);
  assert.ok(recovery.aggregateMaximumRequests <= recovery.originalMaximumRequests,
    'RECOVERY_AGGREGATE_REQUEST_CEILING_EXCEEDED');
  assert.equal(recovery.aggregateMaximumRequestsPerFamily, 6);
  assert.ok(recovery.aggregateMaximumRequestsPerFamily <= recovery.originalMaximumRequestsPerFamily,
    'RECOVERY_FAMILY_REQUEST_CEILING_EXCEEDED');
  assert.equal(recovery.paidCallsAuthorized, 9);
  assert.equal(recovery.paidCallsAlreadyMade, 0);
  assert.equal(recovery.existingGeminiAuthorizationUnspent, true);
  assert.equal(Object.values(recovery.retainedFamilyCounts || {}).reduce((total, count) => total + count, 0),
    recovery.retainedResponseCount, 'RECOVERY_RETAINED_FAMILY_COUNTS_MISMATCH');
  assert.equal(sha256(await readRaw(`${PREVIOUS_CAPTURE}/capture-reserved.json`)),
    recovery.previousReservedMarkerSha256, 'RECOVERY_PREVIOUS_MARKER_HASH_MISMATCH');
  assert.equal(sha256(await readRaw(`${PREVIOUS_CAPTURE}/capture-partial.jsonl`)),
    recovery.previousJournalSha256, 'RECOVERY_PREVIOUS_JOURNAL_HASH_MISMATCH');
  assert.equal(recoveryPayloadAudit.sha256, EXPECTED_RECOVERY_PAYLOAD_AUDIT_SHA256);
  assert.equal(recoveryPayloadAudit.value.payloadSha256, '17028b5c5357357c7a0e5d5597f00d6ca545c556b89a73ffe5727b6765d940fc');
  assert.equal(recoveryPayloadAudit.value.responseCount, 15);
  assert.equal(recoveryPayloadAudit.value.allFailuresNull, true);
  assert.equal(recoveryPayloadAudit.value.journalEqualsPayloadEntries, true);
  assert.equal(recoveryPayloadAudit.value.previous11CaptureUnchanged, true);
  assert.equal(recoverySeal.sha256, EXPECTED_RECOVERY_SEAL_SHA256);
  assert.equal(recoverySeal.value.profile, 'iras-v4-supervisor-evidence-seal-verification');
  assert.equal(recoverySeal.value.status, 'PASS');
  assert.equal(recoverySeal.value.completionSha256, EXPECTED_RECOVERY_COMPLETION_SHA256);
  assert.equal(recoverySeal.value.rawHashBindingsVerified, 6);
  assert.equal(recoverySeal.value.replayLookups, 15);
  assert.equal(recoverySeal.value.geminiCalls, 0);

  const hashes = Object.freeze({
    [LAUNCHER_PATH]: sha256(launcherBytes),
    [RUNNER_PATH]: runner.sha256,
    [PREREGISTRATION_PATH]: preregistration.sha256,
    [ACTIVATION_PATH]: activation.sha256,
    [FREEZE_VALIDATION_PATH]: freezeValidation.sha256,
    [AUTHORIZATION_REQUEST_PATH]: authorizationRequest.sha256,
    [AUTHORIZATION_PATH]: authorization.sha256,
    [RESOURCE_PROJECTION_PATH]: resourceProjection.sha256,
    [RESOURCE_REVIEW_PATH]: resourceReview.sha256,
    [RECOVERY_PLAN_PATH]: recoveryPlan.sha256,
    [RECOVERY_FINALIZER_PATH]: sha256(recoveryFinalizerBytes),
    [RECOVERY_PAYLOAD_AUDIT_PATH]: recoveryPayloadAudit.sha256,
    [RECOVERY_SEAL_PATH]: recoverySeal.sha256
  });
  return Object.freeze({
    launcherSha256: hashes[LAUNCHER_PATH],
    hashes,
    runnerConfiguration: runner.value,
    preregistration: preregistration.value,
    preregistrationSha256: preregistration.sha256,
    activation: activation.value,
    activationSha256: activation.sha256,
    authorization: auth,
    authorizationSha256: authorization.sha256,
    resourceProjection: projection,
    resourceProjectionSha256: resourceProjection.sha256,
    resourceReviewSha256: resourceReview.sha256,
    freezeValidationSha256: freezeValidation.sha256,
    captureInventory: activation.value.captureInventory,
    recoveryPlan: recovery,
    recoveryPlanSha256: recoveryPlan.sha256,
    recoveryPayloadAudit: recoveryPayloadAudit.value,
    recoverySeal: recoverySeal.value
  });
}

async function assertContextStable(context) {
  for (const relative of EXECUTION_INPUTS) {
    const current = sha256(await readRaw(relative));
    assert.equal(current, context.hashes[relative], 'FROZEN_EXECUTION_INPUT_CHANGED');
  }
}

async function assertCaptureOutputsAbsent() {
  for (const relative of Object.values(CAPTURE_OUTPUTS)) await assertAbsent(relative);
}

async function assertSemanticNamespaceAbsent() {
  await assertAbsent(SEMANTIC_NAMESPACE);
}

function git(args, options = {}) {
  return execFileSync(GIT, ['-C', ROOT, ...args], { encoding: 'utf8', windowsHide: true, ...options }).trim();
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
    { stdio: 'ignore', windowsHide: true });
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
  const context = await loadPreparedContext();
  const checkout = await assertExecutionCheckout(context);
  await assertCaptureOutputsAbsent();
  await assertSemanticNamespaceAbsent();
  await assertContextStable(context);
  logPhase('OFFLINE_CHECK', 'PASSED', {
    reviewedCommit: REVIEWED_COMMIT,
    head: checkout.head,
    captureInventoryRows: context.captureInventory.length,
    authorizedGeminiCalls: context.authorization.authorizedGeminiCalls,
    authorizationGranted: context.authorization.authorizationGranted,
    officialSourceCaptureAuthorized: context.authorization.officialSourceCaptureAuthorized,
    semanticNamespace: SEMANTIC_NAMESPACE,
    liveNetworkUsed: false,
    credentialRead: false,
    filesWritten: false
  });
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
    assert.deepEqual(loaded.payload, captureRun.capture.document, 'CAPTURE_PAYLOAD_DOCUMENT_MISMATCH');
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

function assertRecoveryCompletionBindings(completion, expected) {
  assert.equal(completion.profile, 'iras-v4-recovery-capture-finalization');
  assert.equal(completion.status, 'CAPTURE_EVIDENCE_LOCKED_SEMANTIC_HELD');
  for (const field of ['recoveryPlanSha256', 'capturePayloadSha256', 'captureJournalSha256', 'captureMarkerSha256',
    'failedCaptureResultSha256', 'evidenceLockSha256', 'captureInventorySha256']) {
    assert.equal(completion[field], expected[field], `RECOVERY_COMPLETION_BINDING_MISMATCH:${field}`);
  }
  assert.equal(completion.captureRequestCount, 15);
  assert.equal(completion.successfulReplayLookupCount, 15);
  assert.equal(completion.semanticStatus, 'HELD_RESOURCE');
  assert.equal(completion.semanticCalls, 0);
  assert.equal(completion.providerApiCalls, 0);
  assert.equal(completion.networkBlocked, true);
  assert.equal(completion.sourceEvidenceExpiresAtUtc,
    new Date(Date.parse(expected.earliestAcquisitionAt) + 24 * 60 * 60_000).toISOString());
  assert.ok(Number.isFinite(Date.parse(completion.finalizedAtUtc)), 'RECOVERY_COMPLETION_TIMESTAMP_INVALID');
}

function assertRecoveryCompletionRejectsTampering(completion, expected) {
  for (const mutation of [
    { capturePayloadSha256: '0'.repeat(64) },
    { failedCaptureResultSha256: 'f'.repeat(64) },
    { captureInventorySha256: '0'.repeat(64) },
    { successfulReplayLookupCount: 14 },
    { networkBlocked: false }
  ]) assert.throws(() => assertRecoveryCompletionBindings({ ...completion, ...mutation }, expected));
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
  assert.equal(report.executionMode, 'BOUNDED_OFFICIAL_IRAS_CAPTURE_ONLY');
  assert.equal(report.authorizationSha256, context.authorizationSha256, 'CAPTURE_AUTHORIZATION_BINDING_MISMATCH');
  assert.equal(report.resourceProjectionSha256, context.resourceProjectionSha256, 'CAPTURE_PROJECTION_BINDING_MISMATCH');
  assert.equal(report.resourceReviewSha256, context.resourceReviewSha256, 'CAPTURE_REVIEW_BINDING_MISMATCH');
  assert.equal(report.freezeValidationSha256, context.freezeValidationSha256, 'CAPTURE_FREEZE_BINDING_MISMATCH');
  assert.equal(report.reviewedCommit, REVIEWED_COMMIT);
  assert.equal(report.semanticNamespace, SEMANTIC_NAMESPACE);
  assert.equal(report.providerCredentialRead, false);
  let recoveryCompletion = null;
  if (report.status === 'CAPTURED_AND_LOCKED') {
    assert.equal(report.launcherSha256, context.launcherSha256, 'CAPTURE_LAUNCHER_BINDING_MISMATCH');
    assert.equal(report.captureInventorySha256, context.authorization.captureInventorySha256);
    assert.equal(report.semanticCalls, 0);
    assert.equal(report.requestCount, 15);
    assert.equal(report.planRows?.length, 15);
    assert.ok(report.planRows.every(row => row.status === 'SUCCESS'), 'FRESH_CAPTURE_PLAN_NOT_COMPLETE');
    assert.equal(report.capturePayloadSha256, payloadRead.sha256, 'CAPTURE_RESULT_PAYLOAD_HASH_MISMATCH');
    assert.equal(report.evidenceLockSha256, lockRead.sha256, 'CAPTURE_RESULT_LOCK_HASH_MISMATCH');
  } else {
    assert.equal(report.status, 'FAILED_NO_AUTOMATIC_RETRY', 'FRESH_CAPTURE_NOT_SUCCESSFULLY_LOCKED');
    assert.equal(report.phase, 'CAPTURE_PAYLOAD_VALIDATION', 'RECOVERY_CAPTURE_FAILURE_PHASE_MISMATCH');
    assert.equal(report.failureCode, 'CAPTURE_PAYLOAD_DOCUMENT_MISMATCH', 'RECOVERY_CAPTURE_FAILURE_NOT_APPROVED');
    assert.equal(report.launcherSha256, EXPECTED_INTERRUPTED_CAPTURE_LAUNCHER_SHA256,
      'RECOVERY_ORIGINAL_CAPTURE_LAUNCHER_MISMATCH');
    recoveryCompletion = await readJson(RECOVERY_COMPLETION_PATH);
    assert.equal(recoveryCompletion.sha256, EXPECTED_RECOVERY_COMPLETION_SHA256,
      'RECOVERY_COMPLETION_RAW_HASH_MISMATCH');
  }
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
  assert.equal(lockRead.value.capturePayloadSha256, payloadRead.sha256, 'EVIDENCE_LOCK_PAYLOAD_HASH_MISMATCH');
  assert.equal(lockRead.value.captureInventorySha256, context.authorization.captureInventorySha256,
    'EVIDENCE_LOCK_INVENTORY_MISMATCH');
  const captureTime = Date.parse(payloadValidation.earliestAcquisitionAt);
  assert.ok(Number.isFinite(captureTime) && captureTime <= Date.now() && Date.now() - captureTime < 24 * 60 * 60_000,
    'FRESH_CAPTURE_EXPIRED');
  let recoveryCompletionSha256 = null;
  if (recoveryCompletion) {
    const plan = context.recoveryPlan;
    const journalBytes = await readRaw(CAPTURE_OUTPUTS.journal);
    const markerSha256 = sha256(await readRaw(CAPTURE_OUTPUTS.marker));
    const journalSha256 = sha256(journalBytes);
    const journalEntries = journalBytes.toString('utf8').trim().split(/\r?\n/).map(line => JSON.parse(line));
    assert.deepEqual(journalEntries, payloadRead.value.entries, 'RECOVERY_CAPTURE_JOURNAL_MISMATCH');
    assert.equal(payloadRead.value.captureStatus, 'COMPLETE');
    assert.equal(payloadRead.value.synthetic, false);
    assert.equal(payloadRead.value.entries.length, 15);
    const inventory = context.captureInventory.filter(row => row.purpose !== 'REDIRECT');
    assert.equal(inventory.length, 15);
    for (let index = 0; index < inventory.length; index += 1) {
      const wanted = inventory[index], entry = payloadRead.value.entries[index];
      assert.deepEqual(entry.request, { family: wanted.family, url: wanted.url, method: wanted.method, headers: wanted.headers });
      assert.equal(entry.inventoryPurpose, wanted.purpose);
      assert.equal(entry.actualUrl, wanted.url);
      assert.equal(entry.status, 200);
      assert.equal(entry.failure, null);
    }
    const previousMarkerSha256 = sha256(await readRaw(`${PREVIOUS_CAPTURE}/capture-reserved.json`));
    const previousJournalBytes = await readRaw(`${PREVIOUS_CAPTURE}/capture-partial.jsonl`);
    assert.equal(previousMarkerSha256, plan.previousReservedMarkerSha256, 'RECOVERY_PREVIOUS_MARKER_CHANGED');
    assert.equal(sha256(previousJournalBytes), plan.previousJournalSha256, 'RECOVERY_PREVIOUS_JOURNAL_CHANGED');
    assert.equal(previousJournalBytes.toString('utf8').trim().split(/\r?\n/).length, plan.retainedResponseCount);
    const completion = recoveryCompletion.value;
    const expected = {
      recoveryPlanSha256: context.recoveryPlanSha256,
      capturePayloadSha256: payloadRead.sha256,
      captureJournalSha256: journalSha256,
      captureMarkerSha256: markerSha256,
      failedCaptureResultSha256: captureResult.sha256,
      evidenceLockSha256: lockRead.sha256,
      captureInventorySha256: context.authorization.captureInventorySha256,
      earliestAcquisitionAt: payloadValidation.earliestAcquisitionAt
    };
    assertRecoveryCompletionBindings(completion, expected);
    assertRecoveryCompletionRejectsTampering(completion, expected);
    recoveryCompletionSha256 = recoveryCompletion.sha256;
  }
  return Object.freeze({ report, captureResultSha256: captureResult.sha256, payloadSha256: payloadRead.sha256,
    evidenceLockSha256: lockRead.sha256, recoveryCompletionSha256 });
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
  if (capture.recoveryCompletionSha256) {
    assert.equal(sha256(await readRaw(RECOVERY_COMPLETION_PATH)), capture.recoveryCompletionSha256,
      'RECOVERY_COMPLETION_CHANGED_DURING_PREFLIGHT');
  }
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

async function validateCaptureMode(context) {
  const checkout = await assertExecutionCheckout(context);
  await assertSemanticNamespaceAbsent();
  await assertContextStable(context);
  logPhase('OFFLINE_RECOVERY_CAPTURE_VALIDATION', 'STARTED', { head: checkout.head });
  await import(pathToFileURL(abs(NETWORK_BLOCKER_PATH)).href);
  const runner = await import(pathToFileURL(abs('scripts/iras_v4_capture_replay_runner.mjs')).href);
  const capture = await validateCapturedEvidence(runner, context);
  assert.ok(capture.recoveryCompletionSha256, 'RECOVERY_COMPLETION_REQUIRED');
  await assertContextStable(context);
  assert.equal(sha256(await readRaw(RECOVERY_COMPLETION_PATH)), capture.recoveryCompletionSha256,
    'RECOVERY_COMPLETION_CHANGED_DURING_VALIDATION');
  logPhase('OFFLINE_RECOVERY_CAPTURE_VALIDATION', 'PASSED', {
    completionSha256: capture.recoveryCompletionSha256,
    capturePayloadSha256: capture.payloadSha256,
    evidenceLockSha256: capture.evidenceLockSha256,
    requestCount: 15,
    replayLookups: context.recoverySeal.replayLookups,
    providerApiCalls: 0,
    networkBlocked: true,
    negativeCompletionBindingChecks: true
  });
}

async function main() {
  const mode = parseMode(process.argv.slice(2));
  if (mode === 'check') return await checkMode();
  logPhase('PRELAUNCH_BINDING_CHECK', 'STARTED', { mode });
  const context = await loadPreparedContext();
  await assertContextStable(context);
  if (mode === 'validate-capture') return await validateCaptureMode(context);
  if (mode === 'capture') await runCapture(context);
  else await runSemantic(context);
}

try {
  await main();
} catch (error) {
  logPhase('LAUNCH', 'FAILED_NO_AUTOMATIC_RETRY', { failureCode: safeFailureCode(error) });
  process.exitCode = 1;
}
