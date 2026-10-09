// Semantic-only continuation for the already locked post-repair capture.
// Default/--check is offline and read-only. Live mode requires the explicit
// --semantic argument, the bound human approval, the independent resource review,
// and a fresh local usage-gate response after core validation.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, open, readFile } from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = 'D:/Accounting';
const GIT = 'C:/Users/Admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/native/git/cmd/git.exe';
const REVIEWED_COMMIT = '66bdb77777f945f19d17cfe1559f4d6f9f9acfae';
const BRANCH = 'codex/multi-authority-workstreams';
const BASE = 'artifacts/iras-v4-acceptance-repaired-2026-10-06/post-repair-2026-10-08';
const PREP = `${BASE}/preparation`;
const EXEC = `${BASE}/execution`;
const CAPTURE = `${BASE}/official-capture`;
const NAMESPACE = 'artifacts/iras-v4-acceptance-repaired-2026-10-06/semantic-run-v4-post-repair-2026-10-08';
const FILES = Object.freeze({
  launcher: `${EXEC}/semantic-continuation.mjs`,
  projection: `${EXEC}/semantic-resource-projection.json`,
  approval: `${EXEC}/semantic-continuation-approval.json`,
  review: `${EXEC}/semantic-resource-review.json`,
  authorization: `${EXEC}/authorization.json`,
  quotaEvidence: `${EXEC}/approval-evidence.json`,
  previousLauncher: `${EXEC}/launch.mjs`,
  previousProjection: `${EXEC}/resource-projection.json`,
  previousReview: `${EXEC}/resource-authorization-review.json`,
  request: `${PREP}/authorization-request.json`,
  freeze: `${PREP}/freeze-validation.json`,
  runner: `${PREP}/runner-configuration.json`,
  preregistration: `${PREP}/preregistration.json`,
  activation: `${PREP}/activation-configuration.json`,
  captureMarker: `${CAPTURE}/capture-reserved.json`,
  capturePayload: `${CAPTURE}/capture-payload.json`,
  evidenceLock: `${CAPTURE}/evidence-lock.json`,
  captureResult: `${CAPTURE}/capture-result.json`
});
const MODEL = 'gemini-3.5-flash-lite';
const EXPECTED_PROJECTION_SHA256 = 'd78085b48a085567f87de6792cfe68901faf9acc6490c52745ebd76eb00c066d';
const RAW_PINS = Object.freeze({
  [FILES.authorization]: '279bea689627e3b6e72bf7f7c7282cca67cb18a73e244d6dc98af010b7e5b486',
  [FILES.quotaEvidence]: '303b08b0959910edaa2464a105cd019a0e83d50f0a458080376b0ce591cb5513',
  [FILES.previousLauncher]: 'bdb88348c5acf9d04c5ee42636fe20e4d03ea34a92fd1429b65afe2248a3e6a9',
  [FILES.previousProjection]: '934a8ac5f93731d959bfc4256f7a907753268770b731c5810b42b0f91cd6de88',
  [FILES.previousReview]: 'd927fa1be568a6634a0319f5ac769ccd6feb2a2f863de50c61c114e8db5e8dee',
  [FILES.request]: '56ed641e0d787a74ee42326b477b5e19a889d82e3b08f093b7794a0771b9149c',
  [FILES.freeze]: 'e27209aef958ddc8512edb09fe108544da26c9cd76c0aa8c5f52b88ce8666442',
  [FILES.runner]: 'f7712ede781edb10e6057d17d1d3a373d48b2f6825c7793377ccbcaf85f69852',
  [FILES.preregistration]: 'feafc2a67e0cf56da4f71d3d6424b1ef23b0b4344a4e27e39d403eec62451aeb',
  [FILES.activation]: '9e0f55d7d4e72555f51cf9f280cf5e959b8cadd1245c2e08a8e515f772c1b1fc',
  [FILES.captureMarker]: '8fa95b95b41380c812131ba4a59ab7682f004d441db692f19cecdfbc9164d28b',
  [FILES.capturePayload]: '77c07c267c0c94cb6f38ca92bfb6fa9c0fdd9e49fb64e9dcf40f1a3f242e7f19',
  [FILES.evidenceLock]: 'aa5c88eeb19c3ef891b09fa3c49f25e20620263f2121faf346403f6012fd445b',
  [FILES.captureResult]: 'ad6f338ee489ebe203b27bebf8702ad9364394a883a378034f50a5f7d8f9755e'
});
const FROZEN_BINDINGS = Object.freeze({
  [FILES.runner]: RAW_PINS[FILES.runner],
  [FILES.preregistration]: RAW_PINS[FILES.preregistration],
  [FILES.activation]: RAW_PINS[FILES.activation]
});
const INPUTS = Object.freeze([
  FILES.launcher, FILES.projection, FILES.approval, FILES.review,
  ...Object.keys(RAW_PINS)
]);
const sha256 = value => createHash('sha256').update(value).digest('hex');
const absolute = relative => path.resolve(ROOT, relative);
const output = (phase, status, details = {}) => process.stdout.write(`${JSON.stringify({ phase, status, ...details })}\n`);
const codedError = code => Object.assign(new Error(code), { code });
const SAFE_CODE = /^[A-Z][A-Z0-9_:-]{0,119}$/;

