// Offline only. Run with Node 22 and --import tsx after review and commit.
import '../../../docs/evaluation/multi-authority-workstreams/iras-v4-negative-controls-2026-10-06/block-external-network.mjs';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as runner from '../../../scripts/iras_v4_capture_replay_runner.mjs';
import { writeFrozenV4Preregistration } from '../../../tests/evaluation/singapore/iras-first-targeted-acceptance-v4.mjs';

const root = path.resolve(fileURLToPath(new URL('../../../', import.meta.url)));
assert.equal(path.resolve(process.cwd()), root, 'Run from the repository root');
assert.equal(Number(process.versions.node.split('.')[0]), 22);
const gitExecutable = process.env.CODEX_GIT_EXECUTABLE;
assert.ok(gitExecutable && path.isAbsolute(gitExecutable), 'Explicit Git executable required');
const directory = path.dirname(fileURLToPath(import.meta.url));
const semanticNamespace = 'artifacts/iras-v4-acceptance-repaired-2026-10-06/semantic-run-v4';
const namespaceDirectory = path.join(root, semanticNamespace);
const runnerConfigurationPath = path.join(directory, 'runner-configuration.json');
const preregistrationPath = path.join(directory, 'preregistration.json');
const activationConfigurationPath = path.join(directory, 'activation-configuration.json');
const validationPath = path.join(directory, 'freeze-validation.json');
async function assertAbsent(target) {
  await assert.rejects(stat(target), error => error.code === 'ENOENT');
}
for (const target of [namespaceDirectory, runnerConfigurationPath, preregistrationPath,
  activationConfigurationPath, validationPath]) await assertAbsent(target);

const historicalRoot = 'artifacts/iras-v4-runner-integrity-2026-10-06';
const archivalRunnerConfigurationPath = path.join(root, historicalRoot, 'runner-configuration.json');
const protectedPaths = [
  `${historicalRoot}/semantic-run-v4/runner-v4.partial.jsonl`,
  `${historicalRoot}/semantic-run-v4/consumed-v4.json`,
  `${historicalRoot}/official-capture-2026-10-06/capture-payload.json`,
  `${historicalRoot}/activation-timeout-fix/activation-configuration.json`,
  'tests/evaluation/singapore/iras-first-targeted-acceptance-v4.json',
  'artifacts/iras-v4-offline-repairs-2026-10-06/baseline-replay.json'
];
async function protectedHashes() {
  return Object.fromEntries(await Promise.all(protectedPaths.map(async relative =>
    [relative, runner.sha256(await readFile(path.join(root, relative)))])));
}
const before = await protectedHashes();
const existing = JSON.parse(await readFile(path.join(root, protectedPaths[3]), 'utf8'));
const captureInventory = existing.captureInventory;
assert.equal(runner.captureInventoryDigest(captureInventory),
  '131b62d87bd13dfd53e1613b914179f7d472ad32df37f12ad946977ac0dff5bf');
assert.equal(runner.validateActivationInventory(captureInventory), true);
assert.equal(captureInventory.length, 15);
assert.deepEqual(await runner.buildApprovedCaptureInventory(), captureInventory,
  'Current approved inventory differs from the reviewed candidate');
const reviewedCommit = execFileSync(gitExecutable, ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();

await runner.writeFrozenRunnerConfiguration({ outputPath: runnerConfigurationPath,
  semanticNamespace, root, gitExecutable, reviewedCommit });
const inputs = await runner.buildActivationPreregistrationInputs({ archivalRunnerConfigurationPath,
  runnerConfigurationPath, captureInventory, root, gitExecutable });
await writeFrozenV4Preregistration(preregistrationPath, { frozen: true, ...inputs.preregistrationBindings });
await runner.writeFrozenActivationConfiguration({ outputPath: activationConfigurationPath,
  archivalRunnerConfigurationPath, runnerConfigurationPath, preregistrationPath,
  captureInventory, root, gitExecutable });
const verified = await runner.verifyFrozenActivationConfiguration({ activationConfigurationPath, root, gitExecutable });
const capability = await runner.loadReviewedV4ExecutionCapability({ activationConfigurationPath, root, gitExecutable });
const permit = await runner.validateReviewedAcquisitionPermit({ runnerConfigurationPath,
  activationConfigurationPath, root, gitExecutable });
assert.ok(capability && permit);
assert.equal(verified.runnerConfiguration.semanticNamespace, semanticNamespace);
assert.equal(verified.preregistration.promptFingerprints.length, 9);
await assertAbsent(namespaceDirectory);
const after = await protectedHashes();
assert.deepEqual(after, before, 'Protected historical inputs changed');
const bindings = {};
for (const target of [runnerConfigurationPath, preregistrationPath, activationConfigurationPath]) {
  bindings[path.relative(root, target).split(path.sep).join('/')] = runner.sha256(await readFile(target));
}
const report = {
  status: 'OFFLINE_BINDINGS_VERIFIED_CAPTURE_AND_SEMANTIC_EXECUTION_HELD',
  reviewedCommit, semanticNamespace, namespaceAbsent: true,
  captureInventorySha256: existing.captureInventorySha256,
  captureInventoryCount: captureInventory.length,
  bindings, promptRowsVerified: 9,
  liveCallsMade: 0, capturesMade: 0, reservationOrDispatchOccurred: false,
  protectedInputsUnchanged: true, protectedInputSha256: { before, after },
  nextRequired: ['NEW_CAPTURE_AUTHORIZATION', 'FRESH_CODE_BOUND_CAPTURE_AND_EVIDENCE_LOCK',
    'CURRENT_SHARED_ALLOWANCE_AND_PROVIDER_QUOTA', 'NEW_NINE_CASE_GEMINI_AUTHORIZATION']
};
await writeFile(validationPath, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(report, null, 2));
