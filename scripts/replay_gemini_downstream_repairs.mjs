import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { bindProductionControlledRetriever } from './iras_v4_capture_replay_runner.mjs';
import { blockAmbientNetwork, loadLatestGeminiOfflineEvidenceBundle, offlineTransport } from './diagnose_latest_gemini_results.mjs';
import { SourceCache } from '../src/retrieval/sourceCache.ts';
import { runV4AcceptanceCase } from './iras_v4_production_acceptance_adapter.mjs';
import { readV4Contract } from '../tests/evaluation/singapore/iras-first-targeted-acceptance-v4.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RUNS_ROOT = 'artifacts/gemini-remediation-2026-10-09';
const OUTPUT_DIR = 'artifacts/gemini-remediation-2026-10-09/closure-repairs-2026-10-09';
export const RETAINED_GEMINI_BATCHES = Object.freeze([
  'live-rerun-2026-10-09',
  'live-rerun-downstream-2026-10-09',
  'live-rerun-ownership-2026-10-09',
  'live-rerun-variants-2026-10-09',
  'live-rerun-gst-binding-2026-10-09',
  'live-rerun-primary-labels-2026-10-09',
  'live-rerun-isolated-final-2026-10-09'
]);
const EXPECTED_BATCHES = Object.freeze({
  'live-rerun-2026-10-09': { dispatches: 9, responseCount: 9, unavailableCaseIds: [] },
  'live-rerun-downstream-2026-10-09': { dispatches: 9, responseCount: 9, unavailableCaseIds: [] },
  'live-rerun-ownership-2026-10-09': { dispatches: 9, responseCount: 9, unavailableCaseIds: [] },
  'live-rerun-variants-2026-10-09': { dispatches: 9, responseCount: 9, unavailableCaseIds: [] },
  'live-rerun-gst-binding-2026-10-09': { dispatches: 9, responseCount: 9, unavailableCaseIds: [] },
  'live-rerun-primary-labels-2026-10-09': { dispatches: 12, responseCount: 7,
    unavailableCaseIds: ['A-paraphrase-2', 'wht-royalty-general-rule'] },
  'live-rerun-isolated-final-2026-10-09': { dispatches: 9, responseCount: 9, unavailableCaseIds: [] }
});
const RUN_INPUTS = RETAINED_GEMINI_BATCHES.flatMap(batchId =>
  ['summary.json', 'runner.partial.jsonl', 'failure-analysis.json', 'consumed.json', 'report.md']
    .map(file => `${RUNS_ROOT}/${batchId}/${file}`));
const FROZEN_INPUTS = [
  'tests/evaluation/singapore/iras-first-targeted-acceptance-v4.json',
  'artifacts/iras-v4-acceptance-repaired-2026-10-06/post-repair-2026-10-08/preparation/runner-configuration.json',
  'artifacts/iras-v4-acceptance-repaired-2026-10-06/post-repair-2026-10-08/preparation/freeze-validation.json',
  'artifacts/iras-v4-acceptance-repaired-2026-10-06/post-repair-2026-10-08/preparation/authorization-request.json',
  'artifacts/iras-v4-acceptance-repaired-2026-10-06/post-repair-2026-10-08/preparation/freeze-process.json',
  'artifacts/iras-v4-acceptance-repaired-2026-10-06/post-repair-2026-10-08/preparation/freeze.stderr.log',
  'artifacts/iras-v4-acceptance-repaired-2026-10-06/post-repair-2026-10-08/preparation/preregistration.json',
  'artifacts/iras-v4-acceptance-repaired-2026-10-06/post-repair-2026-10-08/preparation/freeze-bindings.mjs',
  'artifacts/iras-v4-acceptance-repaired-2026-10-06/post-repair-2026-10-08/preparation/freeze.stdout.log',
  'artifacts/iras-v4-acceptance-repaired-2026-10-06/post-repair-2026-10-08/preparation/independent-review.json',
  'artifacts/iras-v4-acceptance-repaired-2026-10-06/post-repair-2026-10-08/preparation/frozen-inputs-review.json',
  'artifacts/iras-v4-acceptance-repaired-2026-10-06/post-repair-2026-10-08/preparation/activation-configuration.json',
  'artifacts/iras-v4-acceptance-repaired-2026-10-06/post-repair-2026-10-08/official-capture/capture-reserved.json',
  'artifacts/iras-v4-acceptance-repaired-2026-10-06/post-repair-2026-10-08/official-capture/capture-result.json',
  'artifacts/iras-v4-acceptance-repaired-2026-10-06/post-repair-2026-10-08/official-capture/capture-partial.jsonl',
  'artifacts/iras-v4-acceptance-repaired-2026-10-06/post-repair-2026-10-08/official-capture/capture-payload.json',
  'artifacts/iras-v4-acceptance-repaired-2026-10-06/post-repair-2026-10-08/official-capture/evidence-lock.json'
];
const INPUT_PATHS = [...RUN_INPUTS, ...FROZEN_INPUTS];
const sha256 = value => createHash('sha256').update(value).digest('hex');