function modeFrom(argv) {
  assert.ok(argv.length <= 1 && (argv.length === 0 || ['--check', '--semantic'].includes(argv[0])),
    'INVALID_LAUNCH_ARGUMENTS');
  return argv[0] || '--check';
}

function blockOutboundNetwork() {
  const blocked = () => { throw codedError('OFFLINE_NETWORK_BLOCKED'); };
  globalThis.fetch = blocked;
  http.request = blocked;
  http.get = blocked;
  https.request = blocked;
  https.get = blocked;
  net.connect = blocked;
  net.createConnection = blocked;
  net.Socket.prototype.connect = blocked;
  tls.connect = blocked;
}

async function assertSafePath(relative, allowMissing = false) {
  assert.ok(typeof relative === 'string' && relative && !path.isAbsolute(relative), 'INPUT_PATH_INVALID');
  assert.ok(!relative.split(/[\\/]+/).includes('..'), 'INPUT_PATH_TRAVERSAL');
  const resolved = absolute(relative);
  const fromRoot = path.relative(path.resolve(ROOT), resolved);
  assert.ok(fromRoot && !fromRoot.startsWith('..') && !path.isAbsolute(fromRoot), 'INPUT_PATH_OUTSIDE_ROOT');
  let cursor = path.resolve(ROOT);
  for (const part of fromRoot.split(path.sep)) {
    cursor = path.join(cursor, part);
    try {
      const info = await lstat(cursor);
      assert.equal(info.isSymbolicLink(), false, 'SYMLINK_INPUT_BLOCKED');
    } catch (error) {
      if (allowMissing && error?.code === 'ENOENT') return false;
      throw error;
    }
  }
  return true;
}

async function raw(relative) {
  await assertSafePath(relative);
  return readFile(absolute(relative));
}

async function json(relative) {
  const bytes = await raw(relative);
  let value;
  try { value = JSON.parse(bytes.toString('utf8')); }
  catch { throw codedError('INPUT_JSON_INVALID'); }
  assert.ok(value && typeof value === 'object' && !Array.isArray(value), 'INPUT_JSON_INVALID');
  return { value, bytes, sha256: sha256(bytes) };
}

async function absent(relative) {
  if (!await assertSafePath(relative, true)) return;
  try { await lstat(absolute(relative)); throw codedError('OUTPUT_ALREADY_EXISTS'); }
  catch (error) { if (error?.code !== 'ENOENT') throw error; }
}

function git(args, options = {}) {
  return execFileSync(GIT, ['-C', ROOT, ...args], { encoding: 'utf8', windowsHide: true, ...options }).trim();
}

function assertProjection(value) {
  assert.equal(value.profile, 'iras-v4-semantic-continuation-resource-projection', 'PROJECTION_PROFILE_INVALID');
  assert.equal(value.status, 'INDEPENDENTLY_REVIEWED_PLANNING_ESTIMATE', 'PROJECTION_STATUS_INVALID');
  assert.equal(value.fiveHourCostPercentagePoints, 20, 'PROJECTION_SCOPE_INVALID');
  assert.equal(value.weeklyCostPercentagePoints, 10, 'PROJECTION_SCOPE_INVALID');
  assert.equal(value.reserveAfterProjectionMinimumFiveHourPercent, 8, 'PROJECTION_RESERVE_INVALID');
  assert.equal(value.reserveAfterProjectionMinimumWeeklyPercent, 4, 'PROJECTION_RESERVE_INVALID');
  assert.equal(value.checkpointAtRemainingPercent, 10, 'PROJECTION_CHECKPOINT_INVALID');
  assert.equal(value.finishAboveRemainingPercent, 5, 'PROJECTION_FINISH_FLOOR_INVALID');
  assert.equal(value.observationMaximumAgeMs, 300000, 'PROJECTION_OBSERVATION_AGE_INVALID');
  assert.equal(value.liveSourceRetrieval, false, 'SOURCE_RETRIEVAL_NOT_AUTHORIZED');
  assert.equal(value.providerProbesAuthorized, 0, 'PROVIDER_PROBES_NOT_AUTHORIZED');
  assert.equal(value.retries, 0, 'RETRIES_NOT_AUTHORIZED');
  assert.equal(value.authorizedGeminiCalls, 9, 'CALL_SCOPE_INVALID');
  assert.equal(value.model, MODEL, 'MODEL_SCOPE_INVALID');
  assert.equal(value.captureAlreadyLocked, true, 'LOCKED_CAPTURE_REQUIRED');
  assert.match(value.estimation, /not measured Gemini quota/i);
}

