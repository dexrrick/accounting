import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import http, { request as namedHttpRequest } from 'node:http';
import net, { connect as namedNetConnect } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import tls from 'node:tls';
import { fileURLToPath } from 'node:url';
import { SourceCache } from '../../src/retrieval/sourceCache.ts';
import {
  BASELINE_COMMIT,
  ACTIVATION_PROFILE,
  CASE_EVIDENCE_FAMILY,
  EVIDENCE_FAMILIES,
  RUNNER_PROFILE,
  assertActivationConfigurationBodyMatches,
  assertRunnerConfigurationBodyMatches,
  assertFrozenSemanticRequest,
  bindProductionControlledRetriever,
  buildApprovedCaptureInventory,
  captureInventoryDigest,
  collectTrackedExecutablePaths,
  collectCheckoutIntegritySnapshot,
  createCaptureTransport,
  createReplayTransport,
  runBoundedCapture,
  runBoundedV4SemanticPhase,
  runOfflineSyntheticV4CaseLoop,
  sha256,
  matchCaptureInventoryRequest,
  unionProtectedHistoryPaths,
  validateActivationInventory,
  validateCapturePayload
} from '../../scripts/iras_v4_capture_replay_runner.mjs';
import {
  CASE_IDS,
  FAILURE_STAGES,
  readV4Contract,
  reserveConsumption
} from '../evaluation/singapore/iras-first-targeted-acceptance-v4.mjs';
import { runV4AcceptanceCase } from '../../scripts/iras_v4_production_acceptance_adapter.mjs';
import { sendV4SemanticRequest } from '../../scripts/iras_v4_capture_transports.mjs';
import { SEMANTIC_QUESTION_V2_RESPONSE_JSON_SCHEMA } from '../../src/services/semanticQuestionUnderstanding.ts';

const TEST_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const GIT = process.env.CODEX_GIT_EXECUTABLE ||
  'C:/Users/Admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/native/git/cmd/git.exe';
const ARTIFACT_ROOT = 'artifacts/iras-v4-runner-integrity-2026-10-06';

