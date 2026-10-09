import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, open, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { classifyQuestion } from '../../../src/classification/questionClassifier.ts';
import { ControlledWebRetriever } from '../../../src/retrieval/controlledWebRetriever.ts';
import { defaultAdvancedSourceRetriever } from '../../../src/retrieval/advancedSourceRetriever.ts';
import { SourceCache } from '../../../src/retrieval/sourceCache.ts';
import { ExternalSourceValidator } from '../../../src/retrieval/externalSourceValidator.ts';
import { IRAS_SOURCE_MAP_DEFINITIONS, getCoverageTopicsByIds } from '../../../src/standards/coverageRegistry.ts';
import { UNIFIED_SOURCE_REGISTRY } from '../../../src/standards/unifiedSourceModel.ts';
import { buildAuthorityWorkstreams } from '../../../src/services/authorityWorkstreams.ts';
import { buildGroundedReasoningContext } from '../../../src/services/groundingContextBuilder.ts';
import { renderIrasEvidenceResponse } from '../../../src/services/irasEvidencePolicy.ts';
import {
  getRequestedQuestionConcepts,
  reconcileQuestionUnderstanding,
  validateSemanticQuestionInterpretation
} from '../../../src/services/semanticQuestionUnderstanding.ts';
import { irasResolverCases } from '../../fixtures/irasResolverCases.mjs';
import { irasSourceStructureFeatureIdsV6, projectIrasSourceStructureFeaturesV6 } from './iras-source-structure-features-v6.mjs';
import { assertProtectedArtifactsUnchanged, createMappedOnlyTransport, fingerprintProtectedArtifacts } from './iras-mapped-source-diagnostic-v3.mjs';
import { assertPinnedHistoricalArtifactsUnchanged } from './iras-mapped-evidence-diagnostic-v8.mjs';
import { selectPublicExcerptUnits } from './iras-public-rule-excerpts-v1.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const OUTPUT_DIRECTORY = path.join(ROOT,
  'docs/evaluation/multi-authority-workstreams/iras-public-gst-selection-2026-10-03-v3');
export const PLAN_FILENAME = 'iras-public-gst-selection-plan-v3.json';
export const REPORT_FILENAME = 'iras-public-gst-selection-report-v3.json';
export const CONSUMED_FILENAME = 'iras-public-gst-selection-live-consumed-v3.json';
export const GST_MAP_ID = 'IRAS_GST_INPUT_TAX_SOURCE_MAP';
export const GST_TOPIC_ID = 'iras-gst-input-tax';
export const GST_CASE_ID = 'gst-input-tax-general-rule';
export const SELECTED_MAP_IDS = Object.freeze([GST_MAP_ID]);

const V1_DIRECTORY = 'docs/evaluation/multi-authority-workstreams/iras-public-excerpts-2026-10-03-v1';
const V2_DIRECTORY = 'docs/evaluation/multi-authority-workstreams/iras-public-excerpts-2026-10-03-v2';
const V6_LOCAL_DIRECTORY = 'docs/evaluation/multi-authority-workstreams/iras-first-local-2026-10-02-v6';
const V8_DIRECTORY = 'docs/evaluation/multi-authority-workstreams/iras-first-live-2026-10-02-v8';
const V1_ARTIFACT_PATHS = Object.freeze([
  'tests/evaluation/singapore/iras-public-rule-excerpts-v1.mjs',
  'tests/regression/test_iras_public_rule_excerpts_v1.mjs',
  `${V1_DIRECTORY}/iras-public-rule-excerpts-plan-v1.json`,
  `${V1_DIRECTORY}/iras-public-rule-excerpts-report-v1.json`,
  `${V1_DIRECTORY}/iras-public-rule-excerpts-live-consumed-v1.json`,
  `${V1_DIRECTORY}/supervisor-observations.md`
]);
const V2_ARTIFACT_PATHS = Object.freeze([
  'tests/evaluation/singapore/iras-public-rule-excerpts-v2.mjs',
  'tests/regression/test_iras_public_rule_excerpts_v2.mjs',
  `${V2_DIRECTORY}/iras-public-rule-excerpts-plan-v2.json`,
  `${V2_DIRECTORY}/iras-public-rule-excerpts-report-v2.json`,
  `${V2_DIRECTORY}/iras-public-rule-excerpts-live-consumed-v2.json`,
  `${V2_DIRECTORY}/supervisor-observations.md`
]);
const V8_ARTIFACT_PATHS = Object.freeze([
  'tests/evaluation/singapore/iras-mapped-evidence-diagnostic-v8.mjs',
  'tests/regression/test_iras_mapped_evidence_diagnostic_v8.mjs',
  `${V8_DIRECTORY}/iras-mapped-evidence-plan-v8.json`,
  `${V8_DIRECTORY}/iras-mapped-evidence-diagnostic-v8.json`,
  `${V8_DIRECTORY}/iras-mapped-evidence-live-v8-consumed.json`,
  `${V8_DIRECTORY}/supervisor-observations.md`
]);
const GST_CAPTURE_PATHS = Object.freeze([
  'tests/evaluation/singapore/iras-gst-opening-structure-probe-v1.mjs',
  `${V6_LOCAL_DIRECTORY}/iras-gst-opening-structure-probe-v1.json`,
  'tests/evaluation/singapore/iras-gst-public-opening-probe-v1.mjs'
]);
const HISTORY_PATHS = Object.freeze([...V1_ARTIFACT_PATHS, ...V2_ARTIFACT_PATHS, ...V8_ARTIFACT_PATHS,
  ...GST_CAPTURE_PATHS]);