function assertApproval(value, context) {
  assert.equal(value.profile, 'iras-v4-semantic-continuation-approval', 'CURRENT_APPROVAL_REQUIRED');
  assert.equal(value.status, 'CURRENT_HUMAN_APPROVAL_FOR_SEMANTIC_ONLY_CONTINUATION', 'CURRENT_APPROVAL_REQUIRED');
  assert.equal(value.source, 'current Codex chat user message', 'CURRENT_APPROVAL_SOURCE_INVALID');
  assert.equal(value.threadId, '01a11bd1-82cd-7d90-bc8f-2e7a6b764aa1', 'CURRENT_APPROVAL_THREAD_INVALID');
  assert.equal(value.userInstruction, 'i think you can just go ahead with the gemini call', 'CURRENT_APPROVAL_TEXT_MISMATCH');
  assert.equal(value.authorizedAtUtc, '2026-10-08T16:27:15Z', 'CURRENT_APPROVAL_TIME_INVALID');
  assert.equal(value.continuationLauncherSha256, context.launcherSha256, 'APPROVAL_LAUNCHER_BINDING_MISMATCH');
  assert.equal(value.resourceProjectionSha256, context.projectionSha256, 'APPROVAL_PROJECTION_BINDING_MISMATCH');
  assert.equal(value.authorizationSha256, RAW_PINS[FILES.authorization], 'APPROVAL_AUTHORIZATION_BINDING_MISMATCH');
  assert.equal(value.authorizationRequestSha256, RAW_PINS[FILES.request], 'APPROVAL_REQUEST_BINDING_MISMATCH');
  assert.equal(value.quotaEvidenceSha256, RAW_PINS[FILES.quotaEvidence], 'APPROVAL_QUOTA_EVIDENCE_MISMATCH');
  assert.equal(value.captureResultSha256, RAW_PINS[FILES.captureResult], 'APPROVAL_CAPTURE_RESULT_MISMATCH');
  assert.equal(value.capturePayloadSha256, RAW_PINS[FILES.capturePayload], 'APPROVAL_CAPTURE_PAYLOAD_MISMATCH');
  assert.equal(value.evidenceLockSha256, RAW_PINS[FILES.evidenceLock], 'APPROVAL_EVIDENCE_LOCK_MISMATCH');
  assert.equal(value.runnerConfigurationSha256, RAW_PINS[FILES.runner], 'APPROVAL_RUNNER_BINDING_MISMATCH');
  assert.equal(value.preregistrationSha256, RAW_PINS[FILES.preregistration], 'APPROVAL_PREREGISTRATION_BINDING_MISMATCH');
  assert.equal(value.activationConfigurationSha256, RAW_PINS[FILES.activation], 'APPROVAL_ACTIVATION_BINDING_MISMATCH');
  assert.equal(value.freezeValidationSha256, RAW_PINS[FILES.freeze], 'APPROVAL_FREEZE_BINDING_MISMATCH');
  assert.equal(value.captureInventorySha256, '131b62d87bd13dfd53e1613b914179f7d472ad32df37f12ad946977ac0dff5bf',
    'APPROVAL_CAPTURE_INVENTORY_MISMATCH');
  assert.equal(value.reviewedCommit, REVIEWED_COMMIT, 'APPROVAL_COMMIT_MISMATCH');
  assert.equal(value.branch, BRANCH, 'APPROVAL_BRANCH_MISMATCH');
  assert.equal(value.semanticNamespace, NAMESPACE, 'APPROVAL_NAMESPACE_MISMATCH');
  assert.equal(value.model, MODEL, 'APPROVAL_MODEL_MISMATCH');
  assert.equal(value.authorizedGeminiCalls, 9, 'APPROVAL_CALL_COUNT_MISMATCH');
  assert.equal(value.callsPerCase, 1, 'APPROVAL_CALL_POLICY_MISMATCH');
  assert.equal(value.transportTimeoutMs, 8000, 'APPROVAL_TIMEOUT_MISMATCH');
  assert.equal(value.minimumStartGapMs, 15250, 'APPROVAL_START_GAP_MISMATCH');
  assert.equal(value.retries, 0, 'APPROVAL_RETRY_POLICY_MISMATCH');
  assert.equal(value.providerProbesAuthorized, 0, 'APPROVAL_PROBE_POLICY_MISMATCH');
  assert.equal(value.additionalCaptureAuthorized, false, 'ADDITIONAL_CAPTURE_NOT_AUTHORIZED');
  assert.equal(value.liveSourceRetrieval, false, 'SOURCE_RETRIEVAL_NOT_AUTHORIZED');
  assert.equal(value.quotaConfirmedByHuman, true, 'HUMAN_QUOTA_CONFIRMATION_REQUIRED');
  assert.equal(value.unchangedCredentialScopeConfirmed, true, 'CREDENTIAL_SCOPE_CHANGED');
  assert.equal(value.freshUsageGateRequired, true, 'FRESH_USAGE_GATE_REQUIRED');
}

