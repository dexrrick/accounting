import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, open, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { IRAS_SOURCE_MAP_DEFINITIONS, getCoverageTopicsByIds } from '../../../src/standards/coverageRegistry.ts';
import { UNIFIED_SOURCE_REGISTRY } from '../../../src/standards/unifiedSourceModel.ts';
import { ExternalSourceValidator } from '../../../src/retrieval/externalSourceValidator.ts';
import { startsAttachedEvidenceQualification } from '../../../src/verification/claimEvidenceVerifier.ts';
import { assertProtectedArtifactsUnchanged, createMappedOnlyTransport, fingerprintProtectedArtifacts } from './iras-mapped-source-diagnostic-v3.mjs';
import {
  assertPinnedHistoricalArtifactsUnchanged,
  V6_OUTPUT_DIRECTORY,
  V6_PLAN_FILENAME
} from './iras-mapped-evidence-diagnostic-v6.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const OUTPUT_DIRECTORY = path.join(ROOT,
  'docs/evaluation/multi-authority-workstreams/iras-public-excerpts-2026-10-03-v1');
export const PLAN_FILENAME = 'iras-public-rule-excerpts-plan-v1.json';
export const REPORT_FILENAME = 'iras-public-rule-excerpts-report-v1.json';
export const CONSUMED_FILENAME = 'iras-public-rule-excerpts-live-consumed-v1.json';
export const SOURCE_MAP_IDS = Object.freeze([
  'IRAS_CIT_EXPENSES_SOURCE_MAP',
  'IRAS_CIT_FOREIGN_INCOME_SOURCE_MAP',
  'IRAS_WHT_OVERVIEW_SOURCE_MAP',
  'IRAS_WHT_RATES_SOURCE_MAP',
  'IRAS_GST_INPUT_TAX_SOURCE_MAP'
]);
const V6_DIRECTORY = path.relative(ROOT, V6_OUTPUT_DIRECTORY).replaceAll('\\', '/');
const V6_ARTIFACTS = Object.freeze([
  `${V6_DIRECTORY}/${V6_PLAN_FILENAME}`,
  `${V6_DIRECTORY}/iras-mapped-evidence-diagnostic-v6.json`,
  `${V6_DIRECTORY}/iras-mapped-evidence-live-v6-consumed.json`,
  `${V6_DIRECTORY}/supervisor-observations.md`
]);
const CODE_PATHS = Object.freeze([
  'tests/evaluation/singapore/iras-public-rule-excerpts-v1.mjs',
  'tests/regression/test_iras_public_rule_excerpts_v1.mjs',
  'tests/evaluation/singapore/iras-mapped-source-diagnostic-v3.mjs',
  'tests/evaluation/singapore/iras-mapped-evidence-diagnostic-v6.mjs',
  'src/verification/claimEvidenceVerifier.ts',
  'src/retrieval/externalSourceValidator.ts',
  'src/standards/coverageRegistry.ts',
  'src/standards/unifiedSourceModel.ts'
]);
const ALLOWED_REDIRECT_HOSTS = new Set(['www.iras.gov.sg', 'iras.gov.sg']);
const FAMILY_PATTERNS = Object.freeze({
  IRAS_CIT_EXPENSES_SOURCE_MAP: /\b(?:private|personal)\b.{0,100}\b(?:expenses?|costs?)\b|\b(?:expenses?|costs?)\b.{0,100}\b(?:disallowed|deductible|deduction)\b/i,
  IRAS_CIT_FOREIGN_INCOME_SOURCE_MAP: /\b(?:foreign|overseas)\b.{0,120}\b(?:income|dividends?)\b|\bdividends?\b.{0,100}\b(?:received|remitted|tax|exempt)\b/i,
  IRAS_WHT_OVERVIEW_SOURCE_MAP: /\b(?:withholding tax|wht)\b.{0,120}\b(?:royalt(?:y|ies)|non[ -]resident|withhold)\b|\broyalt(?:y|ies)\b/i,
  IRAS_WHT_RATES_SOURCE_MAP: /\b(?:royalt(?:y|ies)|non[ -]resident)\b.{0,120}\b(?:withholding tax|wht|rate|withhold)\b|\broyalt(?:y|ies)\b/i,
  IRAS_GST_INPUT_TAX_SOURCE_MAP: /\binput[ -]tax\b.{0,120}\b(?:claim|recover|condition|business|suppl|invoice|blocked)\b|\b(?:claim|recover)\b.{0,80}\binput[ -]tax\b/i
});

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function repoPath(relative) {
  const target = path.resolve(ROOT, ...relative.split(/[\\/]/));
  const fromRoot = path.relative(ROOT, target);
  assert.ok(fromRoot && fromRoot !== '..' && !fromRoot.startsWith(`..${path.sep}`) && !path.isAbsolute(fromRoot),
    'Diagnostic input path must stay within the repository');
  return target;
}

