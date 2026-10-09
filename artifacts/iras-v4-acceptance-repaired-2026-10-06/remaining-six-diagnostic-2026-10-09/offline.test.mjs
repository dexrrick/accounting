import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import {
  assertApprovedGeminiFetch,
  assertRawSha256,
  diagnosticOutcomeFieldsForTest,
  exerciseNetworkGuardForTest,
  invokeAcceptanceAdapterForTest,
  makeDiagnosticSummaryForTest,
  runIndependentCaseLoopForTest,
  scoreDiagnosticAdapterResult,
  sendAndRecordFetchCountForTest,
  validateFreshUsageGate
} from './launch.mjs';
import { evaluateV4Stages } from '../../../tests/evaluation/singapore/iras-first-targeted-acceptance-v4.mjs';

const ROOT = 'D:/Accounting';
const RUN = 'artifacts/iras-v4-acceptance-repaired-2026-10-06/remaining-six-diagnostic-2026-10-09';
const LAUNCHER = path.join(ROOT, RUN, 'launch.mjs');
const RESULT_PATHS = ['gate-request.json', 'gate-response.json', 'consumed.json', 'remaining-six.partial.jsonl', 'summary.json']
  .map(name => path.join(ROOT, RUN, 'results', name));
const CASE_IDS = [
  'private-expense-treatment',
  'foreign-dividend-receipt-treatment',
  'corporate-residency-general-rule',
  'wht-royalty-general-rule',
  'gst-input-tax-general-rule',
  'unsupported-sfrsi-6-exploration-evaluation'
];

function exists(file) {
  return access(file).then(() => true, error => error?.code === 'ENOENT' ? false : Promise.reject(error));
}
function baseGate(now) {
  const requestedAtUtc = new Date(now - 60_000).toISOString();
  const request = { requestId: 'test-request', requestedAtUtc };
  const bindings = {
    requestSha256: '1'.repeat(64),
    launcherSha256: '2'.repeat(64),
    authorizationSha256: '3'.repeat(64),
    reviewSha256: '4'.repeat(64),
    credentialSha256: '5'.repeat(64)
  };
  const response = {
    profile: 'iras-v4-remaining-six-diagnostic-gate-response',
    requestSha256: bindings.requestSha256,
    requestId: request.requestId,
    launcherSha256: bindings.launcherSha256,
    authorizationSha256: bindings.authorizationSha256,
    independentReviewSha256: bindings.reviewSha256,
    credentialSha256: bindings.credentialSha256,
    suppliedAtUtc: new Date(now - 5_000).toISOString(),
    usageObservation: {
      sourceTool: 'mcp__codex_app__get_usage_limits',
      observedAtUtc: new Date(now - 10_000).toISOString(),
      toolResult: {
        structuredContent: {
          ordinaryUsageAllowed: true,
          rateLimitsByLimitId: { codex: {
            primary: { windowDurationMins: 300, usedPercent: 25 },
            secondary: { windowDurationMins: 10080, usedPercent: 35 }
          } }
        }
      }
    }
  };
  return { request, bindings, response };
}

function allPassAdapterResult() {
  const layers = {
    semantic: { stages: {
      SEMANTIC_VALIDATION: true,
      SEMANTIC_ISSUE_IDENTITY: true,
      SEMANTIC_DIMENSIONS: true,
      TOPIC_OWNERSHIP: true,
      REQUESTED_CONCEPT_OWNERSHIP: true
    } },
    routing: { passed: true },
    local: { passed: true },
    governed: { stages: {
      GOVERNED_RETRIEVAL: true,
      EVIDENCE_ADMISSION: true,
      CLAIM_VERIFICATION: true,
      REQUESTED_CONCEPT_COVERAGE: true
    } },
    application: {
      applicationStatusesPassed: true,
      ruleVerifiedUnresolvedApplicationPreserved: true,
      overallAllowed: true
    }
  };
  const scored = evaluateV4Stages(layers);
  return { layerVerdicts: layers, stageVerdicts: scored.stages, firstFailure: scored.earliestFailure };
}

test('pinned hash helper rejects altered frozen bytes', () => {
  const original = Buffer.from('unchanged frozen input');
  const expected = createHash('sha256').update(original).digest('hex');
  assert.equal(assertRawSha256(original, expected), true);
  assert.throws(() => assertRawSha256(Buffer.from('changed'), expected), /DIAGNOSTIC_PINNED_HASH_MISMATCH/);
});

test('Gemini dispatch accepts only the fixed endpoint, POST, and redirect:error', () => {
  const endpoint = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent';
  assert.equal(assertApprovedGeminiFetch(endpoint, { method: 'POST', redirect: 'error' }), true);
  assert.throws(() => assertApprovedGeminiFetch('https://www.iras.gov.sg/source', { method: 'POST', redirect: 'error' }),
    /DIAGNOSTIC_FETCH_URL_NOT_APPROVED/);
  assert.throws(() => assertApprovedGeminiFetch(endpoint, { method: 'GET', redirect: 'error' }),
    /DIAGNOSTIC_FETCH_METHOD_NOT_APPROVED/);
  assert.throws(() => assertApprovedGeminiFetch(endpoint, { method: 'POST', redirect: 'follow' }),
    /DIAGNOSTIC_FETCH_REDIRECT_POLICY_INVALID/);
});