function assertSemanticReview(review, context) {
  assert.equal(review.profile, 'iras-v4-semantic-resource-review', 'SEMANTIC_RESOURCE_REVIEW_REQUIRED');
  assert.equal(review.status, 'APPROVED_FOR_SEMANTIC_ONLY_CONTINUATION', 'SEMANTIC_RESOURCE_REVIEW_REQUIRED');
  assert.deepEqual(review.bindings, {
    semanticLauncherSha256: context.launcherSha256,
    semanticProjectionSha256: context.projectionSha256,
    semanticApprovalSha256: context.approvalSha256,
    authorizationSha256: RAW_PINS[FILES.authorization],
    authorizationRequestSha256: RAW_PINS[FILES.request],
    runnerConfigurationSha256: RAW_PINS[FILES.runner],
    preregistrationSha256: RAW_PINS[FILES.preregistration],
    activationConfigurationSha256: RAW_PINS[FILES.activation],
    freezeValidationSha256: RAW_PINS[FILES.freeze],
    captureResultSha256: RAW_PINS[FILES.captureResult],
    capturePayloadSha256: RAW_PINS[FILES.capturePayload],
    evidenceLockSha256: RAW_PINS[FILES.evidenceLock]
  }, 'SEMANTIC_RESOURCE_REVIEW_BINDINGS_MISMATCH');
  assert.equal(review.semanticNamespace, NAMESPACE, 'SEMANTIC_RESOURCE_REVIEW_SCOPE_INVALID');
  assert.equal(review.model, MODEL, 'SEMANTIC_RESOURCE_REVIEW_SCOPE_INVALID');
  assert.equal(review.authorizedGeminiCalls, 9, 'SEMANTIC_RESOURCE_REVIEW_SCOPE_INVALID');
  assert.equal(review.retries, 0, 'SEMANTIC_RESOURCE_REVIEW_SCOPE_INVALID');
  assert.equal(review.liveSourceRetrieval, false, 'SEMANTIC_RESOURCE_REVIEW_SCOPE_INVALID');
  assert.equal(review.additionalCapture, false, 'SEMANTIC_RESOURCE_REVIEW_SCOPE_INVALID');
}

