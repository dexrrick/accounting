// Offline comparison only: no capture, model request, activation, or frozen output writes.
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';

const [modulePath, checkoutRoot, configPath, gitExecutable, outputPath] = process.argv.slice(2);
assert.ok(outputPath, 'Usage: benchmark.mjs module checkout frozen-config git output');
const config = JSON.parse(await readFile(configPath, 'utf8'));
const counts = {};
let active = 0;
let maximumConcurrentGitProcesses = 0;
const originalSpawn = childProcess.spawn;
childProcess.spawn = function (executable, args, options) {
  const child = originalSpawn(executable, args, options);
  if (executable === gitExecutable) {
    const command = args[2];
    counts[command] = (counts[command] || 0) + 1;
    active += 1;
    maximumConcurrentGitProcesses = Math.max(maximumConcurrentGitProcesses, active);
    child.once('close', () => { active -= 1; });
  }
  return child;
};
syncBuiltinESMExports();
const { collectCheckoutIntegritySnapshot } = await import(pathToFileURL(modulePath).href);
const started = performance.now();
const snapshot = await collectCheckoutIntegritySnapshot({
  root: checkoutRoot,
  gitExecutable,
  baselineCommit: config.baselineCommit,
  reviewedCommit: config.reviewedCommit,
  paths: config.fileRows.map(row => row.path),
  directories: ['src', 'tests/evaluation/singapore', 'tests/regression', 'scripts']
});
const elapsedMs = performance.now() - started;
assert.deepEqual(snapshot.fileRows, config.fileRows, 'Benchmark must reproduce all 648 frozen file bindings');
assert.equal(snapshot.fileInventorySha256, config.fileInventorySha256);
assert.equal(active, 0, 'No Git children may remain after snapshot');
const result = {
  mode: 'offline-checkout-snapshot-only',
  measuredAt: new Date().toISOString(),
  nodeVersion: process.versions.node,
  modulePath,
  moduleSha256: createHash('sha256').update(await readFile(modulePath)).digest('hex'),
  checkoutRoot,
  head: snapshot.head,
  baselineCommit: config.baselineCommit,
  reviewedCommit: config.reviewedCommit,
  fileCount: snapshot.fileRows.length,
  fileInventorySha256: snapshot.fileInventorySha256,
  matchesFrozenInventory: true,
  elapsedMs,
  gitProcessCount: Object.values(counts).reduce((sum, count) => sum + count, 0),
  gitProcessesByCommand: counts,
  maximumConcurrentGitProcesses,
  externalRequests: 0,
  modelCalls: 0
};
await writeFile(outputPath, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result));
