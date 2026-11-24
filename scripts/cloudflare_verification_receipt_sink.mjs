import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { open, mkdir, realpath, lstat, rm } from 'node:fs/promises';
import path from 'node:path';
import { readVerificationReceiptExport } from './verification_receipt_exporter.mjs';

const ACCOUNT_ID = /^[a-f0-9]{32}$/i;
const BUCKET_NAME = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;
const SAFE_PATH_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_ARTIFACT_BYTES = 64 * 1024 * 1024;
const EMPTY_SHA256 = sha256(Buffer.alloc(0));

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function safeRunId(value) {
  if (typeof value !== 'string' || !SAFE_PATH_SEGMENT.test(value) || value === '.' || value === '..') {
    throw new Error('Invalid verification run ID.');
  }
  return value;
}

function safeRelativePath(value) {
  if (typeof value !== 'string' || value.includes('\\') || value.startsWith('/')) throw new Error('Invalid remote artifact path.');
  const segments = value.split('/');
  if (!segments.every(segment => SAFE_PATH_SEGMENT.test(segment) && segment !== '.' && segment !== '..')) {
    throw new Error('Invalid remote artifact path.');
  }
  return segments.join('/');
}

function encodeObjectKey(key) {
  return key.split('/').map(segment => encodeURIComponent(segment)).join('/');
}

async function readBoundedBody(response, maximumBytes) {
  const declaredLength = Number(response.headers?.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    await response.body?.cancel().catch(() => {});
    throw new Error('R2 object exceeded the configured readback limit.');
  }
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      totalBytes += chunk.length;
      if (totalBytes > maximumBytes) {
        await reader.cancel().catch(() => {});
        throw new Error('R2 object exceeded the configured readback limit.');
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, totalBytes);
}

