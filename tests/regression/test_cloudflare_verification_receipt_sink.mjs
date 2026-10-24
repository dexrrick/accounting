import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createVerificationReceiptExporter } from '../../scripts/verification_receipt_exporter.mjs';
import {
  createCloudflareVerificationReceiptSink,
  downloadCloudflareVerificationReceiptRun
} from '../../scripts/cloudflare_verification_receipt_sink.mjs';

const ACCOUNT_ID = '0c07eba7cff6c7a8e3c9356cf0fcc503';
const BUCKET_NAME = 'accounting-verification-receipts';
const ACCESS_KEY_ID = 'test-access-key-id';
const SECRET_ACCESS_KEY = 'test-secret-access-key';

function hash(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function makeR2({ beforeRequest, omitEtag = false } = {}) {
  const objects = new Map();
  const requests = [];
  const fetchImpl = async (url, init) => {
    const parsedUrl = new URL(url);
    const objectMarker = '/' + BUCKET_NAME + '/';
    const markerIndex = parsedUrl.pathname.indexOf(objectMarker);
    if (markerIndex === -1) throw new Error('Test URL did not include an object key.');
    const encodedKey = parsedUrl.pathname.slice(markerIndex + objectMarker.length);
    const key = encodedKey.split('/').map(part => decodeURIComponent(part)).join('/');
    const request = { url: parsedUrl, key, method: init.method, init, objects, requests };
    requests.push(request);
    assert.equal(parsedUrl.origin, `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`, 'R2 requests use the account S3-compatible endpoint.');
    assert.ok(parsedUrl.pathname.startsWith(`/${BUCKET_NAME}/verification-runs/`));
    assert.equal(init.redirect, 'error', 'R2 requests reject redirects.');
    assert.ok(init.signal instanceof AbortSignal, 'Each R2 request has a timeout signal.');
    assert.match(init.headers.authorization, /^AWS4-HMAC-SHA256 Credential=test-access-key-id\/\d{8}\/auto\/s3\/aws4_request,/);
    assert.match(init.headers.authorization, /SignedHeaders=[a-z0-9-;]+/);
    const override = await beforeRequest?.(request);
    if (override) return override;
    if (init.method === 'GET') {
      const bytes = objects.get(key);
      return bytes ? new Response(Buffer.from(bytes), {
        status: 200,
        headers: (typeof omitEtag === 'function' ? omitEtag(key) : omitEtag) ? {} : { etag: `"${hash(bytes)}"` }
      }) : new Response(null, { status: 404 });
    }
    assert.equal(init.method, 'PUT');
    if (init.headers['if-none-match'] === '*' && objects.has(key)) return new Response(null, { status: 412 });
    if (init.headers['if-match'] && init.headers['if-match'] !== `"${hash(objects.get(key) || Buffer.alloc(0))}"`) return new Response(null, { status: 412 });
    if (!init.headers['if-none-match']) assert.equal(init.headers['content-type'], 'application/octet-stream');
    objects.set(key, Buffer.from(init.body));
    return new Response(null, { status: 200 });
  };
  return { objects, requests, fetchImpl };
}

function createSink(fake, overrides = {}) {
  return createCloudflareVerificationReceiptSink({
    accountId: ACCOUNT_ID,
    bucketName: BUCKET_NAME,
    runId: 'suite-run-20261024',
    accessKeyId: ACCESS_KEY_ID,
    secretAccessKey: SECRET_ACCESS_KEY,
    fetchImpl: fake.fetchImpl,
    timeoutMs: 500,
    ...overrides
  });
}

const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'r2-receipt-sink-'));
const fake = makeR2({
  beforeRequest: request => {
    if (request.method === 'PUT' && request.key.endsWith('/receipts/case-fail.json.gz')) return new Response(null, { status: 503 });
    return undefined;
  }
});
const sink = createSink(fake);
const stdout = [];
const localRoot = path.join(temporaryRoot, 'local-original');
const exporter = await createVerificationReceiptExporter({
  outputDirectory: localRoot,
  runId: 'suite-run-20261024',
  plannedCaseIds: ['case-one', 'case-two', 'case-metadata', 'case-fail'],
  stdout: line => { stdout.push(line); return true; },
  durableSink: sink
});

assert.equal(fake.objects.get(sink.manifestKey) && JSON.parse(fake.objects.get(sink.manifestKey).toString()).status, 'IN_PROGRESS',
  'Construction completes preflight and publishes only an initial manifest before any case dispatch.');
assert.equal(fake.requests.filter(request => request.method === 'PUT').length, 3,
  'Preflight atomically claims the writer lock, writes one probe and publishes the initial manifest before cases.');
assert.ok(fake.requests.some(request => request.key.includes('/preflight/')));
assert.ok(fake.requests.some(request => request.method === 'PUT' && request.key === sink.manifestKey && request.init.headers['if-none-match'] === '*'));
assert.ok(fake.requests.some(request => request.key.endsWith('/writer-lock.json') && request.init.headers['if-none-match'] === '*'),
  'Preflight atomically claims a permanent single-writer lock before any case dispatch.');
