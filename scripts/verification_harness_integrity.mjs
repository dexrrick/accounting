import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstat, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const TEXT_RUNTIME_EXTENSIONS = new Set(['.css', '.js', '.json', '.jsonc', '.lock', '.svg', '.ts', '.tsx', '.yaml', '.yml']);
const ROOT_RUNTIME_CONFIGS = new Set([
  '.gitattributes', '.nvmrc', 'package-lock.json', 'package.json', 'postcss.config.js',
  'tailwind.config.js', 'vite.config.ts', 'wrangler.jsonc'
]);

function isRuntimePath(relativePath) {
  const normalized = relativePath.replaceAll('\\', '/');
  const baseName = path.posix.basename(normalized);
  return normalized.startsWith('src/') || ROOT_RUNTIME_CONFIGS.has(normalized) ||
    /^tsconfig(?:\.[^/]+)?\.json$/.test(baseName);
}

function parseTreeEntries(output) {
  return output.split('\0').filter(Boolean).map(entry => {
    const separator = entry.indexOf('\t');
    if (separator < 0) throw new Error('PINNED_RUNTIME_TREE_INVALID');
    const [mode, type, objectId] = entry.slice(0, separator).split(' ');
    const relativePath = entry.slice(separator + 1);
    if (mode !== '100644' && mode !== '100755' || type !== 'blob' || !/^[a-f0-9]{40,64}$/i.test(objectId || '')) {
      throw new Error('PINNED_RUNTIME_TREE_UNSUPPORTED_ENTRY');
    }
    return { mode, objectId, relativePath };
  }).sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

async function listRuntimeFiles(directory, prefix = '') {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absolutePath = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`PINNED_RUNTIME_SYMLINK:${relativePath}`);
    if (entry.isDirectory()) files.push(...await listRuntimeFiles(absolutePath, relativePath));
    else if (entry.isFile()) files.push(relativePath);
    else throw new Error(`PINNED_RUNTIME_SPECIAL_FILE:${relativePath}`);
  }
  return files;
}

function canonicalJsonWithoutHarnessPostbuild(bytes) {
  const value = JSON.parse(bytes.toString('utf8'));
  const postbuild = value?.scripts?.postbuild;
  if (postbuild !== undefined && !/^node --import tsx --input-type=module -e "process\.env\.ACCOUNTING_ALLOW_LIVE_MODEL_CALLS='1';process\.env\.ACCOUNTING_VERIFICATION_RUN_ID='[a-z0-9-]+';process\.env\.ACCOUNTING_VERIFICATION_EXPORT_DIRECTORY='\/tmp\/accounting-verification-exports';await import\('\.\/.verify-final-build-live\.mjs'\)"$/i.test(postbuild)) {
    throw new Error('PINNED_RUNTIME_POSTBUILD_NOT_APPROVED');
  }
  if (value?.scripts && typeof value.scripts === 'object') delete value.scripts.postbuild;
  const sortKeys = item => Array.isArray(item) ? item.map(sortKeys) : item && typeof item === 'object'
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, sortKeys(item[key])])) : item;
  return Buffer.from(JSON.stringify(sortKeys(value)), 'utf8');
}

function normalizeCheckoutBytes(bytes, relativePath) {
  if (relativePath.replaceAll('\\', '/') === 'package.json') return canonicalJsonWithoutHarnessPostbuild(bytes);
  const extension = path.posix.extname(relativePath).toLowerCase();
  if (!TEXT_RUNTIME_EXTENSIONS.has(extension) && path.posix.basename(relativePath) !== '.nvmrc') return bytes;
  const normalized = Buffer.from(bytes.toString('utf8').replace(/\r\n/g, '\n'), 'utf8');
  if (normalized.includes(0) || normalized.includes(13)) throw new Error(`PINNED_RUNTIME_TEXT_ENCODING_UNSUPPORTED:${relativePath}`);
  return normalized;
}

/**
 * Bind executable src/ files to the reviewed application commit before any app import or sink use.
 * Text sources permit Git's ordinary CRLF checkout conversion only; every other byte and every
 * binary asset must match its pinned Git blob. Untracked files and symlinks are rejected.
 */
