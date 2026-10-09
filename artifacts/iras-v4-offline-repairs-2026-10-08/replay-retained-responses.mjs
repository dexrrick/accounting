import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runV4AcceptanceCase } from '../../scripts/iras_v4_production_acceptance_adapter.mjs';
import { bindProductionControlledRetriever } from '../../scripts/iras_v4_capture_replay_runner.mjs';
import { SourceCache } from '../../src/retrieval/sourceCache.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUTPUT_DIR = path.dirname(fileURLToPath(import.meta.url));
const RETRY_ROOT = path.join(ROOT, 'artifacts/iras-v4-acceptance-repaired-2026-10-06');
const FROZEN_VALIDATION_PATH = path.join(RETRY_ROOT, 'retry-2026-10-08/preparation-final/freeze-validation.json');
const RETRY_CAPTURE_DIR = path.join(RETRY_ROOT, 'retry-2026-10-08/official-capture');
const RUN_PATH = path.join(RETRY_ROOT, 'semantic-run-v4-retry-2026-10-08/runner-v4.partial.jsonl');
const CONSUMPTION_MARKER_PATH = path.join(path.dirname(RUN_PATH), 'consumed-v4.json');
const CAPTURE_PATH = path.join(RETRY_CAPTURE_DIR, 'capture-payload.json');
const CAPTURE_PARTIAL_PATH = path.join(RETRY_CAPTURE_DIR, 'capture-partial.jsonl');
const CAPTURE_RESULT_PATH = path.join(RETRY_CAPTURE_DIR, 'capture-result.json');
const CAPTURE_LOCK_PATH = path.join(RETRY_CAPTURE_DIR, 'evidence-lock.json');
const CAPTURE_RESERVATION_PATH = path.join(RETRY_CAPTURE_DIR, 'capture-reserved.json');
const ACTIVATION_PATH = path.join(RETRY_ROOT, 'retry-2026-10-08/preparation-final/activation-configuration.json');
const PROTECTED_RETRY_INPUT_PATHS = Object.freeze({
  retainedRun: RUN_PATH,
  consumptionMarker: CONSUMPTION_MARKER_PATH,
  capturePayload: CAPTURE_PATH,
  capturePartial: CAPTURE_PARTIAL_PATH,
  captureResult: CAPTURE_RESULT_PATH,
  captureLock: CAPTURE_LOCK_PATH,
  captureReservation: CAPTURE_RESERVATION_PATH,
  activationConfiguration: ACTIVATION_PATH,
  frozenValidationManifest: FROZEN_VALIDATION_PATH
});
const REPLAY_REPORT_PATH = path.join(OUTPUT_DIR, 'replay-after-fixes.json');
const ACCEPT_HEADER = 'text/plain, application/json, text/html, */*';
const CAPTURE_CASE_IDS = Object.freeze([
  'target-relief-entitlement',
  'target-relief-amount',
  'A-paraphrase-2',
  'private-expense-treatment'
]);

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function stableJson(value) {
  return JSON.stringify(value);
}

