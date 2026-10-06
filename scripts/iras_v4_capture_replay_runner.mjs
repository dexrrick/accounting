// Bounded V4 integrity runner. The CLI is offline-check only; this file does not
// start evidence capture, a provider request, or targeted acceptance by itself.
import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, lstat, mkdir, open, readFile, readdir, realpath, stat } from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import tls from 'node:tls';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  buildDesignFingerprints,
  CASE_IDS,
  FUTURE_EVIDENCE_POLICY,
  PROFILE as V4_PROFILE,
  RESOURCE_POLICY,
  createRequestBudgetGuard,
  protectedHistorySnapshot,
  reserveConsumption,
  validateV4LivePreflight
} from '../tests/evaluation/singapore/iras-first-targeted-acceptance-v4.mjs';
import { ControlledWebRetriever } from '../src/retrieval/controlledWebRetriever.ts';
import { SourceCache } from '../src/retrieval/sourceCache.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const RUNNER_PROFILE = 'iras-v4-runner-integrity';
export const RUNNER_CONFIGURATION_STATUS = 'FROZEN_RUNNER_CONFIGURATION';
export const BASELINE_COMMIT = '42637dfb552dae45ed3cb72f4f495d6528a14272';
export const EXPECTED_BRANCH = 'codex/multi-authority-workstreams';
export const EXECUTION_NODE_MAJOR = 22;
export const CAPTURE_POLICY = Object.freeze({
  transportMode: 'frozenContemporaneousCapture',
  evidenceMode: 'governedProductionEvidence',
  maximumRequests: 60,
  maximumRequestsPerFamily: 10,
  maximumResponseBytes: 2_000_000,
  timeoutMs: 3_000,
  redirects: 'manual',
  retries: 0,
  allowedHosts: Object.freeze(['iras.gov.sg', 'www.iras.gov.sg']),
  allowedRequestHeaders: Object.freeze(['accept', 'if-modified-since', 'if-none-match']),
  allowedResponseHeaders: Object.freeze(['cache-control', 'content-type', 'etag', 'last-modified', 'location']),
  maximumCacheReuses: 60,
  maximumReplayLookups: 60,
  maximumCaptureAgeHours: 24
});
export const EVIDENCE_FAMILIES = Object.freeze([
  'relief', 'private-expense', 'foreign-income', 'corporate-residency', 'withholding-tax', 'gst'
]);
export const CASE_EVIDENCE_FAMILY = Object.freeze({
  'target-relief-entitlement': 'relief',
  'target-relief-amount': 'relief',
  'A-paraphrase-2': 'relief',
  'private-expense-treatment': 'private-expense',
  'foreign-dividend-receipt-treatment': 'foreign-income',
  'corporate-residency-general-rule': 'corporate-residency',
  'wht-royalty-general-rule': 'withholding-tax',
  'gst-input-tax-general-rule': 'gst'
});
const reviewedAcquisitionPermits = new WeakSet();

const SHA256_RE = /^[a-f0-9]{64}$/i;
const ACCEPT_HEADER = 'text/plain, application/json, text/html, */*';
const NETWORK_DISABLED_MESSAGE = 'V4_AMBIENT_NETWORK_DISABLED';
const MAX_GIT_OUTPUT_BYTES = 8 * 1024 * 1024;
const EXTRA_BINDINGS = Object.freeze([
  'AGENTS.md',
  'package.json',
  'package-lock.json',
  '.gitattributes',
  'scripts/iras_v4_capture_replay_runner.mjs',
  'tests/regression/test_iras_v4_capture_replay_runner.mjs',
  'docs/evaluation/multi-authority-workstreams/iras-first-targeted-acceptance-2026-10-04-v4/acceptance-design.md',
  'artifacts/iras-v4-runner-integrity-2026-10-06/design.md'
]);
const TRACKED_DIRS = Object.freeze(['src', 'tests/evaluation/singapore', 'tests/regression', 'scripts']);
const ARTIFACT_NAMESPACE = 'artifacts/iras-v4-runner-integrity-2026-10-06/';
let ambientNetworkBlockInProgress = false;
const explicitTransportNetworkContext = new AsyncLocalStorage();
const EXPLICIT_TRANSPORT_NETWORK_CAPABILITY = Symbol('reviewed-transport-call');

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function hasControlCharacters(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function stableJson(value) {
  return JSON.stringify(value);
}

export function captureInventoryDigest(captureInventory) {
  assert.ok(Array.isArray(captureInventory), 'V4_CAPTURE_INVENTORY_REQUIRED');
  return sha256(stableJson(captureInventory));
}

function normalizedRelative(root, target) {
  const absolute = path.resolve(root, target);
  const relative = path.relative(root, absolute);
  assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative), 'V4_PATH_OUTSIDE_REPOSITORY');
  return relative.split(path.sep).join('/');
}

async function assertNoSymlinkPath(root, target, { mustExist = true } = {}) {
  const rootReal = await realpath(root);
  const absolute = path.resolve(root, target);
  const relative = path.relative(path.resolve(root), absolute);
  assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative), 'V4_PATH_OUTSIDE_REPOSITORY');
  let cursor = path.resolve(root);
  for (const component of relative.split(path.sep)) {
    cursor = path.join(cursor, component);
    try {
      const info = await lstat(cursor);
      assert.equal(info.isSymbolicLink(), false, 'V4_BOUND_PATH_SYMLINK_REJECTED:' + relative);
    } catch (error) {
      if (!mustExist && error?.code === 'ENOENT') break;
      throw error;
    }
  }
  if (mustExist) {
    const targetReal = await realpath(absolute);
    const fromRoot = path.relative(rootReal, targetReal);
    assert.ok(fromRoot && !fromRoot.startsWith('..') && !path.isAbsolute(fromRoot), 'V4_REALPATH_ESCAPES_REPOSITORY');
  }
  return absolute;
}

function assertInArtifactNamespace(target, root) {
  const absolute = path.resolve(target);
  const relative = path.relative(path.resolve(root), absolute).split(path.sep).join('/');
  assert.ok(relative.startsWith(ARTIFACT_NAMESPACE), 'V4_ARTIFACT_OUTSIDE_RUNNER_NAMESPACE');
  return absolute;
}

function assertNode22() {
  const major = Number(process.versions.node.split('.')[0]);
  assert.equal(major, EXECUTION_NODE_MAJOR, 'V4_EXECUTION_REQUIRES_NODE_22');
  return { nodeVersion: process.versions.node, execPath: process.execPath };
}

function assertExplicitGit(gitExecutable) {
  assert.ok(path.isAbsolute(gitExecutable), 'V4_EXPLICIT_GIT_EXECUTABLE_REQUIRED');
  return gitExecutable;
}

