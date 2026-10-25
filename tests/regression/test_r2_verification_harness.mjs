import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { LEGACY_HARNESS_SHA256, prepareR2VerificationHarness } from '../../scripts/prepare_r2_verification_harness.mjs';
import { summarizeModelCaptureCompleteness, verifyPinnedApplicationRuntime } from '../../scripts/verification_harness_integrity.mjs';

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
assert.ok(generated.includes('await exporter.recordExportFailure(receipt.id, failureCode);'),
  'An attempted case records EXPORT_FAILED when receipt export fails.');
assert.ok(generated.includes('EXPORT_FAILURE_STATUS_UNVERIFIED'),
  'A failed failure-status write remains explicitly uncertain.');
assert.ok(generated.includes('EXPORTED_PRESERVED'),
  'A local mirror failure preserves an already verified remote export.');
assert.ok(generated.includes('ACCOUNTING_RECEIPT_STORE_ACCESS_KEY_ID'));
assert.ok(generated.includes('ACCOUNTING_RECEIPT_STORE_SECRET_ACCESS_KEY'));
assert.ok(!generated.includes('ACCOUNTING_RECEIPT_STORE_TOKEN'),
  'The prepared harness no longer passes a REST bearer token to the bucket-scoped adapter.');
assert.ok(generated.includes('await exporter.finish();'));
assert.ok(generated.indexOf('const exporter = await createVerificationReceiptExporter(') < generated.indexOf("await import('./src/services/geminiService.ts')"),
  'Durable storage preflight must complete before application import or model dispatch.');
assert.ok(generated.includes('globalThis.fetch = nativeFetch;'));
assert.ok(generated.includes("import { summarizeModelCaptureCompleteness, verifyPinnedApplicationRuntime } from './scripts/verification_harness_integrity.mjs';"),
  'New harnesses must include the reviewed runtime integrity and capture summary helpers.');
