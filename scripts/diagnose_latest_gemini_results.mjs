import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runV4AcceptanceCase } from './iras_v4_production_acceptance_adapter.mjs';
import { bindProductionControlledRetriever, captureInventoryDigest } from './iras_v4_capture_replay_runner.mjs';
import { diagnoseGeminiCaseFailure } from './gemini_failure_diagnostics.mjs';
import { SourceCache } from '../src/retrieval/sourceCache.ts';
import { defaultAdvancedSourceRetriever } from '../src/retrieval/advancedSourceRetriever.ts';
import { resolveMappedOfficialSourceFallback } from '../src/services/groundingContextBuilder.ts';
import { getRequestedQuestionConcepts, validateSemanticQuestionInterpretation } from '../src/services/semanticQuestionUnderstanding.ts';
import { readV4Contract } from '../tests/evaluation/singapore/iras-first-targeted-acceptance-v4.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = 'artifacts/iras-v4-acceptance-repaired-2026-10-06/';
const INPUTS = Object.freeze({
  original: BASE + 'semantic-run-v4-post-repair-2026-10-08/runner-v4.partial.jsonl',
  originalConsumed: BASE + 'semantic-run-v4-post-repair-2026-10-08/consumed-v4.json',
  remaining: BASE + 'remaining-six-diagnostic-2026-10-09/results/summary.json',
  remainingJournal: BASE + 'remaining-six-diagnostic-2026-10-09/results/remaining-six.partial.jsonl',
  remainingConsumed: BASE + 'remaining-six-diagnostic-2026-10-09/results/consumed.json',
  activation: BASE + 'post-repair-2026-10-08/preparation/activation-configuration.json',
  capture: BASE + 'post-repair-2026-10-08/official-capture/capture-payload.json',
  lock: BASE + 'post-repair-2026-10-08/official-capture/evidence-lock.json'
});
const sha256 = value => createHash('sha256').update(value).digest('hex');
const snapshot = async () => Object.fromEntries(await Promise.all(Object.entries(INPUTS).map(async ([name, relative]) =>
  [name, sha256(await readFile(path.join(ROOT, relative)))])));
const json = async relative => JSON.parse(await readFile(path.join(ROOT, relative), 'utf8'));

export function blockAmbientNetwork({ onBlocked } = {}) {
  const restorers = [];
  for (const [target, key] of [[globalThis, 'fetch'], [http, 'request'], [http, 'get'], [https, 'request'], [https, 'get'],
    [net, 'connect'], [net, 'createConnection'], [net.Socket.prototype, 'connect'], [tls, 'connect']]) {
    const descriptor = Object.getOwnPropertyDescriptor(target, key);
    assert.ok(descriptor?.configurable);
    Object.defineProperty(target, key, { ...descriptor, value: function () {
      onBlocked?.(key);
      const error = new Error('GEMINI_DIAGNOSTIC_AMBIENT_NETWORK_BLOCKED');
      if (key === 'fetch') return Promise.reject(error);
      throw error;
    } });
    restorers.push(() => Object.defineProperty(target, key, descriptor));
  }
  syncBuiltinESMExports();
  return () => {
    let failure;
    for (const restore of restorers.reverse()) { try { restore(); } catch (error) { failure ||= error; } }
    syncBuiltinESMExports();
    if (failure) throw failure;
  };
}