async function snapshotInputs() {
  return Object.fromEntries(await Promise.all(INPUT_PATHS.map(async relative =>
    [relative, sha256(await readFile(path.join(ROOT, relative)))])));
}

function compactIssuePlan(issuePlan) {
  return (issuePlan?.issues || []).map(issue => ({
    subject: issue.subject,
    population: issue.population,
    domain: issue.domain,
    operation: issue.operation,
    status: issue.status,
    mappedTopicIds: issue.mappedTopicIds,
    unresolvedReason: issue.unresolvedReason
  }));
}

export function compactReplay(caseId, response, transport, result, error, inventoryHealthy) {
  const governed = result?.productionDiagnostics?.governed;
  const stageVerdicts = result?.stageVerdicts ? { ...result.stageVerdicts } : (!inventoryHealthy ? {} : undefined);
  if (!inventoryHealthy) stageVerdicts.INTEGRITY = false;
  return {
    caseId,
    disposition: 'REPLAYED_RESPONSE',
    retainedResponseSha256: response.sha256,
    retainedResponseBytes: response.bytes,
    semanticAssessment: result?.semanticUnderstanding?.assessmentStatus,
    stageVerdicts,
    firstFailure: inventoryHealthy ? result?.firstFailure || (error ? 'REPLAY_ERROR' : undefined) : 'INTEGRITY',
    issuePlan: compactIssuePlan(result?.issuePlan),
    inventoryHealthy,
    replayError: error,
    offlineCaptureLookups: transport.attempts.length,
    offlineRequests: transport.attempts.map(item => ({
      url: item.url,
      captured: item.captured,
      requestIdentitySha256: item.requestIdentitySha256
    })),
    governed: governed ? {
      available: governed.available,
      status: governed.status,
      evidenceStatus: governed.evidenceStatus,
      applicationStatus: governed.applicationStatus,
      topLevelGaps: governed.topLevelGaps,
      fetches: (governed.fetchValidationObservations || []).map(item => ({
        url: item.url,
        status: item.status,
        finalUrl: item.finalUrl,
        errorCode: item.errorCode,
        titleMatched: item.titleMatched,
        contentMatched: item.contentMatched
      })),
      issues: (governed.governedIssueObservations || []).map(issue => ({
        issueId: issue.issueId,
        evidenceStatus: issue.ruleEvidenceStatus,
        gaps: issue.gaps,
        requestedConceptCoverage: issue.requestedConceptCoverage,
        eligibleRecordIds: issue.eligibleRecordIds,
        verifiedClaimCount: issue.verifiedClaimCount
      })),
      retrievalAttempts: (governed.workstreams || []).flatMap(stream => stream.issues || []).flatMap(issue =>
        (issue.retrievalAttempts || []).map(attempt => ({ issueId: issue.issueId, ...attempt }))),
      selectedSources: (governed.workstreams || []).flatMap(stream => stream.issues || []).flatMap(issue =>
        (issue.sources || []).map(source => ({ issueId: issue.issueId, ...source })))
    } : undefined
  };
}

