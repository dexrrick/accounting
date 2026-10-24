import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { createVerificationReceiptExporter, readVerificationReceiptExport } from '../../scripts/verification_receipt_exporter.mjs';
import { exportRetainedReceipts } from '../../scripts/export_retained_verification_receipts.mjs';

const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'verification-export-'));
const output = path.join(temporaryRoot, 'out');
const stdout = [];
const privateQuotation = 'PRIVATE_VERIFIED_QUOTATION_SHOULD_ONLY_EXIST_IN_FULL_RECEIPT_7f4b2b';
const exporter = await createVerificationReceiptExporter({
  outputDirectory: output,
  runId: 'saved-fixtures',
  plannedCaseIds: ['mom', 'mas', 'iras-residency', 'scope-unknown'],
  stdout: line => stdout.push(line)
});

const unicodeBody = 'The preserved quotation includes Singapore company residence. 測試資料. '.repeat(400);
const bodyBytes = Buffer.from(unicodeBody, 'utf8');
const capturedBase64 = bodyBytes.toString('base64');
const binaryBytes = randomBytes(256 * 1024);
const momReceipt = {
  id: 'mom', status: 'INSUFFICIENT', providerStatus: 'OK', captureCompleteness: 'CAPTURE_WINDOW_SETTLED',
  captureWindow: { boundedWaitMs: 12000, timedOut: false },
  question: 'Private question text must remain in the private receipt.',
  modelResponses: [{ httpStatus: 200, captureStatus: 'COMPLETE', responseBodyHashScope: 'complete_response',
    responseBodySha256: createHashFor(bodyBytes), responseBodyBytesRead: bodyBytes.length,
    responseBodyBytesCaptured: bodyBytes.length, rawResponseBodyText: unicodeBody }],
  sourceResponses: [{ httpStatus: 200, captureStatus: 'COMPLETE', responseBodyHashScope: 'complete_response',
    responseBodySha256: createHashFor(bodyBytes), responseBodyBytes: bodyBytes.length,
    capturedBodyBytes: bodyBytes.length, bodyBase64: capturedBase64, bodyText: unicodeBody }],
  observedAuthorityWorkstreams: {
    status: 'INCOMPLETE', issuePlan: { issues: [{ id: 'mom-part-iv', domain: 'MOM_EMPLOYMENT',
      governingAuthorities: ['MOM'], population: 'EMPLOYEE', operation: 'EXPLAIN_RULE', requestedConcepts: ['Part IV coverage', 'overtime'] }] },
    workstreams: [{ issues: [{ id: 'mom-part-iv', operation: 'EXPLAIN_RULE', admissionDiagnostics: {
      candidateId: 'retained-candidate', contentHash: 'c'.repeat(64), predicates: [{ predicate: 'topic', passed: true }]
    }, verifiedClaims: [{ paragraphId: 'p-1', recordId: 'retained-source-record', quote: privateQuotation, status: 'VERIFIED' }],
      rejectedClaims: [], uncoveredPropositions: ['overtime rates'] }] }],
    gaps: [{ code: 'UNSUPPORTED_PROPOSITION', proposition: 'overtime rates' }]
  },
  finalPresentation: { status: 'INSUFFICIENT', workstreams: [{ issues: [{ id: 'mom-part-iv', selectedParagraphIds: ['p-1'] }] }] },
  requestCompletenessContext: { rawQuery: 'A long private query', inventory: [{ id: 'overtime-rates' }] },
  messageText: '陽性と陰性の大きな Unicode メタデータ '.repeat(8000)
};
const metadataOnlyReceipt = {
  id: 'mas', status: 'INSUFFICIENT', captureCompleteness: 'CAPTURE_WINDOW_SETTLED',
  modelResponses: [],
  sourceResponses: [{ httpStatus: 200, captureStatus: 'COMPLETE', responseBodyHashScope: 'complete_response',
    responseBodySha256: 'a'.repeat(64), responseBodyBytes: 9000, capturedBodyBytes: 0 }],
  observedAuthorityWorkstreams: { status: 'INCOMPLETE', workstreams: [], gaps: [] }
};
const binaryReceipt = {
  id: 'iras-residency', status: 'VERIFIED', captureCompleteness: 'CAPTURE_WINDOW_SETTLED',
  modelResponses: [],
  sourceResponses: [{ httpStatus: 200, captureStatus: 'COMPLETE', responseBodyHashScope: 'complete_response',
    responseBodySha256: createHashFor(binaryBytes), responseBodyBytes: binaryBytes.length,
    capturedBodyBytes: binaryBytes.length, bodyBase64: binaryBytes.toString('base64') }]
};
const unknownScopeReceipt = {
  id: 'scope-unknown', status: 'INSUFFICIENT', captureCompleteness: 'CAPTURE_WINDOW_SETTLED',
  sourceResponses: [{ httpStatus: 200, captureStatus: 'COMPLETE', bodyText: unicodeBody }]
};

