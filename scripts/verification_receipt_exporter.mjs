import { createHash, randomUUID } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { access, lstat, mkdir, open, readFile, readdir, realpath, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { gzip, gunzip } from 'node:zlib';
import { promisify } from 'node:util';

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const BODY_FIELDS = new Set(['rawResponseBodyText', 'bodyText', 'bodyBase64']);
const CASE_LINE_LIMIT = 2_048;
const RUN_LINE_LIMIT = 32_768;
const DEFAULT_MAX_RECEIPT_BYTES = 16 * 1024 * 1024;
const DEFAULT_MAX_DIAGNOSTIC_BYTES = 16 * 1024 * 1024;
const DEFAULT_MAX_CAPTURED_BODY_BYTES = 64 * 1024 * 1024;

export const VERIFICATION_RECEIPT_EXPORT_SCHEMA = 'accounting-verification-receipt-export/v1';

function assertSafeId(value, label) {
  if (typeof value !== 'string' || !SAFE_ID.test(value) || value === '.' || value === '..') {
    throw new Error(`${label} must contain only letters, numbers, dots, underscores, and hyphens.`);
  }
  return value;
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function asObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function bodyMetadataFor(item, key, value) {
  const bytes = key === 'bodyBase64' ? Buffer.from(value, 'base64') : Buffer.from(value, 'utf8');
  if (key === 'bodyBase64' && bytes.toString('base64') !== value) {
    throw new Error('Captured bodyBase64 must use canonical base64 encoding.');
  }
  const declaredHash = typeof item.responseBodySha256 === 'string' ? item.responseBodySha256 : undefined;
  const declaredScope = typeof item.responseBodyHashScope === 'string' ? item.responseBodyHashScope : 'UNOBSERVED';
  const capturedHash = sha256(bytes);
  const declaredCapturedBytes = Number.isSafeInteger(item.capturedBodyBytes)
    ? item.capturedBodyBytes
    : Number.isSafeInteger(item.responseBodyBytesCaptured)
      ? item.responseBodyBytesCaptured
      : undefined;
  const truncated = item.bodyTruncated === true || item.responseBodyTruncated === true ||
    item.captureStatus === 'TRUNCATED_LIMIT' || item.captureStatus === 'INCOMPLETE_TIMEOUT' ||
    item.captureStatus === 'FAILED' || declaredScope === 'captured_prefix' || declaredScope === 'read_prefix' ||
    (declaredCapturedBytes !== undefined && declaredCapturedBytes !== bytes.length) ||
    (Number.isSafeInteger(item.responseBodyBytes) && item.responseBodyBytes !== bytes.length) ||
    (Number.isSafeInteger(item.responseBodyBytesRead) && item.responseBodyBytesRead !== bytes.length);
  const scopeObserved = ['complete_response', 'captured_prefix', 'read_prefix'].includes(declaredScope);
  return { bytes, capturedHash, declaredHash, declaredScope, declaredCapturedBytes, truncated, scopeObserved };
}

async function durableWriteNew(filePath, bytes) {
  await mkdir(path.dirname(filePath), { recursive: true });
  try {
    await access(filePath, fsConstants.F_OK);
    const existing = await readFile(filePath);
    if (sha256(existing) === sha256(bytes)) return false;
    throw new Error('An artifact path already exists with different contents.');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  const tempPath = `${filePath}.${randomUUID()}.tmp`;
  try {
    const handle = await open(tempPath, 'wx', 0o600);
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(tempPath, filePath);
    return true;
  } finally {
    await rm(tempPath, { force: true }).catch(() => {});
  }
}

async function atomicReplace(filePath, bytes) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${randomUUID()}.tmp`;
  try {
    const handle = await open(tempPath, 'wx', 0o600);
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(tempPath, filePath);
  } finally {
    await rm(tempPath, { force: true }).catch(() => {});
  }
}

function safeStatus(value) {
  if (typeof value !== 'string' || value.length > 80 || !/^[A-Za-z0-9_:-]+$/.test(value)) return 'STATUS_OMITTED';
  return value;
}

function addSummaryLine(writer, runState, caseId, summary) {
  const line = `${JSON.stringify(summary)}\n`;
  const bytes = Buffer.byteLength(line, 'utf8');
  if (bytes > CASE_LINE_LIMIT) return { logStatus: 'SUMMARY_SUPPRESSED_CASE_BUDGET' };
  if (runState.stdoutBytes + bytes > RUN_LINE_LIMIT) return { logStatus: 'SUMMARY_SUPPRESSED_RUN_BUDGET' };
  if (runState.writerFailed) return { logStatus: 'SUMMARY_SUPPRESSED_WRITER_FAILED' };
  try {
    const accepted = writer(line);
    runState.stdoutBytes += bytes;
    if (caseId) runState.caseLineBytes.set(caseId, bytes);
    return { logStatus: accepted === false ? 'SUMMARY_WRITER_BACKPRESSURE' : 'SUMMARY_WRITTEN' };
  } catch {
    runState.writerFailed = true;
    return { logStatus: 'SUMMARY_WRITER_FAILED' };
  }
}

function projectObserved(value, depth = 0) {
  if (depth > 8) return 'DEPTH_LIMIT_UNOBSERVED';
  if (value === null || value === undefined) return value === undefined ? 'UNOBSERVED' : value;
  if (Array.isArray(value)) return value.map(item => projectObserved(item, depth + 1));
  if (!asObject(value)) return value;
  const result = {};
  for (const [key, child] of Object.entries(value)) {
    if (/^quote$/i.test(key) && typeof child === 'string') {
      const bytes = Buffer.from(child, 'utf8');
      result.quoteMetadata = {
        sha256: sha256(bytes),
        byteLength: bytes.length,
        characterLength: child.length,
        redacted: true
      };
      continue;
    }
    if (/(?:hash|digest)$/i.test(key) || /^responseBodySha256$/i.test(key)) {
      result[key] = projectObserved(child, depth + 1);
      continue;
    }
    if (/^(rawResponseBodyText|bodyText|bodyBase64|sourceText|messageText|query|rawQuery|quotationText|prompt)$/i.test(key)) continue;
    if (/text|question|answer|excerpt|content|document|html|body/i.test(key) && typeof child === 'string') continue;
    result[key] = projectObserved(child, depth + 1);
  }
  return result;
}

function diagnosticArtifact(receipt, bodyPayloads) {
  const observed = receipt.observedAuthorityWorkstreams;
  const workstreams = asObject(observed) ? observed.workstreams : undefined;
  const presentations = asObject(receipt.finalPresentation) ? receipt.finalPresentation.workstreams : undefined;
  const planIssues = Array.isArray(observed?.issuePlan?.issues) ? observed.issuePlan.issues : [];
  const workstreamIssues = Array.isArray(workstreams) ? workstreams.flatMap(workstream => workstream.issues || []) : [];
  const issueLevelDiagnostics = workstreamIssues.filter(issue => Object.hasOwn(issue || {}, 'admissionDiagnostics'))
    .map(issue => ({ issueId: issue.id ?? 'UNOBSERVED', admissionDiagnostics: issue.admissionDiagnostics }));
  return {
    schemaVersion: 1,
    caseId: receipt.id,
    answerStatus: receipt.status ?? 'UNOBSERVED',
    providerStatus: receipt.providerStatus ?? 'UNOBSERVED',
    semanticPlanSource: receipt.semanticPlanSource ?? 'UNOBSERVED',
    declaredCaptureStatus: receipt.captureCompleteness ?? 'UNOBSERVED',
    captureWindow: projectObserved(receipt.captureWindow ?? 'UNOBSERVED'),
    payloadAvailability: payloadAvailabilityFor(receipt, bodyPayloads),
    bodyPayloads,
    issuePlan: projectObserved(observed?.issuePlan ?? 'UNOBSERVED'),
    issues: projectObserved(workstreamIssues.length > 0 ? workstreamIssues : 'UNOBSERVED'),
    presentationIssues: projectObserved(Array.isArray(presentations) ? presentations.flatMap(workstream => workstream.issues || []) : 'UNOBSERVED'),
    conceptOwnership: projectObserved(planIssues.length > 0 ? planIssues.map(issue => ({
      issueId: issue.id ?? 'UNOBSERVED', authority: issue.authority ?? issue.governingAuthorities ?? issue.governingAuthority ?? 'UNOBSERVED',
      domain: issue.domain ?? 'UNOBSERVED', population: issue.population ?? 'UNOBSERVED',
      operation: issue.operation ?? 'UNOBSERVED', concepts: issue.concepts ?? issue.requestedConcepts ?? 'UNOBSERVED'
    })) : 'UNOBSERVED'),
    admissionDiagnostics: projectObserved(
      observed?.admissionDiagnostics ?? observed?.issuePlan?.admissionDiagnostics ??
        (issueLevelDiagnostics.length > 0 ? issueLevelDiagnostics : 'UNOBSERVED')
    ),
    requestCompletenessContext: projectObserved(receipt.requestCompletenessContext ?? observed?.requestCompletenessContext ?? 'UNOBSERVED'),
    groundedContext: projectObserved(receipt.groundedContext ?? 'UNOBSERVED'),
    evidenceQuality: projectObserved(receipt.evidenceQuality ?? 'UNOBSERVED'),
    sourceMapFallbackTrace: projectObserved(receipt.sourceMapFallbackTrace ?? 'UNOBSERVED'),
    directGroups: projectObserved(receipt.directGroups ?? 'UNOBSERVED'),
    observedStatus: projectObserved({
      workstreamStatus: observed?.status,
      evidenceStatus: observed?.evidenceStatus,
      applicationStatus: observed?.applicationStatus,
      presentationStatus: receipt.finalPresentation?.status,
      requestCompletenessEvaluation: receipt.requestCompletenessEvaluation?.status
    }),
    gaps: projectObserved(observed?.gaps ?? receipt.finalPresentation?.gaps ?? 'UNOBSERVED')
  };
}

function metadataOnlyPayloads(receipt, references) {
  const rows = [];
  for (const [arrayName, items] of [['modelResponses', receipt.modelResponses], ['sourceResponses', receipt.sourceResponses]]) {
    if (!Array.isArray(items)) continue;
    items.forEach((item, index) => {
      const pointer = `/${arrayName}/${index}`;
      const hasPayloadReference = references.some(reference => reference.pointer.startsWith(`${pointer}/`));
      if (hasPayloadReference) return;
      const hasCaptureMetadata = typeof item?.responseBodySha256 === 'string' ||
        typeof item?.responseBodyHashScope === 'string' || typeof item?.captureStatus === 'string' ||
        Number.isSafeInteger(item?.responseBodyBytes) || Number.isSafeInteger(item?.responseBodyBytesRead);
      if (!hasCaptureMetadata) return;
      rows.push({ pointer, payloadStatus: 'METADATA_ONLY', declaredResponseBodySha256: item.responseBodySha256 ?? 'UNOBSERVED',
        declaredHashScope: item.responseBodyHashScope ?? 'UNOBSERVED', captureStatus: item.captureStatus ?? 'UNOBSERVED',
        declaredCaptureBytes: item.capturedBodyBytes ?? item.responseBodyBytesCaptured ?? 'UNOBSERVED', bodyBytesPresent: false });
    });
  }
  return [...references, ...rows];
}

function payloadAvailabilityFor(receipt, bodyPayloads) {
  if (bodyPayloads.length === 0) return 'NO_BODY_CAPTURE_METADATA';
  if (bodyPayloads.some(item => item.payloadStatus === 'METADATA_ONLY')) return 'METADATA_ONLY';
  const declaredFullHashMismatch = bodyPayloads.some(item =>
    item.declaredResponseBodySha256 && item.declaredResponseBodySha256 !== 'UNOBSERVED' &&
    item.declaredHashScope === 'complete_response' && item.declaredResponseBodySha256 !== item.sha256);
  if (declaredFullHashMismatch) return 'PRESENT_PREFIX_OR_DECLARED_HASH_MISMATCH';
  if (bodyPayloads.some(item => item.payloadStatus === 'PRESENT_TRUNCATED_OR_PREFIX')) return 'PRESENT_TRUNCATED_OR_PREFIX';
  if (bodyPayloads.some(item => item.payloadStatus === 'PRESENT_SCOPE_UNOBSERVED')) return 'PRESENT_SCOPE_UNOBSERVED';
  return 'PRESENT_NO_TRUNCATION_RECORDED';
}

async function assertNoSymlinkComponents(root, target) {
  const relative = path.relative(root, target);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('Artifact path escapes the export directory.');
  }
  let current = root;
  for (const part of relative.split(path.sep)) {
    current = path.join(current, part);
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink()) throw new Error('Symbolic links are not allowed in export artifacts.');
    } catch (error) {
      if (error?.code === 'ENOENT') return;
      throw error;
    }
  }
}

async function inflateArtifact(bytes, kind, maximumOutputBytes) {
  try {
    return await gunzipAsync(bytes, { maxOutputLength: maximumOutputBytes });
  } catch (error) {
    if (error?.code === 'ERR_BUFFER_TOO_LARGE') {
      throw new Error(`${kind} artifact exceeds the configured decompressed size limit.`);
    }
    throw new Error(`${kind} artifact is not valid gzip data.`);
  }
}

function normalizeReceipt(receipt, bodyEntries, references) {
  const copy = structuredClone(receipt);
  const visit = (value, pointer = '') => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, `${pointer}/${index}`));
      return;
    }
    if (!asObject(value)) return;
    for (const [key, child] of Object.entries(value)) {
      const childPointer = `${pointer}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`;
      if (BODY_FIELDS.has(key) && typeof child === 'string') {
        const metadata = bodyMetadataFor(value, key, child);
        const prior = bodyEntries.get(metadata.capturedHash);
        if (!prior) bodyEntries.set(metadata.capturedHash, metadata.bytes);
        const reference = {
          sha256: metadata.capturedHash,
          encoding: key === 'bodyBase64' ? 'base64' : 'utf8',
          byteLength: metadata.bytes.length,
          artifactPath: `bodies/${metadata.capturedHash}.gz`,
          declaredResponseBodySha256: metadata.declaredHash ?? 'UNOBSERVED',
          declaredHashScope: metadata.declaredScope,
          declaredCapturedBytes: metadata.declaredCapturedBytes ?? 'UNOBSERVED',
          payloadStatus: metadata.truncated ? 'PRESENT_TRUNCATED_OR_PREFIX' :
            metadata.scopeObserved ? 'PRESENT_NO_TRUNCATION_RECORDED' : 'PRESENT_SCOPE_UNOBSERVED'
        };
        references.push({ pointer: childPointer, ...reference });
        value[key] = { $capturedBody: reference };
      } else {
        visit(child, childPointer);
      }
    }
  };
  visit(copy);
  return copy;
}

function restoreReceipt(value, bodyReferences, bodyMap, pointer = '') {
  const reference = bodyReferences.find(item => item.pointer === pointer);
  if (reference) {
    const bytes = bodyMap.get(reference.sha256);
    if (!bytes) throw new Error('Receipt references an unavailable captured body.');
    return reference.encoding === 'base64' ? bytes.toString('base64') : bytes.toString('utf8');
  }
  if (Array.isArray(value)) return value.map((item, index) => restoreReceipt(item, bodyReferences, bodyMap, `${pointer}/${index}`));
  if (!asObject(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [
    key,
    restoreReceipt(child, bodyReferences, bodyMap, `${pointer}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`)
  ]));
}

export async function createVerificationReceiptExporter({
  outputDirectory,
  runId,
  plannedCaseIds,
  stdout = line => process.stdout.write(line),
  durableSink
}) {
  if (typeof outputDirectory !== 'string' || !path.isAbsolute(outputDirectory) || outputDirectory.startsWith('\\\\') || outputDirectory.startsWith('//')) {
    throw new Error('outputDirectory must be an explicit absolute local path.');
  }
  assertSafeId(runId, 'runId');
  if (!Array.isArray(plannedCaseIds) || plannedCaseIds.length === 0) throw new Error('plannedCaseIds must be a non-empty frozen list.');
  const plan = plannedCaseIds.map(id => assertSafeId(id, 'planned case ID'));
  if (new Set(plan).size !== plan.length) throw new Error('plannedCaseIds must be unique.');
  if (durableSink && ['preflight', 'putArtifact', 'publishManifest'].some(method => typeof durableSink[method] !== 'function')) {
    throw new Error('durableSink must implement preflight, putArtifact, and publishManifest.');
  }

  const outputRoot = path.resolve(outputDirectory);
  await mkdir(outputRoot, { recursive: true });
  const resolvedOutput = await realpath(outputRoot);
  if (path.normalize(resolvedOutput) !== path.normalize(outputRoot)) throw new Error('outputDirectory must not resolve through a symbolic link.');
  const durableSinkInfo = durableSink ? await durableSink.preflight({ runId, plannedCaseIds: [...plan] }) : undefined;
  if (durableSink && (!asObject(durableSinkInfo) || durableSinkInfo.verified !== true ||
      typeof durableSinkInfo.prefix !== 'string' || typeof durableSinkInfo.manifestKey !== 'string')) {
    throw new Error('Durable storage preflight did not verify the remote run prefix.');
  }
  const runDirectory = path.join(outputRoot, runId);
  await mkdir(runDirectory);
  const directoryInfo = await lstat(runDirectory);
  if (directoryInfo.isSymbolicLink() || !directoryInfo.isDirectory()) throw new Error('Run directory must be a new local directory.');

  const manifestPath = path.join(runDirectory, 'manifest.json');
  const manifest = {
    schemaVersion: 1,
    runId,
    createdAtUTC: new Date().toISOString(),
    updatedAtUTC: new Date().toISOString(),
    plannedCaseIds: plan,
    ...(durableSinkInfo ? { durableSink: durableSinkInfo, remoteArtifacts: {} } : {}),
    status: 'IN_PROGRESS',
    cases: Object.fromEntries(plan.map(id => [id, { exportStatus: 'UNOBSERVED', answerStatus: 'UNOBSERVED', declaredCaptureStatus: 'UNOBSERVED', payloadAvailability: 'UNOBSERVED' }]))
  };
  const state = { stdoutBytes: 0, caseLineBytes: new Map(), finished: false, remoteArtifacts: new Map() };
  state.remotePublication = undefined;
  const saveManifest = async (candidate, { publishRemote = true } = {}) => {
    candidate.updatedAtUTC = new Date().toISOString();
    const bytes = Buffer.from(`${JSON.stringify(candidate, null, 2)}\n`, 'utf8');
    if (durableSink && publishRemote) {
      const requiredArtifacts = Object.values(candidate.remoteArtifacts || {});
      let result;
      try {
        result = await durableSink.publishManifest(bytes, { requiredArtifacts });
      } catch (error) {
        const reconciliation = error?.reconciliation;
        if (reconciliation === 'REMOTE_VERIFIED') {
          // The sink read back the proposed bytes after an ambiguous write, so
          // that manifest remains authoritative even though future CAS may stop.
          Object.assign(manifest, candidate);
          state.remotePublication = { status: reconciliation, terminal: error.terminal === true };
          if (error.terminal !== true) throw error;
          await atomicReplace(manifestPath, bytes);
          const saved = await readFile(manifestPath);
          if (sha256(saved) !== sha256(bytes)) throw new Error('Manifest readback hash mismatch.');
          // The case is durably accepted, but this run cannot safely advance.
          // Preserve its local EXPORTED record and stop the caller from
          // dispatching another question.
          throw error;
        }
        if (reconciliation === 'REMOTE_PREVIOUS' || reconciliation === 'REMOTE_UNCERTAIN') {
          state.remotePublication = { status: reconciliation, terminal: true };
        }
        throw error;
      }
      if (result?.verified !== true || result.sha256 !== sha256(bytes) || result.byteLength !== bytes.length) {
        throw new Error('Remote manifest publication was not verified.');
      }
      state.remotePublication = { status: result.reconciliation || 'REMOTE_VERIFIED', terminal: result.terminal === true };
      // Once the remote manifest is verified, it is authoritative even if the local mirror fails.
      Object.assign(manifest, candidate);
    }
    await atomicReplace(manifestPath, bytes);
    const saved = await readFile(manifestPath);
    if (sha256(saved) !== sha256(bytes)) throw new Error('Manifest readback hash mismatch.');
    return bytes;
  };
  try {
    const initialManifestBytes = await saveManifest(manifest, { publishRemote: false });
    if (durableSink) {
      const result = await durableSink.publishManifest(initialManifestBytes, { requiredArtifacts: [] });
      if (result?.verified !== true || result.sha256 !== sha256(initialManifestBytes) || result.byteLength !== initialManifestBytes.length) {
        throw new Error('Remote initial manifest publication was not verified.');
      }
    }
  } catch (error) {
    if (!error?.reconciliation) await rm(runDirectory, { recursive: true, force: true });
    throw error;
  }

  return {
    runDirectory,
    async exportReceipt(receipt) {
      if (state.finished) throw new Error('The receipt export run is already finished.');
      if (state.remotePublication?.terminal) throw new Error(`R2_RUN_WRITE_FENCED_${state.remotePublication.status}`);
      if (!asObject(receipt)) throw new Error('A receipt must be a JSON object.');
      const caseId = assertSafeId(receipt.id, 'receipt case ID');
      if (!plan.includes(caseId)) throw new Error('Receipt case ID is outside the frozen run plan.');
      if (manifest.cases[caseId].exportStatus !== 'UNOBSERVED') throw new Error('This case already has an export result.');

      const bodyEntries = new Map();
      const bodyReferences = [];
      const normalizedReceipt = normalizeReceipt(receipt, bodyEntries, bodyReferences);
      const remoteArtifacts = [];
      const uploadRemoteArtifact = async (relativePath, bytes) => {
        if (!durableSink) return undefined;
        const contentHash = sha256(bytes);
        const existing = state.remoteArtifacts.get(relativePath);
        if (existing) {
          if (existing.sha256 !== contentHash || existing.byteLength !== bytes.length) throw new Error('Remote immutable artifact path conflicts with prior content.');
          return existing;
        }
        const verified = await durableSink.putArtifact(relativePath, bytes, { immutable: true });
        if (verified?.verified !== true || verified.sha256 !== contentHash || verified.byteLength !== bytes.length ||
            verified.key !== `${durableSinkInfo.prefix}/${relativePath}`) throw new Error('Remote artifact readback was not verified.');
        const artifact = { path: relativePath, key: verified.key, sha256: contentHash, byteLength: bytes.length, verified: true };
        state.remoteArtifacts.set(relativePath, artifact);
        remoteArtifacts.push(artifact);
        return artifact;
      };
      for (const [hash, bytes] of bodyEntries) {
        const compressed = await gzipAsync(bytes, { level: 9, mtime: 0 });
        const bodyRelative = `bodies/${hash}.gz`;
        const bodyPath = path.join(runDirectory, ...bodyRelative.split('/'));
        await durableWriteNew(bodyPath, compressed);
        const readback = await gunzipAsync(await readFile(bodyPath));
        if (sha256(readback) !== hash || readback.length !== bytes.length) throw new Error('Captured body integrity check failed.');
        const remoteArtifact = await uploadRemoteArtifact(bodyRelative, compressed);
        if (remoteArtifact && !remoteArtifacts.some(item => item.path === bodyRelative)) remoteArtifacts.push(remoteArtifact);
      }

      const receiptBytes = await gzipAsync(Buffer.from(`${JSON.stringify({ schemaVersion: 1, receipt: normalizedReceipt, bodyReferences }, null, 2)}\n`, 'utf8'), { level: 9, mtime: 0 });
      const allBodyPayloads = metadataOnlyPayloads(receipt, bodyReferences);
      const diagnostic = diagnosticArtifact(receipt, allBodyPayloads);
      const diagnosticBytes = await gzipAsync(Buffer.from(`${JSON.stringify(diagnostic, null, 2)}\n`, 'utf8'), { level: 9, mtime: 0 });
      const receiptRelative = `receipts/${caseId}.json.gz`;
      const diagnosticRelative = `diagnostics/${caseId}.json.gz`;
      const receiptPath = path.join(runDirectory, ...receiptRelative.split('/'));
      const diagnosticPath = path.join(runDirectory, ...diagnosticRelative.split('/'));
      await durableWriteNew(receiptPath, receiptBytes);
      if (sha256(await readFile(receiptPath)) !== sha256(receiptBytes)) throw new Error('Receipt artifact integrity check failed.');
      await durableWriteNew(diagnosticPath, diagnosticBytes);
      if (sha256(await readFile(diagnosticPath)) !== sha256(diagnosticBytes)) throw new Error('Diagnostic artifact integrity check failed.');
      const remoteReceipt = await uploadRemoteArtifact(receiptRelative, receiptBytes);
      const remoteDiagnostic = await uploadRemoteArtifact(diagnosticRelative, diagnosticBytes);
      if (remoteReceipt) remoteArtifacts.push(remoteReceipt);
      if (remoteDiagnostic) remoteArtifacts.push(remoteDiagnostic);

      const payloadAvailability = payloadAvailabilityFor(receipt, allBodyPayloads);
      const next = structuredClone(manifest);
      next.cases[caseId] = {
        exportStatus: 'EXPORTED',
        answerStatus: safeStatus(receipt.status),
        declaredCaptureStatus: receipt.captureCompleteness ?? 'UNOBSERVED',
        payloadAvailability,
        receiptArtifact: { path: receiptRelative, sha256: sha256(receiptBytes) },
        diagnosticArtifact: { path: diagnosticRelative, sha256: sha256(diagnosticBytes) },
        capturedBodyCount: new Set(bodyReferences.map(item => item.sha256)).size,
        ...(durableSink ? { remoteArtifacts } : {})
      };
      if (durableSink) {
        next.remoteArtifacts = { ...manifest.remoteArtifacts };
        for (const artifact of remoteArtifacts) next.remoteArtifacts[artifact.path] = artifact;
      }
      await saveManifest(next);
      Object.assign(manifest, next);

      const summary = {
        event: 'CASE_EXPORTED', caseId, answerStatus: safeStatus(manifest.cases[caseId].answerStatus),
        declaredCaptureStatus: manifest.cases[caseId].declaredCaptureStatus,
        payloadAvailability, exportStatus: 'EXPORTED', receiptArtifact: receiptRelative,
        receiptSha256: sha256(receiptBytes), diagnosticArtifact: diagnosticRelative,
        capturedBodyCount: new Set(bodyReferences.map(item => item.sha256)).size
      };
      return { ...summary, ...addSummaryLine(stdout, state, caseId, summary) };
    },
    async recordExportFailure(caseId, code = 'RECEIPT_EXPORT_FAILED') {
      if (state.finished) throw new Error('The receipt export run is already finished.');
      if (!plan.includes(assertSafeId(caseId, 'case ID'))) throw new Error('Case ID is outside the frozen run plan.');
      if (state.remotePublication?.terminal) {
        return {
          exportStatus: manifest.cases[caseId].exportStatus,
          persistence: state.remotePublication.status
        };
      }
      const next = structuredClone(manifest);
      if (next.cases[caseId].exportStatus === 'UNOBSERVED') {
        next.cases[caseId] = { ...next.cases[caseId], exportStatus: 'EXPORT_FAILED', failureCode: String(code).replace(/[^A-Z0-9_]/gi, '_').slice(0, 64) };
        try {
          await saveManifest(next);
        } catch (error) {
          if (state.remotePublication?.terminal) {
            return {
              exportStatus: manifest.cases[caseId].exportStatus,
              persistence: state.remotePublication.status
            };
          }
          // A verified remote failure status remains authoritative when only
          // its local mirror failed.
          if (manifest.cases[caseId].exportStatus === 'EXPORT_FAILED' && durableSink) {
            return { exportStatus: 'EXPORT_FAILED', persistence: 'REMOTE_VERIFIED_LOCAL_MIRROR_FAILED' };
          }
          throw error;
        }
        Object.assign(manifest, next);
        return { exportStatus: 'EXPORT_FAILED', persistence: durableSink ? 'REMOTE_AND_LOCAL_VERIFIED' : 'LOCAL_VERIFIED' };
      }
      return {
        exportStatus: next.cases[caseId].exportStatus,
        persistence: next.cases[caseId].exportStatus === 'EXPORTED' ? 'PREVIOUSLY_VERIFIED_EXPORT_PRESERVED' : 'PREVIOUSLY_RECORDED'
      };
    },
    async finish() {
      if (state.remotePublication?.terminal) {
        state.finished = true;
        const terminal = structuredClone(manifest);
        terminal.remotePublication = structuredClone(state.remotePublication);
        if (!state.terminalReported) {
          addSummaryLine(stdout, state, undefined, {
            event: 'RUN_FINISHED', runId, exportStatus: 'TERMINAL',
            remotePublication: state.remotePublication.status, manifestArtifact: 'manifest.json'
          });
          state.terminalReported = true;
        }
        const error = new Error(`R2_RUN_TERMINATED_${state.remotePublication.status}`);
        error.reconciliation = state.remotePublication.status;
        throw error;
      }
      if (state.finished) return structuredClone(manifest);
      const next = structuredClone(manifest);
      next.status = next.plannedCaseIds.every(id => next.cases[id].exportStatus === 'EXPORTED') ? 'COMPLETE' : 'INCOMPLETE';
      next.completedAtUTC = new Date().toISOString();
      await saveManifest(next);
      Object.assign(manifest, next);
      state.finished = true;
      addSummaryLine(stdout, state, undefined, { event: 'RUN_FINISHED', runId, exportStatus: manifest.status, manifestArtifact: 'manifest.json' });
      return structuredClone(manifest);
    }
  };
}

export async function readVerificationReceiptExport(runDirectory, {
  maxReceiptBytes = DEFAULT_MAX_RECEIPT_BYTES,
  maxDiagnosticBytes = DEFAULT_MAX_DIAGNOSTIC_BYTES,
  maxCapturedBodyBytes = DEFAULT_MAX_CAPTURED_BODY_BYTES
} = {}) {
  if (typeof runDirectory !== 'string' || !path.isAbsolute(runDirectory)) throw new Error('runDirectory must be an absolute local path.');
  for (const [label, limit] of Object.entries({ maxReceiptBytes, maxDiagnosticBytes, maxCapturedBodyBytes })) {
    if (!Number.isSafeInteger(limit) || limit < 1024 || limit > 256 * 1024 * 1024) {
      throw new Error(`${label} must be between 1024 and 268435456 bytes.`);
    }
  }
  const root = await realpath(runDirectory);
  const rootInfo = await lstat(runDirectory);
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) throw new Error('Export run must be a local directory, not a symbolic link.');
  const manifestPath = path.join(root, 'manifest.json');
  await assertNoSymlinkComponents(root, manifestPath);
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (manifest.schemaVersion !== 1 || !SAFE_ID.test(manifest.runId) || !['IN_PROGRESS', 'INCOMPLETE', 'COMPLETE'].includes(manifest.status) ||
      !Array.isArray(manifest.plannedCaseIds) ||
      !asObject(manifest.cases) || new Set(manifest.plannedCaseIds).size !== manifest.plannedCaseIds.length ||
      manifest.plannedCaseIds.some(id => !SAFE_ID.test(id) || !manifest.cases[id] ||
        !['UNOBSERVED', 'EXPORT_FAILED', 'EXPORTED'].includes(manifest.cases[id].exportStatus))) throw new Error('Export manifest is invalid.');
  const receipts = {};
  for (const caseId of manifest.plannedCaseIds) {
    assertSafeId(caseId, 'manifest case ID');
    const entry = manifest.cases[caseId];
    if (!entry || entry.exportStatus !== 'EXPORTED') continue;
    if (entry.receiptArtifact?.path !== `receipts/${caseId}.json.gz` ||
        entry.diagnosticArtifact?.path !== `diagnostics/${caseId}.json.gz` ||
        !/^[a-f0-9]{64}$/.test(entry.receiptArtifact.sha256 || '') ||
        !/^[a-f0-9]{64}$/.test(entry.diagnosticArtifact.sha256 || '')) throw new Error('Manifest artifact metadata is invalid.');
    const receiptArtifactPath = path.resolve(root, entry.receiptArtifact?.path || '');
    const diagnosticArtifactPath = path.resolve(root, entry.diagnosticArtifact?.path || '');
    if (!receiptArtifactPath.startsWith(`${root}${path.sep}`) || !diagnosticArtifactPath.startsWith(`${root}${path.sep}`)) throw new Error('Manifest artifact path escapes the run directory.');
    await assertNoSymlinkComponents(root, receiptArtifactPath);
    await assertNoSymlinkComponents(root, diagnosticArtifactPath);
    const receiptGzip = await readFile(receiptArtifactPath);
    const diagnosticGzip = await readFile(diagnosticArtifactPath);
    if (sha256(receiptGzip) !== entry.receiptArtifact.sha256 || sha256(diagnosticGzip) !== entry.diagnosticArtifact.sha256) throw new Error('Receipt or diagnostic artifact hash mismatch.');
    const record = JSON.parse(await inflateArtifact(receiptGzip, 'Receipt', maxReceiptBytes));
    const diagnostic = JSON.parse(await inflateArtifact(diagnosticGzip, 'Diagnostic', maxDiagnosticBytes));
    if (record.schemaVersion !== 1 || record.receipt?.id !== caseId || diagnostic.caseId !== caseId) throw new Error('Receipt artifact identity mismatch.');
    const bodyMap = new Map();
    for (const reference of record.bodyReferences) {
      if (!/^[a-f0-9]{64}$/.test(reference.sha256 || '') || reference.artifactPath !== `bodies/${reference.sha256}.gz` ||
          !['utf8', 'base64'].includes(reference.encoding)) throw new Error('Captured-body metadata is invalid.');
      const bodyPath = path.resolve(root, reference.artifactPath);
      if (!bodyPath.startsWith(`${root}${path.sep}`)) throw new Error('Captured-body artifact path escapes the run directory.');
      await assertNoSymlinkComponents(root, bodyPath);
      const bytes = await inflateArtifact(await readFile(bodyPath), 'Captured body', maxCapturedBodyBytes);
      if (sha256(bytes) !== reference.sha256 || bytes.length !== reference.byteLength) throw new Error('Captured-body artifact hash mismatch.');
      bodyMap.set(reference.sha256, bytes);
    }
    const restoredReceipt = restoreReceipt(record.receipt, record.bodyReferences, bodyMap);
    const allBodyPayloads = metadataOnlyPayloads(restoredReceipt, record.bodyReferences);
    if (!isDeepStrictEqual(entry.answerStatus, safeStatus(restoredReceipt.status)) ||
        !isDeepStrictEqual(entry.declaredCaptureStatus, restoredReceipt.captureCompleteness ?? 'UNOBSERVED') ||
        entry.payloadAvailability !== payloadAvailabilityFor(restoredReceipt, allBodyPayloads) ||
        entry.capturedBodyCount !== new Set(record.bodyReferences.map(reference => reference.sha256)).size) {
      throw new Error('Manifest receipt summary does not match the exported receipt.');
    }
    const expectedDiagnostic = diagnosticArtifact(restoredReceipt, allBodyPayloads);
    if (!isDeepStrictEqual(diagnostic, expectedDiagnostic)) throw new Error('Diagnostic artifact does not match its receipt.');
    receipts[caseId] = { receipt: restoredReceipt, diagnostic };
  }
  const allCasesExported = manifest.plannedCaseIds.every(id => manifest.cases[id].exportStatus === 'EXPORTED');
  if ((manifest.status === 'COMPLETE' && !allCasesExported) || (manifest.status === 'INCOMPLETE' && allCasesExported)) {
    throw new Error('Terminal manifest status does not match its planned case states.');
  }
  const findArtifacts = async (directory, prefix = '') => {
    const result = [];
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) throw new Error('Symbolic links are not allowed in export artifacts.');
      if (entry.isDirectory()) result.push(...await findArtifacts(path.join(directory, entry.name), relative));
      else result.push(relative);
    }
    return result;
  };
  const allArtifactPaths = await findArtifacts(root);
  const referencedArtifactPaths = new Set(['manifest.json']);
  for (const caseId of Object.keys(receipts)) {
    const entry = manifest.cases[caseId];
    referencedArtifactPaths.add(entry.receiptArtifact.path);
    referencedArtifactPaths.add(entry.diagnosticArtifact.path);
    const compressed = await readFile(path.join(root, entry.receiptArtifact.path));
    const record = JSON.parse(await inflateArtifact(compressed, 'Receipt', maxReceiptBytes));
    for (const reference of record.bodyReferences) referencedArtifactPaths.add(reference.artifactPath);
  }
  const orphanArtifactPaths = allArtifactPaths.filter(file => !referencedArtifactPaths.has(file));
  return {
    manifest,
    receipts,
    orphanArtifactPaths,
    orphanTemporaryFiles: orphanArtifactPaths.filter(file => file.endsWith('.tmp'))
  };
}