const CODE_PATHS = Object.freeze([
  'tests/evaluation/singapore/iras-public-gst-selection-v3.mjs',
  'tests/regression/test_iras_public_gst_selection_v3.mjs',
  ...V1_ARTIFACT_PATHS.slice(0, 2),
  ...V2_ARTIFACT_PATHS.slice(0, 2),
  ...V8_ARTIFACT_PATHS.slice(0, 2),
  ...GST_CAPTURE_PATHS.slice(0, 2),
  'tests/evaluation/singapore/iras-mapped-source-diagnostic-v3.mjs',
  'tests/evaluation/singapore/iras-source-structure-features-v6.mjs',
  'tests/fixtures/irasResolverCases.mjs',
  'src/classification/questionClassifier.ts',
  'src/standards/coverageRegistry.ts',
  'src/standards/unifiedSourceModel.ts',
  'src/services/semanticQuestionUnderstanding.ts',
  'src/services/authorityWorkstreams.ts',
  'src/services/groundingContextBuilder.ts',
  'src/services/irasEvidencePolicy.ts',
  'src/retrieval/advancedSourceRetriever.ts',
  'src/retrieval/controlledWebRetriever.ts',
  'src/retrieval/sourceCache.ts',
  'src/retrieval/externalSourceValidator.ts',
  'src/verification/claimEvidenceVerifier.ts'
]);
const ALLOWED_REDIRECT_HOSTS = new Set(['www.iras.gov.sg', 'iras.gov.sg']);
const MAX_PAGE_CHARACTERS = 200_000;
const MAX_PAGE_BLOCKS = 10_000;
const MAX_EXCERPTS = 5;
const MAX_CHARACTERS_PER_EXCERPT = 3_000;
const MAX_CHARACTERS_PER_PAGE = 12_000;
const FETCH_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS_PER_URL = 1;
const MAX_ACTUAL_GETS = 2;
const OPENING_BLOCK_INDEX = 7;
const FORBIDDEN_REPORT_KEYS = new Set([
  'query', 'question', 'subject', 'facts', 'factsExplicitlyProvided', 'sourceText', 'html', 'response',
  'prompt', 'modelPayload', 'rawResponse', 'error', 'errorMessage', 'rawError', 'credentials', 'token',
  'password', 'apiKey'
]);
const ALLOWED_GAP_CODES = new Set([
  'NO_GOVERNING_AUTHORITY', 'EMPTY_ISSUE_PLAN', 'ISSUE_PLAN_HAS_UNMAPPED_RESIDUAL',
  'ISSUE_PLAN_COVERAGE_UNESTABLISHED', 'UNASSIGNED_QUERY_TOPIC', 'UNROUTED_MATERIAL_CONCEPT',
  'CANONICAL_AREA_UNRESOLVED', 'ISSUE_UNMAPPED', 'PROVIDER_UNAVAILABLE', 'PROVIDER_AUTHORITY_MISMATCH',
  'PROVIDER_ERROR', 'NO_CANDIDATE_EVIDENCE', 'CANDIDATE_REJECTED', 'NO_ADMITTED_EVIDENCE',
  'IRAS_SCOPE_NOT_COVERED', 'NO_VERIFIED_CLAIM', 'ISSUE_CONCEPT_UNCOVERED'
]);

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function normalizePublicText(value) {
  return String(value || '').normalize('NFC').replace(/\s+/g, ' ').trim();
}

function repositoryPath(relativePath) {
  const target = path.resolve(ROOT, ...relativePath.split(/[\\/]/));
  const relative = path.relative(ROOT, target);
  assert.ok(relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative),
    'Diagnostic input path must stay inside the repository');
  return target;
}

function outputPath(directory, filename) {
  const resolvedDirectory = path.resolve(directory);
  const relativeDirectory = path.relative(OUTPUT_DIRECTORY, resolvedDirectory);
  assert.ok(relativeDirectory === '' || (relativeDirectory !== '..' && !relativeDirectory.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relativeDirectory)), 'GST diagnostic outputs must stay inside the V3 output directory');
  return path.join(resolvedDirectory, filename);
}

function canonicalJson(value) {
  const sort = item => Array.isArray(item) ? item.map(sort) :
    item && typeof item === 'object' ? Object.fromEntries(Object.keys(item).sort().map(key => [key, sort(item[key])])) : item;
  return JSON.stringify(sort(value));
}

async function fingerprintPaths(paths, readFileImpl = readFile) {
  return Promise.all([...paths].sort().map(async relativePath => ({
    path: relativePath,
    sha256: sha256(await readFileImpl(repositoryPath(relativePath)))
  })));
}

function sourceMapDefinition() {
  const definition = IRAS_SOURCE_MAP_DEFINITIONS.find(item => item.id === GST_MAP_ID);
  const pointer = UNIFIED_SOURCE_REGISTRY[GST_MAP_ID];
  assert.ok(definition && pointer, 'The registered GST input-tax source map and pointer are required.');
  assert.equal(definition.domainId, 'IRAS_GST');
  return { definition, pointer };
}

async function publicGstSnapshot(readFileImpl = readFile) {
  const reportPath = repositoryPath(`${V1_DIRECTORY}/iras-public-rule-excerpts-report-v1.json`);
  const report = JSON.parse((await readFileImpl(reportPath)).toString('utf8'));
  const result = report.results.find(row => row.mapId === GST_MAP_ID);
  const excerpt = result?.excerpts?.find(row => row.blockIndex === OPENING_BLOCK_INDEX);
  assert.ok(result?.status === 'VALIDATED' && excerpt && !excerpt.truncated,
    'The exact reviewed public V1 GST opening block must be available.');
  const savedBlocks = excerpt.text.split(/\r?\n\s*\r?\n/).map(value => value.trim()).filter(Boolean);
  assert.equal(savedBlocks[0], '•', 'The captured block retains the leading standalone bullet.');
  const opening = savedBlocks.slice(1).join('\n\n');
  const openingSentences = opening.split(/(?<=[.!?])\s+/).filter(Boolean);
  assert.equal(openingSentences.length, 3, 'The public opening is the complete captured three-sentence passage.');
  const selectedUnits = result.excerpts.map(row => ({
    blockIndex: row.blockIndex,
    unitKind: row.unitKind,
    text: row.text,
    truncated: row.truncated
  }));
  assert.ok(selectedUnits.length > 0 && selectedUnits.length <= MAX_EXCERPTS);
  assert.ok(selectedUnits.every(row => !row.truncated && row.text.length <= MAX_CHARACTERS_PER_EXCERPT));
  assert.ok(selectedUnits.reduce((sum, row) => sum + row.text.length, 0) <= MAX_CHARACTERS_PER_PAGE);
  return {
    captureDocumentSha256: result.documentSha256,
    savedExcerpt: excerpt.text,
    opening,
    openingSentences
  };
}