async function runGit(gitExecutable, root, args, options = {}) {
  assertExplicitGit(gitExecutable);
  return await new Promise((resolve, reject) => {
    const child = spawn(gitExecutable, ['-C', root, ...args], {
      cwd: root,
      windowsHide: true,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    const stdout = [];
    const stderr = [];
    let outputSize = 0;
    child.stdout.on('data', chunk => {
      outputSize += chunk.length;
      if (outputSize > MAX_GIT_OUTPUT_BYTES) {
        child.kill();
        reject(new Error('V4_GIT_OUTPUT_TOO_LARGE'));
      } else stdout.push(chunk);
    });
    child.stderr.on('data', chunk => stderr.push(chunk));
    child.on('error', reject);
    child.on('close', code => {
      const result = {
        code,
        stdout: Buffer.concat(stdout).toString(options.encoding || 'utf8'),
        stderr: Buffer.concat(stderr).toString('utf8')
      };
      if (options.allowNonZero) resolve(result);
      else if (code !== 0) reject(new Error('V4_GIT_COMMAND_FAILED:' + args[0] + ':' + result.stderr.slice(0, 300)));
      else resolve(result);
    });
    if (options.input !== undefined) child.stdin.end(options.input);
    else child.stdin.end();
  });
}

function parsePorcelainZ(raw) {
  const entries = [];
  const fields = raw.split('\0');
  for (const field of fields) {
    if (!field) continue;
    entries.push({ status: field.slice(0, 2), path: field.slice(3) });
  }
  return entries;
}

function isExecutableInput(relative) {
  return /\.(?:mjs|cjs|js|jsx|ts|tsx|mts|cts|sh|ps1|bat|cmd|json)$/i.test(relative);
}

function pathIsWithin(relative, directory) {
  return relative === directory || relative.startsWith(directory + '/');
}

function parseGitPathBlob(raw, relative) {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error('V4_GIT_BLOB_MISSING:' + relative);
  const fields = trimmed.split(/\s+/);
  const blob = fields.at(-1);
  if (!/^[a-f0-9]{40,64}$/i.test(blob || '')) throw new Error('V4_GIT_BLOB_INVALID:' + relative);
  return blob;
}

/**
 * Generic low-level checkout verifier, useful for isolated offline repository tests.
 * Production freezes use collectReviewedRunnerBinding, which supplies the fixed
 * full inventory and prompt projections and does not accept caller-selected paths.
 */
export async function collectCheckoutIntegritySnapshot({
  root = ROOT,
  gitExecutable,
  baselineCommit,
  reviewedCommit,
  paths,
  directories = [],
  expectedBranch
} = {}) {
  assertExplicitGit(gitExecutable);
  assert.ok(baselineCommit && reviewedCommit, 'V4_COMMIT_BINDINGS_REQUIRED');
  assert.ok(Array.isArray(paths) && paths.length > 0, 'V4_FILE_BINDINGS_REQUIRED');
  const absoluteRoot = path.resolve(root);
  const rootInfo = await stat(absoluteRoot);
  assert.ok(rootInfo.isDirectory(), 'V4_REPOSITORY_ROOT_INVALID');
  const head = (await runGit(gitExecutable, absoluteRoot, ['rev-parse', 'HEAD'])).stdout.trim();
  const branch = (await runGit(gitExecutable, absoluteRoot, ['branch', '--show-current'])).stdout.trim();
  const baselineAncestor = (await runGit(gitExecutable, absoluteRoot,
    ['merge-base', '--is-ancestor', baselineCommit, head], { allowNonZero: true })).code === 0;
  const reviewedAncestor = (await runGit(gitExecutable, absoluteRoot,
    ['merge-base', '--is-ancestor', reviewedCommit, head], { allowNonZero: true })).code === 0;
  const baselineExists = (await runGit(gitExecutable, absoluteRoot,
    ['cat-file', '-e', baselineCommit + '^{commit}'], { allowNonZero: true })).code === 0;
  const reviewedExists = (await runGit(gitExecutable, absoluteRoot,
    ['cat-file', '-e', reviewedCommit + '^{commit}'], { allowNonZero: true })).code === 0;
  assert.ok(baselineExists && reviewedExists, 'V4_BOUND_COMMIT_MISSING');
  assert.ok(baselineAncestor, 'V4_BASELINE_NOT_ANCESTOR_OF_HEAD');
  assert.ok(reviewedAncestor, 'V4_REVIEWED_COMMIT_NOT_ANCESTOR_OF_HEAD');
  if (expectedBranch) assert.equal(branch, expectedBranch, 'V4_BRANCH_MISMATCH');

  const canonicalPaths = [...new Set(paths.map(value => normalizedRelative(absoluteRoot, value)))].sort();
  for (const directory of directories) await assertNoSymlinkPath(absoluteRoot, directory);
  const statusPathspecs = [...new Set([...directories, ...canonicalPaths])];
  const status = parsePorcelainZ((await runGit(gitExecutable, absoluteRoot,
    ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', ...statusPathspecs])).stdout);
  const dirty = status.filter(entry => entry.status !== '??');
  assert.deepEqual(dirty, [], 'V4_RELEVANT_TRACKED_FILES_DIRTY');
  const untrackedExecutableInputs = status.filter(entry => entry.status === '??' &&
    directories.some(directory => pathIsWithin(entry.path.replaceAll('\\', '/'), directory.replaceAll('\\', '/'))) &&
    isExecutableInput(entry.path));
  assert.deepEqual(untrackedExecutableInputs, [], 'V4_UNTRACKED_EXECUTABLE_INPUT');

  const fileRows = [];
  for (const relative of canonicalPaths) {
    const absolute = await assertNoSymlinkPath(absoluteRoot, relative);
    const raw = await readFile(absolute);
    const workingGitBlob = parseGitPathBlob((await runGit(gitExecutable, absoluteRoot,
      ['hash-object', '--path=' + relative, '--stdin'], { input: raw })).stdout, relative);
    const headGitBlob = parseGitPathBlob((await runGit(gitExecutable, absoluteRoot,
      ['rev-parse', 'HEAD:' + relative])).stdout, relative);
    const reviewedGitBlob = parseGitPathBlob((await runGit(gitExecutable, absoluteRoot,
      ['rev-parse', reviewedCommit + ':' + relative])).stdout, relative);
    assert.equal(workingGitBlob, headGitBlob, 'V4_HEAD_GIT_BLOB_OWNERSHIP_MISMATCH:' + relative);
    assert.equal(workingGitBlob, reviewedGitBlob, 'V4_REVIEWED_GIT_BLOB_OWNERSHIP_MISMATCH:' + relative);
    fileRows.push({ path: relative, sha256: sha256(raw), gitBlob: workingGitBlob, reviewedBlob: reviewedGitBlob });
  }
  return {
    head,
    branch,
    baselineCommit,
    reviewedCommit,
    baselineAncestor,
    reviewedAncestor,
    fileRows,
    fileInventorySha256: sha256(stableJson(fileRows))
  };
}

function inventoryPathsFromDesign(design) {
  const rows = [
    ...(design.sourceFiles || []),
    ...(design.evaluationFiles || []),
    ...(design.regressionFiles || []),
    ...(design.fixedFileRows || [])
  ];
  return [...new Set([...rows.map(row => row.path), ...EXTRA_BINDINGS])].sort();
}

export async function collectTrackedExecutablePaths({ root = ROOT, gitExecutable, directories = TRACKED_DIRS } = {}) {
  assertExplicitGit(gitExecutable);
  const rootAbsolute = path.resolve(root);
  for (const directory of directories) await assertNoSymlinkPath(rootAbsolute, directory);
  const raw = (await runGit(gitExecutable, rootAbsolute, ['ls-files', '-z', '--', ...directories])).stdout;
  return [...new Set(raw.split('\0').filter(Boolean).filter(isExecutableInput)
    .map(relative => normalizedRelative(rootAbsolute, relative)))].sort();
}

async function protectedHistoryRowPaths(root) {
  const planPath = 'docs/evaluation/multi-authority-workstreams/iras-first-live-2026-10-03-v9/iras-mapped-evidence-plan-v9.json';
  const planFile = await assertNoSymlinkPath(root, planPath);
  const plan = JSON.parse(await readFile(planFile, 'utf8'));
  const rows = [];
  const visit = value => {
    if (!value || typeof value !== 'object') return;
    if (typeof value.path === 'string' && typeof value.sha256 === 'string') rows.push(value);
    else for (const child of Object.values(value)) visit(child);
  };
  visit(plan.preregistration?.historicalFingerprints);
  assert.equal(rows.length, 389, 'V4_PROTECTED_HISTORY_ROW_COUNT_CHANGED');
  return [...new Set(rows.map(row => normalizedRelative(root, row.path)))].sort();
}

export function unionProtectedHistoryPaths(historicalPaths, immutableArtifactRows, root = ROOT) {
  assert.ok(Array.isArray(historicalPaths), 'V4_HISTORICAL_PATHS_REQUIRED');
  assert.ok(Array.isArray(immutableArtifactRows), 'V4_IMMUTABLE_ARTIFACT_ROWS_REQUIRED');
  const currentPaths = immutableArtifactRows.map(row => typeof row === 'string' ? row : row?.path);
  assert.ok(currentPaths.every(value => typeof value === 'string'), 'V4_IMMUTABLE_ARTIFACT_PATH_INVALID');
  return [...new Set([...historicalPaths, ...currentPaths]
    .map(relative => normalizedRelative(root, relative)))].sort();
}

function designProjection(design) {
  return {
    contractSha256: design.contractSha256,
    productionFingerprintSha256: design.productionFingerprintSha256,
    sourceFingerprintSha256: design.sourceFingerprintSha256,
    schemaPromptFingerprintSha256: design.schemaPromptFingerprintSha256,
    protectedHistorySha256: design.protectedHistorySha256,
    evaluationFingerprintSha256: design.evaluationFingerprintSha256,
    promptFingerprints: design.promptFingerprints,
    sourceFiles: design.sourceFiles,
    evaluationFiles: design.evaluationFiles,
    regressionFiles: design.regressionFiles,
    fixedFileRows: design.fixedFileRows
  };
}

function runnerConfigurationBody(snapshot, designProjectionValue, node) {
  return {
    profile: RUNNER_PROFILE,
    status: RUNNER_CONFIGURATION_STATUS,
    baselineCommit: snapshot.baselineCommit,
    reviewedCommit: snapshot.reviewedCommit,
    branch: EXPECTED_BRANCH,
    createdWithNode: node.nodeVersion,
    createdWithExecPath: node.execPath,
    executionNodeMajor: EXECUTION_NODE_MAJOR,
    capturePolicy: CAPTURE_POLICY,
    evidenceFamilies: EVIDENCE_FAMILIES,
    caseEvidenceFamily: CASE_EVIDENCE_FAMILY,
    captureInventory: null,
    productionEvidenceAdapterSha256: null,
    preregistrationSha256: null,
    semanticNamespace: ARTIFACT_NAMESPACE + 'semantic-run-v4',
    designFingerprints: designProjectionValue,
    fileRows: snapshot.fileRows,
    fileInventorySha256: snapshot.fileInventorySha256
  };
}

export async function collectReviewedRunnerBinding({
  root = ROOT,
  gitExecutable,
  baselineCommit = BASELINE_COMMIT,
  reviewedCommit,
  syntheticFixture = false
} = {}) {
  const node = syntheticFixture ? { nodeVersion: process.versions.node, execPath: process.execPath } : assertNode22();
  assertExplicitGit(gitExecutable);
  const design = await buildDesignFingerprints();
  const rootAbsolute = path.resolve(root);
  const tsconfigRows = (await readdir(rootAbsolute, { withFileTypes: true }))
    .filter(entry => entry.isFile() && /^tsconfig[^/]*\.json$/i.test(entry.name))
    .map(entry => entry.name);
  const trackedExecutables = await collectTrackedExecutablePaths({ root: rootAbsolute, gitExecutable });
  const historicalPaths = await protectedHistoryRowPaths(rootAbsolute);
  const protectedSnapshot = await protectedHistorySnapshot();
  assert.equal(protectedSnapshot.frozenV9HistoricalRows, 389, 'V4_PROTECTED_HISTORY_ROW_COUNT_CHANGED');
  const protectedPaths = unionProtectedHistoryPaths(
    historicalPaths,
    protectedSnapshot.immutableEvaluationArtifactRows,
    rootAbsolute
  );
  const files = [...new Set([...inventoryPathsFromDesign(design), ...trackedExecutables, ...protectedPaths, ...tsconfigRows])].sort();
  const snapshot = await collectCheckoutIntegritySnapshot({
    root: rootAbsolute,
    gitExecutable,
    baselineCommit,
    reviewedCommit: reviewedCommit || (await runGit(gitExecutable, rootAbsolute, ['rev-parse', 'HEAD'])).stdout.trim(),
    paths: files,
    directories: TRACKED_DIRS,
    expectedBranch: syntheticFixture ? undefined : EXPECTED_BRANCH
  });
  const body = runnerConfigurationBody(snapshot, designProjection(design), node);
  return {
    ...body,
    integrityBindingSha256: sha256(stableJson(body))
  };
}

function assertOutsideProtectedHistory(outputPath, root) {
  const absolute = path.resolve(outputPath);
  const relative = path.relative(path.resolve(root), absolute).split(path.sep).join('/');
  const protectedPrefix = 'docs/evaluation/multi-authority-workstreams/';
  assert.ok(!relative.startsWith(protectedPrefix), 'V4_RUNNER_ARTIFACT_INSIDE_PROTECTED_HISTORY');
  return absolute;
}

export async function writeFrozenRunnerConfiguration({
  outputPath,
  root = ROOT,
  gitExecutable,
  baselineCommit = BASELINE_COMMIT,
  reviewedCommit
} = {}) {
  assert.ok(outputPath, 'V4_RUNNER_CONFIGURATION_PATH_REQUIRED');
  assertNode22();
  const destination = assertInArtifactNamespace(assertOutsideProtectedHistory(outputPath, root), root);
  const binding = await collectReviewedRunnerBinding({ root, gitExecutable, baselineCommit, reviewedCommit });
  await mkdir(path.dirname(destination), { recursive: true });
  await assertNoSymlinkPath(root, path.relative(root, destination), { mustExist: false });
  const bytes = Buffer.from(JSON.stringify(binding, null, 2) + '\n', 'utf8');
  const handle = await open(destination, 'wx');
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
  return { path: destination, sha256: sha256(bytes), integrityBindingSha256: binding.integrityBindingSha256 };
}

export function assertRunnerConfigurationBodyMatches(document, recomputed) {
  assert.ok(document && recomputed, 'V4_RUNNER_CONFIGURATION_MISSING');
  const suppliedBody = { ...document };
  delete suppliedBody.integrityBindingSha256;
  assert.equal(document.integrityBindingSha256, sha256(stableJson(suppliedBody)), 'V4_RUNNER_CONFIGURATION_BODY_TAMPERED');
  assert.equal(document.integrityBindingSha256, recomputed.integrityBindingSha256, 'V4_RUNNER_INTEGRITY_BINDING_MISMATCH');
  assert.deepEqual(document, recomputed, 'V4_RUNNER_CONFIGURATION_HAS_UNBOUND_FIELDS');
  return true;
}

export async function verifyFrozenRunnerConfiguration({
  binding,
  bindingPath,
  root = ROOT,
  gitExecutable,
  syntheticFixture = false
} = {}) {
  let document = binding;
  if (!document && bindingPath) {
    const absolute = assertInArtifactNamespace(bindingPath, root);
    await assertNoSymlinkPath(root, path.relative(root, absolute));
    document = JSON.parse(await readFile(absolute, 'utf8'));
  }
  assert.ok(document, 'V4_RUNNER_CONFIGURATION_MISSING');
  assert.equal(document.profile, RUNNER_PROFILE, 'V4_RUNNER_CONFIGURATION_PROFILE_INVALID');
  assert.equal(document.status, RUNNER_CONFIGURATION_STATUS, 'V4_RUNNER_CONFIGURATION_NOT_FROZEN');
  assert.equal(document.executionNodeMajor, EXECUTION_NODE_MAJOR, 'V4_EXECUTION_NODE_BINDING_INVALID');
  if (!syntheticFixture) assertNode22();
  const recomputed = await collectReviewedRunnerBinding({
    root,
    gitExecutable,
    baselineCommit: document.baselineCommit,
    reviewedCommit: document.reviewedCommit,
    syntheticFixture
  });
  assertRunnerConfigurationBodyMatches(document, recomputed);
  return { passed: true, integrityBindingSha256: recomputed.integrityBindingSha256, snapshot: recomputed };
}

export async function validateReviewedAcquisitionPermit({
  runnerConfigurationPath,
  root = ROOT,
  gitExecutable
} = {}) {
  assertNode22();
  const { value: config } = await readObjectAndHash(runnerConfigurationPath);
  const verified = await verifyFrozenRunnerConfiguration({ binding: config, root, gitExecutable });
  assert.ok(Array.isArray(config.captureInventory) && config.captureInventory.length > 0,
    'V4_LIVE_CAPTURE_INVENTORY_NOT_REVIEWED');
  assert.match(String(config.productionEvidenceAdapterSha256 || ''), SHA256_RE,
    'V4_PRODUCTION_OBSERVATION_ADAPTER_NOT_REVIEWED');
  assert.match(String(config.preregistrationSha256 || ''), SHA256_RE, 'V4_FROZEN_PREREGISTRATION_NOT_BOUND');
  const permit = Object.freeze({
    integrityBindingSha256: verified.integrityBindingSha256,
    captureInventorySha256: sha256(stableJson(config.captureInventory)),
    productionEvidenceAdapterSha256: config.productionEvidenceAdapterSha256
  });
  reviewedAcquisitionPermits.add(permit);
  return permit;
}

async function verifyFrozenPreregistration(preregistrationPath, preregistrationSha256, runnerConfiguration, root) {
  const prereg = await readObjectAndHash(preregistrationPath, root);
  assert.equal(prereg.sha256, preregistrationSha256, 'V4_CAPTURE_PREREGISTRATION_HASH_MISMATCH');
  assert.equal(prereg.value.profile, V4_PROFILE, 'V4_CAPTURE_PREREGISTRATION_PROFILE_INVALID');
  assert.equal(prereg.value.frozen, true, 'V4_CAPTURE_PREREGISTRATION_NOT_FROZEN');
  for (const key of ['contractSha256', 'productionFingerprintSha256', 'sourceFingerprintSha256',
    'schemaPromptFingerprintSha256', 'protectedHistorySha256', 'evaluationFingerprintSha256']) {
    assert.equal(prereg.value[key], runnerConfiguration.designFingerprints[key], 'V4_CAPTURE_PREREGISTRATION_BINDING_MISMATCH:' + key);
  }
  return prereg.value;
}

function validateOfficialUrl(input) {
  let url;
  try { url = new URL(input); } catch { throw new Error('V4_CAPTURE_URL_INVALID'); }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || !CAPTURE_POLICY.allowedHosts.includes(host) ||
      (url.port && url.port !== '443') || url.username || url.password || url.hash) {
    throw new Error('V4_CAPTURE_URL_BLOCKED');
  }
  return url.toString();
}

function normalizeRequest(url, init = {}, family) {
  if (!EVIDENCE_FAMILIES.includes(family)) throw new Error('V4_CAPTURE_FAMILY_INVALID');
  const normalizedUrl = validateOfficialUrl(url);
  if (String(init.method || 'GET').toUpperCase() !== 'GET' || init.redirect !== 'manual' ||
      (init.body !== undefined && init.body !== null) ||
      (init.credentials !== undefined && init.credentials !== 'omit') ||
      (init.mode !== undefined && init.mode !== 'cors')) {
    throw new Error('V4_CAPTURE_REQUEST_POLICY_REJECTED');
  }
  const headers = new Headers(init.headers || {});
  const normalizedHeaders = {};
  for (const [name, value] of headers.entries()) {
    const lower = name.toLowerCase();
    if (!CAPTURE_POLICY.allowedRequestHeaders.includes(lower) || hasControlCharacters(value) || value.length > 2_000) {
      throw new Error('V4_CAPTURE_REQUEST_HEADER_REJECTED:' + lower);
    }
    normalizedHeaders[lower] = value.trim();
  }
  if (normalizedHeaders.accept !== ACCEPT_HEADER) throw new Error('V4_CAPTURE_ACCEPT_HEADER_MISMATCH');
  return {
    family,
    url: normalizedUrl,
    method: 'GET',
    headers: Object.fromEntries(Object.entries(normalizedHeaders).sort(([a], [b]) => a.localeCompare(b)))
  };
}

function requestIdentity(request) {
  return sha256(stableJson(request));
}

function filteredResponseHeaders(headers) {
  const result = {};
  for (const name of CAPTURE_POLICY.allowedResponseHeaders) {
    const value = headers.get(name);
    if (value !== null && value.length <= 2_000 && !hasControlCharacters(value)) result[name] = value;
  }
  return result;
}

function makeMarkedFailure(url, failure) {
  const response = new Response(null, { status: 502, statusText: 'Official source transport failed' });
  Object.defineProperty(response, 'url', { value: url });
  Object.defineProperty(response, '__officialSourceTransportFailure', { value: failure });
  return response;
}

function outsideProtectedTree(target, root) {
  const absolute = assertInArtifactNamespace(target, root);
  const relative = path.relative(path.resolve(root), absolute).split(path.sep).join('/');
  assert.ok(!relative.startsWith('docs/evaluation/multi-authority-workstreams/'), 'V4_ARTIFACT_INSIDE_PROTECTED_HISTORY');
  return absolute;
}

function isoFrom(value) {
  return new Date(value).toISOString();
}

async function writeExclusiveDurable(filePath, bytes, root = ROOT) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await assertNoSymlinkPath(root, path.relative(root, filePath), { mustExist: false });
  const handle = await open(filePath, 'wx');
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
}

function networkFailureKind(error) {
  return error?.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK_ERROR';
}

function partialCaptureResponse(error) {
  const partial = error?.partialResponse;
  if (!partial) return null;
  const body = Buffer.from(partial.body || Buffer.alloc(0));
  return {
    status: partial.status,
    statusText: partial.statusText || '',
    actualUrl: partial.actualUrl || null,
    headers: partial.headers || {},
    bodyBase64: body.toString('base64'),
    bodySha256: sha256(body),
    bodyBytes: body.length
  };
}

async function consumeResponse(response, maxBytes, signal, deadlinePromise) {
  if (!(response instanceof Response)) throw new Error('V4_CAPTURE_TRANSPORT_RESPONSE_INVALID');
  if (!Number.isInteger(response.status) || response.status < 200 || response.status > 599) {
    throw new Error('V4_CAPTURE_HTTP_STATUS_INVALID');
  }
  const actualUrl = response.url;
  const chunks = [];
  let retainedBytes = 0;
  let observedBytes = 0;
  const headers = filteredResponseHeaders(response.headers);
  if (response.body) {
    const reader = response.body.getReader();
    try {
      while (true) {
        if (signal.aborted) throw new Error('V4_CAPTURE_DEADLINE_EXCEEDED');
        const result = await Promise.race([reader.read(), deadlinePromise]);
        if (result.done) break;
        const chunk = Buffer.from(result.value);
        const remaining = Math.max(0, maxBytes - retainedBytes);
        if (remaining) {
          const retained = chunk.subarray(0, remaining);
          chunks.push(retained);
          retainedBytes += retained.length;
        }
        observedBytes += chunk.length;
        if (observedBytes > maxBytes) {
          void reader.cancel().catch(() => {});
          throw new Error('V4_CAPTURE_RESPONSE_TOO_LARGE');
        }
      }
    } catch (error) {
      void reader.cancel(error).catch(() => {});
      error.partialResponse = {
        status: response.status,
        statusText: response.statusText.slice(0, 200),
        actualUrl: actualUrl || null,
        headers,
        body: Buffer.concat(chunks)
      };
      throw error;
    } finally {
      try { reader.releaseLock(); } catch {}
    }
  }
  return { status: response.status, statusText: response.statusText.slice(0, 200), actualUrl, headers, body: Buffer.concat(chunks) };
}

function explicitTransportCall(fn) {
  const scope = { capability: EXPLICIT_TRANSPORT_NETWORK_CAPABILITY, active: true };
  let result;
  try { result = explicitTransportNetworkContext.run(scope, fn); }
  catch (error) { scope.active = false; throw error; }
  return Promise.resolve(result).finally(() => { scope.active = false; });
}

function ambientNetworkDisabled(fn) {
  if (ambientNetworkBlockInProgress) throw new Error('V4_AMBIENT_NETWORK_GUARD_BUSY');
  ambientNetworkBlockInProgress = true;
  const restorers = [];
  const requireCapability = () => {
    const scope = explicitTransportNetworkContext.getStore();
    if (scope?.capability !== EXPLICIT_TRANSPORT_NETWORK_CAPABILITY || scope.active !== true) {
      throw new Error(NETWORK_DISABLED_MESSAGE);
    }
  };
  const guarded = original => function (...args) {
    requireCapability();
    return Reflect.apply(original, this, args);
  };
  const replace = (target, key, value) => {
    const descriptor = Object.getOwnPropertyDescriptor(target, key);
    if (!descriptor || !('value' in descriptor) || descriptor.configurable === false && descriptor.writable === false) {
      throw new Error('V4_NETWORK_GUARD_API_NOT_PATCHABLE:' + String(key));
    }
    Object.defineProperty(target, key, { ...descriptor, value });
    restorers.push(() => Object.defineProperty(target, key, descriptor));
  };
  const restore = () => {
    let restoreError;
    for (let index = restorers.length - 1; index >= 0; index -= 1) {
      try { restorers[index](); } catch (error) { restoreError ||= error; }
    }
    try { syncBuiltinESMExports(); } catch (error) { restoreError ||= error; }
    ambientNetworkBlockInProgress = false;
    if (restoreError) throw restoreError;
  };
  try {
    const originalFetch = globalThis.fetch;
    replace(globalThis, 'fetch', function (...args) {
      const scope = explicitTransportNetworkContext.getStore();
      if (scope?.capability !== EXPLICIT_TRANSPORT_NETWORK_CAPABILITY || scope.active !== true) {
        return Promise.reject(new Error(NETWORK_DISABLED_MESSAGE));
      }
      return Reflect.apply(originalFetch, this, args);
    });
    for (const [target, key] of [
      [http, 'request'], [http, 'get'], [https, 'request'], [https, 'get'],
      [net, 'connect'], [net, 'createConnection'], [tls, 'connect'], [net.Socket.prototype, 'connect']
    ]) {
      const original = target[key];
      replace(target, key, guarded(original));
    }
    syncBuiltinESMExports();
  } catch (error) {
    try { restore(); } catch {}
    throw error;
  }
  return Promise.resolve().then(fn).finally(restore);
}

export function createCaptureTransport({
  liveFetch,
  markerPath,
  journalPath,
  payloadPath,
  integrityBindingSha256,
  preregistrationSha256,
  runnerConfigurationPath,
  preregistrationPath,
  gitExecutable,
  provenance = {},
  synthetic = false,
  acquisitionPermit,
  root = ROOT,
  now = () => new Date(),
  syntheticTestControls = {}
} = {}) {
  assert.equal(typeof liveFetch, 'function', 'V4_EXPLICIT_CAPTURE_TRANSPORT_REQUIRED');
  assert.match(String(integrityBindingSha256 || ''), SHA256_RE, 'V4_CAPTURE_INTEGRITY_BINDING_REQUIRED');
  if (!synthetic) {
    assert.ok(acquisitionPermit && reviewedAcquisitionPermits.has(acquisitionPermit),
      'V4_LIVE_CAPTURE_REQUIRES_RECOMPUTED_REVIEWED_PERMIT');
    assert.ok(runnerConfigurationPath && path.isAbsolute(gitExecutable),
      'V4_LIVE_CAPTURE_CHECKOUT_VALIDATION_REQUIRED');
    assert.ok(preregistrationPath, 'V4_FROZEN_PREREGISTRATION_PATH_REQUIRED');
    assert.match(String(preregistrationSha256 || ''), SHA256_RE, 'V4_CAPTURE_PREREGISTRATION_BINDING_REQUIRED');
    assert.equal(syntheticTestControls.timeoutMs, undefined, 'V4_LIVE_CAPTURE_POLICY_CANNOT_BE_OVERRIDDEN');
    assert.equal(syntheticTestControls.maximumResponseBytes, undefined, 'V4_LIVE_CAPTURE_POLICY_CANNOT_BE_OVERRIDDEN');
    assert.equal(syntheticTestControls.maximumRequests, undefined, 'V4_LIVE_CAPTURE_POLICY_CANNOT_BE_OVERRIDDEN');
    assert.equal(syntheticTestControls.maximumRequestsPerFamily, undefined, 'V4_LIVE_CAPTURE_POLICY_CANNOT_BE_OVERRIDDEN');
    assert.deepEqual(syntheticTestControls, {}, 'V4_LIVE_CAPTURE_TEST_CONTROLS_FORBIDDEN');
  } else {
    assert.equal(syntheticTestControls.synthetic, true, 'V4_SYNTHETIC_MODE_MUST_BE_EXPLICIT');
  }
  assert.ok(markerPath && journalPath && payloadPath, 'V4_CAPTURE_OUTPUT_PATHS_REQUIRED');
  const marker = outsideProtectedTree(markerPath, root);
  const journal = outsideProtectedTree(journalPath, root);
  const payload = outsideProtectedTree(payloadPath, root);
  if (!synthetic) {
    assert.equal(acquisitionPermit.integrityBindingSha256, integrityBindingSha256, 'V4_CAPTURE_PERMIT_BINDING_MISMATCH');
  }
  const timeoutMs = syntheticTestControls.timeoutMs ?? CAPTURE_POLICY.timeoutMs;
  const maximumResponseBytes = syntheticTestControls.maximumResponseBytes ?? CAPTURE_POLICY.maximumResponseBytes;
  const maximumRequests = syntheticTestControls.maximumRequests ?? CAPTURE_POLICY.maximumRequests;
  const maximumRequestsPerFamily = syntheticTestControls.maximumRequestsPerFamily ?? CAPTURE_POLICY.maximumRequestsPerFamily;
  const effectivePolicy = {
    ...CAPTURE_POLICY,
    timeoutMs,
    maximumResponseBytes,
    maximumRequests,
    maximumRequestsPerFamily
  };
  const familyContext = new AsyncLocalStorage();
  const entries = [];
  const cacheReuses = [];
  const inFlightIdentities = new Set();
  const failedIdentities = new Set();
  const successfulResponses = new Map();
  const familyCounts = new Map();
  const reservedFamilyCounts = new Map();
  let latch;
  let reserved = false;
  let reservationPromise;
  let journalChain = Promise.resolve();
  let journalHandle;
  let dispatchCount = 0;
  let reservedRequestCount = 0;
  let requestSlotChain = Promise.resolve();
  let unsuccessfulHttpStatus = false;

  function latchIntegrity(code) {
    if (!latch) latch = new Error(code);
    return latch;
  }

  async function ensureReserved() {
    if (reserved) return;
    if (reservationPromise) return reservationPromise;
    const content = JSON.stringify({
      profile: RUNNER_PROFILE,
      status: 'CAPTURE_RESERVED_NO_RETRY',
      synthetic,
      integrityBindingSha256,
      preregistrationSha256: preregistrationSha256 || null,
      reservedAt: isoFrom(now())
    }, null, 2) + '\n';
    reservationPromise = (async () => {
      try {
        await mkdir(path.dirname(marker), { recursive: true });
        await mkdir(path.dirname(journal), { recursive: true });
        await assertNoSymlinkPath(root, path.relative(root, marker), { mustExist: false });
        await assertNoSymlinkPath(root, path.relative(root, journal), { mustExist: false });
        await assertNoSymlinkPath(root, path.relative(root, payload), { mustExist: false });
        await writeExclusiveDurable(marker, content, root);
        journalHandle = await open(journal, 'wx');
        await journalHandle.sync();
        reserved = true;
      } catch {
        latchIntegrity('V4_CAPTURE_ALREADY_RESERVED_OR_OUTPUT_EXISTS');
        throw latch;
      }
    })();
    return reservationPromise;
  }

  async function appendEntry(entry) {
    entries.push(entry);
    if (journalHandle) {
      journalChain = journalChain.then(async () => {
        await journalHandle.writeFile(JSON.stringify(entry) + '\n');
        await journalHandle.sync();
      });
      try { await journalChain; }
      catch { throw latchIntegrity('V4_CAPTURE_JOURNAL_WRITE_FAILED'); }
    }
  }

  async function reserveRequestSlot(identityKey, request) {
    const previous = requestSlotChain;
    let release;
    requestSlotChain = new Promise(resolve => { release = resolve; });
    await previous;
    try {
      if (latch) throw latch;
      if (failedIdentities.has(identityKey)) throw latchIntegrity('V4_CAPTURE_RETRY_AFTER_FAILED_REQUEST_BLOCKED');
      if (inFlightIdentities.has(identityKey)) throw latchIntegrity('V4_CAPTURE_CONCURRENT_DUPLICATE_REQUEST_BLOCKED');
      const currentFamilyCount = reservedFamilyCounts.get(request.family) || 0;
      if (reservedRequestCount >= maximumRequests || currentFamilyCount >= maximumRequestsPerFamily) {
        throw latchIntegrity(reservedRequestCount >= maximumRequests
          ? 'V4_CAPTURE_REQUEST_BUDGET_EXCEEDED'
          : 'V4_CAPTURE_FAMILY_BUDGET_EXCEEDED');
      }
      reservedRequestCount += 1;
      reservedFamilyCounts.set(request.family, currentFamilyCount + 1);
      inFlightIdentities.add(identityKey);
    } finally {
      release();
    }
  }

  async function captureFetch(url, init = {}) {
    const family = familyContext.getStore();
    let request;
    try {
      request = normalizeRequest(url, init, family);
    } catch (error) {
      throw latchIntegrity(error.message || 'V4_CAPTURE_REQUEST_REJECTED');
    }
    if (latch) throw latch;
    const identity = requestIdentity(request);
    const identityKey = request.family + ':' + identity;
    if (!synthetic && !reserved) {
      try {
        const permit = await validateReviewedAcquisitionPermit({ runnerConfigurationPath, root, gitExecutable });
        const { value: currentConfiguration } = await readObjectAndHash(runnerConfigurationPath, root);
        if (permit.integrityBindingSha256 !== integrityBindingSha256 ||
            permit.captureInventorySha256 !== acquisitionPermit.captureInventorySha256 ||
            permit.productionEvidenceAdapterSha256 !== acquisitionPermit.productionEvidenceAdapterSha256 ||
            currentConfiguration.preregistrationSha256 !== preregistrationSha256) {
          throw new Error('V4_CAPTURE_PERMIT_CHANGED');
        }
        await verifyFrozenPreregistration(preregistrationPath, preregistrationSha256, currentConfiguration, root);
      } catch (error) {
        throw latchIntegrity(error.message || 'V4_CAPTURE_PREFLIGHT_FAILED');
      }
    } else if (typeof syntheticTestControls.preDispatchPreflight === 'function') {
      try { await syntheticTestControls.preDispatchPreflight(request); }
      catch (error) { throw latchIntegrity(error.message || 'V4_SYNTHETIC_PREFLIGHT_FAILED'); }
    }
    await reserveRequestSlot(identityKey, request);
    try {
      await ensureReserved();
      if (latch) throw latch;
    } catch (error) {
      inFlightIdentities.delete(identityKey);
      throw error;
    }
    dispatchCount += 1;
    familyCounts.set(request.family, (familyCounts.get(request.family) || 0) + 1);
    const startedAt = isoFrom(now());
    const controller = new AbortController();
    const upstreamSignal = init.signal;
    const abortUpstream = () => controller.abort();
    upstreamSignal?.addEventListener('abort', abortUpstream, { once: true });
    if (upstreamSignal?.aborted) controller.abort();
    let timedOut = false;
    let timeoutId;
    const deadlinePromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        timedOut = true;
        controller.abort();
        reject(new Error('V4_CAPTURE_DEADLINE_EXCEEDED'));
      }, timeoutMs);
    });
    const entryBase = {
      ordinal: dispatchCount,
      request,
      requestIdentitySha256: identity,
      startedAt
    };
    try {
      const response = await Promise.race([
        Promise.resolve().then(() => explicitTransportCall(() => liveFetch(request.url, {
          method: 'GET',
          redirect: 'manual',
          headers: request.headers,
          signal: controller.signal
        }))),
        deadlinePromise
      ]);
      const responseData = await consumeResponse(response, maximumResponseBytes, controller.signal, deadlinePromise);
      if (responseData.actualUrl && responseData.actualUrl !== request.url) {
        const entry = {
          ...entryBase,
          completedAt: isoFrom(now()),
          actualUrl: responseData.actualUrl,
          status: responseData.status,
          statusText: responseData.statusText,
          headers: responseData.headers,
          bodyBase64: responseData.body.toString('base64'),
          bodySha256: sha256(responseData.body),
          failure: 'UNEXPECTED_AUTO_FOLLOW'
        };
        await appendEntry(entry);
        throw latchIntegrity('V4_CAPTURE_UNEXPECTED_AUTO_FOLLOW');
      }
      const entry = {
        ...entryBase,
        completedAt: isoFrom(now()),
        actualUrl: responseData.actualUrl || request.url,
        status: responseData.status,
        statusText: responseData.statusText,
        headers: responseData.headers,
        bodyBase64: responseData.body.toString('base64'),
        bodySha256: sha256(responseData.body),
        failure: null
      };
      await appendEntry(entry);
      const responseKey = request.family + ':' + identity;
      const previous = successfulResponses.get(responseKey);
      if (previous && !compareCaptureResponse(previous, entry)) {
        throw latchIntegrity('V4_CAPTURE_CONFLICTING_DUPLICATE_IDENTITY');
      }
      if (responseData.status >= 400) {
        failedIdentities.add(identityKey);
        unsuccessfulHttpStatus = true;
      } else successfulResponses.set(responseKey, entry);
      return new Response(responseData.body.length ? responseData.body : null, {
        status: responseData.status,
        statusText: responseData.statusText,
        headers: responseData.headers
      });
    } catch (error) {
      if (error?.message === 'V4_CAPTURE_RESPONSE_TOO_LARGE') {
        await appendEntry({
          ...entryBase,
          completedAt: isoFrom(now()),
          actualUrl: request.url,
          status: null,
          statusText: '',
          headers: {},
          bodyBase64: '',
          bodySha256: sha256(Buffer.alloc(0)),
          partialResponse: partialCaptureResponse(error),
          failure: 'RESPONSE_TOO_LARGE'
        });
        throw latchIntegrity('V4_CAPTURE_RESPONSE_TOO_LARGE');
      }
      if (timedOut || error?.message === 'V4_CAPTURE_DEADLINE_EXCEEDED' || controller.signal.aborted && !upstreamSignal?.aborted) {
        await appendEntry({
          ...entryBase,
          completedAt: isoFrom(now()),
          actualUrl: request.url,
          status: null,
          statusText: '',
          headers: {},
          bodyBase64: '',
          bodySha256: sha256(Buffer.alloc(0)),
          partialResponse: partialCaptureResponse(error),
          failure: 'TIMEOUT'
        });
        throw latchIntegrity('V4_CAPTURE_DEADLINE_EXCEEDED');
      }
      if (latch) throw latch;
      const kind = networkFailureKind(error);
      failedIdentities.add(identityKey);
      await appendEntry({
        ...entryBase,
        completedAt: isoFrom(now()),
        actualUrl: request.url,
        status: null,
        statusText: '',
        headers: {},
        bodyBase64: '',
        bodySha256: sha256(Buffer.alloc(0)),
        failure: kind,
        error: String(error?.message || error).slice(0, 240)
      });
      return makeMarkedFailure(request.url, kind);
    } finally {
      inFlightIdentities.delete(identityKey);
      clearTimeout(timeoutId);
      upstreamSignal?.removeEventListener('abort', abortUpstream);
    }
  }

  function withEvidenceFamily(family, callback) {
    if (!EVIDENCE_FAMILIES.includes(family)) throw latchIntegrity('V4_CAPTURE_FAMILY_INVALID');
    return familyContext.run(family, callback);
  }

  function withCaseFamily(caseId, callback) {
    const family = CASE_EVIDENCE_FAMILY[caseId];
    if (!family) {
      if (caseId === 'unsupported-sfrsi-6-exploration-evaluation') {
        return familyContext.run(undefined, callback);
      }
      throw latchIntegrity('V4_CAPTURE_CASE_FAMILY_UNMAPPED');
    }
    return withEvidenceFamily(family, callback);
  }

  function recordCacheReuse(url, result) {
    const family = familyContext.getStore();
    if (!EVIDENCE_FAMILIES.includes(family)) throw latchIntegrity('V4_CAPTURE_FAMILY_INVALID');
    if (cacheReuses.length >= CAPTURE_POLICY.maximumCacheReuses) throw latchIntegrity('V4_CACHE_REUSE_BUDGET_EXCEEDED');
    cacheReuses.push({
      family,
      url: validateOfficialUrl(url),
      recordedAt: isoFrom(now()),
      contentHash: result?.contentHash || null
    });
  }

  async function finalizeCapture(captureStatus = 'COMPLETE') {
    await journalChain;
    if (journalHandle) {
      await journalHandle.sync();
      await journalHandle.close();
      journalHandle = undefined;
    }
    const earliestAcquisitionAt = entries.map(entry => Date.parse(entry.startedAt))
      .filter(Number.isFinite).sort((a, b) => a - b)[0];
    const document = {
      profile: RUNNER_PROFILE,
      version: 1,
      transportMode: CAPTURE_POLICY.transportMode,
      evidenceMode: CAPTURE_POLICY.evidenceMode,
      captureStatus,
      synthetic,
      integrityBindingSha256,
      preregistrationSha256: preregistrationSha256 || null,
      captureStartedAt: entries[0]?.startedAt || null,
      captureCompletedAt: isoFrom(now()),
      earliestAcquisitionAt: earliestAcquisitionAt === undefined ? null : new Date(earliestAcquisitionAt).toISOString(),
      policy: effectivePolicy,
      provenance: {
        runnerIntegrityBindingSha256: integrityBindingSha256,
        preregistrationSha256: preregistrationSha256 || null,
        nodeVersion: process.versions.node,
        execPath: process.execPath,
        sourcePolicySha256: provenance.sourcePolicySha256 || null,
        sourceRegistrySha256: provenance.sourceRegistrySha256 || null,
        sourceMapSha256: provenance.sourceMapSha256 || null,
        discoveryPolicySha256: provenance.discoveryPolicySha256 || null,
        productionRetriever: CAPTURE_POLICY.productionRetriever
      },
      requestCount: entries.length,
      familyCounts: Object.fromEntries([...familyCounts.entries()].sort(([a], [b]) => a.localeCompare(b))),
      cacheReuses,
      entries,
      terminalIntegrityFailure: latch?.message || null
    };
    const bytes = Buffer.from(JSON.stringify(document, null, 2) + '\n', 'utf8');
    await writeExclusiveDurable(payload, bytes, root);
    return { path: payload, sha256: sha256(bytes), document };
  }

  return {
    fetch: captureFetch,
    withEvidenceFamily,
    withCaseFamily,
    recordCacheReuse,
    get entries() { return entries; },
    get requestCount() { return dispatchCount; },
    get reservedRequestCount() { return reservedRequestCount; },
    get cacheReuses() { return cacheReuses; },
    get terminalIntegrityFailure() { return latch?.message || null; },
    integrityBindingSha256,
    synthetic,
    acquisitionPermit,
    runnerConfigurationPath,
    preregistrationPath,
    preregistrationSha256,
    gitExecutable,
    trip(code) { throw latchIntegrity(code); },
    assertHealthy() { if (latch) throw latch; },
    assertCaptureComplete() {
      if (unsuccessfulHttpStatus) throw latchIntegrity('V4_CAPTURE_HTTP_STATUS_UNSUCCESSFUL');
    },
    finalizeCapture
  };
}