export function createCloudflareVerificationReceiptSink({
  accountId,
  bucketName,
  runId,
  accessKeyId = process.env.ACCOUNTING_RECEIPT_STORE_ACCESS_KEY_ID,
  secretAccessKey = process.env.ACCOUNTING_RECEIPT_STORE_SECRET_ACCESS_KEY,
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxArtifactBytes = DEFAULT_MAX_ARTIFACT_BYTES
}) {
  if (typeof accountId !== 'string' || !ACCOUNT_ID.test(accountId)) throw new Error('Invalid Cloudflare account ID.');
  if (typeof bucketName !== 'string' || !BUCKET_NAME.test(bucketName)) throw new Error('Invalid Cloudflare R2 bucket name.');
  const normalizedRunId = safeRunId(runId);
  if (typeof accessKeyId !== 'string' || accessKeyId.trim().length === 0 ||
      typeof secretAccessKey !== 'string' || secretAccessKey.trim().length === 0) {
    throw new Error('ACCOUNTING_RECEIPT_STORE_ACCESS_KEY_ID and ACCOUNTING_RECEIPT_STORE_SECRET_ACCESS_KEY are required for the R2 sink.');
  }
  if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required for the R2 sink.');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 120_000) throw new Error('R2 request timeout must be between 100 and 120000 milliseconds.');
  if (!Number.isSafeInteger(maxArtifactBytes) || maxArtifactBytes < 1024 || maxArtifactBytes > 256 * 1024 * 1024) {
    throw new Error('R2 artifact readback bound is invalid.');
  }

  const prefix = `verification-runs/${normalizedRunId}`;
  const manifestKey = `${prefix}/manifest.json`;
  const writerLockKey = `${prefix}/writer-lock.json`;
  const verifiedArtifacts = new Map();
  let preflight = undefined;
  let preflightAttempted = false;
  let manifestSnapshot;
  let publishingManifest = false;
  let terminalWriteState;

  function objectUrl(key) {
    const safeKey = safeRelativePath(key);
    return `https://${accountId}.r2.cloudflarestorage.com/${bucketName}/${encodeObjectKey(safeKey)}`;
  }

  function signRequest(method, key, bytes, extraHeaders = {}) {
    const url = new URL(objectUrl(key));
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const date = amzDate.slice(0, 8);
    const payloadHash = sha256(bytes || Buffer.alloc(0));
    const headers = {
      host: url.host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
      ...extraHeaders
    };
    const canonicalHeaders = Object.keys(headers).sort().map(name => `${name}:${String(headers[name]).trim()}\n`).join('');
    const signedHeaders = Object.keys(headers).sort().join(';');
    const canonicalRequest = [method, url.pathname, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
    const scope = `${date}/auto/s3/aws4_request`;
    const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(Buffer.from(canonicalRequest))].join('\n');
    const hmac = (keyBytes, value) => createHmac('sha256', keyBytes).update(value).digest();
    const dateKey = hmac(Buffer.from(`AWS4${secretAccessKey}`, 'utf8'), date);
    const regionKey = hmac(dateKey, 'auto');
    const serviceKey = hmac(regionKey, 's3');
    const signingKey = hmac(serviceKey, 'aws4_request');
    const signature = hmac(signingKey, stringToSign).toString('hex');
    return {
      ...headers,
      authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
    };
  }

  async function send(method, key, bytes, extraHeaders = {}) {
    const url = objectUrl(key);
    let response;
    try {
      response = await fetchImpl(url, {
        method,
        headers: signRequest(method, key, bytes, {
          ...(method === 'PUT' ? { 'content-type': 'application/octet-stream' } : {}),
          ...extraHeaders
        }),
        ...(bytes ? { body: bytes } : {}),
        redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs)
      });
    } catch {
      throw new Error(`R2_${method}_REQUEST_FAILED`);
    }
    if (response.redirected || (response.status >= 300 && response.status < 400)) {
      await response.body?.cancel().catch(() => {});
      throw new Error('R2_REDIRECT_REJECTED');
    }
    return response;
  }

  async function getObjectSnapshot(key) {
    const response = await send('GET', key);
    if (response.status === 404) {
      await response.body?.cancel().catch(() => {});
      return undefined;
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      throw new Error(`R2_GET_REJECTED_${response.status}`);
    }
    return { bytes: await readBoundedBody(response, maxArtifactBytes), etag: response.headers?.get('etag') || undefined };
  }

  async function getObject(key) {
    return (await getObjectSnapshot(key))?.bytes;
  }

  async function putObject(key, bytes, extraHeaders = {}) {
    if (!Buffer.isBuffer(bytes) || bytes.length > maxArtifactBytes) throw new Error('R2 artifact exceeds the configured upload limit.');
    const response = await send('PUT', key, bytes, extraHeaders);
    await response.body?.cancel().catch(() => {});
    if (!response.ok) throw new Error(`R2_PUT_REJECTED_${response.status}`);
  }

  async function putImmutable(key, bytes) {
    const expectedHash = sha256(bytes);
    const existing = await getObject(key);
    if (existing) {
      if (existing.length !== bytes.length || sha256(existing) !== expectedHash) {
        terminalWriteState = terminalWriteState || 'REMOTE_UNCERTAIN';
        const conflict = new Error('R2_IMMUTABLE_OBJECT_CONFLICT');
        conflict.reconciliation = terminalWriteState;
        throw conflict;
      }
    } else {
      try {
        await putObject(key, bytes, { 'if-none-match': '*' });
      } catch (error) {
        let observed;
        try {
          observed = await getObject(key);
        } catch {
          observed = undefined;
        }
        if (observed && observed.length === bytes.length && sha256(observed) === expectedHash) {
          // A competing create-once PUT may have committed identical bytes.
        } else {
          terminalWriteState = terminalWriteState || 'REMOTE_UNCERTAIN';
          const uncertain = new Error('R2_IMMUTABLE_OBJECT_REMOTE_UNCERTAIN');
          uncertain.reconciliation = terminalWriteState;
          uncertain.cause = error;
          throw uncertain;
        }
      }
    }
    const readback = await getObject(key);
    if (!readback || readback.length !== bytes.length || sha256(readback) !== expectedHash) {
      terminalWriteState = terminalWriteState || 'REMOTE_UNCERTAIN';
      const uncertain = new Error(readback ? 'R2_READBACK_MISMATCH_REMOTE_UNCERTAIN' : 'R2_READBACK_MISSING_REMOTE_UNCERTAIN');
      uncertain.reconciliation = terminalWriteState;
      throw uncertain;
    }
    const result = { key, sha256: expectedHash, byteLength: bytes.length, verified: true };
    verifiedArtifacts.set(key, result);
    return result;
  }

  return {
    type: 'CLOUDFLARE_R2',
    accountId,
    bucketName,
    runId: normalizedRunId,
    prefix,
    manifestKey,
    async preflight({ runId: requestedRunId, plannedCaseIds }) {
      if (preflightAttempted) throw new Error('R2_PREFLIGHT_ALREADY_ATTEMPTED');
      if (requestedRunId !== normalizedRunId || !Array.isArray(plannedCaseIds) || plannedCaseIds.length === 0) {
        throw new Error('R2_PREFLIGHT_SCOPE_MISMATCH');
      }
      const uniquePlannedIds = new Set(plannedCaseIds);
      if (plannedCaseIds.some(id => typeof id !== 'string' || !SAFE_PATH_SEGMENT.test(id)) || uniquePlannedIds.size !== plannedCaseIds.length) {
        throw new Error('R2_PREFLIGHT_PLAN_INVALID');
      }
      preflightAttempted = true;
      const existingManifest = await getObject(manifestKey);
      if (existingManifest) throw new Error('R2_RUN_PREFIX_ALREADY_PUBLISHED');
      const lockBytes = Buffer.from(JSON.stringify({ runId: normalizedRunId, createdAtUTC: new Date().toISOString() }), 'utf8');
      const lockResponse = await send('PUT', writerLockKey, lockBytes, { 'if-none-match': '*' });
      await lockResponse.body?.cancel().catch(() => {});
      if (lockResponse.status === 412 || lockResponse.status === 409) throw new Error('R2_RUN_WRITER_ALREADY_CLAIMED');
      if (!lockResponse.ok) throw new Error(`R2_WRITER_LOCK_REJECTED_${lockResponse.status}`);
      const lockReadback = await getObject(writerLockKey);
      if (!lockReadback || !lockReadback.equals(lockBytes)) throw new Error('R2_WRITER_LOCK_READBACK_MISMATCH');
      const probeKey = `${prefix}/preflight/${randomUUID()}.bin`;
      const probeBytes = randomBytes(32);
      const probe = await putImmutable(probeKey, probeBytes);
      preflight = {
        type: 'CLOUDFLARE_R2', accountId, bucketName, prefix, manifestKey, writerLockKey,
        verified: true,
        preflightProbe: { key: probe.key, sha256: probe.sha256, byteLength: probe.byteLength, verified: true },
        completedAtUTC: new Date().toISOString()
      };
      return structuredClone(preflight);
    },
    async putArtifact(relativePath, bytes, { immutable = true } = {}) {
      if (!preflight) throw new Error('R2_PREFLIGHT_REQUIRED');
      if (terminalWriteState) {
        const fenced = new Error(`R2_RUN_WRITE_FENCED_${terminalWriteState}`);
        fenced.reconciliation = terminalWriteState;
        throw fenced;
      }
      if (immutable !== true) throw new Error('R2_CASE_ARTIFACTS_MUST_BE_IMMUTABLE');
      const safePath = safeRelativePath(relativePath);
      if (safePath.startsWith('preflight/') || safePath === 'manifest.json' || safePath === 'writer-lock.json' || safePath.startsWith('manifest-history/')) {
        throw new Error('R2_RESERVED_OBJECT_PATH');
      }
      return putImmutable(`${prefix}/${safePath}`, bytes);
    },
    async publishManifest(bytes, { requiredArtifacts = [] } = {}) {
      if (!preflight) throw new Error('R2_PREFLIGHT_REQUIRED');
      if (terminalWriteState) {
        const fenced = new Error(`R2_RUN_WRITE_FENCED_${terminalWriteState}`);
        fenced.reconciliation = terminalWriteState;
        throw fenced;
      }
      if (publishingManifest) throw new Error('R2_CONCURRENT_MANIFEST_PUBLICATION_REJECTED');
      publishingManifest = true;
      try {
      if (!Buffer.isBuffer(bytes)) throw new Error('R2_MANIFEST_MUST_BE_BYTES');
      for (const artifact of requiredArtifacts) {
        const verified = verifiedArtifacts.get(artifact.key);
        if (!verified || artifact.verified !== true || artifact.sha256 !== verified.sha256 || artifact.byteLength !== verified.byteLength) {
          throw new Error('R2_MANIFEST_REFERENCES_UNVERIFIED_ARTIFACT');
        }
      }

      const previous = await getObjectSnapshot(manifestKey);
      let previousManifestKey;
      let condition;
      if (previous) {
        const previousHash = sha256(previous.bytes);
        if (!manifestSnapshot) throw new Error('R2_RUN_PREFIX_ALREADY_PUBLISHED');
        if (previousHash !== manifestSnapshot.sha256 || previous.bytes.length !== manifestSnapshot.byteLength) {
          terminalWriteState = 'REMOTE_UNCERTAIN';
          const conflict = new Error('R2_MANIFEST_REMOTE_UNCERTAIN');
          conflict.reconciliation = terminalWriteState;
          conflict.observedHash = previousHash;
          throw conflict;
        }
        if (!previous.etag) {
          terminalWriteState = 'REMOTE_UNCERTAIN';
          const missingEtag = new Error('R2_MANIFEST_ETAG_REQUIRED');
          missingEtag.reconciliation = terminalWriteState;
          throw missingEtag;
        }
        condition = { 'if-match': previous.etag };
        previousManifestKey = `${prefix}/manifest-history/${previousHash}.json`;
        await putImmutable(previousManifestKey, previous.bytes);
      } else if (manifestSnapshot) {
        terminalWriteState = 'REMOTE_UNCERTAIN';
        const missing = new Error('R2_MANIFEST_REMOTE_UNCERTAIN');
        missing.reconciliation = terminalWriteState;
        throw missing;
      } else {
        condition = { 'if-none-match': '*' };
      }
      const expectedHash = sha256(bytes);
      const expectedLength = bytes.length;
      let publicationError;
      try {
        await putObject(manifestKey, bytes, condition);
      } catch (error) {
        publicationError = error;
      }
      let observed;
      let reconciliationReadError;
      try {
        observed = await getObjectSnapshot(manifestKey);
      } catch (error) {
        reconciliationReadError = error;
      }
      const matchesProposal = snapshot => snapshot?.bytes.length === expectedLength && sha256(snapshot.bytes) === expectedHash;
      if (!matchesProposal(observed)) {
        // A second read is read-only reconciliation after a failed/mismatched
        // verification read. It does not retry the possibly in-flight PUT.
        try {
          observed = await getObjectSnapshot(manifestKey);
        } catch (error) {
          reconciliationReadError = error;
        }
      }
      const observedHash = observed ? sha256(observed.bytes) : undefined;
      if (!matchesProposal(observed)) {
        const previousHash = previous ? sha256(previous.bytes) : undefined;
        terminalWriteState = observed && previous && observedHash === previousHash && observed.bytes.length === previous.bytes.length
          ? 'REMOTE_PREVIOUS'
          : 'REMOTE_UNCERTAIN';
        const uncertain = new Error(`R2_MANIFEST_${terminalWriteState}`);
        uncertain.reconciliation = terminalWriteState;
        uncertain.proposedHash = expectedHash;
        uncertain.observedHash = observedHash;
        uncertain.cause = publicationError || reconciliationReadError;
        throw uncertain;
      }
      manifestSnapshot = { sha256: expectedHash, byteLength: expectedLength, etag: observed.etag };
      if (!observed.etag) {
        terminalWriteState = 'REMOTE_UNCERTAIN';
        const missingEtag = new Error('R2_MANIFEST_ETAG_REQUIRED');
        missingEtag.reconciliation = 'REMOTE_VERIFIED';
        missingEtag.terminal = true;
        missingEtag.proposedHash = expectedHash;
        throw missingEtag;
      }
      return {
        key: manifestKey, sha256: expectedHash, byteLength: expectedLength, verified: true, previousManifestKey,
        reconciliation: 'REMOTE_VERIFIED'
      };
      } finally {
        publishingManifest = false;
      }
    },
    async getArtifact(key) {
      const safeKey = safeRelativePath(key);
      if (!safeKey.startsWith(`${prefix}/`)) throw new Error('R2_OBJECT_OUTSIDE_RUN_PREFIX');
      const bytes = await getObject(safeKey);
      if (!bytes) throw new Error('R2_OBJECT_NOT_FOUND');
      return bytes;
    }
  };
}