function passingSyntheticCaseResult(caseId) {
  const layerVerdicts = {
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
  return {
    caseId,
    layerVerdicts,
    stageVerdicts: Object.fromEntries(FAILURE_STAGES.map(stage => [stage, true])),
    firstFailure: null
  };
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function testProviderEnvelopeFailureRetention() {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.GEMINI_API_KEY;
  const body = Buffer.from('{"error":{"message":"synthetic quota response"}}', 'utf8');
  let calls = 0;
  process.env.GEMINI_API_KEY = 'offline-fixture-key-only';
  globalThis.fetch = async (url, init) => {
    calls += 1;
    assert.equal(String(url), 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent');
    assert.equal(init.redirect, 'error');
    assert.equal(new Headers(init.headers).get('x-goog-api-key'), 'offline-fixture-key-only');
    return new Response(body, { status: 429, headers: { 'content-type': 'application/json' } });
  };
  try {
    await assert.rejects(sendV4SemanticRequest({
      prompt: 'offline request fixture',
      system: 'offline system fixture',
      provider: { activeProvider: 'gemini', gemini: { model: 'gemini-3.5-flash-lite' } },
      options: { jsonMode: true, responseJsonSchema: SEMANTIC_QUESTION_V2_RESPONSE_JSON_SCHEMA,
        timeoutMs: 8_000, temperature: 0 },
      caseId: 'unsupported-sfrsi-6-exploration-evaluation'
    }), error => {
      assert.equal(error.message, 'V4_PROVIDER_HTTP_429');
      assert.deepEqual(error.partialProviderResponse, {
        kind: 'GEMINI_HTTP_ENVELOPE',
        status: 429,
        failureCode: 'V4_PROVIDER_HTTP_429',
        truncated: false,
        bodyBase64: body.toString('base64'),
        bodySha256: sha256(body),
        bodyBytes: body.length
      });
      return true;
    });
    assert.equal(calls, 1, 'The synthetic provider error makes exactly one physical fetch and is never retried.');

    const abortController = new AbortController();
    const abortPrefix = Buffer.from('{"error":', 'utf8');
    let stalledFetchCalls = 0;
    let stalledCancelCalls = 0;
    globalThis.fetch = async () => {
      stalledFetchCalls += 1;
      abortController.abort();
      return new Response(new ReadableStream({
        start(controller) { controller.enqueue(abortPrefix); },
        cancel() { stalledCancelCalls += 1; return new Promise(() => {}); }
      }), { status: 500 });
    };
    const freshTransport = await import(new URL(
      '../../scripts/iras_v4_capture_transports.mjs?stalled-cancel-control=1', import.meta.url).href);
    await assert.rejects(freshTransport.sendV4SemanticRequest({
      prompt: 'offline stalled response fixture',
      system: 'offline system fixture',
      provider: { activeProvider: 'gemini', gemini: { model: 'gemini-3.5-flash-lite' } },
      options: { jsonMode: true, responseJsonSchema: SEMANTIC_QUESTION_V2_RESPONSE_JSON_SCHEMA,
        timeoutMs: 8_000, temperature: 0 },
      caseId: 'gst-input-tax-general-rule',
      signal: abortController.signal
    }), error => {
      assert.equal(error.message, 'V4_PROVIDER_TIMEOUT');
      assert.equal(error.partialProviderResponse.kind, 'GEMINI_HTTP_ENVELOPE');
      assert.equal(error.partialProviderResponse.status, 500);
      assert.equal(error.partialProviderResponse.bodyBase64, '');
      assert.equal(error.partialProviderResponse.bodySha256, sha256(Buffer.alloc(0)));
      return true;
    });
    assert.equal(stalledFetchCalls, 1);
    assert.equal(stalledCancelCalls, 1, 'Already-aborted provider reads cancel without awaiting a stalled body cancel.');
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalApiKey;
  }
}

async function testActualAdapterInFixedCaseLoop() {
  const contract = await readV4Contract();
  const caseId = 'private-expense-treatment';
  const caseContract = contract.cases.find(row => row.caseId === caseId);
  assert.ok(caseContract, 'Private-expense case is present in the fixed V4 contract.');
  const subject = 'company private holiday travel expense corporate income tax treatment';
  const semanticWire = {
    schemaVersion: 2,
    jurisdiction: ['Singapore'],
    authorityCandidates: ['IRAS'],
    contextualAuthorities: [],
    domain: 'IRAS_INCOME_TAX',
    population: 'COMPANY',
    primarySubject: subject,
    concepts: [
      { concept: 'company expense tax deductibility', role: 'PRIMARY' },
      { concept: 'private and domestic expenses', role: 'RELATED' }
    ],
    requestedOperation: 'DETERMINE_TREATMENT',
    factsExplicitlyProvided: ['SGD 900', 'director private holiday', 'travel expense'],
    confidence: 0.96,
    issues: [{
      subject,
      population: 'COMPANY',
      domain: 'IRAS_INCOME_TAX',
      governingAuthorities: ['IRAS'],
      contextualAuthorities: [],
      operation: 'DETERMINE_TREATMENT',
      mappedTopicIds: [],
      evidenceRequirement: 'AUTHORITATIVE_SOURCE_AND_CASE_FACTS',
      confidence: 0.96
    }]
  };
  const privateUrl = 'https://www.iras.gov.sg/taxes/corporate-income-tax/income-deductions-for-companies/business-expenses';
  const fixtureResponses = new Map([
    [privateUrl, ['<html><head><title>Business Expenses | IRAS</title></head><body>' +
      '<main><h1>Business Expenses</h1><p>For income tax, companies may deduct expenses wholly and exclusively incurred in producing income under the general deduction rule in section 14. This explains whether a company expense is tax deductible and whether it is deductible for tax purposes. Private and domestic expenses are not deductible under section 15, subject to the statutory exceptions and qualifications. This guidance explains the treatment of business expenses for corporate income tax.</p></main></body></html>', 'text/html']],
    ['https://www.iras.gov.sg/sitemap', ['<?xml version="1.0"?><urlset><url><loc>' +
      'https://www.iras.gov.sg/taxes/individual-income-tax/basics-of-individual-income-tax/tax-reliefs-rebates-and-deductions/tax-reliefs/cpf-relief-employees' +
      '</loc><lastmod>2026-10-04</lastmod></url></urlset>', 'application/xml']],
    ['https://www.iras.gov.sg/robots.txt', ['User-agent: *\nDisallow:', 'text/plain']]
  ]);
  const fetchedUrls = [];
  const fixtureFetch = async url => {
    const normalized = String(url);
    fetchedUrls.push(normalized);
    const fixture = fixtureResponses.get(normalized);
    return new Response(fixture?.[0] || 'SYNTHETIC_FIXTURE_NOT_MAPPED', {
      status: fixture ? 200 : 404,
      headers: { 'content-type': fixture?.[1] || 'text/plain' }
    });
  };
  const webRetriever = bindProductionControlledRetriever({
    transport: { fetch: fixtureFetch },
    cache: new SourceCache()
  });
  assert.equal(Object.isFrozen(webRetriever), true, 'The production retriever passed to the adapter is frozen.');
  const callbackRequests = [];
  const semanticCalls = [];
  const result = await runOfflineSyntheticV4CaseLoop({
    synthetic: true,
    referenceDate: '2026-10-04',
    semanticTransport: async ({ caseId: currentCaseId }) => {
      semanticCalls.push(currentCaseId);
      return currentCaseId === caseId ? JSON.stringify(semanticWire) : `synthetic-${currentCaseId}`;
    },
    evidenceTransport: fixtureFetch,
    withEvidenceFamily: async (_family, callback) => callback(),
    webRetriever,
    executeCase: async ({ caseId: currentCaseId, sendSemantic, referenceDate, evidenceTransport, withEvidenceFamily, webRetriever: controlled }) => {
      if (currentCaseId !== caseId) {
        await sendSemantic({ caseId: currentCaseId });
        return passingSyntheticCaseResult(currentCaseId);
      }
      return await runV4AcceptanceCase({
        caseId: currentCaseId,
        referenceDate,
        evidenceTransport,
        withEvidenceFamily,
        webRetriever: controlled,
        sendSemantic: async request => {
          callbackRequests.push(request);
          return await sendSemantic(request);
        }
      });
    }
  });
  assert.equal(result.status, 'PASSED', `Fixed-loop production scorer row: ${JSON.stringify({
    loopRows: result.rows.map(row => ({ caseId: row.caseId, status: row.status, failure: row.failure })),
    callCounts: result.callCounts,
    status: result.rows[3]?.status,
    failure: result.rows[3]?.failure,
    firstFailure: result.rows[3]?.firstFailure,
    stageVerdicts: result.rows[3]?.stageVerdicts,
    resultRetained: Boolean(result.rows[3]?.actualResult)
  })}`);
  assert.deepEqual(semanticCalls, CASE_IDS);
  assert.equal(callbackRequests.length, 1);
  assert.equal(callbackRequests[0].options.timeoutMs, 8_000);
  assert.equal(callbackRequests[0].timeoutMs, undefined,
    'Actual production adapter callback supplies the frozen timeout in options only.');
  const row = result.rows.find(item => item.caseId === caseId);
  assert.ok(row);
  assert.equal(row.status, 'PASSED');
  assert.equal(Object.keys(row.stageVerdicts).length, FAILURE_STAGES.length,
    'The fixed loop retains the complete fourteen-stage recomputation.');
  assert.equal(FAILURE_STAGES.every(stage => row.stageVerdicts[stage] === true), true);
  assert.equal(Object.hasOwn(row.actualResult.layerVerdicts.semantic, 'passed'), false);
  assert.equal(Object.hasOwn(row.actualResult.layerVerdicts.governed, 'passed'), false);
  assert.equal(row.actualResult.productionDiagnostics.governed.available, true);
  assert.ok(fetchedUrls.includes(privateUrl), 'Production evidence traverses the frozen controlled retriever.');
  assert.equal(JSON.stringify(row.actualResult).includes('synthetic fixture not mapped'), false);
}

function git(root, args) {
  const result = spawnSync(GIT, ['-C', root, ...args], { encoding: 'utf8', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error('test git failed: ' + args[0] + ': ' + result.stderr);
  return result.stdout.trim();
}

async function temporaryDirectory(prefix) {
  return await mkdtemp(path.join(os.tmpdir(), prefix));
}

async function artifactPaths(root, suffix) {
  const directory = path.join(root, ARTIFACT_ROOT, suffix);
  await mkdir(directory, { recursive: true });
  return {
    directory,
    markerPath: path.join(directory, 'capture-reserved.json'),
    journalPath: path.join(directory, 'capture-partial.jsonl'),
    payloadPath: path.join(directory, 'capture-payload.json')
  };
}

function captureTransport(root, paths, liveFetch, overrides = {}) {
  const syntheticTestControls = {
    synthetic: true,
    ...(overrides.syntheticTestControls || {})
  };
  return createCaptureTransport({
    liveFetch,
    ...paths,
    root,
    integrityBindingSha256: digest('synthetic-runner-binding'),
    preregistrationSha256: digest('synthetic-preregistration'),
    synthetic: true,
    provenance: { sourcePolicySha256: digest('synthetic-policy') },
    syntheticTestControls
  });
}

function addResponseUrl(response, value) {
  Object.defineProperty(response, 'url', { value, configurable: true });
  return response;
}

async function initGitFixture(root) {
  await mkdir(path.join(root, 'src'), { recursive: true });
  await mkdir(path.join(root, 'tests', 'regression'), { recursive: true });
  await mkdir(path.join(root, 'scripts'), { recursive: true });
  await writeFile(path.join(root, 'src', 'sample.ts'), 'export const value = 1;\n');
  await writeFile(path.join(root, 'tests', 'regression', 'sample.mjs'), 'export const test = true;\n');
  await writeFile(path.join(root, 'scripts', 'sample.mjs'), 'process.exit(0);\n');
  git(root, ['init', '-b', 'fixture']);
  git(root, ['config', 'user.email', 'runner-fixture@example.invalid']);
  git(root, ['config', 'user.name', 'V4 Runner Fixture']);
  git(root, ['add', '--', 'src/sample.ts', 'tests/regression/sample.mjs', 'scripts/sample.mjs']);
  git(root, ['commit', '-m', 'fixture baseline']);
  return git(root, ['rev-parse', 'HEAD']);
}

async function testCheckoutBindings() {
  const root = await temporaryDirectory('iras-v4-git-');
  try {
    const baseline = await initGitFixture(root);
    const paths = ['src/sample.ts', 'tests/regression/sample.mjs', 'scripts/sample.mjs'];
    const directories = ['src', 'tests/regression', 'scripts'];
    const initial = await collectCheckoutIntegritySnapshot({
      root, gitExecutable: GIT, baselineCommit: baseline, reviewedCommit: baseline, paths, directories
    });
    assert.equal(initial.baselineAncestor, true);
    assert.equal(initial.reviewedAncestor, true);
    assert.equal(initial.fileRows.length, 3);
    assert.ok(initial.fileRows.every(row => row.gitBlob === row.reviewedBlob));

    await assert.rejects(
      collectCheckoutIntegritySnapshot({ root, gitExecutable: GIT, baselineCommit: baseline,
        reviewedCommit: baseline, paths: ['src/' + 'x'.repeat(20_000) + '.ts'], directories: [] }),
      /V4_GIT_STATUS_PATHSPEC_TOO_LARGE/
    );

    await writeFile(path.join(root, 'src', 'sample.ts'), 'export const value = 2;\n');
    await assert.rejects(
      collectCheckoutIntegritySnapshot({ root, gitExecutable: GIT, baselineCommit: baseline, reviewedCommit: baseline, paths, directories }),
      /V4_RELEVANT_TRACKED_FILES_DIRTY/
    );
    git(root, ['checkout', '--', 'src/sample.ts']);

    await writeFile(path.join(root, 'tests', 'regression', 'rogue.mjs'), 'process.exit(0);\n');
    await assert.rejects(
      collectCheckoutIntegritySnapshot({ root, gitExecutable: GIT, baselineCommit: baseline, reviewedCommit: baseline, paths, directories }),
      /V4_UNTRACKED_EXECUTABLE_INPUT/
    );
    await rm(path.join(root, 'tests', 'regression', 'rogue.mjs'));

    await writeFile(path.join(root, 'src', 'sample.ts'), 'export const value = 3;\n');
    git(root, ['add', '--', 'src/sample.ts']);
    git(root, ['commit', '-m', 'reviewed change']);
    const reviewed = git(root, ['rev-parse', 'HEAD']);
    await assert.rejects(
      collectCheckoutIntegritySnapshot({ root, gitExecutable: GIT, baselineCommit: baseline, reviewedCommit: baseline, paths, directories }),
      /V4_REVIEWED_GIT_BLOB_OWNERSHIP_MISMATCH/
    );
    const accepted = await collectCheckoutIntegritySnapshot({
      root, gitExecutable: GIT, baselineCommit: baseline, reviewedCommit: reviewed, paths, directories
    });
    assert.equal(accepted.head, reviewed);

    await writeFile(path.join(root, 'src', 'new-input.cts'), 'export const lateInput = true;\n');
    git(root, ['add', '--', 'src/new-input.cts']);
    git(root, ['commit', '-m', 'add executable extension after review']);
    const fullTrackedInventory = await collectTrackedExecutablePaths({ root, gitExecutable: GIT, directories });
    assert.ok(fullTrackedInventory.includes('src/new-input.cts'), 'tracked .cts files enter the reviewed inventory');
    await assert.rejects(
      collectCheckoutIntegritySnapshot({
        root, gitExecutable: GIT, baselineCommit: baseline, reviewedCommit: reviewed,
        paths: [...paths, 'src/new-input.cts'], directories
      }),
      /V4_GIT_COMMAND_FAILED:rev-parse/
    );

    git(root, ['checkout', '--detach', baseline]);
    await assert.rejects(
      collectCheckoutIntegritySnapshot({ root, gitExecutable: GIT, baselineCommit: baseline, reviewedCommit: reviewed, paths, directories }),
      /V4_REVIEWED_COMMIT_NOT_ANCESTOR_OF_HEAD/
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testActivationControls() {
  const candidate = await buildApprovedCaptureInventory();
  assert.equal(validateActivationInventory(candidate), true);
  assert.ok(candidate.length <= 60);
  for (const family of EVIDENCE_FAMILIES) {
    const rows = candidate.filter(row => row.family === family);
    assert.ok(rows.length > 0 && rows.length <= 10, `bounded approved inventory for ${family}`);
    assert.ok(rows.some(row => row.purpose === 'SOURCE'), `mapped source request for ${family}`);
    assert.ok(rows.some(row => row.purpose === 'DISCOVERY'), `explicit discovery request for ${family}`);
  }
  const source = candidate.find(row => row.purpose === 'SOURCE');
  const exactRequest = { family: source.family, url: source.url, method: source.method, headers: source.headers };
  assert.equal(matchCaptureInventoryRequest(exactRequest, candidate), source);
  assert.equal(matchCaptureInventoryRequest({ ...exactRequest, url: source.url + '?unreviewed=1' }, candidate), undefined,
    'inventory does not grant same-host path/query wildcards');
  assert.equal(matchCaptureInventoryRequest({ ...exactRequest, family: 'gst' }, candidate), undefined,
    'inventory is exact by family');
  assert.equal(matchCaptureInventoryRequest({ ...exactRequest, headers: { accept: 'text/html' } }, candidate), undefined,
    'inventory is exact by normalized headers');

  const target = 'https://www.iras.gov.sg/explicit-redirect-target';
  const redirect = { ...source, url: target, purpose: 'REDIRECT', redirectFrom: source.url };
  const redirectRequest = { ...exactRequest, url: target };
  assert.equal(matchCaptureInventoryRequest(redirectRequest, [redirect]), undefined,
    'redirect target requires an observed approved edge');
  assert.equal(matchCaptureInventoryRequest(redirectRequest, [redirect], new Map([[target, new Set([source.url])]])), redirect,
    'redirect target is allowed only after the exact source Location was observed');

  const redirectTargetRow = candidate.find(row => row.purpose === 'SOURCE' && row.family !== source.family);
  assert.ok(redirectTargetRow, 'The bounded inventory contains a second mapped official URL for redirect validation.');
  const explicitRedirect = {
    ...structuredClone(source),
    url: redirectTargetRow.url,
    purpose: 'REDIRECT',
    redirectFrom: source.url,
    provenance: structuredClone(source.provenance)
  };
  assert.equal(validateActivationInventory([...candidate, explicitRedirect]), true,
    'An explicit official target is valid when redirect provenance inherits from a same-family source parent.');
  assert.throws(() => validateActivationInventory([...candidate, {
    ...explicitRedirect,
    provenance: { ...explicitRedirect.provenance, topicIds: ['invented-topic'] }
  }]), /TOPIC_UNMAPPED|REDIRECT_PROVENANCE_NOT_INHERITED/);

  const body = { profile: ACTIVATION_PROFILE, frozen: true, capturePolicy: { maximumRequests: 60 } };
  const document = { ...body, activationConfigurationSha256: sha256(JSON.stringify(body)) };
  assert.equal(assertActivationConfigurationBodyMatches(document, body), true);
  const appended = { ...document, unbound: true };
  const appendedBody = { ...appended };
  delete appendedBody.activationConfigurationSha256;
  appended.activationConfigurationSha256 = sha256(JSON.stringify(appendedBody));
  assert.throws(() => assertActivationConfigurationBodyMatches(appended, body), /HAS_UNBOUND_FIELDS/);
  const changedPolicy = { ...document, capturePolicy: { maximumRequests: 61 } };
  const changedPolicyBody = { ...changedPolicy };
  delete changedPolicyBody.activationConfigurationSha256;
  changedPolicy.activationConfigurationSha256 = sha256(JSON.stringify(changedPolicyBody));
  assert.throws(() => assertActivationConfigurationBodyMatches(changedPolicy, body), /HAS_UNBOUND_FIELDS/);

  const prompt = 'frozen prompt';
  const system = 'frozen system';
  const caseId = CASE_IDS[0];
  const options = { jsonMode: true, responseJsonSchema: SEMANTIC_QUESTION_V2_RESPONSE_JSON_SCHEMA,
    timeoutMs: 8_000, temperature: 0 };
  const request = { caseId, prompt, system, provider: { activeProvider: 'gemini', gemini: { model: 'gemini-3.5-flash-lite' } },
    options, timeoutMs: 8_000 };
  const promptFingerprints = [{ caseId, promptSha256: sha256(prompt), systemSha256: sha256(system),
    schemaSha256: sha256(JSON.stringify(SEMANTIC_QUESTION_V2_RESPONSE_JSON_SCHEMA)) }];
  assert.equal(assertFrozenSemanticRequest(request, { caseId, promptFingerprints }), true);
  const requestWithOptionsTimeoutOnly = { ...request };
  delete requestWithOptionsTimeoutOnly.timeoutMs;
  assert.equal(assertFrozenSemanticRequest(requestWithOptionsTimeoutOnly, { caseId, promptFingerprints }), true,
    'The adapter carries the frozen timeout inside options before the runner binds its transport timeout.');
  assert.throws(() => assertFrozenSemanticRequest({ ...request, timeoutMs: 7_999 },
    { caseId, promptFingerprints }), /TIMEOUT_OPTION_MISMATCH/);
  assert.throws(() => assertFrozenSemanticRequest({ ...request, provider: { ...request.provider,
    gemini: { model: 'different-model' } } }, { caseId, promptFingerprints }), /MODEL_MISMATCH/);
  assert.throws(() => assertFrozenSemanticRequest({ ...request, prompt: prompt + ' altered' },
    { caseId, promptFingerprints }), /PROMPT_FINGERPRINT_MISMATCH/);

  const archivalPath = path.join(TEST_ROOT, ARTIFACT_ROOT, 'runner-configuration.json');
  const archival = JSON.parse(await readFile(archivalPath, 'utf8'));
  assert.equal(archival.captureInventory, null, 'historical frozen runner remains activation-null');
  assert.equal(archival.productionEvidenceAdapterSha256, null, 'historical frozen runner remains adapter-null');
  assert.equal(archival.preregistrationSha256, null, 'historical frozen runner remains preregistration-null');
}

async function testCheckoutStatusWindowsScale() {
  const root = await temporaryDirectory('iras-v4-status-scale-');
  try {
    const baseline = await initGitFixture(root);
    const monitoredRoot = path.join(root, 'monitored');
    await mkdir(monitoredRoot, { recursive: true });
    const directories = Array.from({ length: 2_200 }, (_, index) =>
      'monitored/d' + String(index).padStart(4, '0'));
    for (let offset = 0; offset < directories.length; offset += 128) {
      await Promise.all(directories.slice(offset, offset + 128).map(directory =>
        mkdir(path.join(root, directory))));
    }
    const paths = ['src/sample.ts'];
    const originalCommandArguments = [GIT, '-C', root, 'status', '--porcelain=v1', '-z',
      '--untracked-files=all', '--', ...directories, ...paths];
    const originalCommandCodeUnits = originalCommandArguments.reduce(
      (total, argument) => total + argument.length + 1, 0);
    assert.ok(originalCommandCodeUnits > 32_767,
      'scale fixture must cross the Windows CreateProcess command-line limit');

    await writeFile(path.join(root, 'src', 'sample.ts'), 'export const value = 2;\n');
    await assert.rejects(
      collectCheckoutIntegritySnapshot({ root, gitExecutable: GIT, baselineCommit: baseline,
        reviewedCommit: baseline, paths, directories }),
      /V4_RELEVANT_TRACKED_FILES_DIRTY/
    );
    git(root, ['checkout', '--', 'src/sample.ts']);

    const roguePath = path.join(root, directories[directories.length - 1], 'rogue.cts');
    await writeFile(roguePath, 'export const rogue = true;\n');
    await assert.rejects(
      collectCheckoutIntegritySnapshot({ root, gitExecutable: GIT, baselineCommit: baseline,
        reviewedCommit: baseline, paths, directories }),
      /V4_UNTRACKED_EXECUTABLE_INPUT/
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function testFrozenConfigurationGuards() {
  const base = { profile: RUNNER_PROFILE, status: 'FROZEN_RUNNER_CONFIGURATION', captureInventory: null };
  const valid = { ...base, integrityBindingSha256: digest(JSON.stringify(base)) };
  assert.equal(assertRunnerConfigurationBodyMatches(valid, valid), true);
  const appendedActivationFieldBody = { ...base, captureInventorySha256: digest(JSON.stringify([])) };
  const appendedActivationField = {
    ...appendedActivationFieldBody,
    integrityBindingSha256: digest(JSON.stringify(appendedActivationFieldBody))
  };
  assert.throws(() => assertRunnerConfigurationBodyMatches(appendedActivationField, valid),
    /V4_RUNNER_INTEGRITY_BINDING_MISMATCH/);

  const inventory = [{ family: 'gst', url: 'https://iras.gov.sg/gst' }];
  assert.equal(captureInventoryDigest(inventory), digest(JSON.stringify(inventory)),
    'capture lock and validator use the same JSON inventory digest');
  assert.throws(() => captureInventoryDigest(null), /V4_CAPTURE_INVENTORY_REQUIRED/);

  const subsequentImmutableFile = 'docs/evaluation/multi-authority-workstreams/newer-review-artifact.md';
  const protectedUnion = unionProtectedHistoryPaths(
    ['src/frozen-historical-file.ts'],
    [{ path: subsequentImmutableFile, sha256: digest('later immutable artifact') }],
    TEST_ROOT
  );
  assert.ok(protectedUnion.includes('src/frozen-historical-file.ts'));
  assert.ok(protectedUnion.includes(subsequentImmutableFile),
    'current immutable artifact rows join the 389 historical paths in the bound input set');
}

async function testControlledCaptureAndReplay() {
  const root = await temporaryDirectory('iras-v4-capture-');
  const paths = await artifactPaths(root, 'controlled');
  let liveCalls = 0;
  const transport = captureTransport(root, paths, async (url, init) => {
    liveCalls += 1;
    assert.equal(init.method, 'GET');
    assert.equal(init.redirect, 'manual');
    await stat(paths.markerPath);
    if (url.endsWith('/start')) {
      return new Response(null, { status: 302, headers: { location: 'https://www.iras.gov.sg/final', 'content-type': 'text/html' } });
    }
    if (url.endsWith('/final')) return new Response('official bytes', { status: 200, headers: { 'content-type': 'text/plain; charset=utf-8' } });
    return new Response('cached body', { status: 200, headers: { 'content-type': 'text/plain' } });
  });

  try {
    const result = await runBoundedCapture({
      transport,
      syntheticMode: true,
      execute: async ({ webRetriever, withEvidenceFamily }) => {
        await assert.rejects(globalThis.fetch('https://example.invalid'), /V4_AMBIENT_NETWORK_DISABLED/);
        assert.throws(() => http.request('https://example.invalid'), /V4_AMBIENT_NETWORK_DISABLED/);
        assert.throws(() => namedHttpRequest('https://example.invalid'), /V4_AMBIENT_NETWORK_DISABLED/);
        assert.throws(() => net.connect({ host: 'example.invalid', port: 443 }), /V4_AMBIENT_NETWORK_DISABLED/);
        assert.throws(() => namedNetConnect({ host: 'example.invalid', port: 443 }), /V4_AMBIENT_NETWORK_DISABLED/);
        assert.throws(() => tls.connect({ host: 'example.invalid', port: 443 }), /V4_AMBIENT_NETWORK_DISABLED/);
        const blockedSocket = new net.Socket();
        try { assert.throws(() => blockedSocket.connect(443, 'example.invalid'), /V4_AMBIENT_NETWORK_DISABLED/); }
        finally { blockedSocket.destroy(); }
        return await withEvidenceFamily('relief', async () => {
          const redirected = await webRetriever.fetchOfficialSource('https://iras.gov.sg/start', { useCache: false });
          assert.equal(redirected.status, 'SUCCESS');
          assert.equal(redirected.content, 'official bytes');
          const first = await webRetriever.fetchOfficialSource('https://iras.gov.sg/cache');
          const reused = await webRetriever.fetchOfficialSource('https://iras.gov.sg/cache');
          assert.equal(first.status, 'SUCCESS');
          assert.equal(reused.cached, true);
          return { redirected: redirected.finalUrl };
        });
      }
    });
    assert.equal(result.synthetic, true);
    assert.equal(liveCalls, 3, 'redirect is a separately counted HTTP request, cache hit is not');
    assert.equal(transport.requestCount, 3);
    assert.equal(transport.cacheReuses.length, 1);
    const payload = JSON.parse(await readFile(paths.payloadPath, 'utf8'));
    assert.equal(payload.entries.length, 3);
    assert.equal(payload.entries[0].status, 302);
    assert.equal(payload.entries[0].request.family, 'relief');
    assert.equal(payload.entries[0].actualUrl, 'https://iras.gov.sg/start');
    assert.equal(payload.entries[0].headers.location, 'https://www.iras.gov.sg/final');
    assert.equal(payload.entries[1].actualUrl, 'https://www.iras.gov.sg/final');
    assert.equal(payload.provenance.execPath, process.execPath);
    validateCapturePayload(payload, { syntheticMode: true });

    const replay = createReplayTransport({
      payload,
      syntheticMode: true,
      expectedIntegrityBindingSha256: payload.integrityBindingSha256,
      expectedPreregistrationSha256: payload.preregistrationSha256
    });
    const replayRetriever = bindProductionControlledRetriever({ transport: replay, cache: new SourceCache() });
    const replayed = await replay.withEvidenceFamily('relief', async () => {
      const first = await replayRetriever.fetchOfficialSource('https://iras.gov.sg/start', { useCache: false });
      const second = await replayRetriever.fetchOfficialSource('https://iras.gov.sg/start', { useCache: false });
      const cached = await replayRetriever.fetchOfficialSource('https://iras.gov.sg/cache');
      assert.equal(cached.content, 'cached body');
      return [first, second];
    });
    assert.equal(replayed[0].content, 'official bytes');
    assert.equal(replayed[1].content, 'official bytes', 'frozen response map supports repeat lookup');
    assert.equal(replay.replayLookupCount, 5);
    assert.equal(replay.unusedResponseCount, 0);
    assert.equal(replay.cacheReuses.length, 0);

    const miss = createReplayTransport({ payload, syntheticMode: true });
    const missRetriever = bindProductionControlledRetriever({ transport: miss, cache: new SourceCache() });
    let missError;
    try {
      await miss.withEvidenceFamily('relief', async () =>
        await missRetriever.fetchOfficialSource('https://iras.gov.sg/unrecorded', { useCache: false }));
    } catch (error) {
      missError = error;
    }
    assert.equal(missError?.message, 'V4_REPLAY_MISS',
      'the retriever catches the missing lookup, then the wrapper rethrows its terminal integrity latch');
    assert.equal(miss.terminalIntegrityFailure, 'V4_REPLAY_MISS',
      'a swallowed ControlledWebRetriever failure still trips the replay latch');
    assert.throws(() => miss.assertHealthy(), /V4_REPLAY_MISS/);

    const tampered = structuredClone(payload);
    tampered.entries[0].bodyBase64 = Buffer.from('tampered').toString('base64');
    assert.throws(() => validateCapturePayload(tampered, { syntheticMode: true }), /V4_CAPTURE_BODY_HASH_MISMATCH/);
    assert.throws(() => validateCapturePayload(payload, {
      syntheticMode: true,
      expectedIntegrityBindingSha256: digest('wrong')
    }), /V4_CAPTURE_BINDING_MISMATCH/);
    assert.throws(() => validateCapturePayload(payload, {
      syntheticMode: true,
      now: new Date(Date.now() + 25 * 60 * 60 * 1000)
    }), /V4_CAPTURE_EXPIRED_OR_FUTURE/);

    const wrongDate = structuredClone(payload);
    wrongDate.earliestAcquisitionAt = new Date(Date.now() - 60_000).toISOString();
    assert.throws(() => validateCapturePayload(wrongDate, { syntheticMode: true }), /V4_CAPTURE_EARLIEST_TIME_MISMATCH/);

    const conflict = structuredClone(payload);
    const duplicate = structuredClone(conflict.entries[1]);
    duplicate.bodyBase64 = Buffer.from('conflicting bytes').toString('base64');
    duplicate.bodySha256 = sha256(Buffer.from('conflicting bytes'));
    conflict.entries.push(duplicate);
    conflict.requestCount += 1;
    conflict.familyCounts.relief += 1;
    assert.throws(() => validateCapturePayload(conflict, { syntheticMode: true }), /V4_CAPTURE_CONFLICTING_DUPLICATE_IDENTITY/);

    const omittedSyntheticFlag = structuredClone(payload);
    delete omittedSyntheticFlag.synthetic;
    assert.throws(() => validateCapturePayload(omittedSyntheticFlag), /V4_CAPTURE_SYNTHETIC_MODE_MISMATCH/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testLiveHoldBeforeOutput() {
  const root = await temporaryDirectory('iras-v4-live-hold-');
  try {
    const paths = await artifactPaths(root, 'held-capture');
    let fetchCalls = 0;
    let executeCalls = 0;
    await assert.rejects(runBoundedCapture({
      transport: { synthetic: false, fetch: async () => { fetchCalls += 1; } },
      syntheticMode: false,
      runnerConfigurationPath: path.join(paths.directory, 'missing-runner-config.json'),
      execute: async () => { executeCalls += 1; }
    }), /V4_REVIEWED_EXECUTION_CAPABILITY_REQUIRED/);
    assert.equal(fetchCalls, 0);
    assert.equal(executeCalls, 0);
    await assert.rejects(stat(paths.markerPath), { code: 'ENOENT' });

    const outsideTarget = path.join(root, 'outside-target');
    await mkdir(outsideTarget);
    const linkedOutputDirectory = path.join(root, ARTIFACT_ROOT, 'symlink-output');
    await mkdir(path.dirname(linkedOutputDirectory), { recursive: true });
    await symlink(outsideTarget, linkedOutputDirectory, 'junction');
    const symlinkPaths = {
      directory: linkedOutputDirectory,
      markerPath: path.join(linkedOutputDirectory, 'capture-reserved.json'),
      journalPath: path.join(linkedOutputDirectory, 'capture-partial.jsonl'),
      payloadPath: path.join(linkedOutputDirectory, 'capture-payload.json')
    };
    const symlinkTransport = captureTransport(root, symlinkPaths, async () => {
      throw new Error('symlinked output must fail before dispatch');
    });
    await assert.rejects(runBoundedCapture({
      transport: symlinkTransport,
      syntheticMode: true,
      execute: async ({ withEvidenceFamily }) => await withEvidenceFamily('gst', () =>
        symlinkTransport.fetch('https://iras.gov.sg/symlink-output', {
          method: 'GET', redirect: 'manual', headers: { Accept: 'text/plain, application/json, text/html, */*' }
        }))
    }), /V4_CAPTURE_ALREADY_RESERVED_OR_OUTPUT_EXISTS/);
    assert.equal(symlinkTransport.requestCount, 0);
    await assert.rejects(stat(path.join(outsideTarget, 'capture-reserved.json')), { code: 'ENOENT' });

    const artifactDirectory = path.join(root, ARTIFACT_ROOT);
    const namespace = path.join(artifactDirectory, 'semantic-run-v4');
    await mkdir(namespace, { recursive: true });
    const preregistrationPath = path.join(artifactDirectory, 'fixture-preregistration.json');
    const preregistrationBytes = Buffer.from('{}');
    await writeFile(preregistrationPath, preregistrationBytes);
    const configurationPath = path.join(artifactDirectory, 'fixture-runner-configuration.json');
    await writeFile(configurationPath, JSON.stringify({
      semanticNamespace: ARTIFACT_ROOT + '/semantic-run-v4',
      preregistrationSha256: sha256(preregistrationBytes)
    }));
    const lockPath = path.join(artifactDirectory, 'fixture-lock.json');
    const payloadPath = path.join(artifactDirectory, 'fixture-payload.json');
    await writeFile(lockPath, '{}');
    await writeFile(payloadPath, '{}');
    let allowanceReads = 0;
    let semanticCalls = 0;
    await assert.rejects(runBoundedV4SemanticPhase({
      root,
      runnerConfigurationPath: configurationPath,
      preregistrationPath,
      evidenceLockPath: lockPath,
      capturePayloadPath: payloadPath,
      namespaceDirectory: namespace,
      authorizedGeminiCalls: 9,
      sharedAllowanceReader: async () => { allowanceReads += 1; return {}; },
      semanticTransport: async () => { semanticCalls += 1; return 'unexpected'; },
      executeCase: async () => ({})
    }), /V4_RUNNER_CONFIGURATION_PROFILE_INVALID/);
    assert.equal(allowanceReads, 0, 'runner integrity HOLD precedes external allowance lookup');
    assert.equal(semanticCalls, 0, 'runner integrity HOLD precedes provider dispatch');
    await assert.rejects(stat(path.join(namespace, 'consumed-v4.json')), { code: 'ENOENT' });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testCaptureBudgetsAndFailures() {
  const root = await temporaryDirectory('iras-v4-budgets-');
  try {
    const exactPaths = await artifactPaths(root, 'concurrent-exact-family-cap');
    let exactPreflights = 0;
    let releaseExactPreflight;
    const exactGate = new Promise(resolve => { releaseExactPreflight = resolve; });
    let exactDispatches = 0;
    const exactTransport = captureTransport(root, exactPaths, async () => {
      exactDispatches += 1;
      return new Response('bounded');
    }, {
      syntheticTestControls: {
        maximumRequests: 60,
        maximumRequestsPerFamily: 10,
        preDispatchPreflight: async () => {
          exactPreflights += 1;
          if (exactPreflights === 10) releaseExactPreflight();
          await exactGate;
        }
      }
    });
    await runBoundedCapture({
      transport: exactTransport,
      syntheticMode: true,
      execute: async ({ withEvidenceFamily }) => await Promise.all(Array.from({ length: 10 }, (_, index) =>
        withEvidenceFamily('gst', () => exactTransport.fetch(`https://iras.gov.sg/exact-${index}`, {
          method: 'GET', redirect: 'manual', headers: { Accept: 'text/plain, application/json, text/html, */*' }
        }))))
    });
    assert.equal(exactDispatches, 10);
    assert.equal(exactTransport.reservedRequestCount, 10);
    assert.equal(JSON.parse(await readFile(exactPaths.payloadPath, 'utf8')).familyCounts.gst, 10);

    const concurrentPaths = await artifactPaths(root, 'concurrent-family-budget');
    const concurrentLimit = 11;
    let concurrentPreflights = 0;
    let releaseConcurrentPreflight;
    const concurrentGate = new Promise(resolve => { releaseConcurrentPreflight = resolve; });
    let concurrentDispatches = 0;
    const concurrentTransport = captureTransport(root, concurrentPaths, async () => {
      concurrentDispatches += 1;
      return new Response('bounded');
    }, {
      syntheticTestControls: {
        maximumRequests: 60,
        maximumRequestsPerFamily: 10,
        preDispatchPreflight: async () => {
          concurrentPreflights += 1;
          if (concurrentPreflights === concurrentLimit) releaseConcurrentPreflight();
          await concurrentGate;
        }
      }
    });
    await assert.rejects(runBoundedCapture({
      transport: concurrentTransport,
      syntheticMode: true,
      execute: async ({ withEvidenceFamily }) => {
        const outcomes = await Promise.allSettled(Array.from({ length: concurrentLimit }, (_, index) =>
          withEvidenceFamily('gst', () => concurrentTransport.fetch(`https://iras.gov.sg/concurrent-${index}`, {
            method: 'GET', redirect: 'manual', headers: { Accept: 'text/plain, application/json, text/html, */*' }
          }))));
        assert.ok(outcomes.some(row => row.status === 'rejected'));
        throw outcomes.find(row => row.status === 'rejected').reason;
      }
    }), /V4_CAPTURE_FAMILY_BUDGET_EXCEEDED/);
    assert.equal(concurrentPreflights, concurrentLimit, 'calls reach the asynchronous preflight seam before slot reservation');
    assert.equal(concurrentTransport.reservedRequestCount, 10);
    assert.ok(concurrentDispatches <= 10, 'concurrent capture never dispatches beyond the family allowance');
    const concurrentPayload = JSON.parse(await readFile(concurrentPaths.payloadPath, 'utf8'));
    assert.ok(concurrentPayload.entries.length <= 10);
    assert.ok((concurrentPayload.familyCounts.gst || 0) <= 10);

    const totalPaths = await artifactPaths(root, 'concurrent-total-budget');
    const totalLimit = 16;
    let totalPreflights = 0;
    let releaseTotalPreflight;
    const totalGate = new Promise(resolve => { releaseTotalPreflight = resolve; });
    let totalDispatches = 0;
    const totalTransport = captureTransport(root, totalPaths, async () => {
      totalDispatches += 1;
      return new Response('bounded');
    }, {
      syntheticTestControls: {
        maximumRequests: 15,
        maximumRequestsPerFamily: 10,
        preDispatchPreflight: async () => {
          totalPreflights += 1;
          if (totalPreflights === totalLimit) releaseTotalPreflight();
          await totalGate;
        }
      }
    });
    await assert.rejects(runBoundedCapture({
      transport: totalTransport,
      syntheticMode: true,
      execute: async ({ withEvidenceFamily }) => {
        const sends = Array.from({ length: totalLimit }, (_, index) => {
          const family = index < 8 ? 'relief' : 'gst';
          return withEvidenceFamily(family, () => totalTransport.fetch(`https://iras.gov.sg/total-${index}`, {
            method: 'GET', redirect: 'manual', headers: { Accept: 'text/plain, application/json, text/html, */*' }
          }));
        });
        const outcomes = await Promise.allSettled(sends);
        assert.ok(outcomes.some(row => row.status === 'rejected'));
        throw outcomes.find(row => row.status === 'rejected').reason;
      }
    }), /V4_CAPTURE_REQUEST_BUDGET_EXCEEDED/);
    assert.equal(totalPreflights, totalLimit);
    assert.equal(totalTransport.reservedRequestCount, 15);
    assert.ok(totalDispatches <= 15, 'concurrent capture never dispatches beyond the total allowance');
    const totalPayload = JSON.parse(await readFile(totalPaths.payloadPath, 'utf8'));
    assert.ok(totalPayload.entries.length <= 15);

    for (const status of [404, 500]) {
      const httpFailurePaths = await artifactPaths(root, `http-${status}-retry`);
      let httpFailureCalls = 0;
      const httpFailureTransport = captureTransport(root, httpFailurePaths, async () => {
        httpFailureCalls += 1;
        return new Response('not found', { status, headers: { 'content-type': 'text/plain' } });
      });
      await assert.rejects(runBoundedCapture({
        transport: httpFailureTransport,
        syntheticMode: true,
        execute: async ({ webRetriever, withEvidenceFamily }) => await withEvidenceFamily('gst', async () => {
          const first = await webRetriever.fetchOfficialSource('https://iras.gov.sg/http-' + status, { useCache: false });
          assert.equal(first.status, 'HTTP_ERROR');
          return await webRetriever.fetchOfficialSource('https://iras.gov.sg/http-' + status, { useCache: false });
        })
      }), /V4_CAPTURE_RETRY_AFTER_FAILED_REQUEST_BLOCKED/);
      assert.equal(httpFailureCalls, 1, `HTTP ${status} identities are terminal and never retried`);
    }

    const paths = await artifactPaths(root, 'budget');
    let dispatches = 0;
    const transport = captureTransport(root, paths, async () => {
      dispatches += 1;
      return new Response('response', { status: 404, headers: { 'content-type': 'text/plain' } });
    });
    await assert.rejects(runBoundedCapture({
      transport,
      syntheticMode: true,
      execute: async ({ withEvidenceFamily }) => {
        for (const family of EVIDENCE_FAMILIES) {
          await withEvidenceFamily(family, async () => {
            for (let i = 0; i < 10; i += 1) {
              const response = await transport.fetch('https://iras.gov.sg/missing?i=' + family + i, {
                method: 'GET',
                redirect: 'manual',
                headers: { Accept: 'text/plain, application/json, text/html, */*' }
              });
              assert.equal(response.status, 404);
            }
          });
        }
        await withEvidenceFamily('relief', () =>
          transport.fetch('https://iras.gov.sg/over-budget', {
            method: 'GET',
            redirect: 'manual',
            headers: { Accept: 'text/plain, application/json, text/html, */*' }
          }));
      }
    }), /V4_CAPTURE_REQUEST_BUDGET_EXCEEDED/);
    assert.equal(dispatches, 60);
    assert.equal(transport.requestCount, 60);
    const capture = JSON.parse(await readFile(paths.payloadPath, 'utf8'));
    assert.equal(capture.requestCount, 60);
    assert.equal(capture.familyCounts.relief, 10);

    const retryPaths = await artifactPaths(root, 'failure-retry');
    let failedCalls = 0;
    const failedTransport = captureTransport(root, retryPaths, async () => {
      failedCalls += 1;
      throw new Error('offline fixture network failure');
    });
    await assert.rejects(runBoundedCapture({
      transport: failedTransport,
      syntheticMode: true,
      execute: async ({ webRetriever, withEvidenceFamily }) => await withEvidenceFamily('gst', () =>
        webRetriever.fetchOfficialSource('https://iras.gov.sg/fails', { useCache: false }))
    }), /V4_CAPTURE_ACQUISITION_NETWORK_ERROR/);
    assert.equal(failedCalls, 1);
    const failedPayload = JSON.parse(await readFile(retryPaths.payloadPath, 'utf8'));
    assert.equal(failedPayload.captureStatus, 'FAILED');
    assert.equal(failedPayload.entries[0].failure, 'NETWORK_ERROR');
    assert.throws(() => validateCapturePayload(failedPayload, { syntheticMode: true }), /V4_CAPTURE_INCOMPLETE/);

    const maliciousPaths = await artifactPaths(root, 'malicious-url');
    let maliciousCalls = 0;
    const maliciousTransport = captureTransport(root, maliciousPaths, async () => {
      maliciousCalls += 1;
      return new Response('should not run');
    });
    await assert.rejects(runBoundedCapture({
      transport: maliciousTransport,
      syntheticMode: true,
      execute: async ({ withEvidenceFamily }) => await withEvidenceFamily('gst', () =>
        maliciousTransport.fetch('http://attacker.example/page', {
          method: 'GET', redirect: 'manual', headers: { Accept: 'text/plain, application/json, text/html, */*' }
        }))
    }), /V4_CAPTURE_URL_BLOCKED/);
    assert.equal(maliciousCalls, 0);
    assert.equal(maliciousTransport.terminalIntegrityFailure, 'V4_CAPTURE_URL_BLOCKED');

    const redirectPaths = await artifactPaths(root, 'malicious-redirect');
    let redirectCalls = 0;
    const redirectTransport = captureTransport(root, redirectPaths, async () => {
      redirectCalls += 1;
      return new Response(null, { status: 302, headers: { location: 'https://attacker.example/escape' } });
    });
    await assert.rejects(runBoundedCapture({
      transport: redirectTransport,
      syntheticMode: true,
      execute: async ({ webRetriever, withEvidenceFamily }) => await withEvidenceFamily('gst', () =>
        webRetriever.fetchOfficialSource('https://iras.gov.sg/redirect-offsite', { useCache: false }))
    }), /V4_PRODUCTION_REDIRECT_REJECTED/);
    assert.equal(redirectCalls, 1);
    assert.equal(redirectTransport.terminalIntegrityFailure, 'V4_PRODUCTION_REDIRECT_REJECTED');

    const autoFollowPaths = await artifactPaths(root, 'auto-follow');
    const autoFollowTransport = captureTransport(root, autoFollowPaths, async _url =>
      addResponseUrl(new Response('hidden follow', { status: 200 }), 'https://www.iras.gov.sg/final'));
    await assert.rejects(runBoundedCapture({
      transport: autoFollowTransport,
      syntheticMode: true,
      execute: async ({ withEvidenceFamily }) => await withEvidenceFamily('gst', () =>
        autoFollowTransport.fetch('https://iras.gov.sg/hidden-follow', {
          method: 'GET', redirect: 'manual', headers: { Accept: 'text/plain, application/json, text/html, */*' }
        }))
    }), /V4_CAPTURE_UNEXPECTED_AUTO_FOLLOW/);
    const autoFollowPayload = JSON.parse(await readFile(autoFollowPaths.payloadPath, 'utf8'));
    assert.equal(autoFollowPayload.entries[0].failure, 'UNEXPECTED_AUTO_FOLLOW');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testCaptureDeadlineAndBodyLimit() {
  const root = await temporaryDirectory('iras-v4-limits-');
  try {
    const timeoutPaths = await artifactPaths(root, 'timeout');
    let timeoutStreamCancelled = false;
    const timeoutTransport = captureTransport(root, timeoutPaths, async () => new Response(new ReadableStream({
      start(controller) {
        setTimeout(() => {
          if (!timeoutStreamCancelled) {
            controller.enqueue(new TextEncoder().encode('late'));
            controller.close();
          }
        }, 100);
      },
      cancel() { timeoutStreamCancelled = true; }
    })), { syntheticTestControls: { timeoutMs: 15 } });
    await assert.rejects(runBoundedCapture({
      transport: timeoutTransport,
      syntheticMode: true,
      execute: async ({ withEvidenceFamily }) => await withEvidenceFamily('relief', () =>
        timeoutTransport.fetch('https://iras.gov.sg/slow', {
          method: 'GET', redirect: 'manual', headers: { Accept: 'text/plain, application/json, text/html, */*' }
        }))
    }), /V4_CAPTURE_DEADLINE_EXCEEDED/);
    assert.equal(timeoutTransport.requestCount, 1);
    const timeoutPayload = JSON.parse(await readFile(timeoutPaths.payloadPath, 'utf8'));
    assert.equal(timeoutPayload.entries[0].failure, 'TIMEOUT');

    const oversizedPaths = await artifactPaths(root, 'oversized');
    const oversizedTransport = captureTransport(root, oversizedPaths, async () =>
      new Response('12345', { status: 200 }), { syntheticTestControls: { maximumResponseBytes: 4 } });
    await assert.rejects(runBoundedCapture({
      transport: oversizedTransport,
      syntheticMode: true,
      execute: async ({ withEvidenceFamily }) => await withEvidenceFamily('relief', () =>
        oversizedTransport.fetch('https://iras.gov.sg/oversized', {
          method: 'GET', redirect: 'manual', headers: { Accept: 'text/plain, application/json, text/html, */*' }
        }))
    }), /V4_CAPTURE_RESPONSE_TOO_LARGE/);
    const oversizedPayload = JSON.parse(await readFile(oversizedPaths.payloadPath, 'utf8'));
    assert.equal(oversizedPayload.entries[0].failure, 'RESPONSE_TOO_LARGE');

    const stalledCancelPaths = await artifactPaths(root, 'stalled-cancel-timeout');
    const stalledCancelTransport = captureTransport(root, stalledCancelPaths, async () => new Response(new ReadableStream({
      start(controller) { controller.enqueue(Buffer.from('capture-prefix')); },
      cancel() { return new Promise(() => {}); }
    }), { status: 200 }), { syntheticTestControls: { timeoutMs: 20 } });
    const timeoutStartedAt = Date.now();
    const stalledCapture = runBoundedCapture({
      transport: stalledCancelTransport,
      syntheticMode: true,
      execute: async ({ withEvidenceFamily }) => await withEvidenceFamily('relief', () =>
        stalledCancelTransport.fetch('https://iras.gov.sg/stalled-cancel-timeout', {
          method: 'GET', redirect: 'manual', headers: { Accept: 'text/plain, application/json, text/html, */*' }
        }))
    });
    await assert.rejects(Promise.race([
      stalledCapture,
      new Promise((_, reject) => setTimeout(() => reject(new Error('V4_CAPTURE_CANCEL_CLEANUP_HUNG')), 250))
    ]), /V4_CAPTURE_DEADLINE_EXCEEDED/);
    assert.ok(Date.now() - timeoutStartedAt < 250, 'capture deadline does not wait for a stalled stream cancel');
    const stalledCapturePayload = JSON.parse(await readFile(stalledCancelPaths.payloadPath, 'utf8'));
    const partialCapture = stalledCapturePayload.entries[0].partialResponse;
    assert.equal(partialCapture.bodyBase64, Buffer.from('capture-prefix').toString('base64'));
    assert.equal(partialCapture.bodySha256, sha256(Buffer.from('capture-prefix')));
    assert.equal(partialCapture.bodyBytes, Buffer.byteLength('capture-prefix'));
    validateCapturePayload(stalledCapturePayload, { syntheticMode: true, requireComplete: false });

    const stalledOverflowPaths = await artifactPaths(root, 'stalled-cancel-overflow');
    const stalledOverflowTransport = captureTransport(root, stalledOverflowPaths, async () => new Response(new ReadableStream({
      start(controller) { controller.enqueue(Buffer.from('12345')); },
      cancel() { return new Promise(() => {}); }
    }), { status: 200 }), { syntheticTestControls: { maximumResponseBytes: 4 } });
    const overflowStartedAt = Date.now();
    await assert.rejects(Promise.race([
      runBoundedCapture({
        transport: stalledOverflowTransport,
        syntheticMode: true,
        execute: async ({ withEvidenceFamily }) => await withEvidenceFamily('relief', () =>
          stalledOverflowTransport.fetch('https://iras.gov.sg/stalled-cancel-overflow', {
            method: 'GET', redirect: 'manual', headers: { Accept: 'text/plain, application/json, text/html, */*' }
          }))
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('V4_CAPTURE_CANCEL_CLEANUP_HUNG')), 250))
    ]), /V4_CAPTURE_RESPONSE_TOO_LARGE/);
    assert.ok(Date.now() - overflowStartedAt < 250, 'capture overflow cleanup is nonblocking');
    const stalledOverflowPayload = JSON.parse(await readFile(stalledOverflowPaths.payloadPath, 'utf8'));
    assert.equal(stalledOverflowPayload.entries[0].partialResponse.bodyBase64, Buffer.from('1234').toString('base64'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testCaseLoopAndOneUseReservation() {
  let clockValue = 0;
  const startTimes = [];
  const rawSemanticBytes = Buffer.from([0xff, 0xfe, 0x61]);
  const previousFetch = globalThis.fetch;
  let authorizedFetchCalls = 0;
  globalThis.fetch = async () => {
    authorizedFetchCalls += 1;
    return new Response(rawSemanticBytes, { status: 200 });
  };
  let loop;
  try {
    loop = await runOfflineSyntheticV4CaseLoop({
      synthetic: true,
      minimumStartGapMs: 15_250,
      clock: () => clockValue,
      sleep: async ms => { clockValue += ms; },
      semanticTransport: async ({ caseId }) => {
        startTimes.push({ caseId, at: clockValue });
        return await globalThis.fetch('https://example.invalid');
      },
      referenceDate: '2026-10-01',
      executeCase: async ({ caseId, sendSemantic, referenceDate }) => {
        assert.equal(referenceDate, '2026-10-01', 'fixed loop forwards bound evidence reference date');
        await assert.rejects(globalThis.fetch('https://example.invalid'), /V4_AMBIENT_NETWORK_DISABLED/);
        assert.equal(typeof await sendSemantic({ caseId, prompt: 'synthetic only' }), 'string');
        return passingSyntheticCaseResult(caseId);
      }
    });
  } finally {
    globalThis.fetch = previousFetch;
  }
  assert.deepEqual(loop.rows.map(row => row.caseId), CASE_IDS);
  assert.equal(loop.status, 'PASSED');
  assert.deepEqual(loop.callCounts, Object.fromEntries(CASE_IDS.map(id => [id, 1])));
  assert.equal(authorizedFetchCalls, CASE_IDS.length);
  assert.equal(loop.rows[0].semanticResponseSha256, sha256(rawSemanticBytes), 'response identity uses original response bytes');
  assert.equal(loop.rows[0].semanticResponseBytes, rawSemanticBytes.length);
  assert.equal(loop.rows[0].semanticResponseBase64, rawSemanticBytes.toString('base64'),
    'partial journal result retains exact successful semantic bytes');
  assert.equal(loop.rows[0].actualResult.caseId, CASE_IDS[0], 'actual bounded case result is retained');
  for (let i = 1; i < startTimes.length; i += 1) {
    assert.ok(startTimes[i].at - startTimes[i - 1].at >= 15_250);
  }

  const scoredFailureProgress = [];
  let scoredFailureSends = 0;
  const scoredFailure = await runOfflineSyntheticV4CaseLoop({
    synthetic: true,
    referenceDate: '2026-10-01',
    semanticTransport: async ({ caseId }) => { scoredFailureSends += 1; return `actual-${caseId}`; },
    executeCase: async ({ caseId, sendSemantic }) => {
      const raw = await sendSemantic({ caseId });
      const result = passingSyntheticCaseResult(caseId);
      result.observedSemanticResponse = raw;
      if (caseId === CASE_IDS[0]) {
        result.layerVerdicts.semantic.stages.SEMANTIC_VALIDATION = false;
        result.firstFailure = null;
      }
      return result;
    },
    writeProgress: async row => scoredFailureProgress.push(row)
  });
  assert.equal(scoredFailure.status, 'FAILED');
  assert.equal(scoredFailureSends, CASE_IDS.length, 'scored semantic failures are retained while bounded cases continue');
  assert.equal(scoredFailure.rows[0].failure.stage, 'SEMANTIC_VALIDATION');
  assert.equal(scoredFailure.rows[0].actualResult.layerVerdicts.semantic.stages.SEMANTIC_VALIDATION, false);
  assert.equal(scoredFailure.rows[0].stageVerdicts.SEMANTIC_VALIDATION, false,
    'Canonical stage verdicts are recomputed from the five production layer outputs.');
  assert.equal(scoredFailure.rows[0].failure.code, 'V4_ACCEPTANCE_STAGE_VERDICTS_MISMATCH',
    'Contradictory adapter stage claims are attributed as an acceptance scoring error.');
  assert.equal(Object.keys(scoredFailure.rows[0].stageVerdicts).length, FAILURE_STAGES.length);
  assert.equal(scoredFailure.rows[0].semanticResponseBase64, Buffer.from(`actual-${CASE_IDS[0]}`).toString('base64'));
  assert.equal(scoredFailureProgress.find(row => row.event === 'CASE_FAILED').actualResult.caseId, CASE_IDS[0]);

  const providerFailureProgress = [];
  const providerFailureBytes = Buffer.from('{"error":"synthetic"}', 'utf8');
  const providerFailure = await runOfflineSyntheticV4CaseLoop({
    synthetic: true,
    semanticTransport: async () => {
      const error = new Error('V4_PROVIDER_HTTP_429');
      error.partialProviderResponse = {
        kind: 'GEMINI_HTTP_ENVELOPE', status: 429, failureCode: error.message, truncated: false,
        bodyBase64: providerFailureBytes.toString('base64'), bodySha256: sha256(providerFailureBytes),
        bodyBytes: providerFailureBytes.length
      };
      throw error;
    },
    executeCase: async ({ caseId, sendSemantic }) => {
      await sendSemantic({ caseId }).catch(() => {});
      return passingSyntheticCaseResult(caseId);
    },
    writeProgress: async row => providerFailureProgress.push(row)
  });
  assert.equal(providerFailure.rows[0].failure.stage, 'SEMANTIC_TRANSPORT',
    'A swallowed provider failure remains the primary cause over the adapter semantic fallback.');
  assert.equal(providerFailure.rows[0].providerResponsePartial.bodyBase64, providerFailureBytes.toString('base64'));
  assert.equal(providerFailure.rows[0].semanticResponseBase64, undefined,
    'Provider HTTP bytes are never mislabeled as successful semantic response bytes.');
  const providerFailureEvent = providerFailureProgress.find(row => row.event === 'SEMANTIC_RESPONSE_FAILED');
  assert.equal(providerFailureEvent.partialProviderResponse.kind, 'GEMINI_HTTP_ENVELOPE');
  assert.equal(providerFailureEvent.partialSemanticResponseBase64, undefined);
  assert.equal(providerFailure.rows[1].status, 'NOT_RUN_AFTER_PRIOR_FAILURE');

  let replayLatched = false;
  let latchedSemanticCalls = 0;
  const latchedResult = await runOfflineSyntheticV4CaseLoop({
    synthetic: true,
    semanticTransport: async ({ caseId }) => { latchedSemanticCalls += 1; return `offline-${caseId}`; },
    assertCaseHealth: () => { if (replayLatched) throw new Error('V4_REPLAY_MISS'); },
    executeCase: async ({ caseId, sendSemantic }) => {
      const observed = await sendSemantic({ caseId });
      const result = passingSyntheticCaseResult(caseId);
      result.observedSemanticResponse = observed;
      replayLatched = true;
      return result;
    }
  });
  assert.equal(latchedResult.rows[0].failure.stage, 'INTEGRITY');
  assert.equal(latchedResult.rows[0].actualResult.observedSemanticResponse, `offline-${CASE_IDS[0]}`,
    'A post-case integrity latch preserves the completed bounded production-shaped result.');
  assert.equal(latchedResult.rows[1].status, 'NOT_RUN_AFTER_PRIOR_FAILURE');
  assert.equal(latchedSemanticCalls, 1, 'A latched evidence replay stops remaining semantic sends immediately.');

  let semanticDispatches = 0;
  const duplicateOutcome = await runOfflineSyntheticV4CaseLoop({
    synthetic: true,
    semanticTransport: async () => {
      semanticDispatches += 1;
      return 'response';
    },
    executeCase: async ({ caseId, sendSemantic }) => {
      if (caseId === CASE_IDS[0]) {
        await Promise.all([
          sendSemantic({ prompt: 'first' }),
          sendSemantic({ prompt: 'retry' })
        ]);
      }
      return await sendSemantic({ prompt: 'single call' });
    }
  });
  assert.equal(semanticDispatches, 1);
  assert.equal(duplicateOutcome.status, 'FAILED');
  assert.equal(duplicateOutcome.rows[0].failure.stage, 'CASE_EXECUTION');

  let timeoutCalls = 0;
  const timeoutOutcome = await runOfflineSyntheticV4CaseLoop({
    synthetic: true,
    timeoutMs: 15,
    semanticTransport: async () => {
      timeoutCalls += 1;
      return await new Promise(resolve => setTimeout(() => resolve('late'), 100));
    },
    executeCase: async ({ caseId, sendSemantic }) => await sendSemantic({ caseId })
  });
  assert.equal(timeoutCalls, 1);
  assert.equal(timeoutOutcome.rows[0].failure.stage, 'SEMANTIC_TRANSPORT');
  assert.equal(timeoutOutcome.rows[0].failure.code, 'V4_SEMANTIC_DEADLINE_EXCEEDED');

  const oversizedOutcome = await runOfflineSyntheticV4CaseLoop({
    synthetic: true,
    maximumResponseBytes: 8,
    semanticTransport: async () => 'response-too-large',
    executeCase: async ({ caseId, sendSemantic }) => await sendSemantic({ caseId })
  });
  assert.equal(oversizedOutcome.rows[0].failure.code, 'V4_SEMANTIC_RESPONSE_TOO_LARGE');

  const semanticTimeoutPrefix = Buffer.from('semantic-prefix');
  const semanticTimeoutProgress = [];
  const semanticTimeoutStarted = Date.now();
  const stalledStreamOutcome = await Promise.race([
    runOfflineSyntheticV4CaseLoop({
      synthetic: true,
      timeoutMs: 20,
      semanticTransport: async () => new Response(new ReadableStream({
        start(controller) { controller.enqueue(semanticTimeoutPrefix); },
        cancel() { return new Promise(() => {}); }
      }), { status: 200 }),
      executeCase: async ({ caseId, sendSemantic }) => await sendSemantic({ caseId }),
      writeProgress: async row => semanticTimeoutProgress.push(row)
    }),
    new Promise((_, reject) => setTimeout(() => reject(new Error('V4_SEMANTIC_CANCEL_CLEANUP_HUNG')), 250))
  ]);
  assert.equal(stalledStreamOutcome.rows[0].failure.code, 'V4_SEMANTIC_DEADLINE_EXCEEDED');
  assert.ok(Date.now() - semanticTimeoutStarted < 250, 'semantic deadline does not await a stalled stream cancel');
  const semanticTimeoutFailure = semanticTimeoutProgress.find(row => row.event === 'SEMANTIC_RESPONSE_FAILED');
  assert.equal(semanticTimeoutFailure.partialSemanticResponseBase64, semanticTimeoutPrefix.toString('base64'));
  assert.equal(semanticTimeoutFailure.partialSemanticResponseSha256, sha256(semanticTimeoutPrefix));
  assert.equal(semanticTimeoutFailure.partialSemanticResponseBytes, semanticTimeoutPrefix.length);

  const semanticOverflowProgress = [];
  const semanticOverflowOutcome = await runOfflineSyntheticV4CaseLoop({
    synthetic: true,
    maximumResponseBytes: 4,
    semanticTransport: async () => new Response(new ReadableStream({
      start(controller) { controller.enqueue(Buffer.from('12345')); },
      cancel() { return new Promise(() => {}); }
    }), { status: 200 }),
    executeCase: async ({ caseId, sendSemantic }) => await sendSemantic({ caseId }),
    writeProgress: async row => semanticOverflowProgress.push(row)
  });
  assert.equal(semanticOverflowOutcome.rows[0].failure.code, 'V4_SEMANTIC_RESPONSE_TOO_LARGE');
  const semanticOverflowFailure = semanticOverflowProgress.find(row => row.event === 'SEMANTIC_RESPONSE_FAILED');
  assert.equal(semanticOverflowFailure.partialSemanticResponseBase64, Buffer.from('1234').toString('base64'));
  assert.equal(semanticOverflowFailure.partialSemanticResponseSha256, sha256(Buffer.from('1234')));
  assert.equal(semanticOverflowFailure.partialSemanticResponseBytes, 4);

  const root = await temporaryDirectory('iras-v4-reserve-');
  try {
    const namespace = path.join(root, ARTIFACT_ROOT, 'semantic-run-v4');
    await mkdir(namespace, { recursive: true });
    const hash = digest('binding');
    const binding = {
      preregistrationSha256: hash,
      contractSha256: hash,
      evidenceLockSha256: hash,
      productionFingerprintSha256: hash,
      sourceFingerprintSha256: hash,
      schemaPromptFingerprintSha256: hash,
      protectedHistorySha256: hash,
      evaluationFingerprintSha256: hash,
      sharedAllowanceObservation: { authorizedGeminiCalls: 9 }
    };
    const preflight = { passed: true };
    const reservations = await Promise.allSettled([
      reserveConsumption(namespace, binding, preflight),
      reserveConsumption(namespace, binding, preflight)
    ]);
    assert.equal(reservations.filter(row => row.status === 'fulfilled').length, 1);
    assert.equal(reservations.filter(row => row.status === 'rejected').length, 1);
    const consumed = path.join(namespace, 'consumed-v4.json');
    await stat(consumed);
    await assert.rejects(reserveConsumption(namespace, binding, preflight), /V4_NAMESPACE_ALREADY_USED/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function main() {
  assert.equal(RUNNER_PROFILE, 'iras-v4-runner-integrity');
  assert.equal(CASE_EVIDENCE_FAMILY['wht-royalty-general-rule'], 'withholding-tax');
  assert.equal(BASELINE_COMMIT, '42637dfb552dae45ed3cb72f4f495d6528a14272');
  assert.equal(path.resolve(TEST_ROOT), TEST_ROOT);
  await testActivationControls();
  await testProviderEnvelopeFailureRetention();
  await testActualAdapterInFixedCaseLoop();
  testFrozenConfigurationGuards();
  await testCheckoutBindings();
  await testCheckoutStatusWindowsScale();
  await testControlledCaptureAndReplay();
  await testLiveHoldBeforeOutput();
  await testCaptureBudgetsAndFailures();
  await testCaptureDeadlineAndBodyLimit();
  await testCaseLoopAndOneUseReservation();
  process.stdout.write('V4 capture/replay runner regression passed\n');
}

await main();