function compareCaptureResponse(left, right) {
  return stableJson({
    status: left.status,
    statusText: left.statusText,
    actualUrl: left.actualUrl,
    headers: left.headers,
    bodySha256: left.bodySha256,
    partialResponse: left.partialResponse,
    failure: left.failure
  }) === stableJson({
    status: right.status,
    statusText: right.statusText,
    actualUrl: right.actualUrl,
    headers: right.headers,
    bodySha256: right.bodySha256,
    partialResponse: right.partialResponse,
    failure: right.failure
  });
}

function parseTimestamp(value, code) {
  const parsed = Date.parse(value || '');
  if (!Number.isFinite(parsed)) throw new Error(code);
  return parsed;
}

export function validateCapturePayload(payload, {
  now = new Date(),
  expectedIntegrityBindingSha256,
  expectedPreregistrationSha256,
  syntheticMode = false,
  requireComplete = true
} = {}) {
  assert.ok(payload && payload.profile === RUNNER_PROFILE, 'V4_CAPTURE_PAYLOAD_INVALID');
  assert.equal(payload.version, 1, 'V4_CAPTURE_VERSION_INVALID');
  assert.equal(payload.transportMode, CAPTURE_POLICY.transportMode, 'V4_CAPTURE_MODE_INVALID');
  assert.equal(payload.evidenceMode, CAPTURE_POLICY.evidenceMode, 'V4_CAPTURE_EVIDENCE_MODE_INVALID');
  assert.equal(payload.synthetic, syntheticMode, 'V4_CAPTURE_SYNTHETIC_MODE_MISMATCH');
  if (!syntheticMode) assert.equal(payload.synthetic, false, 'V4_LIVE_CAPTURE_MUST_BE_EXPLICITLY_NON_SYNTHETIC');
  if (requireComplete) assert.equal(payload.captureStatus, 'COMPLETE', 'V4_CAPTURE_INCOMPLETE');
  if (requireComplete) assert.equal(payload.terminalIntegrityFailure, null, 'V4_CAPTURE_TERMINAL_INTEGRITY_FAILURE');
  assert.ok(payload.policy && typeof payload.policy === 'object', 'V4_CAPTURE_POLICY_MISSING');
  if (!syntheticMode) assert.deepEqual(payload.policy, CAPTURE_POLICY, 'V4_CAPTURE_POLICY_MISMATCH');
  else {
    assert.deepEqual(payload.policy.allowedHosts, CAPTURE_POLICY.allowedHosts, 'V4_CAPTURE_TEST_HOST_POLICY_CHANGED');
    assert.deepEqual(payload.policy.allowedRequestHeaders, CAPTURE_POLICY.allowedRequestHeaders, 'V4_CAPTURE_TEST_REQUEST_POLICY_CHANGED');
    assert.deepEqual(payload.policy.allowedResponseHeaders, CAPTURE_POLICY.allowedResponseHeaders, 'V4_CAPTURE_TEST_RESPONSE_POLICY_CHANGED');
  }
  for (const key of ['timeoutMs', 'maximumResponseBytes', 'maximumRequests', 'maximumRequestsPerFamily']) {
    assert.ok(Number.isSafeInteger(payload.policy[key]) && payload.policy[key] > 0, 'V4_CAPTURE_POLICY_VALUE_INVALID:' + key);
    assert.ok(payload.policy[key] <= CAPTURE_POLICY[key], 'V4_CAPTURE_POLICY_LIMIT_EXPANDED:' + key);
  }
  assert.ok(payload.policy.retries === 0 && payload.policy.redirects === 'manual', 'V4_CAPTURE_POLICY_DRIFT');
  if (!syntheticMode) {
    assert.equal(Number(String(payload.provenance?.nodeVersion || '').split('.')[0]), EXECUTION_NODE_MAJOR,
      'V4_CAPTURE_RUNTIME_NODE_MAJOR_INVALID');
    assert.ok(payload.provenance.execPath, 'V4_CAPTURE_RUNTIME_EXEC_PATH_MISSING');
    assert.equal(payload.provenance.runnerIntegrityBindingSha256, payload.integrityBindingSha256,
      'V4_CAPTURE_PROVENANCE_BINDING_MISMATCH');
    assert.equal(payload.provenance.preregistrationSha256, payload.preregistrationSha256,
      'V4_CAPTURE_PROVENANCE_PREREGISTRATION_MISMATCH');
  }
  assert.match(String(payload.integrityBindingSha256 || ''), SHA256_RE, 'V4_CAPTURE_BINDING_INVALID');
  if (expectedIntegrityBindingSha256) assert.equal(payload.integrityBindingSha256, expectedIntegrityBindingSha256, 'V4_CAPTURE_BINDING_MISMATCH');
  if (expectedPreregistrationSha256) assert.equal(payload.preregistrationSha256, expectedPreregistrationSha256, 'V4_CAPTURE_PREREGISTRATION_MISMATCH');
  assert.ok(Array.isArray(payload.entries), 'V4_CAPTURE_ENTRIES_MISSING');
  assert.ok(payload.entries.length <= payload.policy.maximumRequests, 'V4_CAPTURE_REQUEST_BUDGET_EXCEEDED');
  const counts = new Map();
  const identities = new Map();
  const starts = [];
  const currentTime = now instanceof Date ? now.getTime() : new Date(now).getTime();
  if (!Number.isFinite(currentTime)) throw new Error('V4_CAPTURE_VALIDATION_TIME_INVALID');
  for (const entry of payload.entries) {
    assert.ok(entry && entry.request && typeof entry.request === 'object', 'V4_CAPTURE_ENTRY_INVALID');
    const normalized = normalizeRequest(entry.request.url, {
      method: entry.request.method,
      redirect: 'manual',
      headers: entry.request.headers
    }, entry.request.family);
    const identity = requestIdentity(normalized);
    assert.equal(entry.requestIdentitySha256, identity, 'V4_CAPTURE_REQUEST_IDENTITY_MISMATCH');
    const familyCount = (counts.get(normalized.family) || 0) + 1;
    counts.set(normalized.family, familyCount);
    assert.ok(familyCount <= payload.policy.maximumRequestsPerFamily, 'V4_CAPTURE_FAMILY_BUDGET_EXCEEDED');
    const startedAt = parseTimestamp(entry.startedAt, 'V4_CAPTURE_ENTRY_START_INVALID');
    const completedAt = parseTimestamp(entry.completedAt, 'V4_CAPTURE_ENTRY_COMPLETION_INVALID');
    assert.ok(completedAt >= startedAt, 'V4_CAPTURE_ENTRY_TIME_ORDER_INVALID');
    assert.ok(startedAt <= currentTime && completedAt <= currentTime, 'V4_CAPTURE_ENTRY_FROM_FUTURE');
    starts.push(startedAt);
    const bytes = Buffer.from(String(entry.bodyBase64 || ''), 'base64');
    assert.equal(bytes.toString('base64'), String(entry.bodyBase64 || ''), 'V4_CAPTURE_BODY_BASE64_INVALID');
    assert.equal(entry.bodySha256, sha256(bytes), 'V4_CAPTURE_BODY_HASH_MISMATCH');
    assert.ok(bytes.length <= CAPTURE_POLICY.maximumResponseBytes, 'V4_CAPTURE_RESPONSE_TOO_LARGE');
    if (entry.failure) {
      if (requireComplete) throw new Error('V4_CAPTURE_CONTAINS_FAILED_REQUEST:' + entry.failure);
      assert.equal(bytes.length, 0, 'V4_FAILED_CAPTURE_HAS_BODY');
      assert.equal(entry.actualUrl, normalized.url, 'V4_CAPTURE_FAILURE_ACTUAL_URL_MISMATCH');
      assert.ok(['TIMEOUT', 'NETWORK_ERROR', 'RESPONSE_TOO_LARGE', 'UNEXPECTED_AUTO_FOLLOW'].includes(entry.failure),
        'V4_CAPTURE_FAILURE_KIND_INVALID');
      if (entry.partialResponse !== undefined && entry.partialResponse !== null) {
        assert.ok(['TIMEOUT', 'RESPONSE_TOO_LARGE'].includes(entry.failure), 'V4_CAPTURE_PARTIAL_RESPONSE_FAILURE_KIND_INVALID');
        const partial = entry.partialResponse;
        const partialBytes = Buffer.from(String(partial.bodyBase64 || ''), 'base64');
        assert.equal(partialBytes.toString('base64'), String(partial.bodyBase64 || ''), 'V4_CAPTURE_PARTIAL_BODY_BASE64_INVALID');
        assert.equal(partial.bodySha256, sha256(partialBytes), 'V4_CAPTURE_PARTIAL_BODY_HASH_MISMATCH');
        assert.equal(partial.bodyBytes, partialBytes.length, 'V4_CAPTURE_PARTIAL_BODY_LENGTH_MISMATCH');
        assert.ok(partialBytes.length <= payload.policy.maximumResponseBytes, 'V4_CAPTURE_PARTIAL_BODY_TOO_LARGE');
        if (partial.status !== undefined && partial.status !== null) {
          assert.ok(Number.isInteger(partial.status) && partial.status >= 200 && partial.status <= 599,
            'V4_CAPTURE_PARTIAL_HTTP_STATUS_INVALID');
        }
        if (partial.actualUrl) {
          validateOfficialUrl(partial.actualUrl);
          assert.equal(partial.actualUrl, normalized.url, 'V4_CAPTURE_PARTIAL_AUTO_FOLLOW_REJECTED');
        }
        for (const [name, value] of Object.entries(partial.headers || {})) {
          assert.ok(CAPTURE_POLICY.allowedResponseHeaders.includes(name), 'V4_CAPTURE_PARTIAL_RESPONSE_HEADER_REJECTED:' + name);
          assert.ok(typeof value === 'string' && value.length <= 2_000 && !hasControlCharacters(value),
            'V4_CAPTURE_PARTIAL_RESPONSE_HEADER_INVALID:' + name);
        }
      }
    } else {
      assert.ok(Number.isInteger(entry.status) && entry.status >= 200 && entry.status <= 599, 'V4_CAPTURE_HTTP_STATUS_INVALID');
      assert.ok(entry.actualUrl === normalized.url, 'V4_CAPTURE_ACTUAL_URL_MISMATCH');
    }
    for (const [name, value] of Object.entries(entry.headers || {})) {
      assert.ok(CAPTURE_POLICY.allowedResponseHeaders.includes(name), 'V4_CAPTURE_RESPONSE_HEADER_REJECTED:' + name);
      assert.ok(typeof value === 'string' && value.length <= 2_000 && !hasControlCharacters(value),
        'V4_CAPTURE_RESPONSE_HEADER_INVALID:' + name);
    }
    const location = entry.headers?.location;
    if (location && entry.status >= 300 && entry.status < 400) {
      const target = new URL(location, normalized.url).toString();
      validateOfficialUrl(target);
    }
    const familyIdentity = normalized.family + ':' + identity;
    if (identities.has(familyIdentity)) {
      assert.ok(compareCaptureResponse(identities.get(familyIdentity), entry), 'V4_CAPTURE_CONFLICTING_DUPLICATE_IDENTITY');
    } else identities.set(familyIdentity, entry);
  }
  assert.equal(payload.requestCount, payload.entries.length, 'V4_CAPTURE_REQUEST_COUNT_MISMATCH');
  const derivedCounts = Object.fromEntries([...counts.entries()].sort(([a], [b]) => a.localeCompare(b)));
  assert.deepEqual(payload.familyCounts, derivedCounts, 'V4_CAPTURE_FAMILY_COUNTS_MISMATCH');
  const earliest = starts.length ? Math.min(...starts) : NaN;
  if (requireComplete && starts.length === 0) throw new Error('V4_CAPTURE_EMPTY');
  if (Number.isFinite(earliest)) {
    const age = currentTime - earliest;
    assert.ok(age >= 0 && age <= payload.policy.maximumCaptureAgeHours * 60 * 60 * 1000, 'V4_CAPTURE_EXPIRED_OR_FUTURE');
    assert.equal(Date.parse(payload.earliestAcquisitionAt), earliest, 'V4_CAPTURE_EARLIEST_TIME_MISMATCH');
    const captureDate = new Date(earliest).toISOString().slice(0, 10);
    assert.equal(payload.sourceReferenceDate || captureDate, captureDate, 'V4_CAPTURE_SOURCE_DATE_MISMATCH');
  } else if (requireComplete) throw new Error('V4_CAPTURE_ACQUISITION_TIME_MISSING');
  assert.ok(Array.isArray(payload.cacheReuses), 'V4_CAPTURE_CACHE_REUSE_LIST_MISSING');
  assert.ok(payload.cacheReuses.length <= CAPTURE_POLICY.maximumCacheReuses, 'V4_CACHE_REUSE_BUDGET_EXCEEDED');
  for (const reuse of payload.cacheReuses) {
    assert.ok(EVIDENCE_FAMILIES.includes(reuse.family), 'V4_CAPTURE_CACHE_REUSE_FAMILY_INVALID');
    validateOfficialUrl(reuse.url);
    const recordedAt = parseTimestamp(reuse.recordedAt, 'V4_CAPTURE_CACHE_REUSE_TIME_INVALID');
    assert.ok(recordedAt <= currentTime, 'V4_CAPTURE_CACHE_REUSE_FROM_FUTURE');
    if (reuse.contentHash !== null) assert.match(String(reuse.contentHash), SHA256_RE, 'V4_CAPTURE_CACHE_REUSE_HASH_INVALID');
  }
  return {
    passed: true,
    entryCount: payload.entries.length,
    earliestAcquisitionAt: Number.isFinite(earliest) ? new Date(earliest).toISOString() : null,
    familyCounts: derivedCounts
  };
}

