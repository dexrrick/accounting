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
  CASE_EVIDENCE_FAMILY,
  EVIDENCE_FAMILIES,
  RUNNER_PROFILE,
  assertRunnerConfigurationBodyMatches,
  captureInventoryDigest,
  collectTrackedExecutablePaths,
  bindProductionControlledRetriever,
  collectCheckoutIntegritySnapshot,
  createCaptureTransport,
  createReplayTransport,
  runBoundedCapture,
  runBoundedV4SemanticPhase,
  runOfflineSyntheticV4CaseLoop,
  sha256,
  unionProtectedHistoryPaths,
  validateCapturePayload
} from '../../scripts/iras_v4_capture_replay_runner.mjs';
import {
  CASE_IDS,
  reserveConsumption
} from '../evaluation/singapore/iras-first-targeted-acceptance-v4.mjs';

const TEST_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const GIT = process.env.CODEX_GIT_EXECUTABLE ||
  'C:/Users/Admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/native/git/cmd/git.exe';
const ARTIFACT_ROOT = 'artifacts/iras-v4-runner-integrity-2026-10-06';

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
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
    }), /V4_LIVE_CAPTURE_REQUIRES_RECOMPUTED_REVIEWED_PERMIT/);
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
      execute: async ({ webRetriever, withEvidenceFamily }) => await withEvidenceFamily('gst', async () => {
        const first = await webRetriever.fetchOfficialSource('https://iras.gov.sg/fails', { useCache: false });
        assert.equal(first.status, 'NETWORK_ERROR');
        return await webRetriever.fetchOfficialSource('https://iras.gov.sg/fails', { useCache: false });
      })
    }), /V4_CAPTURE_RETRY_AFTER_FAILED_REQUEST_BLOCKED/);
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
      executeCase: async ({ caseId, sendSemantic }) => {
        await assert.rejects(globalThis.fetch('https://example.invalid'), /V4_AMBIENT_NETWORK_DISABLED/);
        assert.equal(typeof await sendSemantic({ caseId, prompt: 'synthetic only' }), 'string');
        return { caseId };
      }
    });
  } finally {
    globalThis.fetch = previousFetch;
  }
  assert.deepEqual(loop.rows.map(row => row.caseId), CASE_IDS);
  assert.deepEqual(loop.callCounts, Object.fromEntries(CASE_IDS.map(id => [id, 1])));
  assert.equal(authorizedFetchCalls, CASE_IDS.length);
  assert.equal(loop.rows[0].semanticResponseSha256, sha256(rawSemanticBytes), 'response identity uses original response bytes');
  assert.equal(loop.rows[0].semanticResponseBytes, rawSemanticBytes.length);
  for (let i = 1; i < startTimes.length; i += 1) {
    assert.ok(startTimes[i].at - startTimes[i - 1].at >= 15_250);
  }

  let semanticDispatches = 0;
  await assert.rejects(runOfflineSyntheticV4CaseLoop({
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
  }), /V4_EXTRA_OR_RETRY_SEMANTIC_CALL_BLOCKED/);
  assert.equal(semanticDispatches, 1);

  let timeoutCalls = 0;
  await assert.rejects(runOfflineSyntheticV4CaseLoop({
    synthetic: true,
    timeoutMs: 15,
    semanticTransport: async () => {
      timeoutCalls += 1;
      return await new Promise(resolve => setTimeout(() => resolve('late'), 100));
    },
    executeCase: async ({ caseId, sendSemantic }) => await sendSemantic({ caseId })
  }), /V4_SEMANTIC_DEADLINE_EXCEEDED/);
  assert.equal(timeoutCalls, 1);

  await assert.rejects(runOfflineSyntheticV4CaseLoop({
    synthetic: true,
    maximumResponseBytes: 8,
    semanticTransport: async () => 'response-too-large',
    executeCase: async ({ caseId, sendSemantic }) => await sendSemantic({ caseId })
  }), /V4_SEMANTIC_RESPONSE_TOO_LARGE/);

  const semanticTimeoutPrefix = Buffer.from('semantic-prefix');
  const semanticTimeoutProgress = [];
  const semanticTimeoutStarted = Date.now();
  await assert.rejects(Promise.race([
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
  ]), /V4_SEMANTIC_DEADLINE_EXCEEDED/);
  assert.ok(Date.now() - semanticTimeoutStarted < 250, 'semantic deadline does not await a stalled stream cancel');
  const semanticTimeoutFailure = semanticTimeoutProgress.find(row => row.event === 'SEMANTIC_RESPONSE_FAILED');
  assert.equal(semanticTimeoutFailure.partialResponseBase64, semanticTimeoutPrefix.toString('base64'));
  assert.equal(semanticTimeoutFailure.partialResponseSha256, sha256(semanticTimeoutPrefix));
  assert.equal(semanticTimeoutFailure.partialResponseBytes, semanticTimeoutPrefix.length);

  const semanticOverflowProgress = [];
  await assert.rejects(runOfflineSyntheticV4CaseLoop({
    synthetic: true,
    maximumResponseBytes: 4,
    semanticTransport: async () => new Response(new ReadableStream({
      start(controller) { controller.enqueue(Buffer.from('12345')); },
      cancel() { return new Promise(() => {}); }
    }), { status: 200 }),
    executeCase: async ({ caseId, sendSemantic }) => await sendSemantic({ caseId }),
    writeProgress: async row => semanticOverflowProgress.push(row)
  }), /V4_SEMANTIC_RESPONSE_TOO_LARGE/);
  const semanticOverflowFailure = semanticOverflowProgress.find(row => row.event === 'SEMANTIC_RESPONSE_FAILED');
  assert.equal(semanticOverflowFailure.partialResponseBase64, Buffer.from('1234').toString('base64'));
  assert.equal(semanticOverflowFailure.partialResponseSha256, sha256(Buffer.from('1234')));
  assert.equal(semanticOverflowFailure.partialResponseBytes, 4);

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