assert.equal(fake.requests.some(request => request.url.hostname !== `${ACCOUNT_ID}.r2.cloudflarestorage.com`), false);
{
  const request = fake.requests.find(item => item.method === 'PUT' && item.key.endsWith('/writer-lock.json'));
  const amzDate = request.init.headers['x-amz-date'];
  const date = amzDate.slice(0, 8);
  const bodyHash = hash(Buffer.from(request.init.body));
  const path = request.url.pathname;
  const headers = request.init.headers;
  const canonicalHeaders = 'content-type:application/octet-stream\nhost:' + request.url.host + '\nif-none-match:*\nx-amz-content-sha256:' + bodyHash + '\nx-amz-date:' + amzDate + '\n';
  const canonicalRequest = ['PUT', path, '', canonicalHeaders, 'content-type;host;if-none-match;x-amz-content-sha256;x-amz-date', bodyHash].join('\n');
  const scope = `${date}/auto/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, hash(Buffer.from(canonicalRequest))].join('\n');
  const hmac = (keyBytes, value) => createHmac('sha256', keyBytes).update(value).digest();
  const dateKey = hmac(Buffer.from(`AWS4${SECRET_ACCESS_KEY}`, 'utf8'), date);
  const signingKey = hmac(hmac(hmac(dateKey, 'auto'), 's3'), 'aws4_request');
  const expected = hmac(signingKey, stringToSign).toString('hex');
  assert.ok(headers.authorization.endsWith('Signature=' + expected),
    'SigV4 signature independently matches its canonical request (' + headers.authorization.slice(-64) + ' != ' + expected + ').');
}

const capturedText = 'A retained official-source body with quotation. 測試';
const capturedBytes = Buffer.from(capturedText, 'utf8');
const sharedSource = {
  httpStatus: 200, captureStatus: 'COMPLETE', responseBodyHashScope: 'complete_response',
  responseBodySha256: hash(capturedBytes), responseBodyBytes: capturedBytes.length,
  capturedBodyBytes: capturedBytes.length, bodyText: capturedText
};
const firstReceipt = {
  id: 'case-one', status: 'VERIFIED', captureCompleteness: 'CAPTURE_WINDOW_SETTLED', sourceResponses: [sharedSource]
};
const secondReceipt = {
  id: 'case-two', status: 'VERIFIED', captureCompleteness: 'CAPTURE_WINDOW_SETTLED', sourceResponses: [{ ...sharedSource }]
};
const metadataOnlyReceipt = {
  id: 'case-metadata', status: 'INSUFFICIENT', captureCompleteness: 'CAPTURE_WINDOW_SETTLED',
  sourceResponses: [{ httpStatus: 200, captureStatus: 'COMPLETE', responseBodyHashScope: 'complete_response',
    responseBodySha256: 'a'.repeat(64), responseBodyBytes: 4096, capturedBodyBytes: 0 }]
};

await exporter.exportReceipt(firstReceipt);
const firstRemoteManifest = Buffer.from(fake.objects.get(sink.manifestKey));
const firstManifest = JSON.parse(firstRemoteManifest.toString('utf8'));
assert.equal(firstManifest.cases['case-one'].exportStatus, 'EXPORTED');
assert.equal(firstManifest.cases['case-one'].remoteArtifacts.every(artifact => artifact.verified), true);
for (const artifact of firstManifest.cases['case-one'].remoteArtifacts) {
  assert.ok(fake.objects.has(artifact.key), 'The manifest is published only after each referenced artifact is in R2.');
  assert.equal(hash(fake.objects.get(artifact.key)), artifact.sha256);
}

await exporter.exportReceipt(secondReceipt);
await exporter.exportReceipt(metadataOnlyReceipt);
const bodyKey = `${sink.prefix}/bodies/${hash(capturedBytes)}.gz`;
assert.equal(fake.requests.filter(request => request.method === 'PUT' && request.key === bodyKey).length, 1,
  'A shared captured body is uploaded and verified once across cases.');
const beforeFailureManifest = Buffer.from(fake.objects.get(sink.manifestKey));
await assert.rejects(exporter.exportReceipt({ id: 'case-fail', status: 'VERIFIED' }), /R2_IMMUTABLE_OBJECT_REMOTE_UNCERTAIN/);
assert.deepEqual(fake.objects.get(sink.manifestKey), beforeFailureManifest,
  'A failed case upload does not publish or replace the previous manifest.');
assert.equal(JSON.parse(beforeFailureManifest.toString()).cases['case-fail'].exportStatus, 'UNOBSERVED');
const recordedFailure = await exporter.recordExportFailure('case-fail', 'R2_PUT_REJECTED_503');
assert.deepEqual(recordedFailure, { exportStatus: 'UNOBSERVED', persistence: 'REMOTE_UNCERTAIN' });
assert.deepEqual(fake.objects.get(sink.manifestKey), beforeFailureManifest,
  'An ambiguous artifact write leaves the previous manifest authoritative and fences the run.');
await assert.rejects(exporter.finish(), /R2_RUN_TERMINATED_REMOTE_UNCERTAIN/);
const finalManifest = JSON.parse(await readFile(path.join(exporter.runDirectory, 'manifest.json'), 'utf8'));
assert.equal(finalManifest.status, 'IN_PROGRESS');
assert.equal(finalManifest.cases['case-metadata'].payloadAvailability, 'METADATA_ONLY');
assert.equal(finalManifest.cases['case-fail'].exportStatus, 'UNOBSERVED');
assert.ok(fake.requests.some(request => request.method === 'PUT' && request.key === sink.manifestKey && request.init.headers['if-match']),
  'Every manifest replacement uses the ETag from the previously verified version.');

const downloadedRoot = path.join(temporaryRoot, 'downloaded');
await rm(localRoot, { recursive: true });
const recoverySink = createSink(fake);
const writesBeforeRecovery = fake.requests.filter(request => request.method === 'PUT').length;
const downloaded = await downloadCloudflareVerificationReceiptRun({ sink: recoverySink, outputDirectory: downloadedRoot });
assert.equal(fake.requests.filter(request => request.method === 'PUT').length, writesBeforeRecovery,
  'A fresh read-only sink can recover a run without re-running writer preflight or issuing writes.');
assert.deepEqual(downloaded.receipts['case-one'].receipt, firstReceipt);
assert.deepEqual(downloaded.receipts['case-two'].receipt, secondReceipt);
assert.equal(downloaded.receipts['case-metadata'].diagnostic.payloadAvailability, 'METADATA_ONLY');
assert.equal(downloaded.manifest.cases['case-fail'].exportStatus, 'UNOBSERVED');
assert.equal((await readFile(path.join(downloaded.runDirectory, 'bodies', `${hash(capturedBytes)}.gz`))).length,
  fake.objects.get(bodyKey).length);
assert.ok(stdout.every(line => Buffer.byteLength(line) <= 2048));
assert.equal(fake.requests.some(request => /generativelanguage|googleapis|(?:acra|cpf|mom|mas|iras)\.gov\.sg/i.test(request.url.href)), false,
  'The sink performs only receipt storage calls and never dispatches model or source requests.');

let sabotageLocalMirror = true;
let localMirrorFailureInjected = false;
let localMirrorSetupError;
const mirrorFailureRoot = path.join(temporaryRoot, 'remote-authoritative-local');
const mirrorFailureManifestPath = path.join(mirrorFailureRoot, 'remote-authoritative-run', 'manifest.json');
const mirrorFailureFake = makeR2({ beforeRequest: async request => {
  if (sabotageLocalMirror && !localMirrorFailureInjected && request.method === 'GET' && request.key.endsWith('/manifest.json') && request.objects.has(request.key)) {
    const remoteManifest = JSON.parse(request.objects.get(request.key).toString('utf8'));
    if (remoteManifest.cases?.['case-authoritative']?.exportStatus === 'EXPORTED' || remoteManifest.status === 'COMPLETE') {
      localMirrorFailureInjected = true;
      try {
        await rm(mirrorFailureManifestPath, { recursive: true, force: true });
        await mkdir(mirrorFailureManifestPath, { recursive: true });
        await writeFile(path.join(mirrorFailureManifestPath, 'blocker'), 'keep local mirror unwritable');
      } catch (error) {
        localMirrorSetupError = error;
        throw error;
      }
    }
  }
  return undefined;
} });
const mirrorFailureSink = createSink(mirrorFailureFake, { runId: 'remote-authoritative-run' });
const mirrorFailureExporter = await createVerificationReceiptExporter({
  outputDirectory: mirrorFailureRoot,
  runId: 'remote-authoritative-run',
  plannedCaseIds: ['case-authoritative'],
  stdout: () => true,
  durableSink: mirrorFailureSink
});
let finishAttempted = false;
const localMirrorFailure = error => ['EISDIR', 'EEXIST', 'ENOTEMPTY', 'EPERM', 'EACCES'].includes(error.code);
let exportMirrorError;
let finishMirrorError;
try {
  try {
    await mirrorFailureExporter.exportReceipt({ id: 'case-authoritative', status: 'VERIFIED', sourceResponses: [] });
  } catch (error) {
    exportMirrorError = error;
    const preservedExport = await mirrorFailureExporter.recordExportFailure('case-authoritative', 'LOCAL_MIRROR_FAILED');
    assert.deepEqual(preservedExport, {
      exportStatus: 'EXPORTED', persistence: 'PREVIOUSLY_VERIFIED_EXPORT_PRESERVED'
    }, 'Recording a local mirror failure cannot downgrade an already verified remote export.');
  } finally {
    finishAttempted = true;
    try {
      await mirrorFailureExporter.finish();
    } catch (error) {
      finishMirrorError = error;
    }
  }
} finally {
  sabotageLocalMirror = false;
}
assert.equal(finishAttempted, true);
assert.ok(localMirrorFailure(exportMirrorError), `Export should reject with a local filesystem failure; injection error: ${localMirrorSetupError?.message || 'none'}`);
assert.ok(localMirrorFailure(finishMirrorError), 'Finalization should retain remote authority while the local mirror stays unwritable.');
const remoteAuthoritativeManifest = JSON.parse(mirrorFailureFake.objects.get(mirrorFailureSink.manifestKey).toString('utf8'));
assert.equal(remoteAuthoritativeManifest.status, 'COMPLETE');
assert.equal(remoteAuthoritativeManifest.cases['case-authoritative'].exportStatus, 'EXPORTED',
  'A verified remote case remains authoritative after local mirror failure and finalization.');
const mirrorRecoverySink = createSink(mirrorFailureFake, { runId: 'remote-authoritative-run' });
const mirrorRecovery = await downloadCloudflareVerificationReceiptRun({
  sink: mirrorRecoverySink,
  outputDirectory: path.join(temporaryRoot, 'remote-authoritative-recovery')
});
assert.deepEqual(mirrorRecovery.receipts['case-authoritative'].receipt,
  { id: 'case-authoritative', status: 'VERIFIED', sourceResponses: [] },
  'A new sink instance can recover the exact receipt accepted by remote storage.');

const collision = makeR2();
const collisionSink = createSink(collision, { runId: 'collision-run' });
collision.objects.set('verification-runs/collision-run/manifest.json', Buffer.from('{}'));
await assert.rejects(collisionSink.preflight({ runId: 'collision-run', plannedCaseIds: ['a'] }), /R2_RUN_PREFIX_ALREADY_PUBLISHED/);
assert.equal(collision.requests.filter(request => request.method === 'PUT').length, 0,
  'A prefix collision stops before any remote write.');

let releaseLockRequests;
const bothLockRequests = new Promise(resolve => { releaseLockRequests = resolve; });
let lockRequestCount = 0;
const simultaneous = makeR2({ beforeRequest: async request => {
  if (request.method === 'PUT' && request.key.endsWith('/writer-lock.json')) {
    lockRequestCount += 1;
    if (lockRequestCount === 2) releaseLockRequests();
    await bothLockRequests;
  }
  return undefined;
} });
const simultaneousWriters = [createSink(simultaneous, { runId: 'simultaneous-writers' }),
  createSink(simultaneous, { runId: 'simultaneous-writers' })];
const simultaneousResults = await Promise.allSettled(simultaneousWriters.map(writer =>
  writer.preflight({ runId: 'simultaneous-writers', plannedCaseIds: ['a'] })));
assert.equal(simultaneousResults.filter(result => result.status === 'fulfilled').length, 1,
  'The S3 conditional writer lock admits exactly one simultaneous writer for a run ID.');
assert.match(simultaneousResults.find(result => result.status === 'rejected').reason.message, /R2_RUN_WRITER_ALREADY_CLAIMED/);

const failureStatusUnavailable = makeR2({ beforeRequest: request => {
  if (request.method === 'PUT' && request.key.endsWith('/receipts/failed-case.json.gz')) return new Response(null, { status: 503 });
  if (request.method === 'PUT' && request.key.endsWith('/manifest.json') && request.objects.has(request.key)) return new Response(null, { status: 503 });
  return undefined;
} });
const failureStatusSink = createSink(failureStatusUnavailable, { runId: 'failed-status-not-saved' });
const failureStatusExporter = await createVerificationReceiptExporter({
  outputDirectory: path.join(temporaryRoot, 'failure-status-not-saved'), runId: 'failed-status-not-saved',
  plannedCaseIds: ['failed-case'], stdout: () => true, durableSink: failureStatusSink
});
await assert.rejects(failureStatusExporter.exportReceipt({ id: 'failed-case', status: 'VERIFIED' }), /R2_IMMUTABLE_OBJECT_REMOTE_UNCERTAIN/);
assert.deepEqual(await failureStatusExporter.recordExportFailure('failed-case', 'R2_PUT_REJECTED_503'),
  { exportStatus: 'UNOBSERVED', persistence: 'REMOTE_UNCERTAIN' });
const uncertainFailureStatus = JSON.parse((await readFile(path.join(failureStatusExporter.runDirectory, 'manifest.json'))).toString('utf8'));
assert.equal(uncertainFailureStatus.cases['failed-case'].exportStatus, 'UNOBSERVED',
  'When both artifact and failure-status writes fail, the manifest retains uncertainty instead of inventing a saved failure.');
const uncertainManifestWrites = failureStatusUnavailable.requests.filter(request => request.method === 'PUT' && request.key.endsWith('/manifest.json')).length;
await assert.rejects(failureStatusExporter.finish(), /R2_RUN_TERMINATED_REMOTE_UNCERTAIN/);
assert.equal(failureStatusUnavailable.requests.filter(request => request.method === 'PUT' && request.key.endsWith('/manifest.json')).length,
  uncertainManifestWrites, 'An uncertain artifact write fences further manifest changes.');

const racedPrefix = makeR2();
const racedSink = createSink(racedPrefix, { runId: 'raced-prefix-run' });
await racedSink.preflight({ runId: 'raced-prefix-run', plannedCaseIds: ['a'] });
const concurrentlyPublishedManifest = Buffer.from('{"runId":"another-writer"}');
racedPrefix.objects.set(racedSink.manifestKey, concurrentlyPublishedManifest);
await assert.rejects(racedSink.publishManifest(Buffer.from('{"runId":"ours"}')), /R2_RUN_PREFIX_ALREADY_PUBLISHED/);
assert.deepEqual(racedPrefix.objects.get(racedSink.manifestKey), concurrentlyPublishedManifest,
  'The initial publication refuses to overwrite a manifest created after preflight.');

const denied = makeR2({ beforeRequest: () => new Response(null, { status: 403 }) });
const deniedSink = createSink(denied, { runId: 'denied-run' });
await assert.rejects(deniedSink.preflight({ runId: 'denied-run', plannedCaseIds: ['a'] }), error =>
  error.message.includes('403') && !error.message.includes(SECRET_ACCESS_KEY));
assert.equal(denied.requests.filter(request => request.method === 'PUT').length, 0);

const redirects = makeR2({ beforeRequest: () => new Response('do not log this', { status: 302, headers: { location: 'https://evil.invalid/' } }) });
await assert.rejects(createSink(redirects, { runId: 'redirect-run' }).preflight({ runId: 'redirect-run', plannedCaseIds: ['a'] }), /R2_REDIRECT_REJECTED/);

const mismatch = makeR2({
  beforeRequest: request => request.method === 'GET' && request.key.endsWith('/receipts/a.json.gz') && request.objects.has(request.key)
    ? new Response(Buffer.from('wrong bytes'), { status: 200 }) : undefined
});
const mismatchSink = createSink(mismatch, { runId: 'mismatch-run' });
await mismatchSink.preflight({ runId: 'mismatch-run', plannedCaseIds: ['a'] });
await assert.rejects(mismatchSink.putArtifact('receipts/a.json.gz', Buffer.from('receipt'), { immutable: true }), /R2_READBACK_MISMATCH_REMOTE_UNCERTAIN/);

const missingReadback = makeR2({
  beforeRequest: request => request.method === 'GET' && request.key.endsWith('/receipts/a.json.gz')
    ? new Response(null, { status: 404 }) : undefined
});
const missingSink = createSink(missingReadback, { runId: 'missing-run' });
await missingSink.preflight({ runId: 'missing-run', plannedCaseIds: ['a'] });
await assert.rejects(missingSink.putArtifact('receipts/a.json.gz', Buffer.from('receipt'), { immutable: true }), /R2_READBACK_MISSING_REMOTE_UNCERTAIN/);

const timeoutFake = makeR2({ beforeRequest: request => new Promise((_resolve, reject) => {
  request.init.signal.addEventListener('abort', () => reject(new Error('synthetic timeout')), { once: true });
}) });
const timeoutSink = createSink(timeoutFake, { runId: 'timeout-run', timeoutMs: 100 });
const timeoutKeepAlive = setTimeout(() => {}, 250);
await assert.rejects(timeoutSink.preflight({ runId: 'timeout-run', plannedCaseIds: ['a'] }), /R2_GET_REQUEST_FAILED/);
clearTimeout(timeoutKeepAlive);

let failManifestReadbackOnce = true;
let mismatchedManifestReadbacks = 0;
const rollbackFake = makeR2({ beforeRequest: request => {
  if (request.method === 'PUT' && request.key.endsWith('/manifest.json') && request.objects.has(request.key) && failManifestReadbackOnce) {
    failManifestReadbackOnce = false;
    mismatchedManifestReadbacks = 2;
  } else if (request.method === 'GET' && request.key.endsWith('/manifest.json') && mismatchedManifestReadbacks > 0) {
    mismatchedManifestReadbacks -= 1;
    return new Response(Buffer.from('unverified manifest readback'), { status: 200 });
  }
  return undefined;
} });
const rollbackSink = createSink(rollbackFake, { runId: 'manifest-rollback-run' });
const rollbackExporter = await createVerificationReceiptExporter({
  outputDirectory: path.join(temporaryRoot, 'manifest-rollback-local'),
  runId: 'manifest-rollback-run',
  plannedCaseIds: ['case-one'],
  stdout: () => true,
  durableSink: rollbackSink
});
const priorRemoteManifest = Buffer.from(rollbackFake.objects.get(rollbackSink.manifestKey));
await assert.rejects(rollbackExporter.exportReceipt({ id: 'case-one', status: 'VERIFIED' }), /R2_MANIFEST_REMOTE_UNCERTAIN/);
assert.notDeepEqual(rollbackFake.objects.get(rollbackSink.manifestKey), priorRemoteManifest,
  'A mismatched readback is reported as uncertain without overwriting a possibly committed proposal.');
const localRollbackManifest = JSON.parse(await readFile(path.join(rollbackExporter.runDirectory, 'manifest.json'), 'utf8'));
assert.equal(localRollbackManifest.cases['case-one'].exportStatus, 'UNOBSERVED', 'A failed remote publish cannot promote the local case.');
assert.deepEqual(await rollbackExporter.recordExportFailure('case-one'),
  { exportStatus: 'UNOBSERVED', persistence: 'REMOTE_UNCERTAIN' });
const uncertainPublishCount = rollbackFake.requests.filter(request => request.method === 'PUT' && request.key === rollbackSink.manifestKey).length;
await assert.rejects(rollbackExporter.finish(), /R2_RUN_TERMINATED_REMOTE_UNCERTAIN/);
assert.equal(rollbackFake.requests.filter(request => request.method === 'PUT' && request.key === rollbackSink.manifestKey).length,
  uncertainPublishCount, 'An uncertain manifest replacement cannot trigger rollback or finalization writes.');

let failAcceptedManifestWriteOnce = true;
const transportRollbackFake = makeR2({ beforeRequest: request => {
  if (request.method === 'PUT' && request.key.endsWith('/manifest.json') && request.objects.has(request.key) && failAcceptedManifestWriteOnce) {
    failAcceptedManifestWriteOnce = false;
    request.objects.set(request.key, Buffer.from(request.init.body));
    throw new Error('synthetic connection loss after server accepted the manifest');
  }
  return undefined;
} });
const transportRollbackSink = createSink(transportRollbackFake, { runId: 'manifest-transport-rollback-run' });
const transportRollbackExporter = await createVerificationReceiptExporter({
  outputDirectory: path.join(temporaryRoot, 'manifest-transport-rollback-local'),
  runId: 'manifest-transport-rollback-run',
  plannedCaseIds: ['case-one'],
  stdout: () => true,
  durableSink: transportRollbackSink
});
const priorTransportManifest = Buffer.from(transportRollbackFake.objects.get(transportRollbackSink.manifestKey));
await transportRollbackExporter.exportReceipt({ id: 'case-one', status: 'VERIFIED' });
assert.notDeepEqual(transportRollbackFake.objects.get(transportRollbackSink.manifestKey), priorTransportManifest,
  'A lost acknowledgement is reconciled against the proposed manifest with a read-only exact-hash read.');
const priorHistoryKey = `${transportRollbackSink.prefix}/manifest-history/${hash(priorTransportManifest)}.json`;
assert.deepEqual(transportRollbackFake.objects.get(priorHistoryKey), priorTransportManifest,
  'The previous manifest remains recoverable in immutable history.');
const localTransportManifest = JSON.parse(await readFile(path.join(transportRollbackExporter.runDirectory, 'manifest.json'), 'utf8'));
assert.equal(localTransportManifest.cases['case-one'].exportStatus, 'EXPORTED');

let failFirstManifestReadback = false;
const secondReadFake = makeR2({ beforeRequest: request => {
  if (request.method === 'PUT' && request.key.endsWith('/manifest.json') && request.objects.has(request.key)) {
    failFirstManifestReadback = true;
  } else if (request.method === 'GET' && request.key.endsWith('/manifest.json') && failFirstManifestReadback) {
    failFirstManifestReadback = false;
    return new Response(null, { status: 503 });
  }
  return undefined;
} });
const secondReadSink = createSink(secondReadFake, { runId: 'manifest-readonly-reconcile-run' });
const secondReadExporter = await createVerificationReceiptExporter({
  outputDirectory: path.join(temporaryRoot, 'manifest-readonly-reconcile-local'), runId: 'manifest-readonly-reconcile-run',
  plannedCaseIds: ['case-one'], stdout: () => true, durableSink: secondReadSink
});
await secondReadExporter.exportReceipt({ id: 'case-one', status: 'VERIFIED' });
assert.equal(JSON.parse(secondReadFake.objects.get(secondReadSink.manifestKey).toString()).cases['case-one'].exportStatus, 'EXPORTED',
  'A bounded read-only reconciliation can verify a manifest after the first acknowledgement read fails.');
assert.equal(secondReadFake.requests.filter(request => request.method === 'PUT' && request.key === secondReadSink.manifestKey).length, 2,
  'A failed manifest read triggers no additional PUT attempt.');

let delayedManifestCommit = true;
const delayedCommitFake = makeR2({ beforeRequest: request => {
  if (request.method === 'PUT' && request.key.endsWith('/manifest.json') && request.objects.has(request.key) && delayedManifestCommit) {
    delayedManifestCommit = false;
    const delayedBytes = Buffer.from(request.init.body);
    setTimeout(() => request.objects.set(request.key, delayedBytes), 25);
    return new Response(null, { status: 503 });
  }
  return undefined;
} });
const delayedCommitSink = createSink(delayedCommitFake, { runId: 'manifest-delayed-commit-run' });
const delayedCommitExporter = await createVerificationReceiptExporter({
  outputDirectory: path.join(temporaryRoot, 'manifest-delayed-commit-local'), runId: 'manifest-delayed-commit-run',
  plannedCaseIds: ['case-one'], stdout: () => true, durableSink: delayedCommitSink
});
const priorDelayedManifest = Buffer.from(delayedCommitFake.objects.get(delayedCommitSink.manifestKey));
await assert.rejects(delayedCommitExporter.exportReceipt({ id: 'case-one', status: 'VERIFIED' }), /R2_MANIFEST_REMOTE_PREVIOUS/);
const delayedManifestWrites = delayedCommitFake.requests.filter(request => request.method === 'PUT' && request.key === delayedCommitSink.manifestKey).length;
assert.deepEqual(await delayedCommitExporter.recordExportFailure('case-one'),
  { exportStatus: 'UNOBSERVED', persistence: 'REMOTE_PREVIOUS' });
await assert.rejects(delayedCommitExporter.finish(), /R2_RUN_TERMINATED_REMOTE_PREVIOUS/);
assert.equal(delayedCommitFake.requests.filter(request => request.method === 'PUT' && request.key === delayedCommitSink.manifestKey).length,
  delayedManifestWrites, 'No rollback or finalization PUT races a delayed manifest commit.');
await new Promise(resolve => setTimeout(resolve, 35));
assert.notDeepEqual(delayedCommitFake.objects.get(delayedCommitSink.manifestKey), priorDelayedManifest,
  'The earlier manifest update can land after reconciliation reports REMOTE_PREVIOUS.');

const immutableRaceFake = makeR2({ beforeRequest: request => {
  if (request.method === 'PUT' && request.key.endsWith('/receipts/collision.json.gz') && !request.objects.has(request.key)) {
    request.objects.set(request.key, Buffer.from('competing bytes'));
  }
  return undefined;
} });
const immutableRaceSink = createSink(immutableRaceFake, { runId: 'immutable-race-run' });
await immutableRaceSink.preflight({ runId: 'immutable-race-run', plannedCaseIds: ['collision'] });
await assert.rejects(immutableRaceSink.putArtifact('receipts/collision.json.gz', Buffer.from('ours')),
  /R2_IMMUTABLE_OBJECT_REMOTE_UNCERTAIN/);
assert.equal(immutableRaceFake.objects.get(`${immutableRaceSink.prefix}/receipts/collision.json.gz`).toString(), 'competing bytes',
  'Conditional immutable create does not overwrite a racing writer.');
assert.ok(immutableRaceFake.requests.some(request => request.key.endsWith('/receipts/collision.json.gz') && request.init.headers['if-none-match'] === '*'));

const manifestRaceFake = makeR2();
const manifestRaceSink = createSink(manifestRaceFake, { runId: 'manifest-race-run' });
const manifestRaceExporter = await createVerificationReceiptExporter({
  outputDirectory: path.join(temporaryRoot, 'manifest-race-local'), runId: 'manifest-race-run',
  plannedCaseIds: ['case-one'], stdout: () => true, durableSink: manifestRaceSink
});
const competingManifest = Buffer.from('{"runId":"competing"}');
manifestRaceFake.objects.set(manifestRaceSink.manifestKey, competingManifest);
await assert.rejects(manifestRaceExporter.exportReceipt({ id: 'case-one', status: 'VERIFIED' }), /R2_MANIFEST_REMOTE_UNCERTAIN/);
assert.deepEqual(manifestRaceFake.objects.get(manifestRaceSink.manifestKey), competingManifest,
  'A manifest changed by another actor is neither replaced nor rolled back.');

const initialCasCompetitor = Buffer.from('{"runId":"raced-initial-create"}');
const initialCasRaceFake = makeR2({ beforeRequest: request => {
  if (request.method === 'PUT' && request.key.endsWith('/manifest.json') && !request.objects.has(request.key)) {
    request.objects.set(request.key, initialCasCompetitor);
  }
  return undefined;
} });
const initialCasRaceSink = createSink(initialCasRaceFake, { runId: 'initial-cas-race-run' });
await assert.rejects(createVerificationReceiptExporter({
  outputDirectory: path.join(temporaryRoot, 'initial-cas-race-local'), runId: 'initial-cas-race-run',
  plannedCaseIds: ['case-one'], stdout: () => true, durableSink: initialCasRaceSink
}), /R2_MANIFEST_REMOTE_UNCERTAIN/);
assert.deepEqual(initialCasRaceFake.objects.get(initialCasRaceSink.manifestKey), initialCasCompetitor,
  'If-None-Match rejects a competing manifest created after the negative read.');

const replacementCasCompetitor = Buffer.from('{"runId":"raced-replacement"}');
const replacementCasRaceFake = makeR2({ beforeRequest: request => {
  if (request.method === 'PUT' && request.key.endsWith('/manifest.json') && request.init.headers['if-match']) {
    request.objects.set(request.key, replacementCasCompetitor);
  }
  return undefined;
} });
const replacementCasRaceSink = createSink(replacementCasRaceFake, { runId: 'replacement-cas-race-run' });
const replacementCasRaceExporter = await createVerificationReceiptExporter({
  outputDirectory: path.join(temporaryRoot, 'replacement-cas-race-local'), runId: 'replacement-cas-race-run',
  plannedCaseIds: ['case-one'], stdout: () => true, durableSink: replacementCasRaceSink
});
await assert.rejects(replacementCasRaceExporter.exportReceipt({ id: 'case-one', status: 'VERIFIED' }), /R2_MANIFEST_REMOTE_UNCERTAIN/);
assert.deepEqual(replacementCasRaceFake.objects.get(replacementCasRaceSink.manifestKey), replacementCasCompetitor,
  'If-Match rejects a competing manifest written after the previous-version GET.');

const missingEtagFake = makeR2({ omitEtag: true });
const missingEtagSink = createSink(missingEtagFake, { runId: 'missing-manifest-etag-run' });
await assert.rejects(createVerificationReceiptExporter({
  outputDirectory: path.join(temporaryRoot, 'missing-manifest-etag-local'), runId: 'missing-manifest-etag-run',
  plannedCaseIds: ['case-one'], stdout: () => true, durableSink: missingEtagSink
}), /R2_MANIFEST_ETAG_REQUIRED/);
assert.ok(missingEtagFake.objects.has(missingEtagSink.manifestKey), 'The observed initial manifest is retained after continuation fails closed without an ETag.');

let hideManifestEtag = false;
const replacementMissingEtagFake = makeR2({
  omitEtag: key => hideManifestEtag && key.endsWith('/manifest.json'),
  beforeRequest: request => {
    if (request.method === 'PUT' && request.key.endsWith('/manifest.json') && request.objects.has(request.key)) hideManifestEtag = true;
    return undefined;
  }
});
const replacementMissingEtagSink = createSink(replacementMissingEtagFake, { runId: 'replacement-missing-etag-run' });
const replacementMissingEtagExporter = await createVerificationReceiptExporter({
  outputDirectory: path.join(temporaryRoot, 'replacement-missing-etag-local'), runId: 'replacement-missing-etag-run',
  plannedCaseIds: ['last-case'], stdout: () => true, durableSink: replacementMissingEtagSink
});
await assert.rejects(replacementMissingEtagExporter.exportReceipt({ id: 'last-case', status: 'VERIFIED' }), /R2_MANIFEST_ETAG_REQUIRED/);
const preservedLastCase = JSON.parse(await readFile(path.join(replacementMissingEtagExporter.runDirectory, 'manifest.json'), 'utf8'));
assert.equal(preservedLastCase.cases['last-case'].exportStatus, 'EXPORTED',
  'An exact-hash but non-CAS-verifiable final case remains recorded as remotely accepted.');
const lastCaseManifestWrites = replacementMissingEtagFake.requests.filter(request => request.method === 'PUT' && request.key === replacementMissingEtagSink.manifestKey).length;
await assert.rejects(replacementMissingEtagExporter.finish(), /R2_RUN_TERMINATED_REMOTE_VERIFIED/);
assert.equal(replacementMissingEtagFake.requests.filter(request => request.method === 'PUT' && request.key === replacementMissingEtagSink.manifestKey).length,
  lastCaseManifestWrites, 'The final case cannot be presented as a successfully finalized run.');

let hideFailureStatusEtag = false;
const failureStatusMissingEtagFake = makeR2({
  omitEtag: key => hideFailureStatusEtag && key.endsWith('/manifest.json'),
  beforeRequest: request => {
    if (request.method === 'PUT' && request.key.endsWith('/manifest.json') && request.objects.has(request.key)) hideFailureStatusEtag = true;
    return undefined;
  }
});
const failureStatusMissingEtagSink = createSink(failureStatusMissingEtagFake, { runId: 'failure-status-missing-etag-run' });
const failureStatusMissingEtagExporter = await createVerificationReceiptExporter({
  outputDirectory: path.join(temporaryRoot, 'failure-status-missing-etag-local'), runId: 'failure-status-missing-etag-run',
  plannedCaseIds: ['failed-case'], stdout: () => true, durableSink: failureStatusMissingEtagSink
});
assert.deepEqual(await failureStatusMissingEtagExporter.recordExportFailure('failed-case', 'TEST_CASE_FAILURE'),
  { exportStatus: 'EXPORT_FAILED', persistence: 'REMOTE_VERIFIED' },
  'A remotely verified failure status reports its terminal condition, not a local-mirror failure.');
assert.equal(JSON.parse(failureStatusMissingEtagFake.objects.get(failureStatusMissingEtagSink.manifestKey).toString())
  .cases['failed-case'].exportStatus, 'EXPORT_FAILED');
assert.equal(JSON.parse(await readFile(path.join(failureStatusMissingEtagExporter.runDirectory, 'manifest.json'), 'utf8'))
  .cases['failed-case'].exportStatus, 'EXPORT_FAILED', 'The exact remotely verified failure status is mirrored locally.');
await assert.rejects(failureStatusMissingEtagExporter.finish(), /R2_RUN_TERMINATED_REMOTE_VERIFIED/);

assert.throws(() => createSink(makeR2(), { accountId: 'wrong-account' }), /account ID/);
assert.throws(() => createSink(makeR2(), { bucketName: '../wrong-bucket' }), /bucket name/);
const invalidPlanFake = makeR2();
const invalidPlanSink = createSink(invalidPlanFake, { runId: 'invalid-plan-run' });
await assert.rejects(invalidPlanSink.preflight({ runId: 'invalid-plan-run', plannedCaseIds: [null] }), /R2_PREFLIGHT_PLAN_INVALID/);
assert.equal(invalidPlanFake.requests.length, 0, 'Invalid planned IDs are rejected before any remote request.');
const traversal = makeR2();
const traversalSink = createSink(traversal, { runId: 'traversal-run' });
await traversalSink.preflight({ runId: 'traversal-run', plannedCaseIds: ['a'] });
const requestsBeforeTraversal = traversal.requests.length;
await assert.rejects(traversalSink.putArtifact('../outside.json', Buffer.from('x')), /Invalid remote artifact path/);
assert.equal(traversal.requests.length, requestsBeforeTraversal, 'Rejected object paths never reach Cloudflare.');
await assert.rejects(traversalSink.getArtifact('verification-runs/other-run/manifest.json'), /R2_OBJECT_OUTSIDE_RUN_PREFIX/);

const forbiddenOutput = path.join(temporaryRoot, 'no-run-folder');
const preflightFailure = makeR2({ beforeRequest: () => new Response(null, { status: 403 }) });
await assert.rejects(createVerificationReceiptExporter({
  outputDirectory: forbiddenOutput,
  runId: 'preflight-blocked',
  plannedCaseIds: ['a'],
  durableSink: createSink(preflightFailure, { runId: 'preflight-blocked' })
}));
await assert.rejects(readdir(path.join(forbiddenOutput, 'preflight-blocked')),
  error => error.code === 'ENOENT', 'Failed preflight must occur before a local run directory or manifest is created.');

await rm(temporaryRoot, { recursive: true, force: true });
console.log('Cloudflare receipt sink preflight, immutable upload, R2 readback, manifest ordering, offline recovery and failure regressions passed.');