export function createReplayTransport({
  payload,
  integrityLatch,
  syntheticMode = false,
  now = new Date(),
  expectedIntegrityBindingSha256,
  expectedPreregistrationSha256
} = {}) {
  validateCapturePayload(payload, {
    now,
    syntheticMode,
    expectedIntegrityBindingSha256,
    expectedPreregistrationSha256,
    requireComplete: !syntheticMode
  });
  const responseByIdentity = new Map();
  for (const entry of payload.entries) {
    const key = entry.request.family + ':' + entry.requestIdentitySha256;
    if (responseByIdentity.has(key)) {
      if (!compareCaptureResponse(responseByIdentity.get(key), entry)) throw new Error('V4_CAPTURE_CONFLICTING_DUPLICATE_IDENTITY');
    } else responseByIdentity.set(key, entry);
  }
  const lookupCounts = new Map();
  const familyContext = new AsyncLocalStorage();
  let latched;
  let replayLookupCount = 0;
  const cacheReuses = [];

  function trip(code) {
    if (!latched) {
      latched = new Error(code);
      integrityLatch?.(code);
    }
    return latched;
  }

  async function replayFetch(url, init = {}) {
    if (latched) throw latched;
    let request;
    try { request = normalizeRequest(url, init, familyContext.getStore()); }
    catch (error) { throw trip(error.message || 'V4_REPLAY_REQUEST_POLICY_REJECTED'); }
    const identity = requestIdentity(request);
    const key = request.family + ':' + identity;
    const entry = responseByIdentity.get(key);
    if (!entry) throw trip('V4_REPLAY_MISS');
    if (entry.requestIdentitySha256 !== identity || stableJson(entry.request) !== stableJson(request)) throw trip('V4_REPLAY_REQUEST_IDENTITY_MISMATCH');
    replayLookupCount += 1;
    if (replayLookupCount > CAPTURE_POLICY.maximumReplayLookups) throw trip('V4_REPLAY_LOOKUP_BUDGET_EXCEEDED');
    lookupCounts.set(key, (lookupCounts.get(key) || 0) + 1);
    if (entry.failure) {
      if (entry.failure === 'TIMEOUT') return makeMarkedFailure(request.url, 'TIMEOUT');
      return makeMarkedFailure(request.url, 'NETWORK_ERROR');
    }
    const body = Buffer.from(entry.bodyBase64, 'base64');
    const nullBody = entry.status === 204 || entry.status === 205 || entry.status === 304;
    const response = new Response(nullBody ? null : body, {
      status: entry.status,
      statusText: entry.statusText,
      headers: entry.headers
    });
    Object.defineProperty(response, 'url', { value: entry.actualUrl });
    return response;
  }

  function withEvidenceFamily(family, callback) {
    if (!EVIDENCE_FAMILIES.includes(family)) throw trip('V4_REPLAY_FAMILY_INVALID');
    return familyContext.run(family, callback);
  }
  function withCaseFamily(caseId, callback) {
    const family = CASE_EVIDENCE_FAMILY[caseId];
    if (!family && caseId !== 'unsupported-sfrsi-6-exploration-evaluation') throw trip('V4_REPLAY_CASE_FAMILY_UNMAPPED');
    return familyContext.run(family, callback);
  }
  function recordCacheReuse(url, result) {
    const family = familyContext.getStore();
    if (!EVIDENCE_FAMILIES.includes(family)) throw trip('V4_REPLAY_FAMILY_INVALID');
    if (cacheReuses.length >= CAPTURE_POLICY.maximumCacheReuses) throw trip('V4_CACHE_REUSE_BUDGET_EXCEEDED');
    cacheReuses.push({ family, url: validateOfficialUrl(url), recordedAt: isoFrom(now), contentHash: result?.contentHash || null });
  }
  function assertHealthy() { if (latched) throw latched; }
  return {
    fetch: replayFetch,
    withEvidenceFamily,
    withCaseFamily,
    recordCacheReuse,
    assertHealthy,
    get lookupCounts() { return lookupCounts; },
    get replayLookupCount() { return replayLookupCount; },
    get unusedResponseCount() { return responseByIdentity.size - lookupCounts.size; },
    get cacheReuses() { return cacheReuses; },
    get terminalIntegrityFailure() { return latched?.message || null; },
    trip
  };
}