assert.ok(generated.includes('const applicationRoot = path.dirname(fileURLToPath(import.meta.url));') &&
  generated.includes("verifyPinnedApplicationRuntime({ root: applicationRoot, appSourceSha })") &&
  generated.includes("{ cwd: applicationRoot, encoding: 'utf8' }") &&
  generated.includes('readFile(path.join(applicationRoot, filePath))'),
'Git guards, runtime verification, and diagnostic file reads must use the harness importer directory.');
{
  const casesLoop = generated.indexOf('let casesWithErrors = 0;');
  const exportStart = generated.indexOf('    try {\n      await exporter.exportReceipt(JSON.parse(scrub(JSON.stringify(receipt))));', casesLoop);
  const exportEndMarker = '      break;\n    }';
  const exportEnd = generated.indexOf(exportEndMarker, exportStart) + exportEndMarker.length;
  const finishStart = generated.indexOf('  try {\n    await exporter.finish();', exportEnd);
  const finishErrorMarker = '    terminalExportFailure ||= terminalStatus';
  const finishError = generated.indexOf(finishErrorMarker, finishStart);
  const finishEnd = generated.indexOf('\n  }', finishError) + '\n  }'.length;
  const terminalStart = generated.indexOf('if (terminalExportFailure) {', finishEnd);
  assert.ok(exportStart >= 0 && exportEnd > exportStart && finishStart > exportEnd && finishEnd > finishStart && terminalStart > finishEnd,
    'The generated export-failure, finish, and terminal-diagnostic blocks are extractable for behavior checks.');
  const behaviorSource = [
    'let terminalExportFailure;',
    'try {',
    '  for (const testCase of receipts) {',
    '    const receipt = testCase;',
    generated.slice(exportStart, exportEnd),
    '  }',
    '} finally {',
    generated.slice(finishStart, finishEnd),
    '}',
    generated.slice(terminalStart)
  ].join('\n');
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  async function checkFailure(recordResult, recordThrows, expectedStatus) {
    const calls = [];
    const exporter = {
      async exportReceipt(receipt) {
        calls.push('export:' + receipt.id);
        const error = new Error('R2_PUT_REJECTED_503');
        error.code = 'R2_PUT_REJECTED_503';
        throw error;
      },
      async recordExportFailure(caseId, code) {
        calls.push('record:' + caseId + ':' + code);
        if (recordThrows) throw new Error('private remote error body must stay hidden');
        return recordResult;
      },
      async finish() { calls.push('finish'); }
    };
    const run = new AsyncFunction('exporter', 'receipts', 'scrub', behaviorSource);
    await assert.rejects(run(exporter, [{ id: 'attempted' }, { id: 'must-not-run' }], value => value),
      error => error.message.includes(expectedStatus) && !error.message.includes('private remote error body'));
    assert.deepEqual(calls, [
      'export:attempted',
      'record:attempted:R2_PUT_REJECTED_503',
      'finish'
    ], 'The run records the failed case, stops later dispatch, and always finalizes.');
  }
  await checkFailure({ exportStatus: 'EXPORT_FAILED', persistence: 'REMOTE_AND_LOCAL_VERIFIED' }, false, 'EXPORT_FAILED_RECORDED');
  await checkFailure({ exportStatus: 'EXPORTED', persistence: 'PREVIOUSLY_VERIFIED_EXPORT_PRESERVED' }, false, 'EXPORTED_PRESERVED');
  await checkFailure({ exportStatus: 'UNOBSERVED', persistence: 'REMOTE_PREVIOUS' }, false, 'EXPORT_FAILURE_STATUS_REMOTE_PREVIOUS');
  await checkFailure({ exportStatus: 'UNOBSERVED', persistence: 'REMOTE_UNCERTAIN' }, false, 'EXPORT_FAILURE_STATUS_REMOTE_UNCERTAIN');
  await checkFailure({ exportStatus: 'EXPORTED', persistence: 'REMOTE_VERIFIED' }, false, 'EXPORT_FAILURE_STATUS_REMOTE_VERIFIED_TERMINAL');
  await checkFailure(undefined, true, 'EXPORT_FAILURE_STATUS_UNVERIFIED');

  const calls = [];
  const exporter = {
    async exportReceipt(receipt) {
      calls.push('export:' + receipt.id);
      const error = new Error('R2_MANIFEST_ETAG_REQUIRED');
      error.reconciliation = 'REMOTE_VERIFIED';
      error.terminal = true;
      throw error;
    },
    async recordExportFailure(caseId, code) {
      calls.push('record:' + caseId + ':' + code);
      return { exportStatus: 'EXPORTED', persistence: 'REMOTE_VERIFIED' };
    },
    async finish() {
      calls.push('finish');
      const error = new Error('R2_RUN_TERMINATED_REMOTE_VERIFIED');
      error.reconciliation = 'REMOTE_VERIFIED';
      throw error;
    }
  };
  const run = new AsyncFunction('exporter', 'receipts', 'scrub', behaviorSource);
  await assert.rejects(run(exporter, [{ id: 'last-case' }], value => value), error =>
    error.message.includes('EXPORT_FAILURE_STATUS_REMOTE_VERIFIED_TERMINAL') &&
    error.message.includes('R2_MANIFEST_ETAG_REQUIRED') &&
    !error.message.includes('private remote error body'));
  assert.deepEqual(calls, [
    'export:last-case', 'record:last-case:R2_MANIFEST_ETAG_REQUIRED', 'finish'
  ], 'A last-case REMOTE_VERIFIED result stops dispatch and cannot exit as successful completion.');
}
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
  await writeFile(path.join(temporaryRoot, 'scripts/verification_harness_integrity.mjs'),
    await readFile(fileURLToPath(new URL('../../scripts/verification_harness_integrity.mjs', import.meta.url))));
  const harnessPath = path.join(temporaryRoot, '.verify-final-build-live.mjs');
  await writeFile(harnessPath, generated);
  const environment = { ...process.env };
  delete environment.ACCOUNTING_ALLOW_LIVE_MODEL_CALLS;
  const held = spawnSync(process.execPath, [harnessPath], { cwd: temporaryRoot, env: environment, encoding: 'utf8' });
  assert.equal(held.status, 1);
  assert.match(held.stderr, /LIVE_MODEL_CALLS_HELD/);
  assert.ok(!held.stderr.includes('UNEXPECTED_STORAGE_OR_DISPATCH'));

  const integrityCheckStart = generated.indexOf('const verifiedApplicationRuntime = await verifyPinnedApplicationRuntime({ root: applicationRoot, appSourceSha });');
  const sinkConstructionStart = generated.indexOf('const receiptSink = createCloudflareVerificationReceiptSink({');
  const exporterConstructionStart = generated.indexOf('const exporter = await createVerificationReceiptExporter({');
  const applicationImportStart = generated.indexOf("await import('./src/services/geminiService.ts')");
  assert.ok(integrityCheckStart >= 0 && integrityCheckStart < sinkConstructionStart &&
    sinkConstructionStart < exporterConstructionStart && exporterConstructionStart < applicationImportStart,
  'Pinned runtime bytes must be verified before sink construction, storage preflight, and application import.');

  const runtimeRoot = path.join(temporaryRoot, 'runtime-repo');
  await mkdir(path.join(runtimeRoot, 'src', 'nested'), { recursive: true });
  await mkdir(path.join(runtimeRoot, 'docs'), { recursive: true });
  const runtimeSourcePath = path.join(runtimeRoot, 'src', 'nested', 'module.ts');
  const runtimeAssetPath = path.join(runtimeRoot, 'src', 'asset.png');
  const originalRuntimeSource = 'export const answer = 42;\n';
  const attributesText = '* text=auto\n';
  await writeFile(runtimeSourcePath, originalRuntimeSource);
  await writeFile(path.join(runtimeRoot, '.gitattributes'), attributesText);
  await writeFile(runtimeAssetPath, Buffer.from([0, 1, 2, 255]));
  await writeFile(path.join(runtimeRoot, 'docs', 'note.md'), 'retained documentation\n');
  const packageJson = { name: 'runtime-fixture', type: 'module', scripts: { build: 'tsc -b' } };
  const packageText = `${JSON.stringify(packageJson, null, 2)}\n`;
  const tsconfigText = `${JSON.stringify({ compilerOptions: { strict: true } }, null, 2)}\n`;
  await writeFile(path.join(runtimeRoot, 'package.json'), packageText);
  await writeFile(path.join(runtimeRoot, 'package-lock.json'), `${JSON.stringify({ lockfileVersion: 3, packages: {} }, null, 2)}\n`);
  await writeFile(path.join(runtimeRoot, 'tsconfig.json'), tsconfigText);
  await writeFile(path.join(runtimeRoot, '.nvmrc'), '22\n');
  const gitAt = (...args) => {
    const result = spawnSync('git', ['-C', runtimeRoot, ...args], { encoding: 'utf8' });
    assert.equal(result.status, 0, `Git ${args[0]} failed: ${result.stderr}`);
    return result.stdout.trim();
  };
  gitAt('init', '--quiet');
  gitAt('config', 'user.email', 'harness-test@example.invalid');
  gitAt('config', 'user.name', 'Harness Test');
  gitAt('add', 'src', 'docs', 'package.json', 'package-lock.json', 'tsconfig.json', '.nvmrc', '.gitattributes');
  gitAt('commit', '--quiet', '-m', 'pinned runtime fixture');
  const runtimeCommit = gitAt('rev-parse', 'HEAD');
  const runtimeManifest = await verifyPinnedApplicationRuntime({ root: runtimeRoot, appSourceSha: runtimeCommit });
  assert.equal(runtimeManifest.files.length, 7);
  assert.match(runtimeManifest.manifestSha256, /^[a-f0-9]{64}$/);
  assert.ok(runtimeManifest.files.every(file => /^[a-f0-9]{64}$/.test(file.diskSha256)));

  const importerRoot = path.join(temporaryRoot, 'importer-repo');
  await cp(runtimeRoot, importerRoot, { recursive: true });
  const importerModulePath = path.join(importerRoot, 'src', 'nested', 'module.ts');
  await writeFile(importerModulePath, 'export const answer = 777;\n');
  const integrityModuleUrl = pathToFileURL(fileURLToPath(new URL('../../scripts/verification_harness_integrity.mjs', import.meta.url))).href;
  const importerGuardPath = path.join(importerRoot, 'guard-importer-root.mjs');
  await writeFile(importerGuardPath, [
    "import path from 'node:path';",
    "import { fileURLToPath } from 'node:url';",
    `import { verifyPinnedApplicationRuntime } from '${integrityModuleUrl}';`,
    'const applicationRoot = path.dirname(fileURLToPath(import.meta.url));',
    'try {',
    '  await verifyPinnedApplicationRuntime({ root: applicationRoot, appSourceSha: process.argv[2] });',
    "  console.error('DIRTY_IMPORTER_WAS_ACCEPTED');",
    '  process.exitCode = 2;',
    '} catch (error) {',
    "  if (!/^PINNED_RUNTIME_CONTENT_MISMATCH/.test(error.message)) throw error;",
    "  console.log('DIRTY_IMPORTER_REJECTED');",
    '}'
  ].join('\n'));
  const mismatchedImporter = spawnSync(process.execPath, [importerGuardPath, runtimeCommit], {
    cwd: runtimeRoot, encoding: 'utf8'
  });
  assert.equal(mismatchedImporter.status, 0, mismatchedImporter.stderr);
  assert.match(mismatchedImporter.stdout, /DIRTY_IMPORTER_REJECTED/,
    'A clean process cwd cannot make a dirty harness importer pass the pinned runtime check.');

  await writeFile(path.join(runtimeRoot, 'docs', 'note.md'), 'documentation-only edit\n');
  const docsOnlyRuntime = await verifyPinnedApplicationRuntime({ root: runtimeRoot, appSourceSha: runtimeCommit });
  assert.equal(docsOnlyRuntime.manifestSha256, runtimeManifest.manifestSha256,
    'Documentation changes outside the executable src tree do not change the runtime receipt.');
  await writeFile(path.join(runtimeRoot, 'package.json'), `${JSON.stringify({
    ...packageJson, scripts: { ...packageJson.scripts,
      postbuild: "node --import tsx --input-type=module -e \"process.env.ACCOUNTING_ALLOW_LIVE_MODEL_CALLS='1';process.env.ACCOUNTING_VERIFICATION_RUN_ID='harness-2026-10-25-1234';process.env.ACCOUNTING_VERIFICATION_EXPORT_DIRECTORY='/tmp/accounting-verification-exports';await import('./.verify-final-build-live.mjs')\""
    }
  }, null, 2)}\n`);
  const harnessHookRuntime = await verifyPinnedApplicationRuntime({ root: runtimeRoot, appSourceSha: runtimeCommit });
  assert.notEqual(harnessHookRuntime.manifestSha256, runtimeManifest.manifestSha256,
    'The manifest retains raw package.json bytes even though the one harness-only postbuild field is excluded for comparison.');
  await writeFile(path.join(runtimeRoot, 'package.json'), `${JSON.stringify({
    ...packageJson, scripts: { ...packageJson.scripts, postbuild: 'node unrelated.mjs' }
  }, null, 2)}\n`);
  await assert.rejects(verifyPinnedApplicationRuntime({ root: runtimeRoot, appSourceSha: runtimeCommit }), /PINNED_RUNTIME_POSTBUILD_NOT_APPROVED/,
    'Only the bounded verification hook is excluded from the pinned package comparison.');
  await writeFile(path.join(runtimeRoot, 'package.json'), packageText);

  await writeFile(runtimeSourcePath, 'export const answer = 99;\n');
  await assert.rejects(verifyPinnedApplicationRuntime({ root: runtimeRoot, appSourceSha: runtimeCommit }), /PINNED_RUNTIME_CONTENT_MISMATCH/,
    'A modified tracked runtime module must fail the pin check.');
  await writeFile(runtimeSourcePath, originalRuntimeSource);
  const ignoredPath = path.join(runtimeRoot, 'src', 'injected.ts');
  await writeFile(path.join(runtimeRoot, '.gitignore'), 'src/injected.ts\n');
  await writeFile(ignoredPath, 'export const injected = true;\n');
  await assert.rejects(verifyPinnedApplicationRuntime({ root: runtimeRoot, appSourceSha: runtimeCommit }), /PINNED_RUNTIME_FILE_SET_MISMATCH/,
    'An ignored untracked module under src cannot shadow the pinned runtime.');
  await rm(ignoredPath);
  await rm(runtimeSourcePath);
  await assert.rejects(verifyPinnedApplicationRuntime({ root: runtimeRoot, appSourceSha: runtimeCommit }), /PINNED_RUNTIME_FILE_SET_MISMATCH/,
    'A missing runtime module must fail the pin check.');
  await writeFile(runtimeSourcePath, originalRuntimeSource);
  await writeFile(path.join(runtimeRoot, 'tsconfig.json'), `${JSON.stringify({ compilerOptions: { strict: false } }, null, 2)}\n`);
  await assert.rejects(verifyPinnedApplicationRuntime({ root: runtimeRoot, appSourceSha: runtimeCommit }), /PINNED_RUNTIME_CONTENT_MISMATCH:tsconfig\.json/,
    'A changed TypeScript runtime configuration must fail the pin check.');
  await writeFile(path.join(runtimeRoot, 'tsconfig.json'), tsconfigText);
  await writeFile(runtimeAssetPath, Buffer.from([0, 1, 2, 4]));
  await assert.rejects(verifyPinnedApplicationRuntime({ root: runtimeRoot, appSourceSha: runtimeCommit }), /PINNED_RUNTIME_CONTENT_MISMATCH/,
    'Binary runtime assets are compared byte-for-byte.');
  await writeFile(runtimeAssetPath, Buffer.from([0, 1, 2, 255]));
  await writeFile(runtimeSourcePath, originalRuntimeSource.replace('\n', '\r\n'));
  await writeFile(path.join(runtimeRoot, '.gitattributes'), attributesText.replaceAll('\n', '\r\n'));
  const crlfRuntime = await verifyPinnedApplicationRuntime({ root: runtimeRoot, appSourceSha: runtimeCommit });
  assert.notEqual(crlfRuntime.manifestSha256, runtimeManifest.manifestSha256,
    'The receipt digest retains the raw disk hash even when Git checkout line endings are normalized for comparison.');
  assert.match(crlfRuntime.comparisonPolicy, /CRLF-to-LF/,
    'The permitted checkout normalization is stated alongside the retained manifest.');
  await writeFile(path.join(runtimeRoot, '.gitattributes'), '* text=auto\n*.png binary\n');
  await assert.rejects(verifyPinnedApplicationRuntime({ root: runtimeRoot, appSourceSha: runtimeCommit }), /PINNED_RUNTIME_CONTENT_MISMATCH:\.gitattributes/,
    'Only CRLF checkout conversion is ignored; substantive .gitattributes edits remain pinned.');

  const bodyReference = { $capturedBody: {
    sha256: 'a'.repeat(64), encoding: 'utf8', byteLength: 25,
    artifactPath: `bodies/${'a'.repeat(64)}.gz`, payloadStatus: 'PRESENT_NO_TRUNCATION_RECORDED'
  } };
  const completeGenerateContent = {
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/models/gemini:generateContent',
    generateContent: true, retainedRawBody: true, rawResponseBodyText: bodyReference,
    captureStatus: 'COMPLETE', responseBodyHashScope: 'complete_response', responseBodyTruncated: false
  };
  const completeStream = {
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/models/gemini:streamGenerateContent',
    generateContent: false, retainedRawBody: false, captureStatus: 'COMPLETE',
    responseBodyHashScope: 'complete_response', responseBodyTruncated: false
  };
  const completeSummary = summarizeModelCaptureCompleteness([{
    dispatches: { model: 2 }, modelResponses: [completeGenerateContent, completeStream]
  }]);
  assert.equal(completeSummary.allGenerateContentBodiesRetained, true);
  assert.equal(completeSummary.completedGenerateContentBodies, 1);
  assert.equal(completeSummary.metadataOnlyStreamResponses, 1);
  assert.equal(completeSummary.incompleteGenerateContentBodies, 0);

  const incompleteVariants = [
    { ...completeGenerateContent, captureStatus: 'INCOMPLETE_TIMEOUT' },
    { ...completeGenerateContent, captureStatus: 'TRUNCATED_LIMIT', responseBodyTruncated: true },
    { ...completeGenerateContent, retainedRawBody: false },
    { endpoint: 'https://generativelanguage.googleapis.com/v1beta/models/gemini:generateContent',
      transportError: { message: 'network failure' }, captureStatus: 'FAILED' }
  ];
  for (const record of incompleteVariants) {
    const summary = summarizeModelCaptureCompleteness([{ dispatches: { model: 1 }, modelResponses: [record] }]);
    assert.equal(summary.allGenerateContentBodiesRetained, false);
  }
  assert.equal(summarizeModelCaptureCompleteness([{ dispatches: { model: 0 }, modelResponses: [] }])
    .allGenerateContentBodiesRetained, false, 'No observed generateContent responses cannot pass vacuously.');
  assert.equal(summarizeModelCaptureCompleteness([{ dispatches: { model: 1 }, modelResponses: [] }])
    .missingModelResponseRecords, 1, 'Missing request records are counted and make completeness fail.');
  const failedStreamSummary = summarizeModelCaptureCompleteness([{ dispatches: { model: 1 }, modelResponses: [
    { endpoint: 'https://generativelanguage.googleapis.com/v1beta/models/gemini:streamGenerateContent',
      transportError: { message: 'network failure' }, captureStatus: 'FAILED' }
  ] }]);
  assert.equal(failedStreamSummary.streamTransportFailures, 1);
  assert.equal(failedStreamSummary.modelTransportFailures, 1);
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
console.log('R2 harness preparation preserves ten frozen cases, source guards, storage preflight and the live-call hold.');