function currentCaptureDate(now = () => new Date().toISOString()) {
  const instant = new Date(now());
  assert.ok(Number.isFinite(instant.getTime()), 'A valid capture timestamp is required.');
  return instant.toISOString().slice(0, 10);
}

async function historyFingerprints(readFileImpl = readFile) {
  return fingerprintPaths(HISTORY_PATHS, readFileImpl);
}

function frozenV8HistoryRows(v8Plan) {
  const groups = v8Plan?.preregistration?.historicalFingerprints;
  const requiredGroups = ['v1v2', 'pinnedV3AndBaseline', 'additionalImmutableHistory'];
  for (const group of requiredGroups) {
    assert.ok(Array.isArray(groups?.[group]), `Frozen V8 ${group} history fingerprints are required.`);
  }
  const byPath = new Map();
  for (const row of requiredGroups.flatMap(group => groups[group])) {
    assert.ok(typeof row?.path === 'string' && /^[a-f0-9]{64}$/.test(row.sha256 || ''),
      'Frozen V8 history rows must contain repository-relative paths and SHA-256 fingerprints.');
    repositoryPath(row.path);
    const existing = byPath.get(row.path);
    assert.ok(!existing || existing === row.sha256, `Conflicting frozen V8 fingerprints: ${row.path}`);
    byPath.set(row.path, row.sha256);
  }
  return [...byPath].sort(([left], [right]) => left.localeCompare(right))
    .map(([artifactPath, hash]) => ({ path: artifactPath, sha256: hash }));
}

async function verifyFrozenV8History(v8Plan, readFileImpl = readFile) {
  const rows = frozenV8HistoryRows(v8Plan);
  for (const row of rows) {
    const actual = sha256(await readFileImpl(repositoryPath(row.path)));
    if (actual !== row.sha256) {
      throw Object.assign(new Error(`Frozen V8 history changed: ${row.path}`), { code: 'HISTORICAL_INTEGRITY_FAILURE' });
    }
  }
  return rows;
}

async function readAndVerifyV8History(readFileImpl = readFile) {
  const planBytes = await readFileImpl(repositoryPath(`${V8_DIRECTORY}/iras-mapped-evidence-plan-v8.json`));
  const v8Plan = JSON.parse(planBytes.toString('utf8'));
  const rows = await verifyFrozenV8History(v8Plan, readFileImpl);
  return { planBytes, v8Plan, rows };
}

async function mergeHistoryFingerprints(...groups) {
  const byPath = new Map();
  for (const row of groups.flat()) {
    const existing = byPath.get(row.path);
    assert.ok(!existing || existing === row.sha256, `Conflicting historical fingerprints: ${row.path}`);
    byPath.set(row.path, row.sha256);
  }
  return [...byPath].sort(([left], [right]) => left.localeCompare(right))
    .map(([artifactPath, hash]) => ({ path: artifactPath, sha256: hash }));
}

function sourcePageFromV8Plan(v8Plan) {
  const matched = v8Plan?.preregistration?.sourceMaps?.filter(row => row.mapIds?.includes(GST_MAP_ID)) || [];
  assert.equal(matched.length, 1, 'Frozen V8 history must contain the GST input-tax map exactly once.');
  const { definition } = sourceMapDefinition();
  assert.equal(matched[0].canonicalUrl, definition.canonicalSourceUrl,
    'Registered GST map URL must match its frozen V8 canonical URL.');
  const url = new URL(matched[0].canonicalUrl);
  assert.equal(url.protocol, 'https:');
  assert.ok(ALLOWED_REDIRECT_HOSTS.has(url.hostname.toLowerCase()));
  assert.equal(url.username, '');
  assert.equal(url.password, '');
  assert.equal(url.search, '');
  assert.equal(url.hash, '');
  return {
    mapId: GST_MAP_ID,
    canonicalUrl: url.toString(),
    host: url.hostname.toLowerCase(),
    topicIds: [...definition.topicIds].sort()
  };
}

