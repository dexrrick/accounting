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
  runId: verificationRunId
  // `token` defaults to ACCOUNTING_RECEIPT_STORE_TOKEN from the caller's environment.
});
const exporter = await createVerificationReceiptExporter({
  outputDirectory: localWorkingDirectory,
  runId: verificationRunId,
  plannedCaseIds: cases.map(({ id }) => id),
  durableSink: receiptSink
});
```

Exporter construction awaits R2 preflight before it creates the run manifest or returns to the caller, so the harness must initialize it before importing or dispatching the model. Preflight checks that the run manifest key is unused and stores then retrieves a random probe under that run prefix. Each compressed body, full receipt, and diagnostic is uploaded as an immutable object and retrieved again; only after all case artifacts pass hash and byte-length checks does the sink publish and verify the updated manifest. The previous manifest is retained under a content-addressed history key. A failed case upload or unverified manifest replacement does not promote the case in the local exporter; failed manifest replacement attempts restore and verify the previous remote manifest.

The token must be supplied by the invoking environment (or an explicitly provided in-memory argument); it is not read from CLI arguments, output files, or source configuration. The adapter uses the fixed Cloudflare API origin and rejects redirects. Its errors contain bounded status codes rather than provider response bodies.

To recover a completed run in a later environment with read access, create an adapter for the same `accountId`, `bucketName`, and `runId`, then call `downloadCloudflareVerificationReceiptRun({ sink: receiptSink, outputDirectory: explicitNewLocalDirectory })`. The helper retrieves the remote manifest and indexed artifacts, verifies their hashes, and runs `readVerificationReceiptExport` on the recovered directory. The `outputDirectory` must be an absolute local path and the run directory under it must not already exist.

The isolated legacy harness preparer is `scripts/prepare_r2_verification_harness.mjs`. It only accepts the frozen reviewed fixture and requires reviewed source/tree hashes. For example, with paths and hashes supplied by the reviewer:

```powershell
node scripts/prepare_r2_verification_harness.mjs `
  --template tests/fixtures/legacy_verification_harness_23637b.txt `
  --output <isolated-root>/.verify-final-build-live.mjs `
  --app-source-sha <reviewed-commit-sha> `
  --app-tree-sha256 <reviewed-app-tree-sha256>
```

Preparing the file does not execute it. Any future invocation separately requires `ACCOUNTING_ALLOW_LIVE_MODEL_CALLS=1`, `ACCOUNTING_RECEIPT_STORE_TOKEN`, `ACCOUNTING_VERIFICATION_RUN_ID`, and `ACCOUNTING_VERIFICATION_EXPORT_DIRECTORY` in the process environment. The live-model gate remains held unless the operator explicitly enables it. A future live harness must initialize the approved R2 sink before application import, pass a retrievable bucket/run prefix, and confirm post-build recovery with this reader. Provisioning the bucket or preparing the harness does not establish live-model acceptance; no live model run is performed by these exporter tools or authorized by the storage adapter.