async function loadContext({ live = false } = {}) {
  const launcherBytes = await raw(FILES.launcher);
  const launcherSha256 = sha256(launcherBytes);
  const [projection, approval] = await Promise.all([json(FILES.projection), json(FILES.approval)]);
  assert.equal(projection.sha256, EXPECTED_PROJECTION_SHA256, 'PROJECTION_RAW_HASH_MISMATCH');
  assertProjection(projection.value);
  const context = {
    launcherSha256,
    projectionSha256: projection.sha256,
    projection: projection.value,
    approvalSha256: approval.sha256,
    approval: approval.value
  };
  assertApproval(approval.value, context);
  for (const [relative, expected] of Object.entries(RAW_PINS)) {
    assert.equal(sha256(await raw(relative)), expected, 'PINNED_INPUT_HASH_MISMATCH');
  }
  const [authorization, request, freeze, captureResult, capturePayload, evidenceLock] = await Promise.all([
    json(FILES.authorization), json(FILES.request), json(FILES.freeze), json(FILES.captureResult),
    json(FILES.capturePayload), json(FILES.evidenceLock)
  ]);
  assert.deepEqual(freeze.value.bindings, FROZEN_BINDINGS, 'FREEZE_BINDINGS_MISMATCH');
  assert.equal(freeze.value.reviewedCommit, REVIEWED_COMMIT, 'FREEZE_COMMIT_MISMATCH');
  assert.equal(freeze.value.semanticNamespace, NAMESPACE, 'FREEZE_NAMESPACE_MISMATCH');
  assert.equal(authorization.value.authorizationGranted, true, 'ORIGINAL_AUTHORIZATION_REQUIRED');
  assert.equal(authorization.value.geminiAcceptanceAuthorized, true, 'ORIGINAL_SEMANTIC_AUTHORIZATION_REQUIRED');
  assert.equal(authorization.value.quotaConfirmedByHuman, true, 'ORIGINAL_QUOTA_CONFIRMATION_REQUIRED');
  assert.equal(authorization.value.semanticNamespace, NAMESPACE, 'ORIGINAL_AUTHORIZATION_SCOPE_MISMATCH');
  assert.equal(authorization.value.authorizationRequestSha256, request.sha256, 'ORIGINAL_REQUEST_BINDING_MISMATCH');
  assert.equal(authorization.value.runnerConfigurationSha256, RAW_PINS[FILES.runner], 'ORIGINAL_RUNNER_BINDING_MISMATCH');
  assert.equal(authorization.value.preregistrationSha256, RAW_PINS[FILES.preregistration], 'ORIGINAL_PREREGISTRATION_BINDING_MISMATCH');
  assert.equal(authorization.value.activationConfigurationSha256, RAW_PINS[FILES.activation], 'ORIGINAL_ACTIVATION_BINDING_MISMATCH');
  assert.equal(captureResult.value.status, 'CAPTURED_AND_LOCKED', 'LOCKED_CAPTURE_REQUIRED');
  assert.equal(captureResult.value.reviewedCommit, REVIEWED_COMMIT, 'CAPTURE_COMMIT_MISMATCH');
  assert.equal(captureResult.value.semanticNamespace, NAMESPACE, 'CAPTURE_NAMESPACE_MISMATCH');
  assert.equal(captureResult.value.authorizationSha256, authorization.sha256, 'CAPTURE_AUTHORIZATION_MISMATCH');
  assert.equal(captureResult.value.capturePayloadSha256, capturePayload.sha256, 'CAPTURE_PAYLOAD_BINDING_MISMATCH');
  assert.equal(captureResult.value.evidenceLockSha256, evidenceLock.sha256, 'CAPTURE_LOCK_BINDING_MISMATCH');
  assert.equal(captureResult.value.requestCount, 15, 'CAPTURE_REQUEST_COUNT_MISMATCH');
  assert.equal(captureResult.value.semanticCalls, 0, 'CAPTURE_ALREADY_CONSUMED_SEMANTIC_CALLS');
  assert.equal(captureResult.value.providerCredentialRead, false, 'CAPTURE_CREDENTIAL_READ_MISMATCH');
  assert.equal(capturePayload.value.requestCount, 15, 'CAPTURE_PAYLOAD_COUNT_MISMATCH');
  assert.equal(capturePayload.value.entries?.length, 15, 'CAPTURE_PAYLOAD_ENTRIES_MISMATCH');
  assert.equal(evidenceLock.value.capturePayloadSha256, capturePayload.sha256, 'EVIDENCE_LOCK_PAYLOAD_MISMATCH');
  assert.equal(evidenceLock.value.requestCount, 15, 'EVIDENCE_LOCK_COUNT_MISMATCH');
  assert.equal(evidenceLock.value.mode, 'frozenContemporaneousCapture', 'EVIDENCE_LOCK_MODE_MISMATCH');
  Object.assign(context, {
    authorizationSha256: authorization.sha256,
    requestSha256: request.sha256,
    freezeSha256: freeze.sha256,
    captureResultSha256: captureResult.sha256,
    capturePayloadSha256: capturePayload.sha256,
    evidenceLockSha256: evidenceLock.sha256
  });
  if (live) {
    const review = await json(FILES.review);
    context.reviewSha256 = review.sha256;
    assertSemanticReview(review.value, context);
  }
  return context;
}

async function assertCheckout(context, requireCommitted) {
  assert.equal(path.resolve(process.cwd()).replaceAll('\\', '/').toLowerCase(), ROOT.toLowerCase(), 'WRONG_REPOSITORY_ROOT');
  assert.equal(Number(process.versions.node.split('.')[0]), 22, 'NODE_22_REQUIRED');
  assert.equal(path.resolve(process.env.CODEX_GIT_EXECUTABLE || ''), path.resolve(GIT), 'EXPLICIT_GIT_PATH_REQUIRED');
  const branch = git(['branch', '--show-current']);
  assert.equal(branch, BRANCH, 'BRANCH_MISMATCH');
  execFileSync(GIT, ['-C', ROOT, 'merge-base', '--is-ancestor', REVIEWED_COMMIT, 'HEAD'],
    { stdio: 'ignore', windowsHide: true });
  const head = git(['rev-parse', 'HEAD']);
  if (requireCommitted) {
    for (const relative of INPUTS) {
      const working = git(['hash-object', `--path=${relative}`, '--stdin'], { input: await raw(relative) });
      const committed = git(['rev-parse', `HEAD:${relative}`]);
      assert.equal(working, committed, 'LIVE_INPUT_NOT_COMMITTED');
    }
  }
  assert.equal(context.approval.reviewedCommit, REVIEWED_COMMIT, 'APPROVAL_COMMIT_MISMATCH');
  return { head, branch };
}