async function buildPreregistration({ readFileImpl = readFile,
  checkV8History = assertPinnedHistoricalArtifactsUnchanged,
  readProtectedFingerprints = fingerprintProtectedArtifacts,
  readHistoryFingerprints = historyFingerprints,
  readCodeFingerprints = paths => fingerprintPaths(paths, readFileImpl),
  now = () => new Date().toISOString() } = {}) {
  await checkV8History();
  const v8Before = await readAndVerifyV8History(readFileImpl);
  const v8PlanBytes = v8Before.planBytes;
  const v8Plan = v8Before.v8Plan;
  const reference = await publicGstSnapshot(readFileImpl);
  const { definition } = sourceMapDefinition();
  const sourcePage = sourcePageFromV8Plan(v8Plan);
  assert.equal(sourcePage.canonicalUrl, definition.canonicalSourceUrl);
  const pages = [sourcePage];
  assert.equal(pages.length, 1);
  const histories = await mergeHistoryFingerprints(await readHistoryFingerprints(), v8Before.rows);
  const v8PipelineCodePaths = (v8Plan.preregistration.sourceFingerprints || []).map(item => item.path);
  const completeCodePaths = [...new Set([...v8PipelineCodePaths, ...CODE_PATHS])].sort();
  const v8After = await readAndVerifyV8History(readFileImpl);
  assert.equal(sha256(v8After.planBytes), sha256(v8PlanBytes), 'The frozen V8 plan changed during preregistration.');
  assert.deepEqual(v8After.rows, v8Before.rows, 'Frozen V8 history changed during preregistration.');
  await checkV8History();
  return {
    schemaVersion: 1,
    profileVersion: 'iras-public-gst-selection-v3',
    referenceDate: currentCaptureDate(now),
    sourceMaps: pages,
    publicReference: {
      captureReportPath: `${V1_DIRECTORY}/iras-public-rule-excerpts-report-v1.json`,
      mapId: GST_MAP_ID,
      blockIndex: OPENING_BLOCK_INDEX,
      documentSha256: reference.captureDocumentSha256,
      savedBlockNormalizedSha256: sha256(normalizePublicText(reference.savedExcerpt)),
      openingSentenceCount: reference.openingSentences.length,
      openingNormalizedSha256: sha256(normalizePublicText(reference.opening))
    },
    constraints: {
      interpretation: 'PUBLIC_SOURCE_STRUCTURE_AND_PRESENCE_ONLY_NOT_ENTAILMENT',
      canonicalPageCount: 1,
      maxPageCharacters: MAX_PAGE_CHARACTERS,
      maxPageBlocks: MAX_PAGE_BLOCKS,
      maxExcerptsPerPage: MAX_EXCERPTS,
      maxCharactersPerExcerpt: MAX_CHARACTERS_PER_EXCERPT,
      maxCharactersPerPage: MAX_CHARACTERS_PER_PAGE,
      timeoutMs: FETCH_TIMEOUT_MS,
      allowedRedirectsPerUrl: MAX_REDIRECTS_PER_URL,
      maximumActualGets: MAX_ACTUAL_GETS,
      retries: 0,
      redirectPolicy: 'ONE_SAME_PATH_IRAS_PEER_HOST_REDIRECT',
      transportCache: 'SHARED_V3_MAPPED_ONLY_TRANSPORT_ACROSS_CAPTURE_CONTEXT_AND_RENDERER',
      otherMappedPages: 'CLOSED_SYNTHETIC_503_NO_NETWORK'
    },
    v8PlanSha256: sha256(v8PlanBytes),
    v8PinnedHistory: await checkV8History(),
    protectedArtifacts: await readProtectedFingerprints(),
    historicalArtifacts: histories,
    codeFingerprints: await readCodeFingerprints(completeCodePaths),
    structureProjection: {
      schema: 'IRAS_SOURCE_STRUCTURE_FEATURES_V6',
      interpretation: 'PRESENCE_ONLY_NOT_ENTAILMENT',
      featureIds: [...irasSourceStructureFeatureIdsV6]
    }
  };
}

function planHash(value) {
  return sha256(canonicalJson(value));
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

/** Reuses the GST-specific complete-unit selector with the reviewed V1/V2 page, block, and unit bounds. */
export function selectGstPublicUnits(substantiveText) {
  const result = selectPublicExcerptUnits(GST_MAP_ID, substantiveText);
  assert.ok(result.excerpts.length <= MAX_EXCERPTS, 'GST excerpts exceed the fixed per-page count bound.');
  assert.ok(result.excerpts.every(row => !row.truncated && row.text.length <= MAX_CHARACTERS_PER_EXCERPT),
    'GST excerpts must remain complete bounded source units.');
  assert.ok(result.excerpts.reduce((sum, row) => sum + row.text.length, 0) <= MAX_CHARACTERS_PER_PAGE,
    'GST excerpts exceed the fixed aggregate character bound.');
  const normalizedSource = normalizePublicText(substantiveText);
  assert.ok(result.excerpts.every(row => normalizedSource.includes(normalizePublicText(row.text))),
    'Every complete cleaned GST unit must be a member of the bounded source text.');
  return result;
}

function gstInterpretation(testCase) {
  const issue = testCase.issues[0];
  const interpretation = {
    schemaVersion: 2,
    jurisdiction: ['Singapore'],
    authorityCandidates: ['IRAS'],
    contextualAuthorities: [],
    domain: issue.domain,
    population: issue.population,
    primarySubject: issue.subject,
    concepts: [{ concept: issue.subject, role: 'PRIMARY' }],
    requestedOperation: issue.operation,
    factsExplicitlyProvided: [],
    confidence: 0.96,
    issues: [{
      subject: issue.subject,
      population: issue.population,
      domain: issue.domain,
      governingAuthorities: ['IRAS'],
      contextualAuthorities: [],
      operation: issue.operation,
      mappedTopicIds: [],
      evidenceRequirement: 'AUTHORITATIVE_SOURCE',
      confidence: 0.96
    }]
  };
  assert.ok(validateSemanticQuestionInterpretation(interpretation, testCase.query));
  return interpretation;
}

function safeProvenance(record) {
  return ['LOCAL_STATIC', 'LIVE_EXTERNAL', 'LIVE_PATCH'].includes(record?.provenance) ? record.provenance : 'OTHER';
}

function mapForRecord(record) {
  const url = record?.canonicalSourceUrl || record?.officialSourceUrl;
  return IRAS_SOURCE_MAP_DEFINITIONS.find(definition => definition.canonicalSourceUrl === url)?.id || 'UNMAPPED_RECORD';
}

function sourceBlockShape(text) {
  const trimmed = text.trim();
  if (!trimmed) return 'EMPTY';
  if ((trimmed.startsWith('|') || trimmed.endsWith('|')) && (trimmed.match(/\|/g) || []).length >= 2) return 'PIPE_TABLE_ROW';
  if (/^(?:[•◦▪‣*-]\s+|\(?\d{1,3}\)?[.)]\s+)/.test(trimmed)) return 'MARKED_LIST_ITEM';
  if (trimmed.endsWith(':')) return 'COLON_HEADING';
  if (/^(?:conditions?|requirements?|input tax claims?)\b/i.test(trimmed) && !/[.!?]$/.test(trimmed)) return 'HEADING';
  return 'PARAGRAPH';
}