export function offlineTransport(payload, inventory, caseId, family) {
  const context = new AsyncLocalStorage();
  const attempts = [];
  let failure;
  const entries = new Map(payload.entries.filter(entry => entry.request.family === family).map(entry => [entry.requestIdentitySha256, entry]));
  const assertHealthy = () => { if (failure) throw failure; };
  return { attempts, assertHealthy, withEvidenceFamily: (selected, fn) => context.run(selected, fn),
    fetch: async (rawUrl, init = {}) => {
      assertHealthy();
      assert.equal(context.getStore(), family);
      const url = new URL(String(rawUrl));
      assert.ok(['www.iras.gov.sg', 'iras.gov.sg'].includes(url.hostname));
      assert.equal(url.protocol, 'https:');
      assert.equal(url.username + url.password + url.port + url.hash, '');
      assert.equal(String(init.method || 'GET').toUpperCase(), 'GET');
      assert.equal(init.redirect, 'manual');
      assert.ok(init.body == null);
      const headers = Object.fromEntries([...new Headers(init.headers).entries()].sort(([a], [b]) => a.localeCompare(b)));
      const request = { family, url: url.toString(), method: 'GET', headers };
      const identity = sha256(JSON.stringify(request));
      const allowed = inventory.some(item => item.family === family && item.url === request.url && item.method === request.method &&
        JSON.stringify(item.headers) === JSON.stringify(request.headers) && item.provenance?.caseIds?.includes(caseId));
      const entry = entries.get(identity);
      attempts.push({ url: request.url, requestIdentitySha256: identity, captured: Boolean(allowed && entry) });
      if (!allowed || !entry) { failure = new Error('OFFLINE_REQUEST_OUTSIDE_CAPTURE_INVENTORY'); throw failure; }
      assert.deepEqual(entry.request, request);
      const bytes = Buffer.from(entry.bodyBase64, 'base64');
      assert.equal(sha256(bytes), entry.bodySha256);
      const response = new Response(bytes, { status: entry.status, headers: entry.headers });
      Object.defineProperty(response, 'url', { value: entry.actualUrl });
      return response;
    }
  };
}

export async function loadLatestGeminiOfflineEvidenceBundle() {
  const [activation, payload, lock, payloadBytes] = await Promise.all([
    json(INPUTS.activation), json(INPUTS.capture), json(INPUTS.lock), readFile(path.join(ROOT, INPUTS.capture))
  ]);
  assert.equal(sha256(payloadBytes), lock.capturePayloadSha256, 'The retained source capture must match its evidence lock.');
  assert.equal(activation.captureInventorySha256, captureInventoryDigest(activation.captureInventory),
    'The retained activation inventory digest must validate.');
  assert.equal(lock.captureInventorySha256, activation.captureInventorySha256,
    'The retained evidence lock must bind the activation inventory.');
  for (const entry of payload.entries || []) {
    assert.equal(entry.requestIdentitySha256, sha256(JSON.stringify(entry.request)),
      'Each retained capture request identity must validate.');
    const inventoryEntry = activation.captureInventory.find(item => item.family === entry.request.family &&
      item.url === entry.request.url && item.method === entry.request.method &&
      JSON.stringify(item.headers) === JSON.stringify(entry.request.headers) &&
      item.provenance?.caseIds?.some(caseId => entry.request.family === activation.caseEvidenceFamily?.[caseId]));
    assert.ok(inventoryEntry, 'Every retained source capture entry must be present in the activated inventory.');
    const bytes = Buffer.from(entry.bodyBase64, 'base64');
    assert.equal(sha256(bytes), entry.bodySha256, 'Every retained source response body hash must validate.');
    assert.equal(bytes.length, entry.bodyBytes ?? bytes.length, 'Retained source body byte length must validate when recorded.');
  }
  return { activation, payload, lock, inputPaths: INPUTS };
}