async function checkMode() {
  blockOutboundNetwork();
  const context = await loadContext();
  const checkout = await assertCheckout(context, false);
  await absent(NAMESPACE);
  let reviewStatus = 'PENDING';
  if (await assertSafePath(FILES.review, true)) {
    const review = await json(FILES.review);
    context.reviewSha256 = review.sha256;
    assertSemanticReview(review.value, context);
    reviewStatus = 'APPROVED';
  }
  output('OFFLINE_CHECK', 'PASSED', {
    reviewedCommit: REVIEWED_COMMIT,
    head: checkout.head,
    branch: checkout.branch,
    semanticNamespace: NAMESPACE,
    resourceReview: reviewStatus,
    liveNetworkUsed: false,
    credentialRead: false,
    filesWritten: false
  });
}

function decodeUsage(response) {
  const observation = response.usageObservation;
  assert.ok(observation && typeof observation === 'object', 'USAGE_OBSERVATION_MISSING');
  assert.equal(observation.sourceTool, 'mcp__codex_app__get_usage_limits', 'USAGE_OBSERVATION_SOURCE_INVALID');
  const toolResult = observation.toolResult;
  assert.ok(toolResult && typeof toolResult === 'object' && toolResult.isError !== true, 'USAGE_LIMITS_UNAVAILABLE');
  let value = toolResult.structuredContent;
  if (!value && Array.isArray(toolResult.content)) {
    const textRows = toolResult.content.filter(row => row?.type === 'text');
    if (textRows.length === 1) {
      try { value = JSON.parse(textRows[0].text); } catch { /* rejected below */ }
    }
  }
  assert.ok(value && typeof value === 'object', 'USAGE_LIMITS_UNREADABLE');
  assert.equal(value.ordinaryUsageAllowed, true, 'USAGE_LIMITS_UNAVAILABLE');
  const primary = value.rateLimitsByLimitId?.codex?.primary;
  const secondary = value.rateLimitsByLimitId?.codex?.secondary;
  assert.equal(primary?.windowDurationMins, 300, 'FIVE_HOUR_WINDOW_INVALID');
  assert.equal(secondary?.windowDurationMins, 10080, 'WEEKLY_WINDOW_INVALID');
  assert.ok([primary.usedPercent, secondary.usedPercent].every(n => Number.isFinite(n) && n >= 0 && n <= 100),
    'USAGE_LIMITS_UNREADABLE');
  return { observation, primary, secondary };
}

function assertFreshGate(response, request, requestSha, context, credentialSha256) {
  assert.equal(response.profile, 'iras-v4-semantic-continuation-gate-response', 'GATE_RESPONSE_PROFILE_INVALID');
  assert.equal(response.requestId, request.requestId, 'GATE_RESPONSE_ID_MISMATCH');
  assert.equal(response.requestSha256, requestSha, 'GATE_RESPONSE_REQUEST_HASH_MISMATCH');
  assert.equal(response.launcherSha256, context.launcherSha256, 'GATE_RESPONSE_LAUNCHER_MISMATCH');
  assert.equal(response.approvalSha256, context.approvalSha256, 'GATE_RESPONSE_APPROVAL_MISMATCH');
  assert.equal(response.projectionSha256, context.projectionSha256, 'GATE_RESPONSE_PROJECTION_MISMATCH');
  assert.equal(response.resourceReviewSha256, context.reviewSha256, 'GATE_RESPONSE_REVIEW_MISMATCH');
  assert.equal(response.credentialSha256, credentialSha256, 'GATE_RESPONSE_CREDENTIAL_MISMATCH');
  const requestedAt = Date.parse(request.requestedAtUtc);
  const suppliedAt = Date.parse(response.suppliedAtUtc || '');
  const { observation, primary, secondary } = decodeUsage(response);
  const observedAt = Date.parse(observation.observedAtUtc || '');
  const now = Date.now();
  assert.ok(Number.isFinite(suppliedAt) && suppliedAt >= requestedAt && suppliedAt <= now, 'GATE_TIMESTAMP_INVALID');
  assert.ok(Number.isFinite(observedAt) && observedAt >= requestedAt && observedAt <= now &&
    now - observedAt <= context.projection.observationMaximumAgeMs, 'USAGE_OBSERVATION_STALE_OR_PRE_REQUEST');
  const remainingFiveHour = 100 - primary.usedPercent;
  const remainingWeekly = 100 - secondary.usedPercent;
  const afterFiveHour = remainingFiveHour - context.projection.fiveHourCostPercentagePoints;
  const afterWeekly = remainingWeekly - context.projection.weeklyCostPercentagePoints;
  assert.ok(remainingFiveHour > context.projection.finishAboveRemainingPercent, 'FIVE_HOUR_FINISH_FLOOR_NOT_MET');
  assert.ok(remainingFiveHour >= context.projection.checkpointAtRemainingPercent, 'FIVE_HOUR_CHECKPOINT_REQUIRED');
  assert.ok(afterFiveHour >= context.projection.reserveAfterProjectionMinimumFiveHourPercent, 'FIVE_HOUR_RESERVE_NOT_MET');
  assert.ok(afterWeekly >= context.projection.reserveAfterProjectionMinimumWeeklyPercent, 'WEEKLY_RESERVE_NOT_MET');
  return Object.freeze({ source: 'codex', readable: true, observedAt: observation.observedAtUtc,
    fiveHourRemainingPercent: remainingFiveHour, weeklyRemainingPercent: remainingWeekly,
    projectedFiveHourCostPercentagePoints: context.projection.fiveHourCostPercentagePoints,
    projectedWeeklyCostPercentagePoints: context.projection.weeklyCostPercentagePoints });
}