function normalizeRequest(urlValue, init, family) {
  assert.equal(typeof family, 'string', 'OFFLINE_REPLAY_FAMILY_MISSING');
  const url = new URL(String(urlValue));
  assert.ok(['http:', 'https:'].includes(url.protocol), 'OFFLINE_REPLAY_PROTOCOL_REJECTED');
  assert.ok(['iras.gov.sg', 'www.iras.gov.sg'].includes(url.hostname), 'OFFLINE_REPLAY_HOST_REJECTED');
  assert.equal(url.username, '', 'OFFLINE_REPLAY_CREDENTIALS_REJECTED');
  assert.equal(url.password, '', 'OFFLINE_REPLAY_CREDENTIALS_REJECTED');
  assert.equal(url.hash, '', 'OFFLINE_REPLAY_FRAGMENT_REJECTED');
  assert.equal(url.port, '', 'OFFLINE_REPLAY_PORT_REJECTED');
  assert.equal(String(init.method || 'GET').toUpperCase(), 'GET', 'OFFLINE_REPLAY_METHOD_REJECTED');
  assert.equal(init.redirect, 'manual', 'OFFLINE_REPLAY_REDIRECT_POLICY_REJECTED');
  assert.ok(init.body === undefined || init.body === null, 'OFFLINE_REPLAY_BODY_REJECTED');
  assert.ok(init.credentials === undefined || init.credentials === 'omit', 'OFFLINE_REPLAY_CREDENTIAL_POLICY_REJECTED');
  assert.ok(init.mode === undefined || init.mode === 'cors', 'OFFLINE_REPLAY_MODE_REJECTED');
  const headers = {};
  for (const [name, rawValue] of new Headers(init.headers || {}).entries()) {
    const lower = name.toLowerCase();
    assert.ok(['accept', 'if-modified-since', 'if-none-match'].includes(lower), 'OFFLINE_REPLAY_HEADER_REJECTED:' + lower);
    const value = rawValue.trim();
    assert.ok(!/[\u0000-\u001f\u007f]/.test(value), 'OFFLINE_REPLAY_HEADER_VALUE_REJECTED');
    headers[lower] = value;
  }
  assert.equal(headers.accept, ACCEPT_HEADER, 'OFFLINE_REPLAY_ACCEPT_HEADER_MISMATCH');
  return {
    family,
    url: url.toString(),
    method: 'GET',
    headers: Object.fromEntries(Object.entries(headers).sort(([a], [b]) => a.localeCompare(b)))
  };
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function snapshotProtectedInputs() {
  const frozenValidation = await readJson(FROZEN_VALIDATION_PATH);
  const frozenInputs = frozenValidation.protectedInputSha256?.before;
  assert.ok(frozenInputs && typeof frozenInputs === 'object', 'OFFLINE_FROZEN_PROTECTED_INPUTS_MISSING');
  assert.equal(Object.keys(frozenInputs).length, 21, 'OFFLINE_FROZEN_PROTECTED_INPUT_COUNT_MISMATCH');
  const historyEntries = await Promise.all(Object.entries(frozenInputs).map(async ([relativePath, expectedHash]) => {
    const actualHash = sha256(await readFile(path.join(ROOT, relativePath)));
    assert.equal(actualHash, expectedHash, 'OFFLINE_FROZEN_PROTECTED_INPUT_CHANGED:' + relativePath);
    return [`frozen:${relativePath}`, actualHash];
  }));
  const retryEntries = await Promise.all(Object.entries(PROTECTED_RETRY_INPUT_PATHS).map(async ([name, filePath]) =>
    [`retry:${name}`, sha256(await readFile(filePath))]));
  return Object.fromEntries([...historyEntries, ...retryEntries]);
}

function validateBase64AndHash(base64, expectedHash, label) {
  assert.equal(typeof base64, 'string', `${label}_BASE64_MISSING`);
  const bytes = Buffer.from(base64, 'base64');
  assert.equal(bytes.toString('base64'), base64, `${label}_BASE64_INVALID`);
  assert.equal(sha256(bytes), expectedHash, `${label}_SHA256_MISMATCH`);
  return bytes;
}

function makeAmbientNetworkBlock() {
  const restorers = [];
  const replace = (target, key) => {
    const descriptor = Object.getOwnPropertyDescriptor(target, key);
    assert.ok(descriptor && 'value' in descriptor && descriptor.configurable !== false,
      'OFFLINE_NETWORK_GUARD_API_NOT_PATCHABLE:' + String(key));
    Object.defineProperty(target, key, {
      ...descriptor,
      value: function () {
        const error = new Error('OFFLINE_RETAINED_REPLAY_AMBIENT_NETWORK_BLOCKED');
        if (key === 'fetch') return Promise.reject(error);
        throw error;
      }
    });
    restorers.push(() => Object.defineProperty(target, key, descriptor));
  };
  return {
    install() {
      replace(globalThis, 'fetch');
      for (const [target, key] of [
        [http, 'request'], [http, 'get'], [https, 'request'], [https, 'get'],
        [net, 'connect'], [net, 'createConnection'], [tls, 'connect'], [net.Socket.prototype, 'connect']
      ]) replace(target, key);
      syncBuiltinESMExports();
    },
    restore() {
      let restoreError;
      for (let index = restorers.length - 1; index >= 0; index -= 1) {
        try { restorers[index](); } catch (error) { restoreError ||= error; }
      }
      syncBuiltinESMExports();
      if (restoreError) throw restoreError;
    }
  };
}

function makeOfflineTransport({ caseId, family, inventory, entries }) {
  const context = new AsyncLocalStorage();
  const attempts = [];
  const rejectedIdentities = [];
  const inventoryByIdentity = new Map();
  const captureByIdentity = new Map();
  let latchedError;

  for (const item of inventory) {
    const request = normalizeRequest(item.url, {
      method: item.method,
      redirect: 'manual',
      headers: item.headers
    }, item.family);
    const identity = sha256(stableJson(request));
    inventoryByIdentity.set(identity, { item, request });
  }
  for (const entry of entries) {
    if (entry.request.family !== family) continue;
    const request = normalizeRequest(entry.request.url, {
      method: entry.request.method,
      redirect: 'manual',
      headers: entry.request.headers
    }, entry.request.family);
    const identity = sha256(stableJson(request));
    assert.equal(entry.requestIdentitySha256, identity, 'OFFLINE_CAPTURE_REQUEST_IDENTITY_MISMATCH');
    assert.ok(inventoryByIdentity.has(identity), 'OFFLINE_CAPTURE_ENTRY_OUTSIDE_CASE_FAMILY_INVENTORY');
    assert.ok(!captureByIdentity.has(identity), 'OFFLINE_CAPTURE_DUPLICATE_IDENTITY');
    captureByIdentity.set(identity, entry);
  }

  function latch(errorCode, request, identity) {
    if (!latchedError) {
      latchedError = new Error(errorCode);
      if (request) rejectedIdentities.push({
        caseId,
        family,
        requestedUrl: request.url,
        method: request.method,
        headers: request.headers,
        requestIdentitySha256: identity,
        rejection: errorCode,
        latched: true
      });
    }
    return latchedError;
  }

  const transport = {
    attempts,
    rejectedIdentities,
    get terminalIntegrityFailure() { return latchedError?.message || null; },
    withEvidenceFamily(requestedFamily, callback) {
      if (requestedFamily !== family) throw latch('OFFLINE_REPLAY_CASE_FAMILY_MISMATCH');
      return context.run(requestedFamily, callback);
    },
    assertHealthy() {
      if (latchedError) throw latchedError;
    },
    async fetch(url, init = {}) {
      const requestedFamily = context.getStore();
      let request;
      try {
        request = normalizeRequest(url, init, requestedFamily);
      } catch (error) {
        const requestedUrl = (() => { try { return new URL(String(url)).toString(); } catch { return String(url); } })();
        attempts.push({ caseId, family: requestedFamily, requestedUrl, accepted: false, reason: error.message });
        throw latch(error.message || 'OFFLINE_REPLAY_REQUEST_POLICY_REJECTED');
      }
      const identity = sha256(stableJson(request));
      const authorized = inventoryByIdentity.get(identity);
      const attempt = {
        caseId,
        family: requestedFamily,
        requestedUrl: request.url,
        method: request.method,
        requestIdentitySha256: identity,
        inventoryMatched: Boolean(authorized),
        accepted: false
      };
      attempts.push(attempt);
      if (latchedError) {
        attempt.reason = 'LATCHED_PRIOR_INTEGRITY_FAILURE';
        throw latchedError;
      }
      if (requestedFamily !== family || !authorized) {
        attempt.reason = 'REQUEST_IDENTITY_OUTSIDE_CASE_FAMILY_INVENTORY';
        throw latch('OFFLINE_REPLAY_REQUEST_OUTSIDE_CAPTURE_INVENTORY', request, identity);
      }
      const entry = captureByIdentity.get(identity);
      if (!entry) {
        attempt.reason = 'INVENTORY_REQUEST_HAS_NO_CAPTURED_RESPONSE';
        throw latch('OFFLINE_REPLAY_CAPTURE_ENTRY_MISSING', request, identity);
      }
      if (entry.failure) {
        attempt.reason = 'CAPTURED_TRANSPORT_FAILURE:' + entry.failure;
        throw latch('OFFLINE_REPLAY_CAPTURED_TRANSPORT_FAILURE', request, identity);
      }
      attempt.accepted = true;
      attempt.captureOrdinal = entry.ordinal;
      const bytes = validateBase64AndHash(entry.bodyBase64, entry.bodySha256, 'OFFLINE_CAPTURE_BODY');
      const nullBody = entry.status === 204 || entry.status === 205 || entry.status === 304;
      const response = new Response(nullBody ? null : bytes, { status: entry.status, statusText: entry.statusText, headers: entry.headers });
      Object.defineProperty(response, 'url', { value: entry.actualUrl });
      return response;
    }
  };
  return transport;
}

function compactIssueDiagnostics(result) {
  const governed = result.productionDiagnostics?.governed || {};
  const observations = governed.governedIssueObservations || [];
  const issues = (governed.workstreams || []).flatMap(stream => (stream.issues || []).map(issue => ({
    authority: stream.authority,
    issueId: issue.issueId,
    subject: issue.subject,
    operation: issue.operation,
    evidenceStatus: issue.evidenceStatus,
    applicationStatus: issue.applicationStatus,
    gaps: issue.gaps || [],
    retrievalAttempts: issue.retrievalAttempts || [],
    verifiedQuotes: (issue.verifiedClaims || []).slice(0, 5).map(claim => ({ recordId: claim.recordId, quote: claim.quote }))
  })));
  return {
    available: governed.available,
    status: governed.status,
    evidenceStatus: governed.evidenceStatus,
    applicationStatus: governed.applicationStatus,
    topLevelGaps: governed.topLevelGaps || [],
    candidateGroupCount: governed.candidateGroupCount,
    candidateGroupRecordCount: governed.candidateGroupRecordCount,
    fetchValidationObservations: governed.fetchValidationObservations || [],
    issues,
    requestedConceptCoverage: observations.map(item => ({
      issueId: item.issueId,
      coverageStatus: item.coverageStatus,
      providerError: item.providerError,
      lifecycle: item.lifecycle,
      candidateCount: item.candidateCount,
      observedRecordIds: item.observedRecordIds || [],
      eligibleRecordIds: item.eligibleRecordIds || [],
      actualReturnedSourceCount: item.actualReturnedSourceCount,
      rejectedCount: item.rejectedCount,
      transportBinding: item.transportBinding,
      recordDiagnostics: item.recordDiagnostics || [],
      requestedConceptCoverage: item.requestedConceptCoverage,
      gaps: item.gaps || [],
      requestedConcepts: item.evidenceQuality?.requestedConcepts || [],
      coveredConcepts: item.evidenceQuality?.coveredConcepts || [],
      uncoveredConcepts: item.evidenceQuality?.uncoveredConcepts || [],
      verifiedClaims: (item.verifiedClaims || []).slice(0, 5)
    }))
  };
}

export async function runOfflineRetainedReplay({ writeReport = false, reportPath = REPLAY_REPORT_PATH } = {}) {
  const protectedInputsBefore = await snapshotProtectedInputs();
  const [activation, payload, captureResult, lock, consumed, runnerText] = await Promise.all([
    readJson(ACTIVATION_PATH), readJson(CAPTURE_PATH), readJson(CAPTURE_RESULT_PATH),
    readJson(CAPTURE_LOCK_PATH), readJson(CONSUMPTION_MARKER_PATH), readFile(RUN_PATH, 'utf8')
  ]);
  assert.equal(consumed.status, 'CONSUMED_NO_RETRY', 'OFFLINE_RETRY_RUN_NOT_RECORDED_AS_CONSUMED');
  assert.equal(consumed.profile, 'iras-first-targeted-acceptance-v4', 'OFFLINE_RETRY_CONSUMPTION_PROFILE_MISMATCH');
  assert.equal(activation.status, 'FROZEN_ACTIVATION_CONFIGURATION', 'OFFLINE_ACTIVATION_STATUS_INVALID');
  assert.equal(payload.captureStatus, 'COMPLETE', 'OFFLINE_CAPTURE_NOT_COMPLETE');
  assert.equal(payload.synthetic, false, 'OFFLINE_CAPTURE_MUST_BE_RETAINED_LIVE_EVIDENCE');
  assert.equal(lock.frozen, true, 'OFFLINE_CAPTURE_LOCK_NOT_FROZEN');
  assert.equal(lock.synthetic, false, 'OFFLINE_CAPTURE_LOCK_MUST_RETAIN_LIVE_EVIDENCE');
  assert.equal(captureResult.status, 'CAPTURED_AND_LOCKED', 'OFFLINE_CAPTURE_RESULT_NOT_LOCKED');
  assert.equal(captureResult.semanticCalls, 0, 'OFFLINE_REPLAY_CAPTURE_RESULT_RECORDED_SEMANTIC_CALLS');
  assert.equal(captureResult.providerCredentialRead, false, 'OFFLINE_REPLAY_CAPTURE_RESULT_READ_PROVIDER_CREDENTIAL');
  const payloadSha256 = sha256(await readFile(CAPTURE_PATH));
  const lockSha256 = sha256(await readFile(CAPTURE_LOCK_PATH));
  const activationFileSha256 = sha256(await readFile(ACTIVATION_PATH));
  assert.equal(payloadSha256, lock.capturePayloadSha256, 'OFFLINE_CAPTURE_PAYLOAD_LOCK_HASH_MISMATCH');
  assert.equal(lockSha256, consumed.evidenceLockSha256, 'OFFLINE_CAPTURE_LOCK_CONSUMPTION_HASH_MISMATCH');
  assert.equal(lockSha256, captureResult.evidenceLockSha256, 'OFFLINE_CAPTURE_LOCK_RESULT_HASH_MISMATCH');
  assert.equal(payloadSha256, captureResult.capturePayloadSha256, 'OFFLINE_CAPTURE_PAYLOAD_RESULT_HASH_MISMATCH');
  assert.equal(activationFileSha256, consumed.activationConfigurationFileSha256, 'OFFLINE_ACTIVATION_FILE_CONSUMPTION_HASH_MISMATCH');
  assert.equal(activation.activationConfigurationSha256, consumed.activationConfigurationSha256, 'OFFLINE_ACTIVATION_CONSUMPTION_HASH_MISMATCH');
  assert.equal(payload.captureInventorySha256, activation.captureInventorySha256, 'OFFLINE_CAPTURE_INVENTORY_BINDING_MISMATCH');
  assert.equal(payload.captureInventorySha256, consumed.captureInventorySha256, 'OFFLINE_CAPTURE_INVENTORY_CONSUMPTION_MISMATCH');
  assert.equal(payload.captureInventorySha256, captureResult.captureInventorySha256, 'OFFLINE_CAPTURE_INVENTORY_RESULT_MISMATCH');
  assert.equal(payload.captureInventorySha256, lock.captureInventorySha256, 'OFFLINE_CAPTURE_INVENTORY_LOCK_MISMATCH');

  const inventory = activation.captureInventory;
  const inventoryIds = new Set(inventory.map(item => sha256(stableJson(normalizeRequest(item.url, {
    method: item.method, redirect: 'manual', headers: item.headers
  }, item.family)))));
  const captureEntries = payload.entries;
  let verifiedCaptureBytes = 0;
  for (const entry of captureEntries) {
    const request = normalizeRequest(entry.request.url, {
      method: entry.request.method, redirect: 'manual', headers: entry.request.headers
    }, entry.request.family);
    const identity = sha256(stableJson(request));
    assert.equal(entry.requestIdentitySha256, identity, 'OFFLINE_CAPTURE_REQUEST_IDENTITY_MISMATCH');
    assert.ok(inventoryIds.has(identity), 'OFFLINE_CAPTURE_REQUEST_NOT_IN_FROZEN_INVENTORY');
    validateBase64AndHash(entry.bodyBase64, entry.bodySha256, 'OFFLINE_CAPTURE_BODY');
    verifiedCaptureBytes += 1;
  }

  const retainedRows = runnerText.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line))
    .filter(row => ['CASE_COMPLETED', 'CASE_FAILED'].includes(row.event) && CAPTURE_CASE_IDS.includes(row.caseId));
  assert.deepEqual(retainedRows.map(row => row.caseId), CAPTURE_CASE_IDS, 'OFFLINE_RETAINED_CASE_SET_MISMATCH');
  const retainedResponseChecks = retainedRows.map(row => {
    const responseBytes = validateBase64AndHash(row.semanticResponseBase64, row.semanticResponseSha256, 'OFFLINE_SEMANTIC_RESPONSE');
    assert.equal(responseBytes.length, row.semanticResponseBytes, 'OFFLINE_SEMANTIC_RESPONSE_BYTE_COUNT_MISMATCH');
    return { caseId: row.caseId, sha256: row.semanticResponseSha256, bytes: responseBytes.length };
  });
  const expectedResponseHashes = {
    'target-relief-entitlement': '2b01be82a346c448df48ff6c1df72f47741ecee26a957f94ca4d4c0920814178',
    'target-relief-amount': 'a72bc72eb6c0b99e9fc995c25b9c65b3539d29458cc26f9a3a8a20a790083b5b',
    'A-paraphrase-2': 'f5d794abde155441ae208fe7fc4d1257776e240c4fe15d64fee9dcdd14ab6dda',
    'private-expense-treatment': '063c02ff8dac7c57479b163911e229903389a28cd8851a338dfccdd2a4e3082e'
  };
  for (const row of retainedRows) {
    assert.equal(row.semanticResponseSha256, expectedResponseHashes[row.caseId],
      'OFFLINE_RETAINED_RESPONSE_HASH_CHANGED:' + row.caseId);
  }

  const priorRows = new Map(retainedRows.map(row => [row.caseId, row]));
  const replayed = [];
  const networkGuard = makeAmbientNetworkBlock();
  networkGuard.install();
  let protectedInputsAfter;
  try {
    for (const caseId of CAPTURE_CASE_IDS) {
      const prior = priorRows.get(caseId);
      const family = activation.caseEvidenceFamily[caseId];
      assert.equal(typeof family, 'string', 'OFFLINE_CASE_FAMILY_MISSING');
      const familyInventory = inventory.filter(item => item.family === family && item.provenance?.caseIds?.includes(caseId));
      assert.ok(familyInventory.length > 0, 'OFFLINE_CASE_FAMILY_INVENTORY_EMPTY:' + caseId);
      const transport = makeOfflineTransport({ caseId, family, inventory: familyInventory, entries: captureEntries });
      const webRetriever = bindProductionControlledRetriever({
        transport,
        cache: new SourceCache()
      });
      const response = Buffer.from(prior.semanticResponseBase64, 'base64').toString('utf8');
      const referenceDate = prior.actualResult?.productionDiagnostics?.local?.referenceDate;
      assert.match(referenceDate || '', /^\d{4}-\d{2}-\d{2}$/, 'OFFLINE_REPLAY_REFERENCE_DATE_MISSING');
      const result = await transport.withEvidenceFamily(family, () => runV4AcceptanceCase({
        caseId,
        referenceDate,
        sendSemantic: async request => {
          assert.equal(request.caseId, caseId, 'OFFLINE_SEMANTIC_CASE_MISMATCH');
          return response;
        },
        evidenceTransport: transport.fetch,
        withEvidenceFamily: transport.withEvidenceFamily,
        webRetriever
      }));
      replayed.push({
        caseId,
        sourceEvent: prior.event,
        retainedResponseSha256: prior.semanticResponseSha256,
        family,
        stageVerdicts: result.stageVerdicts,
        layerVerdicts: result.layerVerdicts,
        firstFailure: result.firstFailure,
        interpretation: result.interpretation,
        issuePlan: result.issuePlan,
        governedEvidence: compactIssueDiagnostics(result),
        requestAttempts: transport.attempts,
        rejectedIdentities: transport.rejectedIdentities,
        terminalIntegrityFailure: transport.terminalIntegrityFailure
      });
    }
  } finally {
    try {
      networkGuard.restore();
    } finally {
      protectedInputsAfter = await snapshotProtectedInputs();
      assert.deepEqual(protectedInputsAfter, protectedInputsBefore, 'OFFLINE_REPLAY_MUTATED_PROTECTED_INPUTS');
    }
  }

  const consumedRunMutated = Object.keys(protectedInputsBefore)
    .some(name => protectedInputsBefore[name] !== protectedInputsAfter[name]);
  assert.equal(consumedRunMutated, false, 'OFFLINE_REPLAY_MUTATED_CONSUMED_RUN_OR_EVIDENCE');
  const reviewedCases = replayed.map(item => {
    const operationalIntegrity = item.terminalIntegrityFailure === null;
    const authoritativeStageVerdicts = {
      ...item.stageVerdicts,
      ...(operationalIntegrity ? {} : { INTEGRITY: false })
    };
    return {
      ...item,
      rawAdapterStageVerdicts: item.stageVerdicts,
      rawAdapterFirstFailure: item.firstFailure,
      stageVerdicts: authoritativeStageVerdicts,
      firstFailure: operationalIntegrity ? item.firstFailure : 'INTEGRITY',
      operationalIntegrity,
      authoritativeFirstFailure: operationalIntegrity ? item.firstFailure : 'INTEGRITY'
    };
  });
  const report = {
    profile: 'IRAS_V4_OFFLINE_RETAINED_DIAGNOSTIC_ONLY',
    acceptanceResult: false,
    liveCallsMade: 0,
    capturesMade: 0,
    consumedRunMutated,
    protectedInputSha256: { before: protectedInputsBefore, after: protectedInputsAfter },
    retainedRunPath: path.relative(ROOT, RUN_PATH).replaceAll(path.sep, '/'),
    capturePath: path.relative(ROOT, CAPTURE_PATH).replaceAll(path.sep, '/'),
    activationInventorySha256: activation.captureInventorySha256,
    capturePayloadSha256: payloadSha256,
    captureLockSha256: lockSha256,
    activationConfigurationFileSha256: activationFileSha256,
    protectedInputCount: Object.keys(protectedInputsBefore).length,
    historicalProtectedInputCount: 21,
    retryProtectedInputCount: Object.keys(PROTECTED_RETRY_INPUT_PATHS).length,
    verifiedSemanticResponseCount: retainedResponseChecks.length,
    semanticResponses: retainedResponseChecks,
    captureBodyHashes: captureEntries.map(entry => ({ ordinal: entry.ordinal, family: entry.request.family, sha256: entry.bodySha256 })),
    verifiedCapturedEntryCount: verifiedCaptureBytes,
    capturedEntryCount: captureEntries.length,
    cases: reviewedCases
  };
  if (writeReport) {
    await mkdir(OUTPUT_DIR, { recursive: true });
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { flag: 'w' });
  }
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = await runOfflineRetainedReplay({ writeReport: true, reportPath: REPLAY_REPORT_PATH });
  console.log(JSON.stringify({
    profile: report.profile,
    acceptanceResult: report.acceptanceResult,
    verifiedSemanticResponseCount: report.verifiedSemanticResponseCount,
    verifiedCapturedEntryCount: report.verifiedCapturedEntryCount,
    cases: report.cases.map(item => ({
      caseId: item.caseId,
      firstFailure: item.firstFailure,
      stages: Object.entries(item.stageVerdicts).filter(([, passed]) => !passed).map(([stage]) => stage),
      rejected: item.rejectedIdentities.map(row => ({ requestedUrl: row.requestedUrl, requestIdentitySha256: row.requestIdentitySha256 }))
    }))
  }, null, 2));
}