await exporter.exportReceipt(momReceipt);
await exporter.exportReceipt(metadataOnlyReceipt);
await exporter.exportReceipt(binaryReceipt);
await exporter.exportReceipt(unknownScopeReceipt);

let recovered = await readVerificationReceiptExport(exporter.runDirectory);
assert.deepEqual(recovered.receipts.mom.receipt, momReceipt, 'The full receipt, including exact text and binary body fields, round trips.');
assert.equal(recovered.receipts.mas.diagnostic.payloadAvailability, 'METADATA_ONLY',
  'Settled capture metadata without a source body never implies payload availability.');
assert.equal(recovered.receipts.mom.diagnostic.declaredCaptureStatus, 'CAPTURE_WINDOW_SETTLED');
assert.deepEqual(recovered.receipts.mom.diagnostic.issues[0].uncoveredPropositions, ['overtime rates']);
assert.deepEqual(recovered.receipts.mom.diagnostic.issues[0].admissionDiagnostics.predicates, [{ predicate: 'topic', passed: true }]);
assert.equal(recovered.receipts.mom.diagnostic.conceptOwnership[0].operation, 'EXPLAIN_RULE');
assert.deepEqual(recovered.receipts.mom.diagnostic.conceptOwnership[0].authority, ['MOM']);
assert.equal(recovered.receipts.mom.diagnostic.issues[0].admissionDiagnostics.contentHash, 'c'.repeat(64),
  'Diagnostic projection preserves candidate identity hashes.');
assert.equal(recovered.receipts.mom.diagnostic.requestCompletenessContext.rawQuery, undefined,
  'The diagnostic summary omits private query text.');
assert.equal(recovered.receipts.mom.diagnostic.issues[0].sourceText, undefined,
  'The diagnostic summary omits source bodies and text.');
assert.deepEqual(recovered.receipts.mom.diagnostic.issues[0].verifiedClaims, [{
  paragraphId: 'p-1',
  recordId: 'retained-source-record',
  quoteMetadata: {
    sha256: createHashFor(Buffer.from(privateQuotation, 'utf8')),
    byteLength: Buffer.byteLength(privateQuotation, 'utf8'),
    characterLength: privateQuotation.length,
    redacted: true
  },
  status: 'VERIFIED'
}], 'The compact diagnostic preserves quotation identity, length, hash and verification outcome without the quote.');
assert.equal(recovered.manifest.cases.mom.capturedBodyCount, 1, 'UTF-8 text and base64 views of identical bytes share one blob.');
assert.equal(recovered.manifest.cases.mas.payloadAvailability, 'METADATA_ONLY');
assert.equal(recovered.manifest.cases['scope-unknown'].payloadAvailability, 'PRESENT_SCOPE_UNOBSERVED',
  'A body with missing hash scope stays scope-unknown, not falsely labeled truncated.');
assert.equal(recovered.receipts['scope-unknown'].diagnostic.payloadAvailability, 'PRESENT_SCOPE_UNOBSERVED');
assert.deepEqual(recovered.receipts['iras-residency'].receipt, binaryReceipt, 'A large binary source body round trips exactly.');
const bodyFiles = await readdir(path.join(exporter.runDirectory, 'bodies'));
assert.equal(bodyFiles.length, 2);
const unicodeBodyFile = `${createHashFor(bodyBytes)}.gz`;
assert.ok(gunzipSync(await readFile(path.join(exporter.runDirectory, 'bodies', unicodeBodyFile))).equals(bodyBytes));
let storedBinaryBodyFound = false;
for (const file of bodyFiles) {
  if (gunzipSync(await readFile(path.join(exporter.runDirectory, 'bodies', file))).equals(binaryBytes)) storedBinaryBodyFound = true;
}
assert.equal(storedBinaryBodyFound, true);
const firstBodyPath = path.join(exporter.runDirectory, 'bodies', unicodeBodyFile);
const validCompressedBody = await readFile(firstBodyPath);
await writeFile(firstBodyPath, 'tampered body');
await assert.rejects(readVerificationReceiptExport(exporter.runDirectory), /body artifact (hash mismatch|is not valid)/i);
await writeFile(firstBodyPath, validCompressedBody);
const stdoutText = stdout.join('');
assert.ok(Buffer.byteLength(stdoutText) < 32_768);
assert.ok(stdout.every(line => Buffer.byteLength(line) <= 2_048));
assert.equal(stdoutText.includes(unicodeBody), false, 'Stdout contains no raw captured text.');
assert.equal(stdoutText.includes('Private question text'), false, 'Stdout contains no question text.');
assert.equal(stdoutText.includes(privateQuotation), false, 'Stdout does not retain the private verified quotation.');
assert.equal(JSON.stringify(recovered.receipts.mom.diagnostic).includes(privateQuotation), false,
  'The diagnostic artifact omits the distinctive full quotation.');
