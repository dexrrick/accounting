import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { irasResolverCases } from '../../fixtures/irasResolverCases.mjs';
import { getCoverageTopicById } from '../../../src/standards/coverageRegistry.ts';
import { selectRelevantFetchedText } from '../../../src/services/groundingContextBuilder.ts';

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const V1_REPORT_PATH = path.join(REPOSITORY_ROOT,
  'docs/evaluation/multi-authority-workstreams/iras-public-excerpts-2026-10-03-v1/iras-public-rule-excerpts-report-v1.json');
const V4_REPORT_PATH = path.join(REPOSITORY_ROOT,
  'docs/evaluation/multi-authority-workstreams/iras-public-gst-selection-2026-10-03-v4/iras-public-gst-selection-report-v4.json');
const OUTPUT_PATH = path.join(REPOSITORY_ROOT,
  'docs/evaluation/multi-authority-workstreams/iras-first-local-2026-10-02-v6/iras-gst-opening-retention-probe-v1.json');
const MAP_ID = 'IRAS_GST_INPUT_TAX_SOURCE_MAP';
const TOPIC_ID = 'iras-gst-input-tax';
const MAX_RETAINED_CHARACTERS = 5000;
const SAVED_BLOCK_INDEX = 7;

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function normalizePublicText(value) {
  return String(value || '').normalize('NFC').replace(/\s+/g, ' ').trim();
}

function topicTerms(topic) {
  return [...new Set([
    topic.title,
    ...(topic.aliases || []),
    ...(topic.keywords || []),
    ...(topic.requiredContentTerms || []),
    ...(topic.paragraphHints || []),
    ...(topic.sectionHints || [])
  ].filter(value => typeof value === 'string' && value.trim().length > 2))];
}

function sentencePresent(text, sentence) {
  return normalizePublicText(text).includes(normalizePublicText(sentence));
}

function syntheticCompetitiveParagraph(term, targetCharacters) {
  const prefix = `Synthetic lexical-index entry, not source guidance: ${term}. `;
  return `${prefix}${'metadata '.repeat(Math.ceil((targetCharacters - prefix.length) / 9))}`.slice(0, targetCharacters);
}

const v1Report = JSON.parse(await readFile(V1_REPORT_PATH, 'utf8'));
const v1Result = v1Report.results.find(row => row.mapId === MAP_ID);
const savedOpeningUnit = v1Result?.excerpts?.find(row => row.blockIndex === SAVED_BLOCK_INDEX);
assert.equal(v1Result?.status, 'VALIDATED');
assert.ok(savedOpeningUnit && !savedOpeningUnit.truncated);
const savedBlocks = savedOpeningUnit.text.split(/\r?\n\s*\r?\n/).map(value => value.trim()).filter(Boolean);
assert.equal(savedBlocks[0], '•', 'The saved V1 unit retains its standalone leading bullet.');
const opening = savedBlocks.slice(1).join('\n\n');
const openingSentences = opening.split(/(?<=[.!?])\s+/).filter(Boolean);
assert.equal(openingSentences.length, 3, 'Use the complete saved three-sentence opening.');
const proposedFirstSentenceHint = openingSentences[0].replace(/[.!?]+$/, '').trim();

const v4Report = JSON.parse(await readFile(V4_REPORT_PATH, 'utf8'));
assert.equal(v4Report.page.mapId, MAP_ID);
assert.equal(v4Report.page.status, 'VALIDATED');
assert.equal(v4Report.page.exactThreeSentenceOpeningMatchPresentInFullVisibleText, true);
assert.deepEqual(v4Report.page.openingSentencePresenceInFullVisibleText, [true, true, true]);
const selectedFullUnit = v4Report.page.selectedUnits.find(row => row.blockIndex === SAVED_BLOCK_INDEX);
assert.ok(selectedFullUnit?.exactThreeSentenceOpeningMatchPresent);
assert.ok(normalizePublicText(selectedFullUnit.cleanPublicUnitText).includes(normalizePublicText(opening)),
  'The selected bounded V4 page unit contains the intact saved three-sentence opening.');