export function bindProductionControlledRetriever({ transport, cache = new SourceCache(), validator } = {}) {
  assert.ok(transport && typeof transport.fetch === 'function', 'V4_EXPLICIT_EVIDENCE_TRANSPORT_REQUIRED');
  const webRetriever = new ControlledWebRetriever(validator, cache);
  const original = webRetriever.fetchOfficialSource.bind(webRetriever);
  webRetriever.fetchOfficialSource = async (url, options = {}) => {
    try { validateOfficialUrl(url); }
    catch (error) {
      transport.assertHealthy?.();
      transport.trip?.('V4_PRODUCTION_REQUEST_URL_BLOCKED');
      throw error;
    }
    const result = await original(url, { ...options, customFetch: transport.fetch });
    if (result.cached) transport.recordCacheReuse?.(url, result);
    if (result.status === 'REDIRECT_REJECTED') transport.trip?.('V4_PRODUCTION_REDIRECT_REJECTED');
    transport.assertHealthy?.();
    return result;
  };
  return webRetriever;
}

export async function runBoundedCapture({
  transport,
  execute,
  syntheticMode = false,
  runnerConfigurationPath,
  preregistrationPath,
  root = ROOT,
  gitExecutable
} = {}) {
  assert.ok(transport && typeof transport.fetch === 'function', 'V4_CAPTURE_TRANSPORT_REQUIRED');
  assert.equal(typeof execute, 'function', 'V4_CAPTURE_EXECUTOR_REQUIRED');
  if (syntheticMode) {
    assert.equal(transport.synthetic, true, 'V4_SYNTHETIC_CAPTURE_MODE_MISMATCH');
  } else {
    assertNode22();
    assert.equal(transport.synthetic, false, 'V4_LIVE_CAPTURE_MODE_MISMATCH');
    assert.ok(transport.acquisitionPermit && reviewedAcquisitionPermits.has(transport.acquisitionPermit),
      'V4_LIVE_CAPTURE_REQUIRES_RECOMPUTED_REVIEWED_PERMIT');
    assert.equal(path.resolve(transport.runnerConfigurationPath || ''), path.resolve(runnerConfigurationPath || ''),
      'V4_CAPTURE_CONFIGURATION_PATH_MISMATCH');
    const configRead = await readObjectAndHash(runnerConfigurationPath);
    const verified = await verifyFrozenRunnerConfiguration({ binding: configRead.value, root, gitExecutable });
    assert.equal(configRead.value.integrityBindingSha256, transport.integrityBindingSha256,
      'V4_CAPTURE_TRANSPORT_RUNNER_BINDING_MISMATCH');
    assert.ok(Array.isArray(verified.snapshot.captureInventory) && verified.snapshot.captureInventory.length > 0,
      'V4_LIVE_CAPTURE_INVENTORY_NOT_REVIEWED');
    assert.match(String(verified.snapshot.productionEvidenceAdapterSha256 || ''), SHA256_RE,
      'V4_PRODUCTION_OBSERVATION_ADAPTER_NOT_REVIEWED');
    assert.equal(path.resolve(transport.preregistrationPath || ''), path.resolve(preregistrationPath || ''),
      'V4_CAPTURE_PREREGISTRATION_PATH_MISMATCH');
    assert.equal(transport.preregistrationSha256, verified.snapshot.preregistrationSha256,
      'V4_CAPTURE_PREREGISTRATION_BINDING_MISMATCH');
    await verifyFrozenPreregistration(preregistrationPath, transport.preregistrationSha256, verified.snapshot, root);
  }
  let result;
  try {
    result = await ambientNetworkDisabled(() => execute({
      webRetriever: bindProductionControlledRetriever({ transport }),
      withEvidenceFamily: transport.withEvidenceFamily,
      withCaseFamily: transport.withCaseFamily
    }));
    transport.assertHealthy();
    transport.assertCaptureComplete?.();
    if (!syntheticMode) {
      const configRead = await readObjectAndHash(runnerConfigurationPath);
      await verifyFrozenRunnerConfiguration({ binding: configRead.value, root, gitExecutable });
    }
    return { result, capture: await transport.finalizeCapture('COMPLETE'), synthetic: syntheticMode };
  } catch (error) {
    try { await transport.finalizeCapture('FAILED'); } catch {}
    throw error;
  }
}

