import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createCloudflareVerificationReceiptSink, downloadCloudflareVerificationReceiptRun } from './scripts/cloudflare_verification_receipt_sink.mjs';
import { createVerificationReceiptExporter } from './scripts/verification_receipt_exporter.mjs';

const accountId = '0c07eba7cff6c7a8e3c9356cf0fcc503';
const bucketName = 'accounting-verification-receipts';
const baselineSha = 'd8480e44d9234f07658edd9743a54774d8d24eae';
const runId = `storage-d8480e44-20261024-${randomUUID()}`;
const storageOrigin = `https://${accountId}.r2.cloudflarestorage.com`;
const nativeFetch = globalThis.fetch;

globalThis.fetch = (input, init) => {
  const value = typeof input === 'string' || input instanceof URL ? String(input) : input?.url;
  let url;
  try { url = new URL(value); } catch { throw new Error('R2_STORAGE_ONLY_URL_REJECTED'); }
  if (url.origin !== storageOrigin) throw new Error('R2_STORAGE_ONLY_HOST_REJECTED');
  return nativeFetch(input, init);
};

const receipt = {
  id: 'storage-only',
  status: 'STORAGE_PROBE',
  verificationCommitSha: baselineSha,
  note: 'Synthetic storage probe; no accounting query or source request.'
};
let localRoot;
let recoveredRoot;
try {
  const sink = createCloudflareVerificationReceiptSink({ accountId, bucketName, runId });
  localRoot = await mkdtemp(path.join(tmpdir(), 'accounting-r2-storage-local-'));
  const exporter = await createVerificationReceiptExporter({
    outputDirectory: localRoot,
    runId,
    plannedCaseIds: [receipt.id],
    durableSink: sink
  });
  await exporter.exportReceipt(receipt);
  const manifest = await exporter.finish();
  assert.equal(manifest.cases[receipt.id].exportStatus, 'EXPORTED');
  assert.ok(Object.values(manifest.remoteArtifacts).length >= 2);

  await rm(exporter.runDirectory, { recursive: true, force: true });
  recoveredRoot = await mkdtemp(path.join(tmpdir(), 'accounting-r2-storage-recovered-'));
  const recovered = await downloadCloudflareVerificationReceiptRun({
    sink: createCloudflareVerificationReceiptSink({ accountId, bucketName, runId }),
    outputDirectory: recoveredRoot
  });
  assert.deepEqual(recovered.receipts[receipt.id].receipt, receipt);
  assert.equal(recovered.manifest.cases[receipt.id].exportStatus, 'EXPORTED');

  console.log(JSON.stringify({
    event: 'R2_STORAGE_RUNTIME_PASS',
    mode: 'STORAGE_ONLY_NO_MODEL_OR_SOURCE_CALLS',
    runId,
    baselineSha,
    checks: ['bucket-scoped SigV4', 'private preflight', 'remote upload and readback', 'manifest publication', 'fresh-sink recovery', 'exact synthetic receipt reconstruction']
  }));
} catch (error) {
  const rawCode = typeof error?.code === 'string' ? error.code : '';
  const failureCode = /^[A-Z0-9_]{1,64}$/i.test(rawCode) ? rawCode :
    (typeof error?.message === 'string' && /^R2_[A-Z0-9_]{1,64}$/i.test(error.message)
      ? error.message
      : 'R2_STORAGE_RUNTIME_FAILED');
  console.error(`R2_STORAGE_RUNTIME_FAILED code=${failureCode} runId=${runId}`);
  process.exitCode = 1;
} finally {
  globalThis.fetch = nativeFetch;
  if (localRoot) await rm(localRoot, { recursive: true, force: true });
  if (recoveredRoot) await rm(recoveredRoot, { recursive: true, force: true });
}