assert.equal(recovered.receipts.mom.receipt.observedAuthorityWorkstreams.workstreams[0].issues[0].verifiedClaims[0].quote,
  privateQuotation, 'The full receipt exactly retains the original verified quotation.');

async function assertManifestEditRejected(runDirectory, edit, pattern, message) {
  const manifestPath = path.join(runDirectory, 'manifest.json');
  const original = await readFile(manifestPath);
  const edited = JSON.parse(original.toString('utf8'));
  edit(edited);
  await writeFile(manifestPath, `${JSON.stringify(edited, null, 2)}\n`);
  await assert.rejects(readVerificationReceiptExport(runDirectory), pattern, message);
  await writeFile(manifestPath, original);
}

await assertManifestEditRejected(exporter.runDirectory,
  manifest => { manifest.cases.mom.answerStatus = 'VERIFIED'; }, /manifest receipt summary/i,
  'The case answer summary must agree with its retained receipt.');
await assertManifestEditRejected(exporter.runDirectory,
  manifest => { manifest.cases.mom.declaredCaptureStatus = 'CAPTURE_FAILED'; }, /manifest receipt summary/i,
  'The case capture summary must agree with its retained receipt.');
await assertManifestEditRejected(exporter.runDirectory,
  manifest => { manifest.cases.mom.capturedBodyCount = 99; }, /manifest receipt summary/i,
  'Captured-body counts must agree with the receipt references.');

const interruptedRun = await createVerificationReceiptExporter({
  outputDirectory: output,
  runId: 'interrupted',
  plannedCaseIds: ['mom', 'mas', 'iras-residency'],
  stdout: () => true
});
await interruptedRun.exportReceipt(momReceipt);
recovered = await readVerificationReceiptExport(interruptedRun.runDirectory);
assert.equal(recovered.manifest.cases.mom.exportStatus, 'EXPORTED');
assert.equal(recovered.manifest.cases.mas.exportStatus, 'UNOBSERVED', 'A stopped run keeps cases without receipts explicitly unobserved.');
assert.deepEqual(recovered.receipts.mom.receipt, momReceipt);

const failRun = await createVerificationReceiptExporter({
  outputDirectory: output,
  runId: 'preserve-prior-case',
  plannedCaseIds: ['mom', 'mas', 'iras-residency'],
  stdout: () => true
});
await failRun.exportReceipt(momReceipt);
const originalMomHash = (await readFile(path.join(failRun.runDirectory, 'manifest.json'))).toString();
await mkdir(path.join(failRun.runDirectory, 'diagnostics', 'mas.json.gz'));
await assert.rejects(failRun.exportReceipt(metadataOnlyReceipt), /already exists|directory|EISDIR|EPERM/i);
await failRun.recordExportFailure('mas', 'ARTIFACT_WRITE_FAILED');
await failRun.finish();
recovered = await readVerificationReceiptExport(failRun.runDirectory);
assert.equal(recovered.receipts.mom.receipt.id, 'mom', 'A later failure preserves the earlier exported case.');
assert.equal(recovered.manifest.cases.mas.exportStatus, 'EXPORT_FAILED');
assert.equal(recovered.manifest.cases['iras-residency'].exportStatus, 'UNOBSERVED');
assert.ok(recovered.orphanArtifactPaths.includes('receipts/mas.json.gz'), 'Files written before a failed manifest update remain orphaned, not accepted.');
assert.ok(originalMomHash.length > 0);

const manifestFailureRun = await createVerificationReceiptExporter({
  outputDirectory: output,
  runId: 'manifest-failure',
  plannedCaseIds: ['mom', 'mas'],
  stdout: () => true
});
await manifestFailureRun.exportReceipt(momReceipt);
const manifestPath = path.join(manifestFailureRun.runDirectory, 'manifest.json');
const backupManifest = path.join(manifestFailureRun.runDirectory, 'manifest.saved');
const beforeManifestFailure = await readFile(manifestPath);
await rename(manifestPath, backupManifest);
await mkdir(manifestPath);
await assert.rejects(manifestFailureRun.exportReceipt(metadataOnlyReceipt), /directory|EPERM|EISDIR|access/i);
await rm(manifestPath, { recursive: true });
await rename(backupManifest, manifestPath);
assert.deepEqual(await readFile(manifestPath), beforeManifestFailure, 'A failed manifest update leaves its prior durable version intact.');
recovered = await readVerificationReceiptExport(manifestFailureRun.runDirectory);
assert.equal(recovered.receipts.mom.receipt.id, 'mom');
assert.equal(recovered.manifest.cases.mas.exportStatus, 'UNOBSERVED');