function safeBlockShapes(sourceText, openingNormalized) {
  const inspected = String(sourceText || '').slice(0, MAX_PAGE_CHARACTERS);
  const blocks = inspected.split(/\r?\n[\t ]*\r?\n+/).map(value => value.trim()).filter(Boolean).slice(0, MAX_PAGE_BLOCKS);
  const shapes = blocks.slice(0, 32).map(sourceBlockShape);
  const shapeCounts = Object.fromEntries(['PARAGRAPH', 'HEADING', 'COLON_HEADING', 'MARKED_LIST_ITEM', 'PIPE_TABLE_ROW', 'EMPTY']
    .map(shape => [shape, shapes.filter(value => value === shape).length]));
  const openingBlocks = blocks.map((text, blockIndex) => ({ text, blockIndex, shape: sourceBlockShape(text) }))
    .filter(block => normalizePublicText(block.text).includes(openingNormalized))
    .slice(0, 8)
    .map(block => ({ blockIndex: block.blockIndex, shape: block.shape,
      openingSentenceCount: (block.text.match(/[.!?](?:\s|$)/g) || []).length }));
  return { blockCount: blocks.length, reportedBlockCount: shapes.length, blockShapes: shapes, shapeCounts, openingBlocks };
}

function recordPresence(record, index, opening, savedExcerpt) {
  const sourceText = record.sourceText || '';
  const normalized = normalizePublicText(sourceText);
  const openingNormalized = normalizePublicText(opening);
  const savedExcerptNormalized = normalizePublicText(savedExcerpt);
  return {
    recordIndex: index,
    sourceMapId: mapForRecord(record),
    provenance: safeProvenance(record),
    normalizedTextSha256: sha256(normalized),
    normalizedTextLength: normalized.length,
    exactSavedBlockMatchPresent: normalized.includes(savedExcerptNormalized),
    exactThreeSentenceOpeningMatchPresent: normalized.includes(openingNormalized),
    openingSentencePresenceCount: opening.split(/(?<=[.!?])\s+/).filter(sentence => normalized.includes(normalizePublicText(sentence))).length,
    structureFeatures: projectIrasSourceStructureFeaturesV6(sourceText, 'RENDER_CONTEXT_SOURCE_TEXT'),
    retainedRecordBlockShapes: safeBlockShapes(sourceText, openingNormalized)
  };
}

function claimPresence(claim, index, sourceRecords, opening, savedExcerpt) {
  const quote = String(claim?.quote || '');
  const normalized = normalizePublicText(quote);
  const openingNormalized = normalizePublicText(opening);
  const savedExcerptNormalized = normalizePublicText(savedExcerpt);
  const source = sourceRecords.find(record => record.id === claim.recordId);
  return {
    claimIndex: index,
    sourceMapId: source ? mapForRecord(source) : 'UNMAPPED_RECORD',
    normalizedQuoteSha256: sha256(normalized),
    normalizedQuoteLength: normalized.length,
    exactSavedBlockMatchPresent: normalized.includes(savedExcerptNormalized),
    exactThreeSentenceOpeningMatchPresent: normalized.includes(openingNormalized),
    openingSentencePresenceCount: opening.split(/(?<=[.!?])\s+/).filter(sentence => normalized.includes(normalizePublicText(sentence))).length,
    structureFeatures: projectIrasSourceStructureFeaturesV6(quote, 'SELECTED_CLAIM_QUOTE')
  };
}

function assertSafeReport(report) {
  const visit = (value, location = '$') => {
    if (Array.isArray(value)) return value.forEach((item, index) => visit(item, `${location}[${index}]`));
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      assert.ok(!FORBIDDEN_REPORT_KEYS.has(key), `Unsafe diagnostic key at ${location}.${key}`);
      visit(child, `${location}.${key}`);
    }
  };
  visit(report);
  return report;
}

function sourceExpectation(page) {
  const { definition, pointer } = sourceMapDefinition();
  const topic = getCoverageTopicsByIds(page.topicIds).find(item => item.domainId === definition.domainId);
  assert.ok(topic, 'GST input-tax coverage topic is registered.');
  return {
    standardIdentifiers: [pointer.standardOrActCode, pointer.documentTitle].filter(Boolean),
    expectedTitles: [pointer.documentTitle],
    topicTerms: [...new Set([topic.title, ...(topic.aliases || []), ...topic.keywords,
      ...(topic.requiredContentTerms || []), ...(topic.paragraphHints || []), ...(topic.sectionHints || [])])],
    allowIrasTopicTokenEquivalence: true
  };
}