test('ambient sockets and source fetches are blocked while only the reviewed Gemini fetch is allowed', async () => {
  const result = await exerciseNetworkGuardForTest();
  assert.equal(result.approvedFetches, 1);
  assert.equal(result.approvedNativeCalls, 1);
  assert.equal(result.blocked.length, 4);
  assert.deepEqual(result.blocked.map(row => row.api).sort(), ['fetch', 'fetch', 'http.get', 'tls.connect']);
  assert.equal(result.blocked.find(row => row.url)?.url, 'https://example.org/');
});

test('acceptance adapter receives and invokes the guarded semantic sender', async () => {
  let sends = 0;
  const result = await invokeAcceptanceAdapterForTest({
    runV4AcceptanceCase: async ({ caseId, sendSemantic }) => {
      assert.equal(caseId, CASE_IDS[0]);
      assert.equal(typeof sendSemantic, 'function');
      return { response: await sendSemantic({ prompt: 'frozen test prompt' }) };
    }
  }, {
    caseId: CASE_IDS[0],
    sendSemantic: async request => {
      sends += 1;
      assert.equal(request.prompt, 'frozen test prompt');
      return 'guarded semantic response';
    }
  });
  assert.equal(sends, 1);
  assert.deepEqual(result, { response: 'guarded semantic response' });
});

test('successful provider send count survives a later scoring exception', async () => {
  const counters = { approvedProviderFetchCount: 0 };
  let providerFetches = 0;
  await assert.rejects(async () => {
    const response = await sendAndRecordFetchCountForTest(async () => {
      providerFetches += 1;
      return 'semantic response';
    }, counters, () => providerFetches);
    assert.equal(response, 'semantic response');
    throw Object.assign(new Error('later scoring failed'), { code: 'TEST_SCORING_THROW' });
  }, /later scoring failed/);
  assert.equal(counters.approvedProviderFetchCount, 1);
});

test('operational failures outrank scorer fields and passed rows have null failure fields', () => {
  const passedScore = scoreDiagnosticAdapterResult(allPassAdapterResult(), true, evaluateV4Stages);
  const passed = diagnosticOutcomeFieldsForTest({ failed: false, scoring: passedScore });
  assert.equal(passed.failureStage, null);
  assert.equal(passed.failureCode, null);
  assert.equal(passed.firstFailure, null);

  const scoringFailure = {
    passed: false,
    firstFailure: 'ACCEPTANCE_SCORE',
    failureCode: 'DIAGNOSTIC_ACCEPTANCE_SCORE_FAILED'
  };
  const operational = diagnosticOutcomeFieldsForTest({
    failed: true,
    failureStage: 'SEMANTIC_TRANSPORT',
    failureCode: 'V4_PROVIDER_TIMEOUT',
    scoring: scoringFailure
  });
  assert.equal(operational.failureStage, 'SEMANTIC_TRANSPORT');
  assert.equal(operational.failureCode, 'V4_PROVIDER_TIMEOUT');
  assert.equal(operational.firstFailure, 'SEMANTIC_TRANSPORT');

  const scoreOnlyFailure = diagnosticOutcomeFieldsForTest({ failed: true, scoring: scoringFailure });
  assert.equal(scoreOnlyFailure.failureStage, 'ACCEPTANCE_SCORE');
  assert.equal(scoreOnlyFailure.failureCode, 'DIAGNOSTIC_ACCEPTANCE_SCORE_FAILED');
});

test('independent case loop records provider, replay, and score failures and still reaches all six cases', async () => {
  const visited = [];
  const progress = [];
  const rows = await runIndependentCaseLoopForTest({
    executeCase: async caseId => {
      visited.push(caseId);
      const index = CASE_IDS.indexOf(caseId);
      if (index === 0) return { caseId, status: 'FAILED', failureStage: 'SEMANTIC_TRANSPORT', failureCode: 'V4_PROVIDER_TIMEOUT' };
      if (index === 1) return { caseId, status: 'FAILED', failureStage: 'INTEGRITY', failureCode: 'V4_REPLAY_MISS' };
      if (index === 2) return { caseId, status: 'FAILED', failureStage: 'ACCEPTANCE_SCORE', failureCode: 'DIAGNOSTIC_SCORE_FAILED' };
      if (index === 3) throw Object.assign(new Error('test case failure'), { code: 'TEST_CASE_FAILURE' });
      return { caseId, status: 'PASSED' };
    },
    failureCounts: caseId => caseId === CASE_IDS[3]
      ? { semanticSendInvocations: 1, approvedProviderFetchCount: 1 }
      : {},
    onProgress: async row => progress.push(row)
  });
  assert.deepEqual(visited, CASE_IDS);
  assert.deepEqual(rows.map(row => row.caseId), CASE_IDS);
  assert.equal(rows.length, 6);
  assert.equal(progress.length, 6);
  assert.deepEqual(rows.slice(0, 3).map(row => row.failureStage), ['SEMANTIC_TRANSPORT', 'INTEGRITY', 'ACCEPTANCE_SCORE']);
  assert.equal(rows[3].failure.code, 'TEST_CASE_FAILURE');
  assert.equal(rows[3].failureStage, 'CASE_EXECUTION');
  assert.equal(rows[3].failureCode, 'TEST_CASE_FAILURE');
  assert.equal(rows[3].semanticSendInvocations, 1);
  assert.equal(rows[3].approvedProviderFetchCount, 1);
  assert.deepEqual(rows.slice(4).map(row => row.status), ['PASSED', 'PASSED']);
  const summary = makeDiagnosticSummaryForTest(rows, { oldJournalHash: 'old-journal', oldMarkerHash: 'old-marker' },
    { observedAtUtc: '2026-10-09T00:00:00.000Z' }, { passed: true, oldNamespaceUnchanged: true });
  assert.equal(summary.actualSemanticDispatchInvocations, 1);
  assert.equal(summary.approvedGeminiFetchRequests, 1);
  assert.ok(Number.isFinite(summary.actualSemanticDispatchInvocations));
  assert.ok(Number.isFinite(summary.approvedGeminiFetchRequests));
});