const budgetRun = await createVerificationReceiptExporter({
  outputDirectory: output,
  runId: 'stdout-budget',
  plannedCaseIds: Array.from({ length: 100 }, (_, index) => `case-${String(index).padStart(3, '0')}`),
  stdout: line => { budgetLines.push(line); return true; }
});
let budgetError;
const budgetLines = [];
const budgetResults = [];
for (const caseId of Array.from({ length: 100 }, (_, index) => `case-${String(index).padStart(3, '0')}`)) {
  try { budgetResults.push(await budgetRun.exportReceipt({ id: caseId, status: 'I'.repeat(3_000) + '測試' })); }
  catch (error) { budgetError = error; break; }
}
assert.equal(budgetError, undefined, 'Log budget exhaustion never prevents receipt persistence.');
assert.ok(Buffer.byteLength(budgetLines.join('')) <= 32_768, 'The run stdout budget is enforced before writing the next line.');
assert.ok(budgetLines.every(line => Buffer.byteLength(line) <= 2_048), 'The per-case stdout budget is enforced.');
assert.equal(budgetResults.length, 100);
assert.ok(budgetResults.some(result => result.logStatus === 'SUMMARY_SUPPRESSED_RUN_BUDGET'));
assert.ok(budgetResults.every(result => !JSON.stringify(result).includes('測試')),
  'Large Unicode status text remains in the receipt but is omitted from summaries.');
const budgetManifest = await readVerificationReceiptExport(budgetRun.runDirectory);
assert.equal(Object.values(budgetManifest.manifest.cases).filter(entry => entry.exportStatus === 'EXPORTED').length, 100);
assert.equal(budgetManifest.receipts['case-000'].receipt.status, 'I'.repeat(3_000) + '測試',
  'The full receipt preserves a large Unicode answer-status value even when logs redact it.');

const backpressureRun = await createVerificationReceiptExporter({
  outputDirectory: output, runId: 'writer-backpressure', plannedCaseIds: ['mom'], stdout: () => false
});
const backpressureResult = await backpressureRun.exportReceipt({ id: 'mom', status: 'VERIFIED' });
assert.equal(backpressureResult.logStatus, 'SUMMARY_WRITER_BACKPRESSURE');
assert.equal((await readVerificationReceiptExport(backpressureRun.runDirectory)).receipts.mom.receipt.status, 'VERIFIED');

const markerRun = await createVerificationReceiptExporter({
  outputDirectory: output, runId: 'marker-shape', plannedCaseIds: ['mom'], stdout: () => true
});
const markerReceipt = { id: 'mom', markerShapedUserData: { $capturedBody: { sha256: 'literal-data' } }, bodyBase64: capturedBase64 };
await markerRun.exportReceipt(markerReceipt);
assert.deepEqual((await readVerificationReceiptExport(markerRun.runDirectory)).receipts.mom.receipt, markerReceipt,
  'An original user object matching the internal marker shape remains ordinary receipt data.');

const terminalRun = await createVerificationReceiptExporter({
  outputDirectory: output, runId: 'terminal-status-consistency', plannedCaseIds: ['mom', 'mas'], stdout: () => true
});
await terminalRun.exportReceipt(momReceipt);
await terminalRun.finish();
await assertManifestEditRejected(terminalRun.runDirectory,
  manifest => { manifest.status = 'COMPLETE'; }, /terminal manifest status/i,
  'A COMPLETE terminal manifest cannot retain an unobserved planned case.');