export async function diagnoseLatestGeminiResults() {
  const before = await snapshot();
  const [remaining, activation, payload, lock, originalText] = await Promise.all([
    json(INPUTS.remaining), json(INPUTS.activation), json(INPUTS.capture), json(INPUTS.lock), readFile(path.join(ROOT, INPUTS.original), 'utf8')
  ]);
  assert.equal(before.capture, lock.capturePayloadSha256);
  const originals = originalText.trim().split(/\r?\n/).map(JSON.parse).filter(row => row.actualResult && row.semanticResponseBase64);
  assert.equal(originals.length, 3);
  assert.equal(remaining.rows.length, 6);
  const retained = [...originals, ...remaining.rows];
  assert.equal(new Set(retained.map(row => row.caseId)).size, 9);
  const observed = retained.map(row => ({ caseId: row.caseId, status: row.status, ...diagnoseGeminiCaseFailure(row),
    blockedUrls: (row.blockedUrlObservations || row.actualResult?.productionDiagnostics?.governed?.fetchValidationObservations || [])
      .filter(item => item.errorCode || item.status === 'THREW').map(item => item.url) }));
  const replays = [];
  let cpfCoverageInspection;
  const restore = blockAmbientNetwork();
  try {
    for (const row of retained.filter(row => row.semanticResponseBase64)) {
      const bytes = Buffer.from(row.semanticResponseBase64, 'base64');
      assert.equal(sha256(bytes), row.semanticResponseSha256);
      assert.equal(bytes.length, row.semanticResponseBytes);
      const family = activation.caseEvidenceFamily[row.caseId];
      const transport = offlineTransport(payload, activation.captureInventory, row.caseId, family);
      const result = await transport.withEvidenceFamily(family, () => runV4AcceptanceCase({
        caseId: row.caseId, referenceDate: '2026-10-08', sendSemantic: async () => bytes.toString('utf8'),
        evidenceTransport: transport.fetch, withEvidenceFamily: transport.withEvidenceFamily,
        webRetriever: bindProductionControlledRetriever({ transport, cache: new SourceCache() })
      }));
      let inventoryHealthy = true;
      try { transport.assertHealthy(); } catch { inventoryHealthy = false; }
      replays.push({ caseId: row.caseId, retainedResponseSha256: row.semanticResponseSha256, inventoryHealthy,
        failureDiagnostics: result.failureDiagnostics, stageVerdicts: result.stageVerdicts,
        requests: transport.attempts, governed: result.productionDiagnostics.governed });
      if (row.caseId === 'A-paraphrase-2') {
        const question = (await readV4Contract()).cases.find(item => item.caseId === row.caseId).question;
        const interpretation = validateSemanticQuestionInterpretation(JSON.parse(bytes.toString('utf8')), question);
        const issue = result.issuePlan.issues.find(issue => issue.governingAuthorities.includes('IRAS'));
        const understanding = { mode: 'SEMANTIC_INTERPRETATION', interpretation };
        const requestedConcepts = getRequestedQuestionConcepts(question, understanding).filter(concept =>
          concept.topicIds.length === 0 || concept.topicIds.some(id => issue.mappedTopicIds.includes(id)));
        const inspectionTransport = offlineTransport(payload, activation.captureInventory, row.caseId, family);
        const inspection = await inspectionTransport.withEvidenceFamily(family, () => resolveMappedOfficialSourceFallback(
          issue.mappedTopicIds, question, defaultAdvancedSourceRetriever, {
            referenceDate: '2026-10-08', questionUnderstanding: understanding, authorityLevelDiscovery: true,
            evidenceScope: { authority: 'IRAS', domain: 'IRAS_INDIVIDUAL_TAX', topicIds: issue.mappedTopicIds, requestedConcepts,
              context: { domainId: 'IRAS_INDIVIDUAL_TAX', population: issue.population, primarySubject: issue.subject,
                concepts: [issue.subject], requestedOperation: issue.operation } },
            webRetriever: bindProductionControlledRetriever({ transport: inspectionTransport, cache: new SourceCache() }),
            fetchOptions: { customFetch: inspectionTransport.fetch, useCache: false },
            officialDomainSearchAdapter: { async searchOfficialDomainCandidates() { return []; } }
          }));
        inspectionTransport.assertHealthy();
        cpfCoverageInspection = { caseId: row.caseId, requestedConcepts, requests: inspectionTransport.attempts,
          coverageDecisions: inspection.trace.coverageDecisions, stages: inspection.trace.stages };
      }
    }
  } finally { restore(); }
  const after = await snapshot();
  assert.deepEqual(after, before, 'Retained results, captures and consumed markers must stay immutable.');
  return { profile: 'GEMINI_REMEDIATION_OFFLINE_DIAGNOSTIC', acceptanceProven: false, newProviderCalls: 0, newSourceRequests: 0,
    protectedInputSha256: { before, after }, observedCounts: { passed: observed.filter(row => row.status === 'PASSED').length,
      failed: observed.filter(row => row.status === 'FAILED').length,
      interpretationsPassed: observed.filter(row => row.assessmentStatus === 'PASSED').length,
      interpretationsNotAssessed: observed.filter(row => row.assessmentStatus === 'NOT_ASSESSED').length }, observed,
    replayedUsableInterpretations: replays.length, replays, cpfCoverageInspection };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const report = await diagnoseLatestGeminiResults();
  const output = path.join(ROOT, 'artifacts/gemini-remediation-2026-10-09');
  await mkdir(output, { recursive: true });
  await writeFile(path.join(output, 'latest-results-diagnostic.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ ...report.observedCounts, replayed: report.replayedUsableInterpretations,
    replayInventoryHealthy: report.replays.filter(row => row.inventoryHealthy).length, acceptanceProven: false }));
}
