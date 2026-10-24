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
{
  const casesLoop = generated.indexOf('let casesWithErrors = 0;');
  const exportStart = generated.indexOf('    try {\n      await exporter.exportReceipt(JSON.parse(scrub(JSON.stringify(receipt))));', casesLoop);
  const exportEndMarker = '      break;\n    }';
  const exportEnd = generated.indexOf(exportEndMarker, exportStart) + exportEndMarker.length;
  const finishStart = generated.indexOf('  try {\n    await exporter.finish();', exportEnd);
  const finishErrorMarker = '    terminalExportFailure ||= { caseId:';
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
  await checkFailure(undefined, true, 'EXPORT_FAILURE_STATUS_UNVERIFIED');
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