function canonicalJson(value) {
  const sort = item => Array.isArray(item) ? item.map(sort) :
    item && typeof item === 'object' ? Object.fromEntries(Object.keys(item).sort().map(key => [key, sort(item[key])])) : item;
  return JSON.stringify(sort(value));
}

async function fingerprintPaths(paths, readFileImpl = readFile) {
  return Promise.all([...paths].sort().map(async relativePath => ({
    path: relativePath,
    sha256: sha256(await readFileImpl(repoPath(relativePath)))
  })));
}

async function v6Integrity(readFileImpl = readFile, checkHistory = assertPinnedHistoricalArtifactsUnchanged,
  readV1V2Fingerprints = fingerprintProtectedArtifacts) {
  const v6Plan = JSON.parse((await readFileImpl(repoPath(V6_ARTIFACTS[0]))).toString('utf8'));
  assert.ok(v6Plan?.preregistration?.sourceMaps, 'Frozen V6 map plan is malformed');
  const hashes = await fingerprintPaths(V6_ARTIFACTS, readFileImpl);
  const pinnedHistory = await checkHistory();
  const v1v2Fingerprints = await readV1V2Fingerprints();
  return { hashes, pinnedHistory, v1v2Fingerprints };
}

function selectedPages(v6Plan) {
  const rows = [];
  for (const mapId of SOURCE_MAP_IDS) {
    const frozenRows = v6Plan.preregistration.sourceMaps.filter(row => row.mapIds?.includes(mapId));
    assert.equal(frozenRows.length, 1, `Frozen V6 plan must contain exactly one page for ${mapId}`);
    const definition = IRAS_SOURCE_MAP_DEFINITIONS.find(item => item.id === mapId);
    assert.ok(definition, `Registered IRAS source map is missing: ${mapId}`);
    assert.equal(frozenRows[0].canonicalUrl, definition.canonicalSourceUrl, `${mapId} URL differs from frozen V6 map`);
    const url = new URL(frozenRows[0].canonicalUrl);
    assert.equal(url.protocol, 'https:');
    assert.ok(ALLOWED_REDIRECT_HOSTS.has(url.hostname.toLowerCase()));
    assert.equal(url.username, '');
    assert.equal(url.password, '');
    assert.equal(url.search, '');
    assert.equal(url.hash, '');
    rows.push({ mapId, canonicalUrl: url.toString(), topicIds: [...definition.topicIds].sort() });
  }
  assert.equal(new Set(rows.map(row => row.canonicalUrl)).size, SOURCE_MAP_IDS.length,
    'The five selected maps must resolve to five unique canonical pages');
  return rows;
}

async function buildPreregis({ readFileImpl = readFile, checkHistory = assertPinnedHistoricalArtifactsUnchanged,
  readV1V2Fingerprints = fingerprintProtectedArtifacts,
  readCodeFingerprints = paths => fingerprintPaths(paths, readFileImpl) } = {}) {
  const v6Bytes = await readFileImpl(repoPath(V6_ARTIFACTS[0]));
  const v6Plan = JSON.parse(v6Bytes.toString('utf8'));
  const historical = await v6Integrity(readFileImpl, checkHistory, readV1V2Fingerprints);
  return {
    schemaVersion: 1,
    profileVersion: 'iras-public-rule-excerpts-v1',
    sourceMaps: selectedPages(v6Plan),
    constraints: {
      interpretation: 'PUBLIC_SOURCE_EXCERPTS_ONLY_DIAGNOSTIC_NOT_ENTAILMENT',
      maxPageCharacters: 200000,
      maxPageBlocks: 10000,
      maxExcerptsPerPage: 5,
      maxCharactersPerExcerpt: 3000,
      maxCharactersPerPage: 12000,
      timeoutMs: 10000,
      maximumActualGets: 10,
      retries: 0,
      redirectPolicy: 'ONE_SAME_PATH_IRAS_PEER_HOST_REDIRECT',
      transportCache: 'SHARED_V3_MAPPED_ONLY_TRANSPORT'
    },
    v6PlanSha256: sha256(v6Bytes),
    v6Integrity: historical,
    codeFingerprints: await readCodeFingerprints(CODE_PATHS)
  };
}