export async function loadCapturePayload(payloadPath, root = ROOT) {
  const absolute = assertInArtifactNamespace(payloadPath, root);
  await assertNoSymlinkPath(root, path.relative(root, absolute));
  const bytes = await readFile(absolute);
  const payload = JSON.parse(bytes.toString('utf8'));
  return { payload, bytes, sha256: sha256(bytes) };
}

function validateEvidenceLock(lock, { config, preregistrationSha256, payloadSha256, payload, now }) {
  assert.ok(lock && lock.mode === FUTURE_EVIDENCE_POLICY.transportMode && lock.frozen === true, 'V4_EVIDENCE_LOCK_INVALID');
  assert.equal(lock.synthetic, false, 'V4_EVIDENCE_LOCK_SYNTHETIC');
  assert.equal(lock.runnerIntegrityBindingSha256, config.integrityBindingSha256, 'V4_EVIDENCE_LOCK_RUNNER_BINDING_MISMATCH');
  assert.equal(lock.preregistrationSha256, preregistrationSha256, 'V4_EVIDENCE_LOCK_PREREGISTRATION_MISMATCH');
  assert.equal(lock.capturePayloadSha256, payloadSha256, 'V4_EVIDENCE_LOCK_PAYLOAD_HASH_MISMATCH');
  assert.equal(lock.captureFileInventorySha256, config.fileInventorySha256, 'V4_EVIDENCE_LOCK_FILE_INVENTORY_MISMATCH');
  assert.ok(Array.isArray(config.captureInventory) && config.captureInventory.length > 0,
    'V4_LIVE_CAPTURE_INVENTORY_NOT_REVIEWED');
  assert.equal(lock.captureInventorySha256, captureInventoryDigest(config.captureInventory),
    'V4_EVIDENCE_LOCK_CAPTURE_INVENTORY_MISMATCH');
  assert.match(String(config.productionEvidenceAdapterSha256 || ''), SHA256_RE,
    'V4_PRODUCTION_OBSERVATION_ADAPTER_NOT_REVIEWED');
  assert.equal(lock.captureAdapterSha256, config.productionEvidenceAdapterSha256,
    'V4_EVIDENCE_LOCK_ADAPTER_MISMATCH');
  for (const key of ['contractSha256', 'productionFingerprintSha256', 'sourceFingerprintSha256',
    'schemaPromptFingerprintSha256', 'protectedHistorySha256', 'evaluationFingerprintSha256']) {
    assert.equal(lock[key], config.designFingerprints[key], 'V4_EVIDENCE_LOCK_FINGERPRINT_MISMATCH:' + key);
  }
  const validated = validateCapturePayload(payload, {
    now,
    expectedIntegrityBindingSha256: config.integrityBindingSha256,
    expectedPreregistrationSha256: preregistrationSha256,
    syntheticMode: false,
    requireComplete: true
  });
  const capturedAt = validated.earliestAcquisitionAt;
  assert.equal(lock.capturedAt, capturedAt, 'V4_EVIDENCE_LOCK_CAPTURE_TIME_MISMATCH');
  assert.equal(lock.sourceReferenceDate, capturedAt.slice(0, 10), 'V4_EVIDENCE_LOCK_DATE_MISMATCH');
  return validated;
}

