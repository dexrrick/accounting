import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import { defaultControlledWebRetriever } from '../src/retrieval/controlledWebRetriever.ts';
import { extractOfficialDocumentFromRetrieved } from '../src/retrieval/officialDocumentExtractor.ts';

const MAX_REQUESTS = 10;
const RECORD_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const DOCUMENT_KINDS = new Set(['AUTO', 'HTML', 'TEXT', 'PDF', 'SSO_LEGISLATION']);

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasControlCharacters(value) {
  return [...value].some(character => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });
}

function normalizeHeading(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

function validateStringArray(value, label) {
  if (!Array.isArray(value) || value.length === 0 || !value.every(nonEmptyString)) {
    throw new Error(`${label} must be a non-empty array of non-empty strings`);
  }
}

function validateDocumentRequest(request, label) {
  if (!isObject(request)) throw new Error(`${label}.request must be an object`);
  for (const field of ['url', 'authority', 'domain', 'standardOrActCode', 'legalOrStandardInstrument']) {
    if (!nonEmptyString(request[field])) throw new Error(`${label}.request.${field} must be a non-empty string`);
  }

  let url;
  try { url = new URL(request.url); }
  catch { throw new Error(`${label}.request.url must be a valid HTTPS URL`); }
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) {
    throw new Error(`${label}.request.url must use HTTPS on the default port without embedded credentials`);
  }

  if (!isObject(request.expectedTopic)) throw new Error(`${label}.request.expectedTopic must be an object`);
  for (const field of ['standardIdentifiers', 'expectedTitles', 'topicTerms']) {
    validateStringArray(request.expectedTopic[field], `${label}.request.expectedTopic.${field}`);
  }
  if (request.expectedTopic.minimumTopicTermMatches !== undefined &&
      (!Number.isInteger(request.expectedTopic.minimumTopicTermMatches) ||
       request.expectedTopic.minimumTopicTermMatches < 1 ||
       request.expectedTopic.minimumTopicTermMatches > request.expectedTopic.topicTerms.length)) {
    throw new Error(`${label}.request.expectedTopic.minimumTopicTermMatches is outside the topic-term set`);
  }
  if (request.documentKind !== undefined && !DOCUMENT_KINDS.has(request.documentKind)) {
    throw new Error(`${label}.request.documentKind is unsupported`);
  }
  for (const field of ['relevantSection', 'sectionHeading', 'sectionEndHeading', 'elementId']) {
    if (request[field] !== undefined && typeof request[field] !== 'string') {
      throw new Error(`${label}.request.${field} must be a string when supplied`);
    }
  }
  if (request.sectionEndHeading !== undefined) {
    if (!nonEmptyString(request.sectionEndHeading) || request.sectionEndHeading.trim().length > 256 || hasControlCharacters(request.sectionEndHeading)) {
      throw new Error(`${label}.request.sectionEndHeading must be a non-empty string of at most 256 printable characters`);
    }
    const startHeading = request.sectionHeading || request.relevantSection;
    if (!nonEmptyString(startHeading) || startHeading.trim().length > 256 || hasControlCharacters(startHeading)) {
      throw new Error(`${label}.request.sectionEndHeading requires a valid sectionHeading or relevantSection`);
    }
    if (normalizeHeading(startHeading) === normalizeHeading(request.sectionEndHeading)) {
      throw new Error(`${label}.request.sectionHeading and sectionEndHeading must differ`);
    }
    if (request.documentKind !== 'PDF' && request.documentKind !== 'AUTO') {
      throw new Error(`${label}.request.sectionEndHeading is supported only for PDF or AUTO requests`);
    }
  }
  if (request.timeoutMs !== undefined && (!Number.isFinite(request.timeoutMs) || request.timeoutMs <= 0)) {
    throw new Error(`${label}.request.timeoutMs must be a positive finite number`);
  }
  if (request.maxResponseBytes !== undefined && (!Number.isInteger(request.maxResponseBytes) || request.maxResponseBytes <= 0)) {
    throw new Error(`${label}.request.maxResponseBytes must be a positive integer`);
  }
  if (request.legislation !== undefined) {
    if (!isObject(request.legislation) ||
        !['actCode', 'actTitle', 'section'].every(field => nonEmptyString(request.legislation[field]))) {
      throw new Error(`${label}.request.legislation must contain actCode, actTitle, and section strings`);
    }
  }
}