async function exclusiveJson(relative, document) {
  const handle = await open(absolute(relative), 'wx');
  const bytes = Buffer.from(JSON.stringify(document, null, 2) + '\n', 'utf8');
  try { await handle.writeFile(bytes); await handle.sync(); }
  finally { await handle.close(); }
  return sha256(bytes);
}

async function freshGate(context) {
  const credential = process.env.GEMINI_API_KEY;
  assert.ok(typeof credential === 'string' && credential.trim().length > 10, 'GEMINI_CREDENTIAL_UNAVAILABLE');
  const credentialSha256 = sha256(Buffer.from(credential, 'utf8'));
  const requestId = randomUUID();
  const requestedAtUtc = new Date().toISOString();
  const requestPath = `${EXEC}/semantic-gate-request-${requestId}.json`;
  const responsePath = `${EXEC}/semantic-gate-response-${requestId}.json`;
  await absent(responsePath);
  const request = {
    profile: 'iras-v4-semantic-continuation-gate-request', requestId, requestedAtUtc,
    responsePath, launcherSha256: context.launcherSha256, approvalSha256: context.approvalSha256,
    projectionSha256: context.projectionSha256, resourceReviewSha256: context.reviewSha256,
    authorizationSha256: context.authorizationSha256, authorizationRequestSha256: context.requestSha256,
    freezeValidationSha256: context.freezeSha256, runnerConfigurationSha256: RAW_PINS[FILES.runner],
    preregistrationSha256: RAW_PINS[FILES.preregistration], activationConfigurationSha256: RAW_PINS[FILES.activation],
    captureResultSha256: context.captureResultSha256, capturePayloadSha256: context.capturePayloadSha256,
    evidenceLockSha256: context.evidenceLockSha256, credentialSha256, semanticNamespace: NAMESPACE,
    model: MODEL, authorizedGeminiCalls: 9, retries: 0, liveSourceRetrieval: false,
    requiredUsageTool: 'mcp__codex_app__get_usage_limits', requiredUsageWindowsMinutes: [300, 10080],
    maximumUsageObservationAgeMs: context.projection.observationMaximumAgeMs,
    quotaConfirmedByHuman: true, userInstruction: context.approval.userInstruction
  };
  await assertInputsStable(context, true);
  const requestSha = await exclusiveJson(requestPath, request);
  output('FRESH_USAGE_GATE', 'AWAITING', { requestId, requestPath, responsePath, timeoutSeconds: 300 });
  const deadline = Date.now() + 300000;
  let response;
  while (Date.now() < deadline) {
    try {
      const metadata = await lstat(absolute(responsePath));
      assert.ok(metadata.isFile() && !metadata.isSymbolicLink(), 'GATE_RESPONSE_NOT_REGULAR_FILE');
      try { response = JSON.parse((await readFile(absolute(responsePath))).toString('utf8')); }
      catch { throw codedError('GATE_RESPONSE_INVALID'); }
      break;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.ok(response, 'FRESH_USAGE_GATE_TIMEOUT');
  return assertFreshGate(response, request, requestSha, context, credentialSha256);
}

async function assertInputsStable(context, live = false) {
  for (const [relative, expected] of Object.entries(RAW_PINS)) {
    assert.equal(sha256(await raw(relative)), expected, 'PINNED_INPUT_CHANGED');
  }
  assert.equal(sha256(await raw(FILES.launcher)), context.launcherSha256, 'LAUNCHER_CHANGED');
  assert.equal(sha256(await raw(FILES.projection)), context.projectionSha256, 'PROJECTION_CHANGED');
  assert.equal(sha256(await raw(FILES.approval)), context.approvalSha256, 'APPROVAL_CHANGED');
  if (live) assert.equal(sha256(await raw(FILES.review)), context.reviewSha256, 'RESOURCE_REVIEW_CHANGED');
}

async function partialSummary() {
  const pathName = `${NAMESPACE}/runner-v4.partial.jsonl`;
  if (!await assertSafePath(pathName, true)) return { actualCallCount: 0, cases: [] };
  let text;
  try { text = (await readFile(absolute(pathName), 'utf8')); }
  catch { return { actualCallCount: 0, cases: [] }; }
  const events = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line) continue;
    try { events.push(JSON.parse(line)); } catch { /* ignore incomplete final line */ }
  }
  const sent = new Set(events.filter(row => ['SEMANTIC_RESPONSE_RECEIVED', 'SEMANTIC_RESPONSE_FAILED'].includes(row.event))
    .map(row => row.caseId).filter(Boolean));
  const cases = events.filter(row => ['CASE_COMPLETED', 'CASE_FAILED', 'CASE_NOT_RUN'].includes(row.event))
    .map(row => ({ caseId: row.caseId, status: row.status || row.event }));
  return { actualCallCount: sent.size, cases };
}