export async function writeFrozenEvidenceLock({
  outputPath,
  payloadPath,
  runnerConfigurationPath,
  gitExecutable,
  preregistrationPath,
  now = new Date(),
  root = ROOT
} = {}) {
  const destination = outsideProtectedTree(outputPath, root);
  const { value: runnerConfiguration } = await readObjectAndHash(runnerConfigurationPath, root);
  await verifyFrozenRunnerConfiguration({ binding: runnerConfiguration, root, gitExecutable });
  const { payload, sha256: payloadSha256 } = await loadCapturePayload(payloadPath, root);
  const preregRead = await readObjectAndHash(preregistrationPath, root);
  const preregistrationSha256 = preregRead.sha256;
  const preregistration = preregRead.value;
  assert.equal(preregistrationSha256, runnerConfiguration.preregistrationSha256,
    'V4_LOCK_PREREGISTRATION_NOT_BOUND_BY_RUNNER_CONFIGURATION');
  validateCapturePayload(payload, {
    now,
    expectedIntegrityBindingSha256: runnerConfiguration.integrityBindingSha256,
    expectedPreregistrationSha256: preregistrationSha256,
    syntheticMode: false,
    requireComplete: true
  });
  const earliest = payload.earliestAcquisitionAt;
  const lock = {
    profile: RUNNER_PROFILE,
    mode: CAPTURE_POLICY.transportMode,
    frozen: true,
    synthetic: false,
    preregistrationSha256,
    contractSha256: preregistration.contractSha256,
    productionFingerprintSha256: preregistration.productionFingerprintSha256,
    sourceFingerprintSha256: preregistration.sourceFingerprintSha256,
    schemaPromptFingerprintSha256: preregistration.schemaPromptFingerprintSha256,
    protectedHistorySha256: preregistration.protectedHistorySha256,
    evaluationFingerprintSha256: preregistration.evaluationFingerprintSha256,
    runnerIntegrityBindingSha256: runnerConfiguration.integrityBindingSha256,
    capturePayloadSha256: payloadSha256,
    captureFileInventorySha256: runnerConfiguration.fileInventorySha256,
    captureInventorySha256: Array.isArray(runnerConfiguration.captureInventory)
      ? captureInventoryDigest(runnerConfiguration.captureInventory)
      : null,
    captureAdapterSha256: runnerConfiguration.productionEvidenceAdapterSha256 || null,
    capturedAt: earliest,
    sourceReferenceDate: earliest.slice(0, 10),
    lockedAt: isoFrom(now),
    earliestAcquisitionAt: earliest,
    requestCount: payload.requestCount,
    familyCounts: payload.familyCounts,
    nodeVersion: payload.provenance?.nodeVersion || null,
    execPath: payload.provenance?.execPath || null
  };
  // The current V4 runner freeze intentionally lacks a reviewed live request
  // inventory and production observation adapter. Keep live lock creation held.
  assert.ok(Array.isArray(runnerConfiguration.captureInventory) && runnerConfiguration.captureInventory.length > 0,
    'V4_LIVE_CAPTURE_INVENTORY_NOT_REVIEWED');
  assert.match(String(runnerConfiguration.productionEvidenceAdapterSha256 || ''), SHA256_RE,
    'V4_PRODUCTION_OBSERVATION_ADAPTER_NOT_REVIEWED');
  await mkdir(path.dirname(destination), { recursive: true });
  const bytes = Buffer.from(JSON.stringify(lock, null, 2) + '\n', 'utf8');
  await writeExclusiveDurable(destination, bytes, root);
  return { path: destination, sha256: sha256(bytes), lock };
}

async function boundedSemanticSend(sendSemantic, args, { timeoutMs, maximumBytes, signal }) {
  const controller = new AbortController();
  const relayAbort = () => controller.abort();
  signal?.addEventListener('abort', relayAbort, { once: true });
  if (signal?.aborted) controller.abort();
  let timeoutId;
  const chunks = [];
  let retainedBytes = 0;
  let reader;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      controller.abort();
      reject(new Error('V4_SEMANTIC_DEADLINE_EXCEEDED'));
    }, timeoutMs);
  });
  try {
    const value = await Promise.race([
      Promise.resolve().then(() => explicitTransportCall(() => sendSemantic({ ...args, signal: controller.signal, timeoutMs }))),
      timeout
    ]);
    if (value instanceof Response) {
      reader = value.body?.getReader();
      if (!reader) return { text: '', bytes: Buffer.alloc(0) };
      try {
        while (true) {
          const part = await Promise.race([reader.read(), timeout]);
          if (part.done) break;
          const chunk = Buffer.from(part.value);
          const remaining = Math.max(0, maximumBytes - retainedBytes);
          if (remaining) {
            const retained = chunk.subarray(0, remaining);
            chunks.push(retained);
            retainedBytes += retained.length;
          }
          if (part.value.byteLength > remaining) {
            void reader.cancel().catch(() => {});
            throw new Error('V4_SEMANTIC_RESPONSE_TOO_LARGE');
          }
        }
      } catch (error) {
        void reader.cancel(error).catch(() => {});
        throw error;
      } finally { try { reader.releaseLock(); } catch {} }
      const bytes = Buffer.concat(chunks);
      return { text: bytes.toString('utf8'), bytes };
    }
    if (typeof value !== 'string') throw new Error('V4_SEMANTIC_RESPONSE_INVALID');
    const bytes = Buffer.from(value, 'utf8');
    if (bytes.length > maximumBytes) {
      chunks.push(bytes.subarray(0, maximumBytes));
      retainedBytes = maximumBytes;
      throw new Error('V4_SEMANTIC_RESPONSE_TOO_LARGE');
    }
    return { text: value, bytes };
  } catch (error) {
    void reader?.cancel(error).catch(() => {});
    const partial = Buffer.concat(chunks);
    error.partialResponse = {
      bodyBase64: partial.toString('base64'),
      bodySha256: sha256(partial),
      bodyBytes: partial.length
    };
    throw error;
  } finally {
    clearTimeout(timeoutId);
    signal?.removeEventListener('abort', relayAbort);
  }
}

async function readObjectAndHash(filePath, root = ROOT) {
  const absolute = assertInArtifactNamespace(filePath, root);
  await assertNoSymlinkPath(root, path.relative(root, absolute));
  const bytes = await readFile(absolute);
  return { value: JSON.parse(bytes.toString('utf8')), bytes, sha256: sha256(bytes) };
}

async function assertNamespaceUnused(namespaceDirectory) {
  assert.ok(namespaceDirectory, 'V4_CONSUMPTION_NAMESPACE_REQUIRED');
  for (const name of ['consumed-v4.json', 'acceptance-v4.json', 'acceptance-v4.json.tmp', 'runner-v4.partial.jsonl']) {
    const target = path.join(namespaceDirectory, name);
    try {
      await access(target);
      throw new Error('V4_NAMESPACE_ALREADY_USED:' + name);
    } catch (error) {
      if (error?.message?.startsWith('V4_NAMESPACE_ALREADY_USED:')) throw error;
      if (error?.code !== 'ENOENT') throw error;
    }
  }
}

async function runFixedV4CaseLoop({
  semanticTransport,
  executeCase,
  evidenceTransport,
  withEvidenceFamily,
  webRetriever,
  requestGuard,
  semanticLimits = {
    timeoutMs: RESOURCE_POLICY.timeoutMs,
    maximumBytes: RESOURCE_POLICY.maximumSemanticResponseBytes
  },
  writeProgress = async () => {},
  now = () => new Date()
}) {
  const rows = [];
  for (const caseId of CASE_IDS) {
    const semanticState = { sends: 0, pending: [], journalPromises: [], responseSha256: null, responseBytes: null };
    const sendSemantic = args => {
      if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('V4_SEMANTIC_REQUEST_SHAPE_INVALID');
      if (args.caseId !== undefined && args.caseId !== caseId) throw new Error('V4_SEMANTIC_CASE_ID_OVERRIDE_BLOCKED');
      semanticState.sends += 1;
      if (semanticState.sends !== 1) throw new Error('V4_EXTRA_OR_RETRY_SEMANTIC_CALL_BLOCKED');
      const operation = requestGuard.invoke(caseId, async () => {
        const response = await boundedSemanticSend(semanticTransport, { ...args, caseId }, {
          timeoutMs: semanticLimits.timeoutMs,
          maximumBytes: semanticLimits.maximumBytes
        });
        semanticState.responseSha256 = sha256(response.bytes);
        semanticState.responseBytes = response.bytes.length;
        await writeProgress({
          event: 'SEMANTIC_RESPONSE_RECEIVED',
          caseId,
          receivedAt: isoFrom(now()),
          responseSha256: semanticState.responseSha256,
          responseBytes: semanticState.responseBytes
        });
        return response.text;
      });
      semanticState.pending.push(operation);
      const journalPromise = operation.catch(async error => {
        await writeProgress({
          event: 'SEMANTIC_RESPONSE_FAILED',
          caseId,
          failedAt: isoFrom(now()),
          error: String(error?.message || error).slice(0, 240),
          partialResponseBase64: error?.partialResponse?.bodyBase64,
          partialResponseSha256: error?.partialResponse?.bodySha256,
          partialResponseBytes: error?.partialResponse?.bodyBytes
        });
      }).catch(() => {});
      semanticState.journalPromises.push(journalPromise);
      return operation;
    };
    const execute = () => executeCase({
      caseId,
      sendSemantic,
      evidenceTransport,
      withEvidenceFamily,
      webRetriever
    });
    const family = CASE_EVIDENCE_FAMILY[caseId];
    let caseResult;
    try {
      caseResult = family && withEvidenceFamily
        ? await withEvidenceFamily(family, execute)
        : await execute();
      if (semanticState.pending.length) await Promise.all(semanticState.pending);
      if (semanticState.journalPromises.length) await Promise.all(semanticState.journalPromises);
    } catch (error) {
      if (semanticState.pending.length) {
        try { await Promise.all(semanticState.pending); } catch {}
      }
      if (semanticState.journalPromises.length) await Promise.all(semanticState.journalPromises);
      throw error;
    }
    assert.equal(semanticState.sends, 1, 'V4_CASE_MUST_SEND_EXACTLY_ONCE:' + caseId);
    assert.ok(semanticState.responseSha256, 'V4_CASE_SEMANTIC_RESPONSE_MISSING:' + caseId);
    const row = {
      caseId,
      completedAt: isoFrom(now()),
      resultSha256: sha256(stableJson(caseResult)),
      semanticResponseSha256: semanticState.responseSha256,
      semanticResponseBytes: semanticState.responseBytes
    };
    rows.push(row);
    await writeProgress({ event: 'CASE_COMPLETED', ...row });
  }
  assert.equal(rows.length, CASE_IDS.length, 'V4_CASE_COUNT_MISMATCH');
  assert.deepEqual(rows.map(row => row.caseId), CASE_IDS, 'V4_CASE_ORDER_MISMATCH');
  assert.deepEqual(Object.fromEntries(requestGuard.counts), Object.fromEntries(CASE_IDS.map(id => [id, 1])),
    'V4_NINE_CALL_BUDGET_NOT_EXHAUSTED');
  return { rows, callCounts: Object.fromEntries(requestGuard.counts) };
}

