import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const LEGACY_HARNESS_SHA256 = '1441a80a0fcebe97269364caef84243cf6448b4e94a0222bf9cbcdf3f497c38a';

// Transform only the inspected historical harness. Preparing a file never dispatches it.
export function prepareR2VerificationHarness(template, { appSourceSha, expectedAppTreeSha256 }) {
  assert.equal(createHash('sha256').update(template).digest('hex'), LEGACY_HARNESS_SHA256,
    'The harness template differs from the reviewed historical capture.');
  assert.match(appSourceSha, /^[a-f0-9]{40}$/);
  assert.match(expectedAppTreeSha256, /^[a-f0-9]{64}$/);
  let source = template;
  const replaceOnce = (before, after) => {
    assert.equal(source.split(before).length, 2, 'Expected one exact harness integration anchor.');
    source = source.replace(before, after);
  };
  replaceOnce("import { gzipSync } from 'node:zlib';\n", '');
  replaceOnce("import { processAccountingQuery } from './src/services/geminiService.ts';", [
    "import { createVerificationReceiptExporter } from './scripts/verification_receipt_exporter.mjs';",
    "import { createCloudflareVerificationReceiptSink } from './scripts/cloudflare_verification_receipt_sink.mjs';",
    "import { summarizeModelCaptureCompleteness, verifyPinnedApplicationRuntime } from './scripts/verification_harness_integrity.mjs';",
    "import path from 'node:path';",
    "import { fileURLToPath } from 'node:url';",
    '',
    '// Storage authorization does not authorize a model run. Disabled unless explicitly enabled.',
    "if (process.env.ACCOUNTING_ALLOW_LIVE_MODEL_CALLS !== '1') {",
    "  throw new Error('LIVE_MODEL_CALLS_HELD: this prepared harness has not been dispatched.');",
    '}'
  ].join('\n'));
  source = source.replace(/^const appSourceSha = '[a-f0-9]{40}';$/m, `const appSourceSha = '${appSourceSha}';`);
  source = source.replace(/^const expectedAppTreeSha256 = '[a-f0-9]{64}';$/m,
    `const expectedAppTreeSha256 = '${expectedAppTreeSha256}';`);
  replaceOnce("const verificationCommitSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();\n",
    "const applicationRoot = path.dirname(fileURLToPath(import.meta.url));\nconst verificationCommitSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: applicationRoot, encoding: 'utf8' }).trim();\n");
  replaceOnce("const commitMetadata = execFileSync('git', ['cat-file', '-p', 'HEAD'], { encoding: 'utf8' });",
    "const commitMetadata = execFileSync('git', ['cat-file', '-p', 'HEAD'], { cwd: applicationRoot, encoding: 'utf8' });");
  replaceOnce("const trackedEntries = execFileSync('git', ['ls-tree', '-r', '-z', 'HEAD'], { encoding: 'utf8' })",
    "const trackedEntries = execFileSync('git', ['ls-tree', '-r', '-z', 'HEAD'], { cwd: applicationRoot, encoding: 'utf8' })");
  replaceOnce("if (actualAppTreeSha256 !== expectedAppTreeSha256) {\n  throw new Error('Tracked application tree differs from the reviewed app source tree.');\n}\n", [
    'if (actualAppTreeSha256 !== expectedAppTreeSha256) {',
    "  throw new Error('Tracked application tree differs from the reviewed app source tree.');",
    '}',
    'const verifiedApplicationRuntime = await verifyPinnedApplicationRuntime({ root: applicationRoot, appSourceSha });',
    ''
  ].join('\n'));
  replaceOnce('const logPartCharacters = 900;\n', '');
  replaceOnce("const sourceHash = async path => createHash('sha256').update(await readFile(path)).digest('hex');",
    "const sourceHash = async filePath => createHash('sha256').update(await readFile(path.join(applicationRoot, filePath))).digest('hex');");
  replaceOnce('      actualAppTreeSha256,\n      executionEnvironment,',
    '      actualAppTreeSha256,\n      applicationRuntime: verifiedApplicationRuntime,\n      executionEnvironment,');
  const emitStart = source.indexOf('function emitCase(receipt) {');
  const emitEnd = source.indexOf('\nconst hashes = {', emitStart);
  assert.ok(emitStart > 0 && emitEnd > emitStart);
  source = source.slice(0, emitStart) + [
    "const runId = process.env.ACCOUNTING_VERIFICATION_RUN_ID || '';",
    "const outputDirectory = process.env.ACCOUNTING_VERIFICATION_EXPORT_DIRECTORY || '';",
    'const receiptSink = createCloudflareVerificationReceiptSink({',
    "  accountId: '0c07eba7cff6c7a8e3c9356cf0fcc503',",
    "  bucketName: 'accounting-verification-receipts',",
    '  runId,',
    "  accessKeyId: process.env.ACCOUNTING_RECEIPT_STORE_ACCESS_KEY_ID || '',",
    "  secretAccessKey: process.env.ACCOUNTING_RECEIPT_STORE_SECRET_ACCESS_KEY || '',",
    '  fetchImpl: nativeFetch',
    '});',
    '// Constructor preflight verifies private durable storage before importing the application.',
    'const exporter = await createVerificationReceiptExporter({',
    '  outputDirectory, runId, plannedCaseIds: cases.map(testCase => testCase.id),',
    '  durableSink: receiptSink, stdout: output',
    '});',
    "const { processAccountingQuery } = await import('./src/services/geminiService.ts');",
    ''
  ].join('\n') + source.slice(emitEnd);
  const beginStart = source.indexOf("output('SHARED_MILESTONE_BEGIN '");
  const beginEnd = source.indexOf('\nfor (const method of Object.keys(originalConsole))', beginStart);
  assert.ok(beginStart > 0 && beginEnd > beginStart);
  source = source.slice(0, beginStart) + source.slice(beginEnd);
  replaceOnce('    emitCase(receipt);', [
    '    try {',
    '      await exporter.exportReceipt(JSON.parse(scrub(JSON.stringify(receipt))));',
    '    } catch (error) {',
    "      const failureCode = typeof error?.code === 'string' && /^[A-Z0-9_]{1,64}$/i.test(error.code)",
    "        ? error.code : (typeof error?.message === 'string' && /^R2_[A-Z0-9_]{1,64}$/i.test(error.message) ? error.message : 'RECEIPT_EXPORT_FAILED');",
    "      let exportStatus = 'EXPORT_FAILURE_STATUS_UNVERIFIED';",
    '      try {',
    '        const failureRecord = await exporter.recordExportFailure(receipt.id, failureCode);',
    "        exportStatus = failureRecord?.persistence === 'REMOTE_PREVIOUS' ? 'EXPORT_FAILURE_STATUS_REMOTE_PREVIOUS' :",
    "          failureRecord?.persistence === 'REMOTE_UNCERTAIN' ? 'EXPORT_FAILURE_STATUS_REMOTE_UNCERTAIN' :",
    "            failureRecord?.persistence === 'REMOTE_VERIFIED' ? 'EXPORT_FAILURE_STATUS_REMOTE_VERIFIED_TERMINAL' :",
    "              failureRecord?.exportStatus === 'EXPORTED' ? 'EXPORTED_PRESERVED' :",
    "                failureRecord?.persistence === 'REMOTE_VERIFIED_LOCAL_MIRROR_FAILED' ? 'EXPORT_FAILED_REMOTE_VERIFIED_LOCAL_MIRROR_FAILED' :",
    "                  failureRecord?.exportStatus === 'EXPORT_FAILED' ? 'EXPORT_FAILED_RECORDED' : 'EXPORT_FAILURE_STATUS_UNVERIFIED';",
    '      } catch {',
    '        // Preserve uncertainty if the status write also failed.',
    '      }',
    '      terminalExportFailure = { caseId: receipt.id, exportStatus, failureCode };',
    '      break;',
    '    }'
  ].join('\n'));
  replaceOnce('let casesWithErrors = 0;\ntry {', 'let casesWithErrors = 0;\nlet terminalExportFailure;\ntry {');
  replaceOnce('  for (const [method, original] of Object.entries(originalConsole)) console[method] = original;\n}',
    [
      '  for (const [method, original] of Object.entries(originalConsole)) console[method] = original;',
      '  try {',
      '    await exporter.finish();',
      '  } catch (error) {',
      "    const terminalStatus = typeof error?.reconciliation === 'string' && /^REMOTE_(?:VERIFIED|PREVIOUS|UNCERTAIN)$/.test(error.reconciliation)",
      "      ? error.reconciliation : (typeof error?.message === 'string' && /^R2_RUN_TERMINATED_REMOTE_(?:VERIFIED|PREVIOUS|UNCERTAIN)$/.test(error.message)",
      "        ? error.message.slice('R2_RUN_TERMINATED_'.length) : undefined);",
      "    terminalExportFailure ||= terminalStatus",
      "      ? { caseId: 'RUN', exportStatus: 'EXPORT_FAILURE_STATUS_' + terminalStatus, failureCode: 'RECEIPT_RUN_TERMINATED' }",
      "      : { caseId: 'RUN', exportStatus: 'FINALIZATION_UNVERIFIED', failureCode: 'RECEIPT_RUN_FINALIZATION_FAILED' };",
      '  }',
      '}',
      'if (terminalExportFailure) {',
      "  throw new Error(\`RECEIPT_EXPORT_TERMINATED case=\${terminalExportFailure.caseId} status=\${terminalExportFailure.exportStatus} code=\${terminalExportFailure.failureCode}\`);",
      '}'
    ].join('\n'));
  const endStart = source.indexOf("\noutput('SHARED_MILESTONE_END '");
  assert.ok(endStart > 0);
  source = source.slice(0, endStart) + '\n';
  assert.ok(!source.includes('SHARED_MILESTONE_PART') && !source.includes('gzip-base64'));
  return source;
}

export async function prepareHarnessFile(args = process.argv.slice(2)) {
  const options = {};
  const names = new Set(['--template', '--output', '--app-source-sha', '--app-tree-sha256']);
  for (let index = 0; index < args.length; index += 2) {
    assert.ok(names.has(args[index]) && args[index + 1] && !Object.hasOwn(options, args[index]), 'Invalid or duplicate preparation argument.');
    options[args[index]] = args[index + 1];
  }
  assert.equal(Object.keys(options).length, 4, 'Template, output, reviewed app SHA and app-tree hash are required.');
  const output = path.resolve(options['--output']);
  const prepared = prepareR2VerificationHarness(await readFile(path.resolve(options['--template']), 'utf8'), {
    appSourceSha: options['--app-source-sha'], expectedAppTreeSha256: options['--app-tree-sha256']
  });
  await writeFile(output, prepared, { flag: 'wx', mode: 0o600 });
  return { output, sha256: createHash('sha256').update(prepared).digest('hex'), dispatched: false };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  prepareHarnessFile().then(result => console.log(JSON.stringify(result))).catch(() => {
    console.error('Harness preparation failed; no live execution was attempted.');
    process.exitCode = 1;
  });
}