async function semanticMode() {
  const context = await loadContext({ live: true });
  const checkout = await assertCheckout(context, true);
  await absent(NAMESPACE);
  await assertInputsStable(context, true);
  output('FROZEN_CORE_VALIDATION', 'STARTED', { head: checkout.head });
  const runner = await import(pathToFileURL(absolute('scripts/iras_v4_capture_replay_runner.mjs')).href);
  const executionCapability = await runner.loadReviewedV4ExecutionCapability({
    activationConfigurationPath: absolute(FILES.activation), root: ROOT, gitExecutable: GIT
  });
  output('EXECUTION_CAPABILITY', 'VALIDATED');
  await assertInputsStable(context, true);
  let runStarted = false;
  try {
    const result = await runner.runBoundedV4SemanticPhase({
      root: ROOT, gitExecutable: GIT, runnerConfigurationPath: absolute(FILES.runner),
      activationConfigurationPath: absolute(FILES.activation), executionCapability,
      preregistrationPath: absolute(FILES.preregistration), evidenceLockPath: absolute(FILES.evidenceLock),
      capturePayloadPath: absolute(FILES.capturePayload), namespaceDirectory: absolute(NAMESPACE),
      authorizedGeminiCalls: 9,
      sharedAllowanceReader: async () => {
        runStarted = true;
        const allowance = await freshGate(context);
        await assertInputsStable(context, true);
        return allowance;
      }
    });
    const summary = {
      status: result.status,
      callCounts: result.callCounts,
      actualCallCount: Object.values(result.callCounts || {}).reduce((sum, count) => sum + count, 0),
      cases: (result.rows || []).map(row => ({ caseId: row.caseId, status: row.status, firstFailure: row.firstFailure || null }))
    };
    const passed = result.acceptanceStatus === 'PASSED';
    output('SEMANTIC_CONTINUATION', passed ? 'COMPLETE' : 'FAILED', summary);
    if (!passed) process.exitCode = 1;
  } catch (error) {
    const summary = runStarted ? await partialSummary() : null;
    const code = SAFE_CODE.test(String(error?.code || '')) && error.code !== 'ERR_ASSERTION'
      ? error.code : 'SEMANTIC_CONTINUATION_FAILED';
    output('SEMANTIC_CONTINUATION', 'FAILED', {
      failureCode: code,
      head: checkout.head,
      ...(summary || {})
    });
    process.exitCode = 1;
  }
}

try {
  const mode = modeFrom(process.argv.slice(2));
  if (mode === '--check') await checkMode();
  else await semanticMode();
} catch (error) {
  const code = SAFE_CODE.test(String(error?.code || '')) && error.code !== 'ERR_ASSERTION'
    ? error.code : 'SEMANTIC_CONTINUATION_PRECHECK_FAILED';
  output('SEMANTIC_CONTINUATION', 'REJECTED', { failureCode: code });
  process.exitCode = 1;
}