export async function verifyPinnedApplicationRuntime({ root = process.cwd(), appSourceSha, git = 'git' }) {
  if (!/^[a-f0-9]{40}$/i.test(appSourceSha || '')) throw new Error('PINNED_RUNTIME_COMMIT_INVALID');
  const runGit = (args, options = {}) => execFileSync(git, ['-C', root, ...args], options);
  const pinned = parseTreeEntries(runGit(['ls-tree', '-r', '-z', appSourceSha], { encoding: 'utf8' }))
    .filter(entry => isRuntimePath(entry.relativePath));
  const sourceRoot = path.join(root, 'src');
  const sourceStat = await lstat(sourceRoot).catch(() => undefined);
  if (!sourceStat?.isDirectory() || sourceStat.isSymbolicLink()) throw new Error('PINNED_RUNTIME_SOURCE_ROOT_MISSING');
  const diskPaths = (await listRuntimeFiles(sourceRoot)).map(file => `src/${file}`);
  const rootEntries = await readdir(root, { withFileTypes: true });
  for (const entry of rootEntries) {
    if (!isRuntimePath(entry.name) || entry.name.startsWith('src/')) continue;
    if (entry.isSymbolicLink() || !entry.isFile()) throw new Error(`PINNED_RUNTIME_CONFIG_UNSUPPORTED_ENTRY:${entry.name}`);
    diskPaths.push(entry.name);
  }
  diskPaths.sort((left, right) => left.localeCompare(right));
  const pinnedPaths = pinned.map(entry => entry.relativePath.replaceAll('\\', '/')).sort((left, right) => left.localeCompare(right));
  if (diskPaths.length !== pinnedPaths.length || diskPaths.some((file, index) => file !== pinnedPaths[index])) {
    throw new Error('PINNED_RUNTIME_FILE_SET_MISMATCH');
  }

  const diskFiles = [];
  for (const entry of pinned) {
    const relativePath = entry.relativePath.replaceAll('\\', '/');
    const bytes = await readFile(path.join(root, ...relativePath.split('/')));
    const expected = runGit(['cat-file', 'blob', entry.objectId], { encoding: 'buffer', maxBuffer: 8 * 1024 * 1024 });
    const normalizedDisk = normalizeCheckoutBytes(bytes, relativePath);
    const normalizedExpected = normalizeCheckoutBytes(expected, relativePath);
    if (!normalizedDisk.equals(normalizedExpected)) {
      throw new Error(`PINNED_RUNTIME_CONTENT_MISMATCH:${relativePath}`);
    }
    diskFiles.push({
      path: relativePath,
      gitBlobObject: entry.objectId,
      diskSha256: createHash('sha256').update(bytes).digest('hex'),
      diskByteLength: bytes.byteLength
    });
  }
  const manifest = {
    sourceCommit: appSourceSha,
    comparisonPolicy: 'tracked src and runtime configs are pinned; text files compare after CRLF-to-LF normalization, binary files compare byte-for-byte, and only package.json scripts.postbuild is excluded as a harness hook',
    files: diskFiles
  };
  const manifestSha256 = createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
  return { ...manifest, manifestSha256 };
}

function isGenerateContent(record) {
  return record?.generateContent === true || /:generateContent(?:\?|$)/.test(record?.endpoint || '');
}

function isStreamGenerateContent(record) {
  return /:streamGenerateContent(?:\?|$)/.test(record?.endpoint || '');
}

function hasRetainedCompleteGenerateContentBody(record) {
  if (!isGenerateContent(record) || record.retainedRawBody !== true || record.captureStatus !== 'COMPLETE' ||
      record.responseBodyHashScope !== 'complete_response' || record.responseBodyTruncated !== false) return false;
  const body = record.rawResponseBodyText;
  if (typeof body === 'string') return true;
  const reference = body?.$capturedBody;
  return Boolean(reference && /^[a-f0-9]{64}$/i.test(reference.sha256 || '') &&
    Number.isSafeInteger(reference.byteLength) && reference.byteLength >= 0 &&
    ['utf8', 'base64'].includes(reference.encoding) &&
    reference.payloadStatus === 'PRESENT_NO_TRUNCATION_RECORDED' &&
    typeof reference.artifactPath === 'string');
}

/** Count model capture evidence from exported/recovered receipt payloads. */
export function summarizeModelCaptureCompleteness(receipts) {
  const list = Array.isArray(receipts) ? receipts : [];
  let modelRequestsDispatched = 0;
  let modelResponseRecords = 0;
  let generateContentResponses = 0;
  let completedGenerateContentBodies = 0;
  let incompleteGenerateContentBodies = 0;
  let metadataOnlyStreamResponses = 0;
  let incompleteMetadataOnlyStreamResponses = 0;
  let unexpectedModelEndpointResponses = 0;
  let modelTransportFailures = 0;
  let generateContentTransportFailures = 0;
  let streamTransportFailures = 0;

  for (const receipt of list) {
    const responses = Array.isArray(receipt?.modelResponses) ? receipt.modelResponses : [];
    modelRequestsDispatched += Number.isSafeInteger(receipt?.dispatches?.model) ? receipt.dispatches.model : 0;
    modelResponseRecords += responses.length;
    for (const record of responses) {
      const generated = isGenerateContent(record);
      if (record?.transportError) {
        modelTransportFailures += 1;
        if (generated) generateContentTransportFailures += 1;
        else streamTransportFailures += 1;
        continue;
      }
      if (generated) {
        generateContentResponses += 1;
        if (hasRetainedCompleteGenerateContentBody(record)) completedGenerateContentBodies += 1;
        else incompleteGenerateContentBodies += 1;
      } else if (isStreamGenerateContent(record)) {
        metadataOnlyStreamResponses += 1;
        if (record?.captureStatus !== 'COMPLETE' || record?.responseBodyHashScope !== 'complete_response' ||
            record?.responseBodyTruncated !== false || record?.retainedRawBody !== false) {
          incompleteMetadataOnlyStreamResponses += 1;
        }
      } else unexpectedModelEndpointResponses += 1;
    }
  }

  const missingModelResponseRecords = Math.max(0, modelRequestsDispatched - modelResponseRecords);
  const unexpectedModelResponseRecords = Math.max(0, modelResponseRecords - modelRequestsDispatched);
  return {
    modelRequestsDispatched,
    modelResponseRecords,
    missingModelResponseRecords,
    unexpectedModelResponseRecords,
    generateContentResponses,
    completedGenerateContentBodies,
    incompleteGenerateContentBodies,
    generateContentTransportFailures,
    metadataOnlyStreamResponses,
    incompleteMetadataOnlyStreamResponses,
    unexpectedModelEndpointResponses,
    streamTransportFailures,
    modelTransportFailures,
    allGenerateContentBodiesRetained: generateContentResponses > 0 &&
      completedGenerateContentBodies === generateContentResponses &&
      incompleteGenerateContentBodies === 0 && generateContentTransportFailures === 0 &&
      missingModelResponseRecords === 0 && unexpectedModelResponseRecords === 0
  };
}
