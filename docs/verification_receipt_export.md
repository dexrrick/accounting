# Verification receipt export

Use `scripts/verification_receipt_exporter.mjs` to save each completed verification case into a new, explicitly named local run directory. It immediately writes compressed full receipts and separate compact diagnostics, stores captured response bodies once by their captured-byte SHA-256, verifies readback, then atomically updates the run manifest. The reader checks artifact hashes before reconstructing the original receipt. Planned cases without an exported receipt stay `UNOBSERVED` when a run stops.

The live harness integration replaces `emitCase(receipt)` and the old END marker with awaited writes and a manifest:

```js
import { createVerificationReceiptExporter } from './scripts/verification_receipt_exporter.mjs';

const exporter = await createVerificationReceiptExporter({
  outputDirectory: approvedPersistentLocalDirectory,
  runId: verificationRunId,
  plannedCaseIds: cases.map(({ id }) => id)
});
try {
  for (const testCase of cases) {
    const receipt = await runExistingCase(testCase);
    await exporter.exportReceipt(receipt); // replaces emitCase(receipt)
  }
} finally {
  await exporter.finish(); // replaces the SHARED_MILESTONE_END marker
}
```

This shows the local integration point; `runExistingCase` and the output directory must be supplied by the harness. Initialize once with the complete, frozen case-ID list before dispatching any questions. Keep existing answer and capture fields unchanged. Review the manifest and every exported receipt before treating a case as evidence. If the process is forcibly stopped before `finish()`, the last durable manifest remains `IN_PROGRESS` and unexported cases stay `UNOBSERVED`.

Answer status, the capture status reported by the runner, availability and truncation of captured body bytes, and export status are recorded separately. A settled capture window does not mean the source body was retained. The exporter preserves source response hashes and hash scopes as reported and computes a separate hash of the bytes it actually stored. It does not recreate missing bodies. Large text and encoded bodies stay in compressed files; stdout receives only bounded case summaries (2 KiB per case and 32 KiB per run).

Import existing JSON receipts offline with the explicit `--output`, `--run-id`, `--planned-cases`, and receipt-file arguments to `scripts/export_retained_verification_receipts.mjs`. This tool reads JSON data only; it makes no model or source requests. A local directory on persistent storage is suitable for offline export.

## Optional Cloudflare R2 durable sink

For a harness that has explicit authorization to write verification receipts, pass the Cloudflare adapter as `durableSink`:

```js
import { createCloudflareVerificationReceiptSink } from './scripts/cloudflare_verification_receipt_sink.mjs';

const receiptSink = createCloudflareVerificationReceiptSink({
  accountId: configuredCloudflareAccountId,
  bucketName: 'accounting-verification-receipts',
  runId: verificationRunId,
  // Defaults to the bucket-scoped ACCOUNTING_RECEIPT_STORE_ACCESS_KEY_ID and
  // ACCOUNTING_RECEIPT_STORE_SECRET_ACCESS_KEY environment variables.
});
const exporter = await createVerificationReceiptExporter({
  outputDirectory: localWorkingDirectory,
  runId: verificationRunId,
  plannedCaseIds: cases.map(({ id }) => id),
  durableSink: receiptSink
});
```

Exporter construction awaits R2 preflight before it creates the run manifest or returns to the caller, so the harness must initialize it before importing or dispatching the model. Preflight checks that the run manifest key is unused, atomically claims a permanent `writer-lock.json` with `If-None-Match: *`, and stores then retrieves a random probe under that run prefix. The lock permits one writer for each run ID; an interrupted or ambiguous run keeps its lock and requires a fresh run ID. Each compressed body, full receipt, and diagnostic is uploaded as an immutable object and retrieved again; only after all case artifacts pass hash and byte-length checks does the sink publish and verify the updated manifest. The previous manifest is retained under a content-addressed history key. If a case export fails, the harness records `EXPORT_FAILED` when it can persist that status and stops dispatching further cases. If the status write also fails, its terminal error reports that the export status remains unverified. A failure to update the local mirror does not downgrade a remotely verified export.

Use the S3-compatible endpoint with bucket-scoped R2 credentials: set `ACCOUNTING_RECEIPT_STORE_ACCESS_KEY_ID` and `ACCOUNTING_RECEIPT_STORE_SECRET_ACCESS_KEY`, or pass them as `accessKeyId` and `secretAccessKey`. These are the R2 S3 Access Key ID and Secret Access Key, not a Cloudflare REST API bearer token. SigV4 signs requests for region `auto` and service `s3`. Keep both values in the invoking environment or a secret manager; they are not read from CLI arguments, output files, or source configuration. The adapter uses the fixed account R2 origin and rejects redirects. Its errors contain bounded status codes rather than provider response bodies.

To check these credentials with storage calls only, run this in an isolated Node 22 process before enabling any model calls:

```js
const runId = 'storage-preflight-' + Date.now();
const sink = createCloudflareVerificationReceiptSink({
  accountId: configuredCloudflareAccountId,
  bucketName: 'accounting-verification-receipts',
  runId
});
const result = await sink.preflight({ runId, plannedCaseIds: ['storage-only'] });
console.log(JSON.stringify({ status: 'R2_STORAGE_PREFLIGHT_PASS', runId, verified: result.verified }));
```

This writes and reads a small random probe and leaves its immutable probe and writer lock under the one-use run prefix. Use a new run ID for a later verification or live run. This check does not dispatch an accounting query.

To recover a completed run in a later environment with read access, create an adapter for the same `accountId`, `bucketName`, and `runId`, then call `downloadCloudflareVerificationReceiptRun({ sink: receiptSink, outputDirectory: explicitNewLocalDirectory })`. The helper retrieves the remote manifest and indexed artifacts, verifies their hashes, and runs `readVerificationReceiptExport` on the recovered directory. The `outputDirectory` must be an absolute local path and the run directory under it must not already exist.

The isolated legacy harness preparer is `scripts/prepare_r2_verification_harness.mjs`. It only accepts the frozen reviewed fixture and requires reviewed source/tree hashes. For example, with paths and hashes supplied by the reviewer:

```powershell
node scripts/prepare_r2_verification_harness.mjs `
  --template tests/fixtures/legacy_verification_harness_23637b.txt `
  --output <isolated-root>/.verify-final-build-live.mjs `
  --app-source-sha <reviewed-commit-sha> `
  --app-tree-sha256 <reviewed-app-tree-sha256>
```

Preparing the file does not execute it. Any future invocation separately requires `ACCOUNTING_ALLOW_LIVE_MODEL_CALLS=1`, `ACCOUNTING_RECEIPT_STORE_ACCESS_KEY_ID`, `ACCOUNTING_RECEIPT_STORE_SECRET_ACCESS_KEY`, `ACCOUNTING_VERIFICATION_RUN_ID`, and `ACCOUNTING_VERIFICATION_EXPORT_DIRECTORY` in the process environment. The live-model gate remains held unless the operator explicitly enables it. A future live harness must initialize the approved R2 sink before application import, pass a retrievable bucket/run prefix, and confirm post-build recovery with this reader. Provisioning the bucket or preparing the harness does not establish live-model acceptance; no live model run is performed by these exporter tools or authorized by the storage adapter.