const liveRetainedRecord = v4Report.pipeline.eligibleRetainedSourcePresence.find(row =>
  row.sourceMapId === MAP_ID && row.provenance === 'LIVE_EXTERNAL');
assert.ok(liveRetainedRecord, 'V4 contains a retained live GST record for this source map.');
assert.equal(liveRetainedRecord.normalizedTextLength, 4964);
assert.equal(liveRetainedRecord.exactThreeSentenceOpeningMatchPresent, false);
assert.deepEqual(liveRetainedRecord.openingSentencePresence, [false, false, false]);
assert.equal(v4Report.pipeline.finalEvidenceStatus, 'INSUFFICIENT');
assert.equal(v4Report.pipeline.finalVerifiedClaimCount, 0);

const frozenCase = irasResolverCases.find(row => row.id === 'gst-input-tax-general-rule');
assert.ok(frozenCase?.issues?.length === 1);
const topic = getCoverageTopicById(TOPIC_ID);
assert.ok(topic && topic.domainId === 'IRAS_GST');
const currentTerms = topicTerms(topic);
const currentQuery = frozenCase.query;
const extendedTerms = [...currentTerms, proposedFirstSentenceHint];

// Topic-label metadata is synthetic and non-entailing. Four competitive entries
// precede the public opening; four follow it. The same opening text is not
// modified, and the selector receives more than its full 5,000-character cap.
const distractorTermLabels = [
  'tax invoice requirements',
  'claimed tax invoices',
  'input taxes',
  'recover input tax'
];
const distractorsBefore = distractorTermLabels.map(term => syntheticCompetitiveParagraph(term, 1600));
const distractorsAfter = distractorTermLabels.map(term => syntheticCompetitiveParagraph(term, 1600));
const syntheticPageText = [
  ...distractorsBefore,
  'Synthetic separator metadata.',
  opening,
  'Synthetic separator metadata.',
  ...distractorsAfter
].join('\n\n');
assert.ok(syntheticPageText.length > MAX_RETAINED_CHARACTERS);

const baselineRetained = selectRelevantFetchedText(syntheticPageText, currentTerms, MAX_RETAINED_CHARACTERS, currentQuery);
const proposedRetained = selectRelevantFetchedText(syntheticPageText, extendedTerms, MAX_RETAINED_CHARACTERS, currentQuery);
const baselineSentenceFlags = openingSentences.map(sentence => sentencePresent(baselineRetained, sentence));
const proposedSentenceFlags = openingSentences.map(sentence => sentencePresent(proposedRetained, sentence));
const exactOpening = normalizePublicText(opening);
const baselineCompleteOpeningPresent = normalizePublicText(baselineRetained).includes(exactOpening);
const proposedCompleteOpeningPresent = normalizePublicText(proposedRetained).includes(exactOpening);
assert.ok(baselineRetained.length <= MAX_RETAINED_CHARACTERS);
assert.ok(proposedRetained.length <= MAX_RETAINED_CHARACTERS);
assert.deepEqual(baselineSentenceFlags, [false, true, false],
  'Current topic labels retain only the middle opening sentence in this fixed synthetic competition.');
assert.equal(baselineCompleteOpeningPresent, false,
  'The current-term baseline must fail to retain the complete synthetic opening.');
assert.deepEqual(proposedSentenceFlags, [true, true, true],
  'The exact first-sentence hint must retain all three opening sentences in this fixture.');
assert.equal(proposedCompleteOpeningPresent, true,
  'The proposed first-sentence hint must retain the complete synthetic opening.');

