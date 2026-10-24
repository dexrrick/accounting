import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LEGACY_HARNESS_SHA256, prepareR2VerificationHarness } from '../../scripts/prepare_r2_verification_harness.mjs';

const fixture = await readFile(fileURLToPath(new URL('../fixtures/legacy_verification_harness_23637b.txt', import.meta.url)), 'utf8');
assert.equal(createHash('sha256').update(fixture).digest('hex'), LEGACY_HARNESS_SHA256);
const metadata = { appSourceSha: 'a'.repeat(40), expectedAppTreeSha256: 'b'.repeat(64) };
const generated = prepareR2VerificationHarness(fixture, metadata);
const queries = source => [...source.matchAll(/\{ id: '([^']+)', question: '([^']+)'/g)].map(match => [match[1], match[2]]);
assert.equal(queries(fixture).length, 10);
assert.deepEqual(queries(generated), queries(fixture), 'The exact ten frozen questions and their order must survive integration.');
assert.ok(generated.includes(`const appSourceSha = '${metadata.appSourceSha}';`));
assert.ok(generated.includes(`const expectedAppTreeSha256 = '${metadata.expectedAppTreeSha256}';`));
assert.ok(!generated.includes('SHARED_MILESTONE_PART') && !generated.includes('SHARED_MILESTONE_BEGIN') && !generated.includes('SHARED_MILESTONE_END'));
assert.ok(generated.includes('await exporter.exportReceipt('));
assert.ok(generated.includes('await exporter.finish();'));
assert.ok(generated.indexOf('const exporter = await createVerificationReceiptExporter(') < generated.indexOf("await import('./src/services/geminiService.ts')"),
  'Durable storage preflight must complete before application import or model dispatch.');
assert.ok(generated.includes('globalThis.fetch = nativeFetch;'));
assert.throws(() => prepareR2VerificationHarness(fixture + '\n', metadata), /template differs/);
assert.throws(() => prepareR2VerificationHarness(fixture, { ...metadata, appSourceSha: 'unreviewed' }));

const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'accounting-r2-harness-'));
try {
  await mkdir(path.join(temporaryRoot, 'scripts'));
  // These stubs fail if construction starts; with the live hold, neither is called.
  await writeFile(path.join(temporaryRoot, 'scripts/verification_receipt_exporter.mjs'),
    "export function createVerificationReceiptExporter(){throw new Error('UNEXPECTED_STORAGE_OR_DISPATCH');}");
  await writeFile(path.join(temporaryRoot, 'scripts/cloudflare_verification_receipt_sink.mjs'),
    "export function createCloudflareVerificationReceiptSink(){throw new Error('UNEXPECTED_STORAGE_OR_DISPATCH');}");
  const harnessPath = path.join(temporaryRoot, '.verify-final-build-live.mjs');
  await writeFile(harnessPath, generated);
  const environment = { ...process.env };
  delete environment.ACCOUNTING_ALLOW_LIVE_MODEL_CALLS;
  const held = spawnSync(process.execPath, [harnessPath], { cwd: temporaryRoot, env: environment, encoding: 'utf8' });
  assert.equal(held.status, 1);
  assert.match(held.stderr, /LIVE_MODEL_CALLS_HELD/);
  assert.ok(!held.stderr.includes('UNEXPECTED_STORAGE_OR_DISPATCH'));
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
console.log('R2 harness preparation preserves ten frozen cases, source guards, storage preflight and the live-call hold.');