export function inspectRetainedCaseRecord(retained) {
  const caseId = retained?.caseId;
  const providerRequests = retained?.providerRequests || [];
  const providerAttempts = retained?.providerAttempts || [];
  assert.ok(typeof caseId === 'string' && caseId.length > 0, 'RETAINED_CASE_ID_INVALID');
  assert.ok(Array.isArray(providerRequests) && Array.isArray(providerAttempts), 'RETAINED_PROVIDER_TRACE_INVALID');
  assert.ok(providerRequests.length <= 2 && providerAttempts.length <= 2, 'RETAINED_PROVIDER_ATTEMPT_LIMIT_EXCEEDED');
  assert.equal(providerRequests.length, providerAttempts.length, 'RETAINED_PROVIDER_TRACE_COUNT_MISMATCH');
  for (let index = 0; index < providerRequests.length; index += 1) {
    assert.equal(providerRequests[index]?.caseId, caseId, 'RETAINED_PROVIDER_CASE_ID_MISMATCH');
    assert.equal(providerRequests[index]?.attempt, index + 1, 'RETAINED_PROVIDER_REQUEST_ORDER_INVALID');
    assert.equal(providerAttempts[index]?.attempt, index + 1, 'RETAINED_PROVIDER_ATTEMPT_ORDER_INVALID');
  }

  const response = retained.semanticResponse;
  if (!response) {
    const providerFailure = (retained.failureDiagnostics?.failureChain || []).some(item =>
      item.stage === 'PROVIDER' && ['TIMEOUT', 'UNAVAILABLE'].includes(item.outcome) &&
      ['TRANSPORT_ERROR', 'V4_PACING_GAP_NOT_MET'].includes(item.code));
    assert.equal(retained.assessmentStatus, 'NOT_ASSESSED', 'RETAINED_RESPONSE_MISSING_FOR_ASSESSED_CASE');
    assert.equal(retained.semanticUnderstanding?.mode, 'DETERMINISTIC_FALLBACK', 'RETAINED_MISSING_RESPONSE_WITHOUT_FALLBACK');
    assert.equal(retained.semanticUnderstanding?.assessmentStatus, 'NOT_ASSESSED', 'RETAINED_MISSING_RESPONSE_ASSESSMENT_MISMATCH');
    assert.ok(['TIMEOUT', 'PROVIDER_ERROR'].includes(retained.semanticUnderstanding?.failure),
      'RETAINED_MISSING_RESPONSE_WITHOUT_TRANSPORT_FAILURE');
    assert.equal(providerFailure, true, 'RETAINED_MISSING_RESPONSE_WITHOUT_PROVIDER_FAILURE_TRACE');
    return { disposition: 'NOT_ASSESSED', transportFailureCode: retained.failureDiagnostics.failureChain
      .find(item => item.stage === 'PROVIDER' && ['TIMEOUT', 'UNAVAILABLE'].includes(item.outcome))?.code };
  }

  assert.equal(typeof response.base64, 'string', 'RETAINED_RESPONSE_BASE64_INVALID');
  assert.ok(/^[a-f0-9]{64}$/i.test(response.sha256), 'RETAINED_RESPONSE_HASH_INVALID');
  assert.ok(Number.isInteger(response.bytes) && response.bytes >= 0, 'RETAINED_RESPONSE_BYTE_COUNT_INVALID');
  const responseBytes = Buffer.from(response.base64, 'base64');
  assert.equal(responseBytes.toString('base64'), response.base64, 'RETAINED_RESPONSE_BASE64_NONCANONICAL');
  assert.equal(sha256(responseBytes), response.sha256, 'RETAINED_RESPONSE_HASH_MISMATCH');
  assert.equal(responseBytes.length, response.bytes, 'RETAINED_RESPONSE_BYTE_COUNT_MISMATCH');
  return { disposition: 'REPLAYED_RESPONSE', responseBytes };
}

function compactNotAssessedReplay(retained, disposition) {
  return {
    caseId: retained.caseId,
    disposition: 'NOT_ASSESSED',
    assessmentStatus: 'NOT_ASSESSED',
    transportUnavailable: true,
    transportFailureCode: disposition.transportFailureCode,
    providerAttemptCount: retained.providerAttempts.length,
    providerRequestCount: retained.providerRequests.length,
    semanticReplayInvoked: false,
    inventoryHealthy: true,
    offlineCaptureLookups: 0,
    offlineRequests: []
  };
}