function planHash(plan) {
  return sha256(canonicalJson(plan));
}

async function assertAbsent(target) {
  try {
    await stat(target);
    throw Object.assign(new Error('Output exists'), { code: 'EEXIST' });
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

async function writeExclusive(target, value) {
  await mkdir(path.dirname(target), { recursive: true });
  const handle = await open(target, 'wx');
  try { await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8'); }
  finally { await handle.close(); }
}

function lineBlocks(text) {
  const paragraphs = text.split(/\r?\n\s*\r?\n/).map(value => value.trim()).filter(Boolean);
  const units = [];
  for (let index = 0; index < paragraphs.length; index += 1) {
    const heading = paragraphs[index];
    if (/^.{1,180}:$/.test(heading) && paragraphs[index + 1]?.startsWith('• ')) {
      const items = [];
      let cursor = index + 1;
      while (cursor < paragraphs.length && /^(?:•|◦|▪)\s/.test(paragraphs[cursor])) {
        items.push(paragraphs[cursor]);
        cursor += 1;
      }
      units.push({ blockIndex: index, kind: 'HEADING_WITH_COMPLETE_LIST', text: `${heading}\n\n${items.join('\n\n')}` });
      index = cursor - 1;
      continue;
    }
    units.push({ blockIndex: index, kind: /^\s*(?:•|◦|▪)\s/.test(heading) ? 'LIST_ITEM' : 'PARAGRAPH', text: heading });
  }
  for (let index = 0; index < units.length; index += 1) {
    let cursor = index + 1;
    while (cursor < units.length && startsAttachedEvidenceQualification(units[cursor].text)) {
      units[index] = { ...units[index], kind: 'WITH_ATTACHED_QUALIFICATION',
        text: `${units[index].text}\n\n${units[cursor].text}` };
      cursor += 1;
    }
    if (cursor > index + 1) units.splice(index + 1, cursor - index - 1);
  }
  return units;
}

function lexicalPriority(mapId, unit) {
  const text = unit.text;
  if (mapId === 'IRAS_CIT_EXPENSES_SOURCE_MAP') {
    if (/\b(?:private|personal)\b.{0,100}\b(?:expenses?|costs?)\b/i.test(text)) return 0;
    return /\b(?:expenses?|costs?)\b.{0,100}\b(?:disallowed|deductible|deduction)\b/i.test(text) ? 1 : undefined;
  }
  if (mapId === 'IRAS_CIT_FOREIGN_INCOME_SOURCE_MAP') {
    if (/\b(?:foreign|overseas)[ -]sourced?\b.{0,100}\bdividends?\b|\b(?:foreign|overseas)\s+dividends?\b|\bdividends?\b.{0,100}\b(?:received|remitted|tax|exempt)\b/i.test(text)) return 0;
    return /\b(?:foreign|overseas)[ -]sourced? income\b.{0,100}\b(?:received|remitted)\s+(?:in|into) singapore\b.{0,120}\b(?:tax|exempt)\b/i.test(text) ? 0 :
      /\b(?:foreign|overseas)\b.{0,120}\b(?:income|dividends?)\b/i.test(text) ? 1 : undefined;
  }
  if (mapId === 'IRAS_WHT_OVERVIEW_SOURCE_MAP' || mapId === 'IRAS_WHT_RATES_SOURCE_MAP') {
    if (/\broyalt(?:y|ies)\b/i.test(text) && /\b(?:non[ -]resident|withholding tax|wht|withhold|rate)\b/i.test(text)) return 0;
    return /\b(?:withholding tax|wht)\b/i.test(text) ? 1 : undefined;
  }
  if (mapId === 'IRAS_GST_INPUT_TAX_SOURCE_MAP') {
    if (unit.kind === 'HEADING_WITH_COMPLETE_LIST' || unit.kind === 'HEADING_AND_BLOCK') {
      if (/\binput[ -]tax\b/i.test(text) && /\b(?:conditions?|must|required|claim|recover)\b/i.test(text)) return 0;
    }
    if (/\binput[ -]tax\b/i.test(text) && /\b(?:conditions?|must|required|claim|recover)\b/i.test(text) &&
      /\b(?:business|taxable supplies|used for|purchase|purchases)\b/i.test(text)) return 0;
    return /\binput[ -]tax\b/i.test(text) ? 1 : undefined;
  }
  return undefined;
}

export function selectPublicExcerptUnits(mapId, substantiveText) {
  const pattern = FAMILY_PATTERNS[mapId];
  assert.ok(pattern, 'Only preregistered map IDs have excerpt selectors');
  if (substantiveText.length > 200000) return { excerpts: [], blockCount: null, truncated: true,
    skipped: { PAGE_CHARACTER_LIMIT: 1 } };
  const rawBlockCount = substantiveText.trim() ? substantiveText.split(/\r?\n\s*\r?\n/).filter(value => value.trim()).length : 0;
  if (rawBlockCount > 10000) return { excerpts: [], blockCount: rawBlockCount, truncated: true,
    skipped: { PAGE_BLOCK_LIMIT: 1 } };
  const blocks = lineBlocks(substantiveText);

  const candidates = [];
  for (let index = 0; index < blocks.length; index += 1) {
    if (!pattern.test(blocks[index].text)) continue;
    let candidate = blocks[index];
    const previous = blocks[index - 1];
    if (candidate.kind !== 'HEADING_WITH_COMPLETE_LIST' && previous &&
      previous.text.length <= 180 && previous.text.split(/\s+/).length <= 12 && !/[.!?,;:]$/.test(previous.text) &&
      !/\b(?:is|are|was|were|may|might|can|could|must|should|does|do|did|has|have|applies|apply|requires|require)\b/i.test(previous.text)) {
      candidate = { ...candidate, blockIndex: previous.blockIndex,
        text: `${previous.text}\n\n${candidate.text}`, kind: 'HEADING_AND_BLOCK' };
    }
    const priority = lexicalPriority(mapId, candidate);
    if (priority !== undefined) candidates.push({ ...candidate, priority });
  }
  const excerpts = [];
  const skipped = {};
  let totalChars = 0;
  const ranked = [...candidates].sort((left, right) => left.priority - right.priority || left.blockIndex - right.blockIndex);
  const selected = [];
  for (let index = 0; index < ranked.length; index += 1) {
    const candidate = ranked[index];
    if (selected.length >= 5) {
      skipped.EXCERPT_COUNT_LIMIT = ranked.length - index;
      break;
    }
    if (candidate.text.length > 3000) { skipped.OVERSIZE_COMPLETE_UNIT = (skipped.OVERSIZE_COMPLETE_UNIT || 0) + 1; continue; }
    if (totalChars + candidate.text.length > 12000) { skipped.PAGE_EXCERPT_CHAR_LIMIT = (skipped.PAGE_EXCERPT_CHAR_LIMIT || 0) + 1; continue; }
    excerpts.push({ blockIndex: candidate.blockIndex, unitKind: candidate.kind, text: candidate.text, truncated: false });
    selected.push(candidate);
    totalChars += candidate.text.length;
  }
  selected.sort((left, right) => left.blockIndex - right.blockIndex);
  excerpts.sort((left, right) => left.blockIndex - right.blockIndex);
  return { excerpts, blockCount: rawBlockCount, truncated: false, skipped };
}

function expectationFor(page) {
  const definition = IRAS_SOURCE_MAP_DEFINITIONS.find(item => item.id === page.mapId);
  const pointer = UNIFIED_SOURCE_REGISTRY[page.mapId];
  const topic = getCoverageTopicsByIds(page.topicIds).find(item => item.domainId === definition?.domainId);
  assert.ok(definition && pointer && topic, `Mapped validation inputs missing for ${page.mapId}`);
  return {
    standardIdentifiers: [pointer.standardOrActCode, pointer.documentTitle].filter(Boolean),
    expectedTitles: [pointer.documentTitle],
    topicTerms: [...new Set([topic.title, ...(topic.aliases || []), ...topic.keywords,
      ...(topic.requiredContentTerms || []), ...(topic.paragraphHints || []), ...(topic.sectionHints || [])])],
    allowIrasTopicTokenEquivalence: true
  };
}

async function readPage(page, transport, validator, fetchSignal) {
  let response = await transport.fetch(page.canonicalUrl, { signal: fetchSignal });
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get('location');
    if (!location) return { status: 'REDIRECT_WITHOUT_LOCATION' };
    let target;
    try { target = new URL(location, page.canonicalUrl); } catch { return { status: 'REDIRECT_URL_INVALID' }; }
    if (!ALLOWED_REDIRECT_HOSTS.has(target.hostname.toLowerCase()) || target.pathname !== new URL(page.canonicalUrl).pathname ||
      target.search || target.hash || target.username || target.password || target.protocol !== 'https:') return { status: 'REDIRECT_REJECTED' };
    response = await transport.fetch(target.toString(), { signal: fetchSignal });
  }
  if (!response.ok) return { status: 'HTTP_ERROR' };
  if (!/^text\/html(?:\s*;|$)/i.test(response.headers.get('content-type') || '')) return { status: 'CONTENT_TYPE_REJECTED' };
  const html = await response.text();
  const documentSha256 = sha256(html);
  const validation = validator.validateTopicContent(html, expectationFor(page));
  if (!validation.isValid || typeof validation.substantiveText !== 'string') {
    return { status: 'SOURCE_VALIDATION_REJECTED', validationCode: validation.errorCode || 'OTHER_VALIDATION_ERROR', documentSha256 };
  }
  const selection = selectPublicExcerptUnits(page.mapId, validation.substantiveText);
  return { status: 'VALIDATED', documentSha256, selection };
}

function assertSafe(value) {
  const forbidden = new Set(['html', 'query', 'question', 'subject', 'prompt', 'modelPayload', 'rawResponse', 'errorMessage']);
  const visit = (item, at = '$') => {
    if (Array.isArray(item)) return item.forEach((child, index) => visit(child, `${at}[${index}]`));
    if (!item || typeof item !== 'object') return;
    for (const [key, child] of Object.entries(item)) {
      assert.ok(!forbidden.has(key), `Unsafe public-excerpt report key at ${at}.${key}`);
      visit(child, `${at}.${key}`);
    }
  };
  visit(value);
  return value;
}

export async function runIrasPublicRuleExcerptDiagnostic({ mode, outputDirectory = OUTPUT_DIRECTORY,
  fetchImpl = globalThis.fetch, readFileImpl = readFile,
  checkHistory = assertPinnedHistoricalArtifactsUnchanged,
  checkV1V2History = assertProtectedArtifactsUnchanged,
  readV1V2Fingerprints = fingerprintProtectedArtifacts,
  readCodeFingerprints = paths => fingerprintPaths(paths, readFileImpl),
  now = () => new Date().toISOString() } = {}) {
  assert.ok(mode === 'plan' || mode === 'live-source', 'Mode must be --plan or --live-source');
  const planPath = path.join(outputDirectory, PLAN_FILENAME);
  const reportPath = path.join(outputDirectory, REPORT_FILENAME);
  const markerPath = path.join(outputDirectory, CONSUMED_FILENAME);
  if (mode === 'plan') {
    await assertAbsent(planPath);
    const preregistration = await buildPreregis({ readFileImpl, checkHistory, readV1V2Fingerprints, readCodeFingerprints });
    const envelope = { preregistration, preregistrationSha256: planHash(preregistration) };
    await writeExclusive(planPath, envelope);
    return envelope;
  }

  await checkHistory();
  const planBytes = await readFileImpl(planPath);
  const envelope = JSON.parse(planBytes.toString('utf8'));
  assert.ok(envelope?.preregistration && envelope.preregistrationSha256 === planHash(envelope.preregistration),
    'PREREGISTRATION_MISMATCH');
  await checkV1V2History(envelope.preregistration.v6Integrity.v1v2Fingerprints);
  const current = await buildPreregis({ readFileImpl, checkHistory, readV1V2Fingerprints, readCodeFingerprints });
  assert.equal(canonicalJson(current), canonicalJson(envelope.preregistration), 'PREREGISTRATION_MISMATCH');
  await assertAbsent(reportPath);
  try {
    await stat(markerPath);
    throw Object.assign(new Error('RUN_CONSUMED'), { code: 'RUN_CONSUMED' });
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  await mkdir(outputDirectory, { recursive: true });
  try {
    const marker = await open(markerPath, 'wx');
    try {
      await marker.writeFile(JSON.stringify({ schemaVersion: 1, preregistrationSha256: envelope.preregistrationSha256,
        status: 'CONSUMED_BEFORE_FIRST_REQUEST', reservedAt: now() }, null, 2) + '\n', 'utf8');
    } finally { await marker.close(); }
  } catch (error) {
    if (error?.code === 'EEXIST') throw Object.assign(new Error('RUN_CONSUMED'), { code: 'RUN_CONSUMED' });
    throw error;
  }

  const transport = createMappedOnlyTransport({
    canonicalUrls: envelope.preregistration.sourceMaps.map(page => ({ canonicalUrl: page.canonicalUrl, mapIds: [page.mapId] })),
    fetchImpl,
    maxActualGets: 10,
    now
  });
  const validator = new ExternalSourceValidator();
  const results = [];
  for (const page of envelope.preregistration.sourceMaps) {
    let result;
    try {
      result = await readPage(page, transport, validator, AbortSignal.timeout(10000));
    } catch {
      result = { status: 'FETCH_OR_PARSE_FAILED' };
    }
    results.push({
      mapId: page.mapId,
      canonicalUrl: page.canonicalUrl,
      status: result.status,
      ...(result.documentSha256 ? { documentSha256: result.documentSha256 } : {}),
      ...(result.validationCode ? { validationCode: result.validationCode } : {}),
      ...(result.selection ? {
        blockCount: result.selection.blockCount,
        excerptCount: result.selection.excerpts.length,
        truncated: result.selection.truncated,
        skippedCounts: result.selection.skipped,
        excerpts: result.selection.excerpts.map(excerpt => ({ ...excerpt, mapId: page.mapId, canonicalUrl: page.canonicalUrl,
          documentSha256: result.documentSha256 }))
      } : {})
    });
  }
  const snapshot = transport.snapshot();
  assert.ok(snapshot.actualGetCount <= 10, 'Actual mapped GET count exceeded the fixed bound');
  assert.ok(snapshot.events.every(event => event.mapIds.length > 0), 'Every request must belong to a selected source map');
  assert.equal(await readFileImpl(repoPath(V6_ARTIFACTS[0])).then(sha256), envelope.preregistration.v6PlanSha256,
    'PREREGISTRATION_MISMATCH');
  await checkV1V2History(envelope.preregistration.v6Integrity.v1v2Fingerprints);
  const after = await buildPreregis({ readFileImpl, checkHistory, readV1V2Fingerprints, readCodeFingerprints });
  assert.equal(canonicalJson(after), canonicalJson(envelope.preregistration), 'PREREGISTRATION_MISMATCH');
  const report = assertSafe({
    schemaVersion: 1,
    profileVersion: 'iras-public-rule-excerpts-v1',
    diagnosticOnly: true,
    interpretation: 'PRESENCE_ONLY_NOT_ENTAILMENT_OR_LIVE_ACCEPTANCE',
    maximumActualGets: 10,
    actualGetCount: snapshot.actualGetCount,
    cacheReuseCount: snapshot.cacheReuseCount,
    transportEvents: snapshot.events.map(event => ({ mapIds: event.mapIds, status: event.status,
      host: ALLOWED_REDIRECT_HOSTS.has(event.host) ? event.host : 'OTHER_HOST', contentHash: event.contentHash })),
    preregistrationSha256: envelope.preregistrationSha256,
    results
  });
  await checkHistory();
  await assertAbsent(reportPath);
  await writeExclusive(reportPath, report);
  return report;
}

function safeFailure(error) {
  const code = error?.code;
  return ['EEXIST', 'ENOENT', 'RUN_CONSUMED'].includes(code) ? code :
    String(error?.message || '').includes('PREREGISTRATION_MISMATCH') ? 'PREREGISTRATION_MISMATCH' : 'DIAGNOSTIC_RUN_FAILED';
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const modeArg = process.argv[2];
  const mode = modeArg === '--plan' ? 'plan' : modeArg === '--live-source' ? 'live-source' : undefined;
  try {
    const result = await runIrasPublicRuleExcerptDiagnostic({ mode });
    process.stdout.write(`${JSON.stringify({ status: 'OK', mode, resultPath: mode === 'plan' ? PLAN_FILENAME : REPORT_FILENAME })}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ status: 'FAILED', code: safeFailure(error) })}\n`);
    process.exitCode = 1;
  }
}