test('canonical rescoring rejects adapter mismatches and integrity failures', () => {
  const valid = allPassAdapterResult();
  assert.equal(scoreDiagnosticAdapterResult(valid, true, evaluateV4Stages).passed, true);
  assert.equal(scoreDiagnosticAdapterResult(valid, false, evaluateV4Stages).passed, false);
  assert.equal(scoreDiagnosticAdapterResult(valid, false, evaluateV4Stages).firstFailure, 'INTEGRITY');
  const tampered = { ...valid, stageVerdicts: { ...valid.stageVerdicts, INTEGRITY: false } };
  assert.equal(scoreDiagnosticAdapterResult(tampered, true, evaluateV4Stages).passed, false);
});

test('fresh usage gate rejects stale observations, binding mismatches, and insufficient reserve', () => {
  const now = Date.now();
  const good = baseGate(now);
  assert.equal(validateFreshUsageGate(good.response, good.request, good.bindings, now).fiveHourRemainingPercent, 75);

  const stale = structuredClone(good);
  stale.response.usageObservation.observedAtUtc = new Date(Date.parse(stale.request.requestedAtUtc) - 1).toISOString();
  assert.throws(() => validateFreshUsageGate(stale.response, stale.request, stale.bindings, now), /DIAGNOSTIC_USAGE_OBSERVATION_STALE/);

  const mismatch = structuredClone(good);
  mismatch.response.launcherSha256 = 'f'.repeat(64);
  assert.throws(() => validateFreshUsageGate(mismatch.response, mismatch.request, mismatch.bindings, now), /DIAGNOSTIC_GATE_LAUNCHER_MISMATCH/);

  const insufficient = structuredClone(good);
  insufficient.response.usageObservation.toolResult.structuredContent.rateLimitsByLimitId.codex.primary.usedPercent = 95;
  insufficient.response.usageObservation.toolResult.structuredContent.rateLimitsByLimitId.codex.secondary.usedPercent = 99;
  assert.throws(() => validateFreshUsageGate(insufficient.response, insufficient.request, insufficient.bindings, now),
    /DIAGNOSTIC_FIVE_HOUR_FINISH_FLOOR_NOT_MET|DIAGNOSTIC_FIVE_HOUR_CHECKPOINT_REQUIRED|DIAGNOSTIC_FIVE_HOUR_RESERVE_NOT_MET/);
});

test('default launcher check is read-only and does not need a credential', async () => {
  const before = await Promise.all(RESULT_PATHS.map(exists));
  assert.deepEqual(before, [false, false, false, false, false]);
  const result = spawnSync(process.execPath, ['--import', 'tsx', LAUNCHER, '--check'], {
    cwd: ROOT,
    encoding: 'utf8',
    windowsHide: true,
    env: {
      PATH: process.env.PATH,
      SYSTEMROOT: process.env.SYSTEMROOT,
      WINDIR: process.env.WINDIR,
      TEMP: process.env.TEMP,
      TMP: process.env.TMP,
      GEMINI_API_KEY: 'sentinel-must-not-be-read-in-check-mode'
    }
  });
  if (result.status === 0) {
    assert.match(result.stdout, /"credentialRead":false/);
    assert.match(result.stdout, /"filesWritten":false/);
  } else {
    // Supervisor-owned authorization/review metadata may be partially staged or
    // temporarily bound to a prior launcher hash while this file is under review.
    assert.match(result.stdout, /DIAGNOSTIC_LIVE_METADATA_INCOMPLETE|DIAGNOSTIC_AUTHORIZATION_LAUNCHER_MISMATCH|DIAGNOSTIC_REVIEW_BINDING_MISMATCH/,
      `${result.stdout}\n${result.stderr}`);
  }
  assert.deepEqual(await Promise.all(RESULT_PATHS.map(exists)), before);
  const launcherHash = createHash('sha256').update(await readFile(LAUNCHER)).digest('hex');
  assert.match(launcherHash, /^[a-f0-9]{64}$/);
});