const identityRun = await createVerificationReceiptExporter({
  outputDirectory: output, runId: 'receipt-identity-consistency', plannedCaseIds: ['mom'], stdout: () => true
});
await identityRun.exportReceipt(momReceipt);
const identityManifestPath = path.join(identityRun.runDirectory, 'manifest.json');
const identityReceiptPath = path.join(identityRun.runDirectory, 'receipts', 'mom.json.gz');
const identityOriginalManifest = await readFile(identityManifestPath);
const identityOriginalReceipt = await readFile(identityReceiptPath);
const identityManifest = JSON.parse(identityOriginalManifest.toString('utf8'));
const identityRecord = JSON.parse(gunzipSync(identityOriginalReceipt).toString('utf8'));
identityRecord.receipt.id = 'mas';
const changedReceiptBytes = gzipSync(Buffer.from(`${JSON.stringify(identityRecord, null, 2)}\n`, 'utf8'));
await writeFile(identityReceiptPath, changedReceiptBytes);
identityManifest.cases.mom.receiptArtifact.sha256 = createHashFor(changedReceiptBytes);
await writeFile(identityManifestPath, `${JSON.stringify(identityManifest, null, 2)}\n`);
await assert.rejects(readVerificationReceiptExport(identityRun.runDirectory), /identity mismatch/i,
  'Even a rehashed receipt cannot change the frozen case identity.');
await writeFile(identityReceiptPath, identityOriginalReceipt);
await writeFile(identityManifestPath, identityOriginalManifest);

const allExportedRun = await createVerificationReceiptExporter({
  outputDirectory: output, runId: 'all-exported-terminal', plannedCaseIds: ['mom'], stdout: () => true
});
await allExportedRun.exportReceipt(momReceipt);
await allExportedRun.finish();
await assertManifestEditRejected(allExportedRun.runDirectory,
  manifest => { manifest.status = 'INCOMPLETE'; }, /terminal manifest status/i,
  'An INCOMPLETE terminal manifest must contain an unexported or failed planned case.');

await assert.rejects(createVerificationReceiptExporter({ outputDirectory: output, runId: '../escape', plannedCaseIds: ['mom'] }));
await assert.rejects(createVerificationReceiptExporter({ outputDirectory: output, runId: 'bad-plan', plannedCaseIds: ['../escape'] }));
await assert.rejects(createVerificationReceiptExporter({ outputDirectory: 'relative-test', runId: 'relative-output', plannedCaseIds: ['mom'] }));

const cliReceiptPath = path.join(temporaryRoot, 'retained-mom.json');
await writeFile(cliReceiptPath, JSON.stringify({ id: 'mom', status: 'INSUFFICIENT', captureCompleteness: 'CAPTURE_WINDOW_SETTLED' }));
const cli = await exportRetainedReceipts([
  '--output', output, '--run-id', 'offline-cli', '--planned-cases', 'mom,mas', '--receipts', cliReceiptPath
]);
assert.equal(cli.status, 'INCOMPLETE', 'The CLI does not mark a run complete while planned receipts remain unobserved.');
recovered = await readVerificationReceiptExport(cli.runDirectory);
assert.equal(recovered.manifest.cases.mom.exportStatus, 'EXPORTED');
assert.equal(recovered.manifest.cases.mas.exportStatus, 'UNOBSERVED');

const hostileReceiptPath = path.join(temporaryRoot, 'retained-invalid.json');
const hostileId = '秘密'.repeat(5000);
await writeFile(hostileReceiptPath, JSON.stringify({ id: hostileId, status: 'UNTRUSTED' }));
const cliLogs = { stdout: [], stderr: [] };
const hostileArguments = ['--output', output, '--run-id', 'bounded-cli-errors', '--planned-cases', 'mom'];
for (let index = 0; index < 200; index += 1) hostileArguments.push('--receipts', hostileReceiptPath);
const boundedFailureRun = await exportRetainedReceipts(hostileArguments, {
  stdout: line => { cliLogs.stdout.push(line); return true; },
  stderr: line => { cliLogs.stderr.push(line); return true; }
});
const combinedCliLogs = cliLogs.stdout.join('') + cliLogs.stderr.join('');
assert.equal(boundedFailureRun.failed, true);
assert.equal(boundedFailureRun.status, 'INCOMPLETE');
assert.ok(Buffer.byteLength(combinedCliLogs) <= 32_768, 'CLI success and failure lines share the run-wide byte budget.');
assert.ok([...cliLogs.stdout, ...cliLogs.stderr].every(line => Buffer.byteLength(line) <= 2_048), 'CLI output stays bounded per line.');
assert.equal(combinedCliLogs.includes(hostileId), false, 'CLI failure output omits an oversized untrusted case ID.');

const corruptReceipt = path.join(cli.runDirectory, 'receipts', 'mom.json.gz');
await writeFile(corruptReceipt, 'tampered');
await assert.rejects(readVerificationReceiptExport(cli.runDirectory), /hash mismatch/i,
  'The reader refuses corrupted or manually changed receipt artifacts.');

await rm(temporaryRoot, { recursive: true, force: true });
console.log('Verification receipt exporter durability, integrity, status separation, stdout bounds, interruption and CLI regressions passed.');

function createHashFor(value) {
  return createHash('sha256').update(value).digest('hex');
}