const result = {
  schemaVersion: 1,
  profileVersion: 'iras-gst-opening-retention-probe-v1',
  diagnosticOnly: true,
  interpretation: 'SYNTHETIC_LONG_PAGE_RETENTION_BOUNDARY_NOT_ACTUAL_PAGE_RANKING_PROOF',
  actualV4Capture: {
    mapId: MAP_ID,
    status: v4Report.page.status,
    sourceDocumentSha256: v4Report.page.documentSha256,
    rawResponseCharacterCount: v4Report.page.rawResponseCharacterCount,
    cleanedVisibleCharacterCount: v4Report.page.cleanVisibleCharacterCount,
    openingUnitBlockIndex: selectedFullUnit.blockIndex,
    openingUnitCharacterCount: selectedFullUnit.characterCount,
    openingUnitCompleteThreeSentenceMatch: selectedFullUnit.exactThreeSentenceOpeningMatchPresent,
    openingPresentInFullVisibleText: v4Report.page.exactThreeSentenceOpeningMatchPresentInFullVisibleText,
    openingSentencePresenceInFullVisibleText: v4Report.page.openingSentencePresenceInFullVisibleText,
    retainedLiveRecordCharacterCount: liveRetainedRecord.normalizedTextLength,
    retainedLiveRecordNormalizedSha256: liveRetainedRecord.normalizedTextSha256,
    openingPresentInRetainedLiveRecord: liveRetainedRecord.exactThreeSentenceOpeningMatchPresent,
    openingSentencePresenceInRetainedLiveRecord: liveRetainedRecord.openingSentencePresence,
    finalEvidenceStatus: v4Report.pipeline.finalEvidenceStatus,
    finalVerifiedClaimCount: v4Report.pipeline.finalVerifiedClaimCount
  },
  fixture: {
    savedV1BlockIndex: SAVED_BLOCK_INDEX,
    savedDocumentSha256: v1Result.documentSha256,
    exactOpeningSha256: sha256(normalizePublicText(opening)),
    exactOpeningSentenceCount: openingSentences.length,
    standaloneBulletRetainedInSavedUnit: true,
    standaloneBulletRemovedFromSyntheticBody: true,
    currentTopicTermCount: currentTerms.length,
    currentTopicTermsSha256: sha256(currentTerms.map(normalizePublicText).join('\n')),
    frozenQuerySha256: sha256(currentQuery),
    proposedFirstSentenceHintSha256: sha256(normalizePublicText(proposedFirstSentenceHint))
  },
  syntheticLongPage: {
    compositionDisclosure: 'Synthetic non-entailing topic-label entries are placed before and after the intact saved three-sentence opening. The first-sentence hint is derived from that saved opening. This ordering and the distractor text are test composition only, not actual V4 adjacency or ranking.',
    syntheticDistractorCount: distractorsBefore.length + distractorsAfter.length,
    distractorCharactersEach: 1600,
    syntheticPageCharacterCount: syntheticPageText.length,
    retainedCharacterCap: MAX_RETAINED_CHARACTERS,
    baselineCurrentTerms: {
      retainedCharacterCount: baselineRetained.length,
      retainedTextSha256: sha256(baselineRetained),
      openingSentencePresence: baselineSentenceFlags,
      completeOpeningPresent: baselineCompleteOpeningPresent
    },
    proposedTermsPlusFirstSourceFacingHint: {
      retainedCharacterCount: proposedRetained.length,
      retainedTextSha256: sha256(proposedRetained),
      openingSentencePresence: proposedSentenceFlags,
      completeOpeningPresent: proposedCompleteOpeningPresent
    }
  },
  limitation: 'V4 proves the complete opening was available in the validated full page and its bounded page unit but absent from the retained live record. The whole page is not reconstructed here. The synthetic helper comparison tests one proposed exact hint against a controlled lexical competition; it does not prove the ranking of the discarded actual V4 page.'
};

await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
await writeFile(OUTPUT_PATH, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
process.stdout.write(`${JSON.stringify({ status: 'OK', actualLiveRetainedCharacters: result.actualV4Capture.retainedLiveRecordCharacterCount,
  syntheticPageCharacters: result.syntheticLongPage.syntheticPageCharacterCount,
  baselineCompleteOpeningPresent, proposedCompleteOpeningPresent,
  baselineSentenceFlags, proposedSentenceFlags,
  reportPath: path.relative(REPOSITORY_ROOT, OUTPUT_PATH) })}\n`);