async function writeLocalArtifact(filePath, bytes) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const handle = await open(filePath, 'wx', 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function downloadCloudflareVerificationReceiptRun({ sink, outputDirectory }) {
  if (!sink || typeof sink.getArtifact !== 'function' || typeof sink.manifestKey !== 'string' || typeof sink.prefix !== 'string') {
    throw new Error('A preflighted Cloudflare receipt sink is required.');
  }
  if (typeof outputDirectory !== 'string' || !path.isAbsolute(outputDirectory) || outputDirectory.startsWith('\\\\') || outputDirectory.startsWith('//')) {
    throw new Error('outputDirectory must be an explicit absolute local path.');
  }
  const manifestBytes = await sink.getArtifact(sink.manifestKey);
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  const runId = safeRunId(manifest.runId);
  if (manifest.durableSink?.prefix !== sink.prefix || manifest.durableSink?.manifestKey !== sink.manifestKey ||
      sink.prefix !== `verification-runs/${runId}`) throw new Error('Remote manifest identity does not match its R2 run prefix.');

  const root = path.resolve(outputDirectory);
  await mkdir(root, { recursive: true });
  if (path.normalize(await realpath(root)) !== path.normalize(root)) throw new Error('outputDirectory must not resolve through a symbolic link.');
  const localRunDirectory = path.join(root, runId);
  await mkdir(localRunDirectory);
  const rootInfo = await lstat(localRunDirectory);
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) throw new Error('Local export directory must be new.');
  try {
    const entries = Object.entries(manifest.remoteArtifacts || {});
    for (const [relativePath, artifact] of entries) {
      const safePath = safeRelativePath(relativePath);
      if (safePath.startsWith('preflight/') || safePath === 'manifest.json' || safePath.startsWith('manifest-history/')) {
        throw new Error('Remote manifest includes an invalid receipt artifact path.');
      }
      if (artifact.path !== safePath || artifact.key !== `${sink.prefix}/${safePath}` || artifact.verified !== true ||
          !/^[a-f0-9]{64}$/.test(artifact.sha256 || '') || !Number.isSafeInteger(artifact.byteLength)) {
        throw new Error('Remote manifest artifact metadata is invalid.');
      }
      const bytes = await sink.getArtifact(artifact.key);
      if (bytes.length !== artifact.byteLength || sha256(bytes) !== artifact.sha256) throw new Error('Remote artifact readback hash mismatch.');
      await writeLocalArtifact(path.join(localRunDirectory, ...safePath.split('/')), bytes);
    }
    await writeLocalArtifact(path.join(localRunDirectory, 'manifest.json'), manifestBytes);
    const recovered = await readVerificationReceiptExport(localRunDirectory);
    return { runDirectory: localRunDirectory, manifest: recovered.manifest, receipts: recovered.receipts };
  } catch (error) {
    await rm(localRunDirectory, { recursive: true, force: true });
    throw error;
  }
}
