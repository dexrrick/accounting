import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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
const TOKEN = 'synthetic-test-token-never-log';

function hash(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function makeR2({ beforeRequest } = {}) {
  const objects = new Map();
  const requests = [];
  const fetchImpl = async (url, init) => {
    const parsedUrl = new URL(url);
    const objectMarker = '/objects/';
    const markerIndex = parsedUrl.pathname.indexOf(objectMarker);
    if (markerIndex === -1) throw new Error('Test URL did not include an object key.');
    const encodedKey = parsedUrl.pathname.slice(markerIndex + objectMarker.length);
    const key = encodedKey.split('/').map(part => decodeURIComponent(part)).join('/');
    const request = { url: parsedUrl, key, method: init.method, init, objects, requests };
    requests.push(request);
    assert.equal(parsedUrl.origin, 'https://api.cloudflare.com', 'R2 requests use only the official Cloudflare API origin.');
    assert.ok(parsedUrl.pathname.startsWith(`/client/v4/accounts/${ACCOUNT_ID}/r2/buckets/${BUCKET_NAME}/objects/`));
    assert.equal(init.redirect, 'error', 'R2 requests reject redirects.');
    assert.ok(init.signal instanceof AbortSignal, 'Each R2 request has a timeout signal.');
    assert.equal(init.headers.authorization, `Bearer ${TOKEN}`);
    const override = await beforeRequest?.(request);
    if (override) return override;
    if (init.method === 'GET') {
      const bytes = objects.get(key);
      return bytes ? new Response(Buffer.from(bytes), { status: 200 }) : new Response(null, { status: 404 });
    }
    assert.equal(init.method, 'PUT');
    assert.equal(init.headers['content-type'], 'application/octet-stream');
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
    token: TOKEN,
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
assert.equal(fake.requests.filter(request => request.method === 'PUT').length, 2,
  'Preflight writes one probe and one initial manifest before cases.');
assert.ok(fake.requests.some(request => request.key.includes('/preflight/')));
assert.equal(fake.requests.some(request => request.url.hostname !== 'api.cloudflare.com'), false);

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
await assert.rejects(exporter.exportReceipt({ id: 'case-fail', status: 'VERIFIED' }), /R2_PUT_REJECTED_503/);
assert.deepEqual(fake.objects.get(sink.manifestKey), beforeFailureManifest,
  'A failed case upload does not publish or replace the previous manifest.');
assert.equal(JSON.parse(beforeFailureManifest.toString()).cases['case-fail'].exportStatus, 'UNOBSERVED');
const finalManifest = await exporter.finish();
assert.equal(finalManifest.status, 'INCOMPLETE');
assert.equal(finalManifest.cases['case-metadata'].payloadAvailability, 'METADATA_ONLY');
assert.equal(finalManifest.cases['case-fail'].exportStatus, 'UNOBSERVED');

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
  error.message.includes('403') && !error.message.includes(TOKEN));
assert.equal(denied.requests.filter(request => request.method === 'PUT').length, 0);

const redirects = makeR2({ beforeRequest: () => new Response('do not log this', { status: 302, headers: { location: 'https://evil.invalid/' } }) });
await assert.rejects(createSink(redirects, { runId: 'redirect-run' }).preflight({ runId: 'redirect-run', plannedCaseIds: ['a'] }), /R2_REDIRECT_REJECTED/);

const mismatch = makeR2({
  beforeRequest: request => request.method === 'GET' && request.key.endsWith('/receipts/a.json.gz') && request.objects.has(request.key)
    ? new Response(Buffer.from('wrong bytes'), { status: 200 }) : undefined
});
const mismatchSink = createSink(mismatch, { runId: 'mismatch-run' });
await mismatchSink.preflight({ runId: 'mismatch-run', plannedCaseIds: ['a'] });
await assert.rejects(mismatchSink.putArtifact('receipts/a.json.gz', Buffer.from('receipt'), { immutable: true }), /R2_READBACK_MISMATCH/);

const missingReadback = makeR2({
  beforeRequest: request => request.method === 'GET' && request.key.endsWith('/receipts/a.json.gz')
    ? new Response(null, { status: 404 }) : undefined
});
const missingSink = createSink(missingReadback, { runId: 'missing-run' });
await missingSink.preflight({ runId: 'missing-run', plannedCaseIds: ['a'] });
await assert.rejects(missingSink.putArtifact('receipts/a.json.gz', Buffer.from('receipt'), { immutable: true }), /R2_READBACK_MISSING/);

const timeoutFake = makeR2({ beforeRequest: request => new Promise((_resolve, reject) => {
  request.init.signal.addEventListener('abort', () => reject(new Error('synthetic timeout')), { once: true });
}) });
const timeoutSink = createSink(timeoutFake, { runId: 'timeout-run', timeoutMs: 100 });
const timeoutKeepAlive = setTimeout(() => {}, 250);
await assert.rejects(timeoutSink.preflight({ runId: 'timeout-run', plannedCaseIds: ['a'] }), /R2_GET_REQUEST_FAILED/);
clearTimeout(timeoutKeepAlive);

let failManifestReadbackOnce = true;
let mismatchNextManifestReadback = false;
const rollbackFake = makeR2({ beforeRequest: request => {
  if (request.method === 'PUT' && request.key.endsWith('/manifest.json') && request.objects.has(request.key) && failManifestReadbackOnce) {
    failManifestReadbackOnce = false;
    mismatchNextManifestReadback = true;
  } else if (request.method === 'GET' && request.key.endsWith('/manifest.json') && mismatchNextManifestReadback) {
    mismatchNextManifestReadback = false;
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
await assert.rejects(rollbackExporter.exportReceipt({ id: 'case-one', status: 'VERIFIED' }), /R2_MANIFEST_READBACK_MISMATCH/);
assert.deepEqual(rollbackFake.objects.get(rollbackSink.manifestKey), priorRemoteManifest,
  'An unverifiable manifest replacement restores and verifies the prior manifest.');
assert.equal(JSON.parse(priorRemoteManifest.toString()).cases['case-one'].exportStatus, 'UNOBSERVED');
const localRollbackManifest = JSON.parse(await readFile(path.join(rollbackExporter.runDirectory, 'manifest.json'), 'utf8'));
assert.equal(localRollbackManifest.cases['case-one'].exportStatus, 'UNOBSERVED', 'A failed remote publish cannot promote the local case.');

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
await assert.rejects(transportRollbackExporter.exportReceipt({ id: 'case-one', status: 'VERIFIED' }), /R2_PUT_REQUEST_FAILED/);
assert.deepEqual(transportRollbackFake.objects.get(transportRollbackSink.manifestKey), priorTransportManifest,
  'A transport error after an accepted manifest PUT restores the earlier current manifest.');
const priorHistoryKey = `${transportRollbackSink.prefix}/manifest-history/${hash(priorTransportManifest)}.json`;
assert.deepEqual(transportRollbackFake.objects.get(priorHistoryKey), priorTransportManifest,
  'The previous manifest remains recoverable in immutable history.');
const localTransportManifest = JSON.parse(await readFile(path.join(transportRollbackExporter.runDirectory, 'manifest.json'), 'utf8'));
assert.equal(localTransportManifest.cases['case-one'].exportStatus, 'UNOBSERVED');

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