export async function replayRetainedGeminiBatch(batchId, { writeReport = false } = {}) {
  assert.ok(RETAINED_GEMINI_BATCHES.includes(batchId), `Unsupported retained Gemini batch: ${batchId}`);
  const runDir = `${RUNS_ROOT}/${batchId}`;
  const before = await snapshotInputs();
  const [summary, bundle, contract] = await Promise.all([
    readFile(path.join(ROOT, `${runDir}/summary.json`), 'utf8').then(JSON.parse),
    loadLatestGeminiOfflineEvidenceBundle(),
    readV4Contract()
  ]);
  const expectedBatch = EXPECTED_BATCHES[batchId];
  assert.ok(expectedBatch, `No retained replay expectations exist for ${batchId}.`);
  assert.equal(summary.cases.length, 9, 'Exactly nine retained Gemini case records are expected.');
  assert.equal(summary.providerRequestCount, expectedBatch.dispatches, 'The retained run must describe its recorded dispatch count.');
  const contracts = new Map(contract.cases.map(item => [item.caseId, item]));
  assert.equal(new Set(summary.cases.map(item => item.caseId)).size, 9, 'Retained case IDs must be unique.');
  assert.deepEqual(summary.cases.map(item => item.caseId), contract.cases.map(item => item.caseId),
    'Retained case identities and ordering must match the fixed V4 contract.');
  assert.ok(summary.cases.every(item => contracts.has(item.caseId)), 'Every retained case must belong to the fixed V4 contract.');
  const unavailableCaseIds = summary.cases.filter(item => !item.semanticResponse).map(item => item.caseId);
  assert.deepEqual(unavailableCaseIds, expectedBatch.unavailableCaseIds, 'Only recorded transport-unavailable cases may omit responses.');
  const dispositions = summary.cases.map(item => inspectRetainedCaseRecord(item));
  assert.equal(dispositions.filter(item => item.disposition === 'REPLAYED_RESPONSE').length, expectedBatch.responseCount,
    'Available response count must match the retained batch inventory.');
  assert.equal(summary.cases.reduce((count, item) => count + (item.providerRequests || []).length, 0), expectedBatch.dispatches,
    'Provider request traces must account for every recorded dispatch.');

  let blockedNetworkAttemptCount = 0;
  const restoreNetwork = blockAmbientNetwork({ onBlocked: () => { blockedNetworkAttemptCount += 1; } });
  const replays = [];
  let semanticReplayInvocations = 0;
  try {
    for (let index = 0; index < summary.cases.length; index += 1) {
      const retained = summary.cases[index];
      const disposition = dispositions[index];
      if (disposition.disposition === 'NOT_ASSESSED') {
        replays.push(compactNotAssessedReplay(retained, disposition));
        continue;
      }
      const response = retained.semanticResponse;
      const responseBytes = disposition.responseBytes;
      const family = bundle.activation.caseEvidenceFamily[retained.caseId] || `no-evidence:${retained.caseId}`;
      const transport = offlineTransport(bundle.payload, bundle.activation.captureInventory, retained.caseId, family);
      let result;
      let replayError;
      try {
        result = await transport.withEvidenceFamily(family, () => runV4AcceptanceCase({
          caseId: retained.caseId,
          referenceDate: bundle.lock.sourceReferenceDate,
          sendSemantic: async () => {
            semanticReplayInvocations += 1;
            return responseBytes.toString('utf8');
          },
          evidenceTransport: transport.fetch,
          withEvidenceFamily: transport.withEvidenceFamily,
          webRetriever: bindProductionControlledRetriever({ transport, cache: new SourceCache() })
        }));
      } catch (error) {
        replayError = error instanceof Error ? error.message : String(error);
      }
      let inventoryHealthy = true;
      try { transport.assertHealthy(); } catch { inventoryHealthy = false; }
      replays.push(compactReplay(retained.caseId, response, transport, result, replayError, inventoryHealthy));
    }
  } finally {
    restoreNetwork();
  }

  const after = await snapshotInputs();
  assert.deepEqual(after, before, 'Retained provider responses, capture inputs, contracts and consumed markers must remain unchanged.');
  const report = {
    profile: 'GEMINI_DOWNSTREAM_REPAIR_OFFLINE_REPLAY',
    batchId,
    diagnosticOnly: true,
    acceptanceProven: false,
    sourceReferenceDate: bundle.lock.sourceReferenceDate,
    retainedCaseRecordCount: replays.length,
    retainedResponseReplayCount: replays.filter(row => row.disposition === 'REPLAYED_RESPONSE').length,
    notAssessedCount: replays.filter(row => row.disposition === 'NOT_ASSESSED').length,
    newProviderCalls: 0,
    semanticReplayInvocations,
    newSourceRequests: 0,
    offlineCaptureLookups: replays.reduce((sum, row) => sum + row.offlineCaptureLookups, 0),
    blockedNetworkAttemptCount,
    captureInventoryHealthy: replays.every(row => row.inventoryHealthy),
    protectedInputsUnchanged: Object.entries(before).every(([key, value]) => after[key] === value),
    protectedInputSha256: { before, after },
    replays
  };
  if (writeReport) {
    const output = path.join(ROOT, OUTPUT_DIR);
    await mkdir(output, { recursive: true });
    await writeFile(path.join(output, `replay-${batchId}.json`), JSON.stringify(report, null, 2) + '\n');
  }
  return report;
}