function validateDocuments(documents) {
  if (!Array.isArray(documents) || documents.length < 1 || documents.length > MAX_REQUESTS) {
    throw new Error(`documents must contain between 1 and ${MAX_REQUESTS} requests`);
  }
  const ids = new Set();
  for (const [index, document] of documents.entries()) {
    const label = `documents[${index}]`;
    if (!isObject(document) || typeof document.recordId !== 'string' || !RECORD_ID_PATTERN.test(document.recordId)) {
      throw new Error(`${label}.recordId must be a safe identifier of 1 to 128 letters, digits, '.', '_', ':', or '-'`);
    }
    const normalizedId = document.recordId.toLowerCase();
    if (ids.has(normalizedId)) throw new Error(`recordId '${document.recordId}' is duplicated`);
    ids.add(normalizedId);
    validateDocumentRequest(document.request, label);
  }
  return structuredClone(documents);
}

function observedFetchFields(fetched) {
  return {
    status: fetched.status ?? null,
    httpStatus: fetched.httpStatus ?? null,
    sourceUrl: fetched.sourceUrl ?? null,
    finalUrl: fetched.finalUrl ?? null,
    contentType: fetched.contentType ?? null,
    retrievedAt: fetched.retrievedAt ?? null,
    contentHash: fetched.contentHash ?? null,
    etag: fetched.etag ?? null,
    lastModified: fetched.lastModified ?? null,
    error: fetched.error ?? null
  };
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function isExtractionReady(document) {
  const fetch = document.fetch;
  const record = document.candidateRecord;
  return fetch?.status === 'SUCCESS' && Number.isInteger(fetch.httpStatus) &&
    fetch.httpStatus >= 200 && fetch.httpStatus < 300 &&
    [fetch.sourceUrl, fetch.finalUrl, fetch.contentType, fetch.retrievedAt]
      .every(value => typeof value === 'string' && value.trim().length > 0) &&
    typeof document.bodyFile === 'string' && document.bodyFile.length > 0 &&
    Number.isInteger(document.bodyBytes) && document.bodyBytes > 0 &&
    typeof document.integrity?.computedSha256 === 'string' &&
    document.integrity.computedSha256 === record?.documentHash &&
    record?.extractionStatus === 'EXACT' &&
    record.isVerbatimText === true && record.lifecycleState === 'CANDIDATE' &&
    record.groundingEligible === false && document.integrity?.observedHashMatchesBytes !== false;
}

/**
 * Captures an explicit bounded request list into a new directory. It never
 * changes source registries or admits extracted records as active evidence.
 */
export async function captureOfficialDocuments({ documents, outputDirectory, retriever = defaultControlledWebRetriever }) {
  const validatedDocuments = validateDocuments(documents);
  if (typeof outputDirectory !== 'string' || outputDirectory.trim().length === 0) {
    throw new Error('outputDirectory must be a non-empty path to a new directory');
  }
  if (!retriever || typeof retriever.fetchOfficialDocument !== 'function') {
    throw new Error('retriever must provide fetchOfficialDocument(url, options)');
  }

  const resolvedOutputDirectory = path.resolve(outputDirectory);
  await mkdir(resolvedOutputDirectory, { recursive: false });

  const manifestDocuments = [];
  for (const [index, item] of validatedDocuments.entries()) {
    const prefix = String(index + 1).padStart(2, '0');
    const bodyFile = `${prefix}-${encodeURIComponent(item.recordId)}.body.gz`;
    let fetched;
    try {
      fetched = await retriever.fetchOfficialDocument(item.request.url, {
        timeoutMs: item.request.timeoutMs,
        maxResponseBytes: item.request.maxResponseBytes
      });
    } catch (error) {
      manifestDocuments.push({
        recordId: item.recordId,
        request: item.request,
        fetch: null,
        fetchFailure: {
          name: error instanceof Error ? error.name : 'Error',
          message: error instanceof Error ? error.message : String(error)
        },
        bodyFile: null,
        bodyBytes: null,
        integrity: null,
        extraction: null,
        candidateRecord: null
      });
      continue;
    }

    const fetch = observedFetchFields(fetched);
    const contentBytes = fetched.contentBytes;
    const hasBytes = contentBytes instanceof Uint8Array;
    const computedSha256 = hasBytes ? sha256(contentBytes) : null;
    const observedHashMatchesBytes = hasBytes && typeof fetched.contentHash === 'string'
      ? computedSha256 === fetched.contentHash.toLowerCase()
      : null;
    if (hasBytes) {
      await writeFile(path.join(resolvedOutputDirectory, bodyFile), gzipSync(contentBytes));
    }

    let extraction = null;
    let candidateRecord = null;
    let extractionFailure = null;
    try {
      const result = await extractOfficialDocumentFromRetrieved(item.request, fetched);
      if (result.status === 'REJECTED') {
        extraction = { status: result.status, code: result.code, reason: result.reason };
      } else {
        candidateRecord = {
          ...result.record,
          id: item.recordId,
          lifecycleState: 'CANDIDATE',
          groundingEligible: false
        };
        extraction = {
          status: result.status,
          extractionStatus: result.record.extractionStatus,
          isVerbatimText: result.record.isVerbatimText
        };
      }
    } catch (error) {
      extractionFailure = {
        name: error instanceof Error ? error.name : 'Error',
        message: error instanceof Error ? error.message : String(error)
      };
    }

    manifestDocuments.push({
      recordId: item.recordId,
      request: item.request,
      fetch,
      ...(fetched.error ? { fetchError: fetched.error } : {}),
      bodyFile: hasBytes ? bodyFile : null,
      bodyBytes: hasBytes ? contentBytes.byteLength : null,
      integrity: {
        computedSha256,
        observedHashMatchesBytes
      },
      extraction,
      ...(extractionFailure ? { extractionFailure } : {}),
      candidateRecord
    });
  }

  const status = manifestDocuments.every(isExtractionReady) ? 'EXTRACTION_READY' : 'BLOCKED';
  const manifest = {
    schemaVersion: 1,
    status,
    documents: manifestDocuments
  };
  await writeFile(path.join(resolvedOutputDirectory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return manifest;
}

function parseArguments(args) {
  let requestsPath;
  let outputDirectory;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--requests' && !requestsPath && args[index + 1]) requestsPath = args[++index];
    else if (arg === '--output' && !outputDirectory && args[index + 1]) outputDirectory = args[++index];
    else throw new Error(`Invalid arguments near '${arg}'`);
  }
  if (!requestsPath || !outputDirectory) throw new Error('Usage: node --import tsx scripts/capture_official_documents.mjs --requests <json-file> --output <new-directory>');
  return { requestsPath, outputDirectory };
}

export async function main(args = process.argv.slice(2)) {
  try {
    const { requestsPath, outputDirectory } = parseArguments(args);
    const requestManifest = JSON.parse(await readFile(path.resolve(requestsPath), 'utf8'));
    if (!isObject(requestManifest) || !Array.isArray(requestManifest.documents)) {
      throw new Error('Request JSON must have a documents array');
    }
    const result = await captureOfficialDocuments({ documents: requestManifest.documents, outputDirectory });
    const summary = {
      status: result.status,
      documents: result.documents.map(document => ({
        recordId: document.recordId,
        fetchStatus: document.fetch?.status ?? null,
        extractionStatus: document.extraction?.extractionStatus ?? document.extraction?.status ?? null,
        code: document.extraction?.code ?? null
      }))
    };
    process.stdout.write(`${JSON.stringify(summary)}\n`);
    process.exitCode = result.status === 'BLOCKED' ? 2 : 0;
    return result;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
    return null;
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (invokedPath === import.meta.url) await main();