async function readSelectedPage(page, transport, validator) {
  let response = await transport.fetch(page.canonicalUrl, { method: 'GET', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  let redirects = 0;
  while (response.status >= 300 && response.status < 400) {
    if (redirects >= MAX_REDIRECTS_PER_URL) return { status: 'REDIRECT_LIMIT_REACHED' };
    const location = response.headers.get('location');
    if (!location) return { status: 'REDIRECT_WITHOUT_LOCATION' };
    let target;
    try { target = new URL(location, page.canonicalUrl); } catch { return { status: 'REDIRECT_URL_INVALID' }; }
    const source = new URL(page.canonicalUrl);
    if (!ALLOWED_REDIRECT_HOSTS.has(target.hostname.toLowerCase()) || target.pathname !== source.pathname ||
      target.search || target.hash || target.username || target.password || target.protocol !== 'https:') {
      return { status: 'REDIRECT_REJECTED' };
    }
    response = await transport.fetch(target.toString(), { method: 'GET', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    redirects += 1;
  }
  if (!response.ok) return { status: 'HTTP_ERROR' };
  if (!/^text\/html(?:\s*;|$)/i.test(response.headers.get('content-type') || '')) return { status: 'CONTENT_TYPE_REJECTED' };
  const html = await response.text();
  if (html.length > MAX_PAGE_CHARACTERS) return { status: 'PAGE_CHARACTER_LIMIT' };
  const documentSha256 = sha256(html);
  const validation = validator.validateTopicContent(html, sourceExpectation(page));
  if (!validation.isValid || typeof validation.substantiveText !== 'string') {
    return { status: 'SOURCE_VALIDATION_REJECTED', documentSha256 };
  }
  if (validation.substantiveText.length > MAX_PAGE_CHARACTERS) return { status: 'PAGE_CHARACTER_LIMIT', documentSha256 };
  const selection = selectGstPublicUnits(validation.substantiveText);
  return { status: 'VALIDATED', documentSha256, visibleText: validation.substantiveText, selection };
}

async function readCurrentPreregistration(planPath, options) {
  const planBytes = await options.readFileImpl(planPath);
  const envelope = JSON.parse(planBytes.toString('utf8'));
  if (!envelope?.preregistration || envelope.preregistrationSha256 !== planHash(envelope.preregistration)) {
    throw Object.assign(new Error('Preregistration mismatch'), { code: 'PREREGISTRATION_MISMATCH' });
  }
  const current = await buildPreregistration(options);
  if (canonicalJson(current) !== canonicalJson(envelope.preregistration)) {
    throw Object.assign(new Error('Current sources no longer match preregistration'), { code: 'PREREGISTRATION_MISMATCH' });
  }
  return { envelope, planBytes, current };
}

async function reserveConsumedMarker(markerPath, marker) {
  try { await writeExclusive(markerPath, marker); }
  catch (error) {
    if (error?.code === 'EEXIST') throw Object.assign(new Error('Run already consumed'), { code: 'RUN_CONSUMED' });
    throw error;
  }
}

function safeTransportEvents(snapshot) {
  return snapshot.events.map(event => ({
    mapIds: event.mapIds.filter(mapId => SELECTED_MAP_IDS.includes(mapId)),
    status: typeof event.status === 'string' && /^(?:HTTP_\d{3}|REDIRECT_\d{3}|REDIRECT_REJECTED|TRANSPORT_ERROR|AUTOMATIC_REDIRECT_REJECTED)$/.test(event.status)
      ? event.status : 'OTHER_STATUS',
    host: ALLOWED_REDIRECT_HOSTS.has(event.host) ? event.host : 'OTHER_HOST',
    contentHash: /^[a-f0-9]{64}$/.test(event.contentHash || '') ? event.contentHash : null
  }));
}

function recordFinalPipeline({ contract, page, selectedPage, context, rendered, workstreams }) {
  const issue = contract.issue;
  const finalIssue = workstreams.workstreams.flatMap(row => row.issues).find(row => row.issueId === issue.id);
  assert.ok(finalIssue, 'The frozen GST issue must remain in the final workstream.');
  const eligibleRecords = context.evidenceQuality?.eligibleRecords || [];
  const accepted = rendered.claimVerification?.accepted || [];
  const finalClaims = finalIssue.verifiedClaims || [];
  const sourceRecords = [...new Map([...eligibleRecords, ...(finalIssue.sources || [])].map(record => [record.id, record])).values()];
  const reference = selectedPage;
  const opening = reference.opening;
  const savedExcerpt = reference.savedExcerpt;
  const visibleNormalized = normalizePublicText(page.visibleText);
  const openingNormalized = normalizePublicText(opening);
  const savedNormalized = normalizePublicText(savedExcerpt);
  const safeLifecycle = Object.fromEntries(['requested', 'mapped', 'retrievalAttempted', 'evidenceFound', 'admitted', 'verified', 'covered']
    .map(stage => [stage, finalIssue.lifecycle?.[stage] === true]));
  return {
    pipeline: {
      status: 'COMPLETED',
      contextEligibleRecordCount: eligibleRecords.length,
      contextUncoveredConceptCount: context.evidenceQuality?.uncoveredConcepts?.length ?? null,
      eligibleRetainedSourcePresence: eligibleRecords.map((record, index) =>
        recordPresence(record, index, opening, savedExcerpt)),
      renderedAcceptedClaimCount: accepted.length,
      renderedRejectedClaimCount: rendered.claimVerification?.rejected?.length || 0,
      renderedSelectedQuotePresence: accepted.map((claim, index) => claimPresence(claim, index, sourceRecords, opening, savedExcerpt)),
      finalVerifiedClaimCount: finalClaims.length,
      finalClaimPresence: finalClaims.map((claim, index) => claimPresence(claim, index, sourceRecords, opening, savedExcerpt)),
      finalEvidenceStatus: ['VERIFIED', 'INSUFFICIENT'].includes(finalIssue.evidenceStatus) ? finalIssue.evidenceStatus : 'OTHER_STATUS',
      finalApplicationStatus: ['UNRESOLVED', 'NOT_REQUIRED'].includes(finalIssue.applicationStatus) ? finalIssue.applicationStatus : 'OTHER_STATUS',
      finalLifecycle: safeLifecycle,
      finalGapCodes: (finalIssue.gaps || []).map(gap => ALLOWED_GAP_CODES.has(gap.code) ? gap.code : 'OTHER_GAP')
    },
    page: {
      mapId: GST_MAP_ID,
      canonicalUrl: IRAS_SOURCE_MAP_DEFINITIONS.find(item => item.id === GST_MAP_ID).canonicalSourceUrl,
      status: page.status,
      documentSha256: page.documentSha256,
      visibleTextLength: page.visibleText.length,
      normalizedVisibleTextSha256: sha256(visibleNormalized),
      exactSavedBlockMatchPresentInFullVisibleText: visibleNormalized.includes(savedNormalized),
      exactThreeSentenceOpeningMatchPresentInFullVisibleText: visibleNormalized.includes(openingNormalized),
      sourceStructureFeatures: projectIrasSourceStructureFeaturesV6(page.visibleText, 'DIRECT_PROBE_SOURCE_TEXT'),
      selectedUnits: page.selection.excerpts.map((excerpt, index) => {
        const normalized = normalizePublicText(excerpt.text);
        assert.ok(excerpt.text.length <= MAX_CHARACTERS_PER_EXCERPT && !excerpt.truncated,
          'Persisted GST public units must remain complete and bounded.');
        return {
          excerptIndex: index,
          blockIndex: excerpt.blockIndex,
          unitKind: excerpt.unitKind,
          characterCount: excerpt.text.length,
          sourceDocumentSha256: page.documentSha256,
          normalizedTextSha256: sha256(normalized),
          cleanPublicUnitText: excerpt.text,
          exactSavedBlockMatchPresent: normalized.includes(savedNormalized),
          exactThreeSentenceOpeningMatchPresent: normalized.includes(openingNormalized),
          sourceStructureFeatures: projectIrasSourceStructureFeaturesV6(excerpt.text, 'DIRECT_PROBE_SOURCE_TEXT')
        };
      })
    }
  };
}

export async function runIrasPublicGstSelectionV3({ mode, outputDirectory = OUTPUT_DIRECTORY,
  fetchImpl = globalThis.fetch, readFileImpl = readFile,
  checkV8History = assertPinnedHistoricalArtifactsUnchanged,
  checkProtectedArtifacts = assertProtectedArtifactsUnchanged,
  readProtectedFingerprints = fingerprintProtectedArtifacts,
  readHistoryFingerprints = () => historyFingerprints(readFileImpl),
  readCodeFingerprints = paths => fingerprintPaths(paths, readFileImpl),
  now = () => new Date().toISOString() } = {}) {
  assert.ok(mode === 'plan' || mode === 'live-source', 'Mode must be plan or live-source.');
  const options = { readFileImpl, checkV8History, readProtectedFingerprints, readHistoryFingerprints, readCodeFingerprints, now };
  const planPath = outputPath(outputDirectory, PLAN_FILENAME);
  const reportPath = outputPath(outputDirectory, REPORT_FILENAME);
  const markerPath = outputPath(outputDirectory, CONSUMED_FILENAME);
  if (mode === 'plan') {
    await assertAbsent(planPath);
    const preregistration = await buildPreregistration(options);
    const envelope = { preregistration, preregistrationSha256: planHash(preregistration) };
    await writeExclusive(planPath, envelope);
    const afterWrite = await readAndVerifyV8History(readFileImpl);
    const pinnedPaths = new Set(afterWrite.rows.map(row => row.path));
    assert.deepEqual(afterWrite.rows, preregistration.historicalArtifacts.filter(row => pinnedPaths.has(row.path)),
    'Frozen V8 history changed while writing the plan.');
    return envelope;
  }

  await checkV8History();
  await readAndVerifyV8History(readFileImpl);
  const protectedBefore = await readProtectedFingerprints();
  await checkProtectedArtifacts(protectedBefore);
  const { envelope, planBytes, current } = await readCurrentPreregistration(planPath, options);
  await assertAbsent(reportPath);
  try {
    await stat(markerPath);
    throw Object.assign(new Error('Run already consumed'), { code: 'RUN_CONSUMED' });
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  await mkdir(outputDirectory, { recursive: true });
  await reserveConsumedMarker(markerPath, {
    schemaVersion: 1,
    profileVersion: 'iras-public-gst-selection-v3',
    preregistrationSha256: envelope.preregistrationSha256,
    preregistrationFileSha256: sha256(planBytes),
    reservedAt: now(),
    status: 'CONSUMED_BEFORE_FIRST_REQUEST'
  });

  await readAndVerifyV8History(readFileImpl);
  const reference = await publicGstSnapshot(readFileImpl);
  const testCase = irasResolverCases.find(row => row.id === GST_CASE_ID);
  assert.ok(testCase && testCase.issues.length === 1, 'The frozen general GST request remains single-issue.');
  const interpretation = gstInterpretation(testCase);
  const questionUnderstanding = { mode: 'SEMANTIC_INTERPRETATION', interpretation };
  const classification = classifyQuestion(testCase.query);
  const reconciled = reconcileQuestionUnderstanding(testCase.query, classification, questionUnderstanding);
  assert.equal(reconciled.issuePlan.source, 'SEMANTIC_ISSUES');
  const issue = reconciled.issuePlan.issues.find(row => row.subject === testCase.issues[0].subject);
  assert.ok(issue);
  const topicIds = [...new Set([...(issue.mappedTopicIds || []), GST_TOPIC_ID, ...(testCase.requiredTopicIds || [])])];
  const topics = getCoverageTopicsByIds(topicIds);
  assert.ok(topics.some(topic => topic.id === GST_TOPIC_ID && topic.domainId === 'IRAS_GST'));
  const requestedConcepts = getRequestedQuestionConcepts(testCase.query, questionUnderstanding)
    .filter(concept => !concept.topicIds.length || concept.topicIds.some(topicId => topicIds.includes(topicId)));
  const plannedIssue = reconciled.issuePlan.issues.find(row => row.id === issue.id);
  const evidenceScope = {
    authority: 'IRAS',
    domain: 'IRAS_GST',
    topicIds,
    requestedConcepts,
    context: {
      domainId: 'IRAS_GST',
      population: issue.population,
      primarySubject: issue.subject,
      concepts: [issue.subject],
      requestedOperation: issue.operation
    }
  };
  const page = current.sourceMaps[0];
  const sourceCache = new SourceCache();
  const webRetriever = new ControlledWebRetriever(undefined, sourceCache);
  const validator = new ExternalSourceValidator();
  const canonicalMapByUrl = new Map(IRAS_SOURCE_MAP_DEFINITIONS.map(definition => [definition.canonicalSourceUrl, definition]));
  const closedMappedCalls = {};
  let unexpectedSyntheticCalls = 0;
  let syntheticRouterCalls = 0;
  const discoveryCounts = { discovery: 0, search: 0 };
  const adapters = {
    discoveryAdapter: { async discoverOfficialSourceCandidates() { discoveryCounts.discovery += 1; return []; }, getLastFetchTrace() { return []; } },
    officialDomainSearchAdapter: { async searchOfficialDomainCandidates() { discoveryCounts.search += 1; return []; }, getLastSearchTrace() { return []; } }
  };
  const transport = createMappedOnlyTransport({
    canonicalUrls: [{ canonicalUrl: page.canonicalUrl, mapIds: [GST_MAP_ID] }],
    fetchImpl,
    maxActualGets: MAX_ACTUAL_GETS,
    now
  });
  const canonicalize = value => {
    try {
      const url = new URL(String(value));
      if (url.hostname.toLowerCase() === 'iras.gov.sg') url.hostname = 'www.iras.gov.sg';
      return url.toString();
    } catch { return ''; }
  };
  const controlledFetch = async (urlValue, init = {}) => {
    syntheticRouterCalls += 1;
    const canonicalUrl = canonicalize(urlValue);
    if (canonicalUrl === page.canonicalUrl) return transport.fetch(urlValue, init);
    const mapped = canonicalMapByUrl.get(canonicalUrl);
    if (mapped) {
      closedMappedCalls[mapped.id] = (closedMappedCalls[mapped.id] || 0) + 1;
      return new Response(null, { status: 503 });
    }
    unexpectedSyntheticCalls += 1;
    return new Response(null, { status: 503 });
  };

  const pageRead = await readSelectedPage(page, transport, validator);
  await readAndVerifyV8History(readFileImpl);
  if (pageRead.status !== 'VALIDATED') throw Object.assign(new Error('Selected GST map was not validated.'), { code: pageRead.status });
  const context = await buildGroundedReasoningContext(testCase.query, null, defaultAdvancedSourceRetriever, undefined, {
    webRetriever,
    fetchOptions: { timeoutMs: FETCH_TIMEOUT_MS, useCache: false, customFetch: controlledFetch },
    ...adapters,
    authorityLevelDiscovery: false,
    localOnly: false,
    referenceDate: current.referenceDate,
    questionUnderstanding,
    evidenceScope
  });
  const rendered = renderIrasEvidenceResponse({}, context, testCase.query, null, 'SFRS_I', 'LOCAL');
  const workstreams = await buildAuthorityWorkstreams(testCase.query, reconciled.issuePlan, {
    retriever: defaultAdvancedSourceRetriever,
    questionUnderstanding,
    referenceDate: current.referenceDate,
    groundingOptions: {
      webRetriever,
      fetchOptions: { timeoutMs: FETCH_TIMEOUT_MS, useCache: false, customFetch: controlledFetch },
      ...adapters,
      authorityLevelDiscovery: false,
      localOnly: false,
      referenceDate: current.referenceDate
    }
  });
  assert.ok(plannedIssue);
  const selectedPage = { ...reference };
  const pipelineProjection = recordFinalPipeline({ contract: { issue }, page: pageRead,
    selectedPage, context, rendered, workstreams });
  const snapshot = transport.snapshot();
  assert.ok(snapshot.actualGetCount <= MAX_ACTUAL_GETS, 'The bounded GST transport exceeded its total request cap.');
  assert.equal(snapshot.events.every(event => event.mapIds.length === 1 && event.mapIds[0] === GST_MAP_ID), true,
    'Only the preregistered GST input-tax map may enter the mapped-only transport.');
  assert.equal(snapshot.actualGetCount, snapshot.events.length);

  await checkV8History();
  await readAndVerifyV8History(readFileImpl);
  await checkProtectedArtifacts(protectedBefore);
  const after = await buildPreregistration(options);
  if (canonicalJson(after) !== canonicalJson(envelope.preregistration) || !(await readFileImpl(planPath)).equals(planBytes)) {
    throw Object.assign(new Error('Sources changed during diagnostic.'), { code: 'PREREGISTRATION_MISMATCH' });
  }
  const report = assertSafeReport({
    schemaVersion: 1,
    profileVersion: 'iras-public-gst-selection-v3',
    diagnosticOnly: true,
    interpretation: 'PRESENCE_ONLY_NOT_ENTAILMENT_OR_ACCEPTANCE',
    referenceDate: current.referenceDate,
    maximumActualGets: MAX_ACTUAL_GETS,
    mappedTransportRequestCount: snapshot.actualGetCount,
    cacheReuseCount: snapshot.cacheReuseCount,
    policyRejectionCount: snapshot.policyRejectionCount,
    transportEvents: safeTransportEvents(snapshot),
    closedMappedSynthetic503Counts: Object.fromEntries(Object.entries(closedMappedCalls).sort(([a], [b]) => a.localeCompare(b))),
    unexpectedSyntheticCallCount: unexpectedSyntheticCalls,
    syntheticRouterCallCount: syntheticRouterCalls,
    modelRequests: 0,
    discoveryRequests: discoveryCounts.discovery,
    searchRequests: discoveryCounts.search,
    preregistrationSha256: envelope.preregistrationSha256,
    ...pipelineProjection
  });
  await assertAbsent(reportPath);
  await writeExclusive(reportPath, report);
  await readAndVerifyV8History(readFileImpl);
  return report;
}

export function safeFailure(error) {
  if (['EEXIST', 'ENOENT', 'RUN_CONSUMED', 'PREREGISTRATION_MISMATCH', 'HISTORICAL_INTEGRITY_FAILURE'].includes(error?.code)) return error.code;
  if (error?.code === 'PAGE_CHARACTER_LIMIT' || error?.code === 'SOURCE_VALIDATION_REJECTED' ||
    error?.code === 'HTTP_ERROR' || error?.code === 'CONTENT_TYPE_REJECTED') return error.code;
  return 'DIAGNOSTIC_RUN_FAILED';
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const modeArg = process.argv[2];
  const mode = modeArg === '--plan' ? 'plan' : modeArg === '--live-source' ? 'live-source' : undefined;
  try {
    await runIrasPublicGstSelectionV3({ mode });
    process.stdout.write(`${JSON.stringify({ status: 'OK', mode,
      resultPath: mode === 'plan' ? PLAN_FILENAME : REPORT_FILENAME, diagnosticOnly: mode === 'live-source' })}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ status: 'FAILED', code: safeFailure(error) })}\n`);
    process.exitCode = 1;
  }
}