export async function replayLatestGeminiDownstreamRepairs(options = {}) {
  return replayRetainedGeminiBatch('live-rerun-downstream-2026-10-09', options);
}

export async function replayBothRetainedGeminiBatches({ writeReport = false } = {}) {
  const reports = [];
  for (const batchId of RETAINED_GEMINI_BATCHES.slice(0, 2)) {
    reports.push(await replayRetainedGeminiBatch(batchId, { writeReport }));
  }
  return {
    profile: 'GEMINI_BOTH_RETAINED_BATCHES_OFFLINE_REPLAY',
    diagnosticOnly: true,
    acceptanceProven: false,
    retainedCaseRecordCount: reports.reduce((sum, report) => sum + report.retainedCaseRecordCount, 0),
    retainedResponseReplayCount: reports.reduce((sum, report) => sum + report.retainedResponseReplayCount, 0),
    notAssessedCount: reports.reduce((sum, report) => sum + report.notAssessedCount, 0),
    newProviderCalls: reports.reduce((sum, report) => sum + report.newProviderCalls, 0),
    newSourceRequests: reports.reduce((sum, report) => sum + report.newSourceRequests, 0),
    protectedInputsUnchanged: reports.every(report => report.protectedInputsUnchanged),
    reports
  };
}

export async function replayAllRetainedGeminiBatches({ writeReport = false } = {}) {
  const reports = [];
  for (const batchId of RETAINED_GEMINI_BATCHES) {
    reports.push(await replayRetainedGeminiBatch(batchId, { writeReport }));
  }
  return {
    profile: 'GEMINI_ALL_RETAINED_BATCHES_OFFLINE_REPLAY',
    diagnosticOnly: true,
    acceptanceProven: false,
    retainedCaseRecordCount: reports.reduce((sum, report) => sum + report.retainedCaseRecordCount, 0),
    retainedResponseReplayCount: reports.reduce((sum, report) => sum + report.retainedResponseReplayCount, 0),
    notAssessedCount: reports.reduce((sum, report) => sum + report.notAssessedCount, 0),
    newProviderCalls: reports.reduce((sum, report) => sum + report.newProviderCalls, 0),
    newSourceRequests: reports.reduce((sum, report) => sum + report.newSourceRequests, 0),
    protectedInputsUnchanged: reports.every(report => report.protectedInputsUnchanged),
    reports
  };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const batchIndex = process.argv.indexOf('--batch');
  const batchId = batchIndex >= 0 ? process.argv[batchIndex + 1] : 'live-rerun-downstream-2026-10-09';
  const report = await replayRetainedGeminiBatch(batchId, { writeReport: true });
  const failures = report.replays.filter(row => row.firstFailure || row.replayError || !row.inventoryHealthy);
  console.log(JSON.stringify({
    profile: report.profile,
    batchId: report.batchId,
    replayed: report.retainedResponseReplayCount,
    caseRecords: report.retainedCaseRecordCount,
    notAssessed: report.notAssessedCount,
    firstFailures: failures.map(row => ({ caseId: row.caseId, firstFailure: row.firstFailure, replayError: row.replayError })),
    offlineCaptureLookups: report.offlineCaptureLookups,
    newProviderCalls: report.newProviderCalls,
    newSourceRequests: report.newSourceRequests,
    blockedNetworkAttemptCount: report.blockedNetworkAttemptCount,
    protectedInputsUnchanged: report.protectedInputsUnchanged
  }, null, 2));
  if (failures.length > 0 || !report.captureInventoryHealthy || report.newProviderCalls !== 0 ||
      report.newSourceRequests !== 0 || report.blockedNetworkAttemptCount !== 0 || !report.protectedInputsUnchanged) {
    process.exitCode = 1;
  }
}