function assertCanonicalNamespace(namespaceDirectory, runnerConfiguration, root) {
  assert.equal(runnerConfiguration.semanticNamespace, ARTIFACT_NAMESPACE + 'semantic-run-v4',
    'V4_SEMANTIC_NAMESPACE_CONFIGURATION_INVALID');
  const expected = path.resolve(root, runnerConfiguration.semanticNamespace);
  const supplied = path.resolve(namespaceDirectory);
  assert.equal(supplied, expected, 'V4_SEMANTIC_NAMESPACE_NOT_FROZEN');
  assertInArtifactNamespace(supplied, root);
  return supplied;
}

/**
 * Offline-only exercise of the same fixed case loop. This entry point is
 * explicitly synthetic and cannot call live preflight, reserve consumption,
 * or create an acceptance artifact.
 */
export async function runOfflineSyntheticV4CaseLoop({
  synthetic,
  semanticTransport,
  executeCase,
  evidenceTransport,
  withEvidenceFamily,
  webRetriever,
  minimumStartGapMs = 0,
  clock = () => performance.now(),
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  timeoutMs = RESOURCE_POLICY.timeoutMs,
  maximumResponseBytes = RESOURCE_POLICY.maximumSemanticResponseBytes,
  writeProgress = async () => {},
  now = () => new Date()
} = {}) {
  assert.equal(synthetic, true, 'V4_OFFLINE_CASE_LOOP_REQUIRES_SYNTHETIC_FIXTURE');
  assert.ok(Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= RESOURCE_POLICY.timeoutMs,
    'V4_SYNTHETIC_SEMANTIC_TIMEOUT_INVALID');
  assert.ok(Number.isSafeInteger(maximumResponseBytes) && maximumResponseBytes > 0 &&
    maximumResponseBytes <= RESOURCE_POLICY.maximumSemanticResponseBytes, 'V4_SYNTHETIC_SEMANTIC_SIZE_LIMIT_INVALID');
  assert.equal(typeof semanticTransport, 'function', 'V4_EXPLICIT_SYNTHETIC_TRANSPORT_REQUIRED');
  assert.equal(typeof executeCase, 'function', 'V4_CASE_EXECUTOR_REQUIRED');
  const guard = createRequestBudgetGuard({ caseIds: CASE_IDS, minimumStartGapMs, clock, sleep });
  return ambientNetworkDisabled(() => runFixedV4CaseLoop({
    semanticTransport,
    executeCase,
    evidenceTransport,
    withEvidenceFamily,
    webRetriever,
    requestGuard: guard,
    semanticLimits: { timeoutMs, maximumBytes: maximumResponseBytes },
    writeProgress,
    now
  }));
}

/**
 * The live semantic orchestrator recomputes each prerequisite itself. The only
 * semantic network edge is sendSemantic; the evidence edge is the strict replay
 * transport. Per-case code receives one guarded send and cannot add cases.
 */
export async function runBoundedV4SemanticPhase({
  root = ROOT,
  gitExecutable,
  runnerConfigurationPath,
  preregistrationPath,
  evidenceLockPath,
  capturePayloadPath,
  namespaceDirectory,
  authorizedGeminiCalls,
  sharedAllowanceReader,
  semanticTransport,
  executeCase,
  now = () => new Date()
} = {}) {
  assertNode22();
  assert.equal(typeof sharedAllowanceReader, 'function', 'V4_SHARED_ALLOWANCE_READER_REQUIRED');
  assert.equal(typeof semanticTransport, 'function', 'V4_EXPLICIT_SEMANTIC_TRANSPORT_REQUIRED');
  assert.equal(typeof executeCase, 'function', 'V4_CASE_EXECUTOR_REQUIRED');
  const outputPath = path.resolve(namespaceDirectory, 'acceptance-v4.json');
  outsideProtectedTree(outputPath, root);
  const [bindingRead, preregRead, lockRead, payloadRead] = await Promise.all([
    readObjectAndHash(runnerConfigurationPath, root),
    readObjectAndHash(preregistrationPath, root),
    readObjectAndHash(evidenceLockPath, root),
    loadCapturePayload(capturePayloadPath, root)
  ]);
  assertCanonicalNamespace(namespaceDirectory, bindingRead.value, root);
  assert.equal(preregRead.sha256, bindingRead.value.preregistrationSha256,
    'V4_RUNNER_CONFIGURATION_PREREGISTRATION_MISMATCH');
  await mkdir(namespaceDirectory, { recursive: true });
  await assertNoSymlinkPath(root, path.relative(root, namespaceDirectory), { mustExist: true });
  await assertNamespaceUnused(namespaceDirectory);
  const verified = await verifyFrozenRunnerConfiguration({
    binding: bindingRead.value,
    root,
    gitExecutable
  });
  const evidenceValidation = validateEvidenceLock(lockRead.value, {
    config: verified.snapshot,
    preregistrationSha256: preregRead.sha256,
    payloadSha256: payloadRead.sha256,
    payload: payloadRead.payload,
    now: now()
  });
  assert.ok(evidenceValidation.passed, 'V4_EVIDENCE_LOCK_VALIDATION_FAILED');
  const sharedAllowance = await sharedAllowanceReader();
  const preflight = await validateV4LivePreflight({
    preregistration: preregRead.value,
    evidenceLock: lockRead.value,
    sharedAllowance,
    authorizedGeminiCalls,
    preregistrationSha256: preregRead.sha256,
    namespaceDirectory,
    now: now()
  });
  assert.equal(preflight.passed, true, 'V4_LIVE_PREFLIGHT_NOT_PASSED:' + preflight.failures.join(','));
  const binding = {
    preregistrationSha256: preregRead.sha256,
    contractSha256: preregRead.value.contractSha256,
    evidenceLockSha256: lockRead.sha256,
    productionFingerprintSha256: preregRead.value.productionFingerprintSha256,
    sourceFingerprintSha256: preregRead.value.sourceFingerprintSha256,
    schemaPromptFingerprintSha256: preregRead.value.schemaPromptFingerprintSha256,
    protectedHistorySha256: preregRead.value.protectedHistorySha256,
    evaluationFingerprintSha256: preregRead.value.evaluationFingerprintSha256,
    sharedAllowanceObservation: { authorizedGeminiCalls }
  };
  const replay = createReplayTransport({
    payload: payloadRead.payload,
    integrityLatch: () => {},
    now: now(),
    expectedIntegrityBindingSha256: bindingRead.value.integrityBindingSha256,
    expectedPreregistrationSha256: preregRead.sha256
  });
  await reserveConsumption(namespaceDirectory, binding, preflight);
  const partialPath = path.join(namespaceDirectory, 'runner-v4.partial.jsonl');
  const partialHandle = await open(partialPath, 'wx');
  await partialHandle.sync();
  try {
    const webRetriever = bindProductionControlledRetriever({ transport: replay });
    const writeProgress = async row => {
      await partialHandle.writeFile(JSON.stringify(row) + '\n');
      await partialHandle.sync();
    };
    const outcome = await ambientNetworkDisabled(() => runFixedV4CaseLoop({
      semanticTransport,
      executeCase,
      evidenceTransport: replay.fetch,
      withEvidenceFamily: replay.withEvidenceFamily,
      webRetriever,
      requestGuard: createRequestBudgetGuard({ caseIds: CASE_IDS, minimumStartGapMs: RESOURCE_POLICY.minimumStartGapMs }),
      writeProgress,
      now
    }));
    replay.assertHealthy();
    const finalSnapshot = await verifyFrozenRunnerConfiguration({
      binding: bindingRead.value,
      root,
      gitExecutable
    });
    assert.equal(finalSnapshot.passed, true, 'V4_POST_RUN_INTEGRITY_FAILED');
    const finalDocument = {
      profile: V4_PROFILE,
      status: 'BOUNDED_SEMANTIC_PHASE_COMPLETE',
      synthetic: false,
      runnerIntegrityBindingSha256: bindingRead.value.integrityBindingSha256,
      preregistrationSha256: preregRead.sha256,
      evidenceLockSha256: lockRead.sha256,
      capturePayloadSha256: payloadRead.sha256,
      rows: outcome.rows,
      callCounts: outcome.callCounts,
      replayCacheReuses: replay.cacheReuses,
      unusedReplayResponseCount: replay.unusedResponseCount
    };
    await partialHandle.writeFile(JSON.stringify({ terminal: finalDocument.status, completedAt: isoFrom(now()) }) + '\n');
    await partialHandle.sync();
    await partialHandle.close();
    await writeExclusiveDurable(outputPath, Buffer.from(JSON.stringify(finalDocument, null, 2) + '\n'));
    return finalDocument;
  } catch (error) {
    try {
      await partialHandle.writeFile(JSON.stringify({ terminal: 'FAILED_CONSUMED', at: isoFrom(now()), error: String(error?.message || error).slice(0, 300) }) + '\n');
      await partialHandle.sync();
      await partialHandle.close();
    } catch {}
    throw error;
  }
}

export async function runOfflineIntegrityCheck({ bindingPath, root = ROOT, gitExecutable } = {}) {
  const result = await verifyFrozenRunnerConfiguration({ bindingPath, root, gitExecutable });
  return {
    status: 'OFFLINE_INTEGRITY_CHECK_PASSED',
    profile: RUNNER_PROFILE,
    integrityBindingSha256: result.integrityBindingSha256,
    head: result.snapshot.head,
    branch: result.snapshot.branch,
    fileCount: result.snapshot.fileRows.length
  };
}

function parseCli(argv) {
  const args = [...argv];
  if (args.length !== 3 || args[0] !== '--offline-check' || args[1] !== '--binding') {
    throw new Error('Usage: node scripts/iras_v4_capture_replay_runner.mjs --offline-check --binding <frozen-runner-configuration.json>');
  }
  return { bindingPath: path.resolve(args[2]) };
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath && pathToFileURL(invokedPath).href === import.meta.url) {
  try {
    const options = parseCli(process.argv.slice(2));
    const gitExecutable = process.env.CODEX_GIT_EXECUTABLE;
    if (!gitExecutable || !path.isAbsolute(gitExecutable)) throw new Error('Set CODEX_GIT_EXECUTABLE to an absolute git.exe path.');
    const result = await runOfflineIntegrityCheck({ ...options, gitExecutable });
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } catch (error) {
    process.stderr.write('V4_OFFLINE_CHECK_FAILED:' + String(error?.message || error) + '\n');
    process.exitCode = 1;
  }
}
