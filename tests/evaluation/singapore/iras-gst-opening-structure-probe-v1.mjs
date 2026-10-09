import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyQuestion } from '../../../src/classification/questionClassifier.ts';
import { ControlledWebRetriever } from '../../../src/retrieval/controlledWebRetriever.ts';
import { defaultAdvancedSourceRetriever } from '../../../src/retrieval/advancedSourceRetriever.ts';
import { SourceCache } from '../../../src/retrieval/sourceCache.ts';
import { supportGeneralIrasRuleConcept } from '../../../src/retrieval/irasRuleConceptSupport.ts';
import { IRAS_SOURCE_MAP_DEFINITIONS } from '../../../src/standards/coverageRegistry.ts';
import { buildAuthorityWorkstreams } from '../../../src/services/authorityWorkstreams.ts';
import { buildGroundedReasoningContext } from '../../../src/services/groundingContextBuilder.ts';
import { renderIrasEvidenceResponse } from '../../../src/services/irasEvidencePolicy.ts';
import { getRequestedQuestionConcepts, reconcileQuestionUnderstanding, validateSemanticQuestionInterpretation } from '../../../src/services/semanticQuestionUnderstanding.ts';
import { irasResolverCases } from '../../fixtures/irasResolverCases.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const REPORT_PATH = path.join(ROOT,
  'docs/evaluation/multi-authority-workstreams/iras-first-local-2026-10-02-v6/iras-gst-opening-structure-probe-v1.json');
const INPUT_REPORT_PATH = path.join(ROOT,
  'docs/evaluation/multi-authority-workstreams/iras-public-excerpts-2026-10-03-v1/iras-public-rule-excerpts-report-v1.json');
const REFERENCE_DATE = '2026-10-02';
const SYNTHETIC_COMPOSITION = 'SYNTHETIC_HTML_ARRANGEMENT_NOT_ORIGINAL_PAGE_OR_LIVE_HTML';
const sha256 = value => createHash('sha256').update(value).digest('hex');
const normalize = value => value.normalize('NFC').replace(/\s+/g, ' ').trim();
const escapeHtml = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const readJson = async absolutePath => JSON.parse(await readFile(absolutePath, 'utf8'));

const publicReport = await readJson(INPUT_REPORT_PATH);
const gstMapId = 'IRAS_GST_INPUT_TAX_SOURCE_MAP';
const savedExcerpt = publicReport.results.find(row => row.mapId === gstMapId)?.excerpts
  .find(row => row.blockIndex === 7);
assert.ok(savedExcerpt && !savedExcerpt.truncated, 'The authorized saved GST block is intact.');
assert.equal(savedExcerpt.unitKind, 'HEADING_AND_BLOCK');
const savedBlocks = savedExcerpt.text.split(/\r?\n\s*\r?\n/).map(block => block.trim()).filter(Boolean);
assert.equal(savedBlocks.length, 2, 'The saved block boundary has two intact units.');
assert.equal(savedBlocks[0], '•', 'The leading standalone bullet is retained as its own saved unit.');
const opening = savedBlocks[1];
assert.equal(opening.split(/(?<=[.!?])\s+/).length, 3, 'The saved opening retains all three source sentences.');
const normalizedOpening = normalize(opening);

const frozenCase = irasResolverCases.find(row => row.id === 'gst-input-tax-general-rule');
assert.ok(frozenCase?.issues.length === 1, 'The original GST request remains a single-issue frozen case.');
const frozenIssue = frozenCase.issues[0];
const interpretation = {
  schemaVersion: 2,
  jurisdiction: ['Singapore'],
  authorityCandidates: ['IRAS'],
  contextualAuthorities: [],
  domain: frozenIssue.domain,
  population: frozenIssue.population,
  primarySubject: frozenIssue.subject,
  concepts: [{ concept: frozenIssue.subject, role: 'PRIMARY' }],
  requestedOperation: frozenIssue.operation,
  factsExplicitlyProvided: [],
  confidence: 0.96,
  issues: [{
    subject: frozenIssue.subject,
    population: frozenIssue.population,
    domain: frozenIssue.domain,
    governingAuthorities: ['IRAS'],
    contextualAuthorities: [],
    operation: frozenIssue.operation,
    mappedTopicIds: [],
    evidenceRequirement: 'AUTHORITATIVE_SOURCE',
    confidence: 0.96
  }]
};
assert.ok(validateSemanticQuestionInterpretation(interpretation, frozenCase.query));
const questionUnderstanding = { mode: 'SEMANTIC_INTERPRETATION', interpretation };
const classification = classifyQuestion(frozenCase.query);
const reconciled = reconcileQuestionUnderstanding(frozenCase.query, classification, questionUnderstanding);
const issue = reconciled.issuePlan.issues[0];
const topicId = 'iras-gst-input-tax';
const topicIds = [...new Set([...(issue.mappedTopicIds || []), ...frozenCase.requiredTopicIds])];
const requestedConcepts = getRequestedQuestionConcepts(frozenCase.query, questionUnderstanding);
assert.ok(topicIds.includes(topicId) && requestedConcepts.length > 0);
const sourceMap = IRAS_SOURCE_MAP_DEFINITIONS.find(definition => definition.id === gstMapId);
assert.ok(sourceMap?.topicIds.includes(topicId));
const sourceOnlySupport = requestedConcepts.map(concept => supportGeneralIrasRuleConcept({
  sourceText: opening,
  domainId: sourceMap.domainId,
  topicIds: [...new Set([...topicIds, ...(concept.topicIds || [])])],
  subject: issue.subject,
  population: issue.population,
  concepts: [concept]
}));
assert.ok(sourceOnlySupport.includes(true), 'The exact complete saved opening supports the frozen general GST concept.');

const arrangements = [
  {
    id: 'body_only_bullet_disclosed_removed',
    boundary: 'synthetic body paragraph containing only saved rule block 2; saved leading bullet omitted',
    html: `<p>${escapeHtml(opening)}</p>`,
    savedStandaloneBulletRetained: false
  },
  {
    id: 'saved_excerpt_blocks_standalone_bullet',
    boundary: 'synthetic HTML paragraphs mirror the two saved text blocks exactly: standalone bullet, then complete opening',
    html: savedBlocks.map(block => `<p>${escapeHtml(block)}</p>`).join(''),
    savedStandaloneBulletRetained: true
  },
  {
    id: 'saved_excerpt_text_inside_one_paragraph',
    boundary: 'synthetic single paragraph containing the intact saved excerpt text, including its embedded bullet and newlines',
    html: `<p>${escapeHtml(savedExcerpt.text)}</p>`,
    savedStandaloneBulletRetained: true
  },
  {
    id: 'synthetic_li_with_nested_paragraph',
    boundary: 'synthetic visible list item containing a paragraph with the unchanged saved opening',
    html: `<ul><li><p>${escapeHtml(opening)}</p></li></ul>`,
    savedStandaloneBulletRetained: false
  },
  {
    id: 'synthetic_colon_intro_followed_by_visible_list',
    boundary: 'synthetic colon-ended topic label followed by a visible list item containing the unchanged saved opening',
    html: `<p>Input tax claim conditions:</p><ul><li>${escapeHtml(opening)}</li></ul>`,
    savedStandaloneBulletRetained: false
  },
  {
    id: 'synthetic_colon_intro_followed_by_unmarked_prose',
    boundary: 'synthetic colon-ended topic label followed by ordinary prose containing the unchanged saved opening',
    html: `<p>Input tax claim conditions:</p><p>${escapeHtml(opening)}</p>`,
    savedStandaloneBulletRetained: false
  }
];

const registeredMapIdsByUrl = new Map(IRAS_SOURCE_MAP_DEFINITIONS.map(definition =>
  [definition.canonicalSourceUrl, definition.id]));
const knownClosedMapIds = new Set(['IRAS_GST_INVOICING_SOURCE_MAP']);
const counters = {
  ambientFetchCalls: 0,
  selectedMappedGetCalls: 0,
  closedKnownMappedGetCalls: 0,
  unexpectedMappedCalls: 0,
  nonGetOrRedirectModeCalls: 0,
  discoveryCalls: 0,
  searchCalls: 0,
  modelCalls: 0
};
const variantResults = [];
const previousFetch = globalThis.fetch;
globalThis.fetch = async () => {
  counters.ambientFetchCalls += 1;
  throw new Error('AMBIENT_NETWORK_DISABLED');
};

try {
  for (const arrangement of arrangements) {
    const before = { ...counters };
    const customFetch = async (urlValue, init = {}) => {
      const url = String(urlValue);
      const method = (init.method || 'GET').toUpperCase();
      if (url === sourceMap.canonicalSourceUrl) {
        if (method !== 'GET' || init.redirect !== 'manual') counters.nonGetOrRedirectModeCalls += 1;
        counters.selectedMappedGetCalls += 1;
        const title = `${sourceMap.pageTitle} | IRAS`;
        const html = `<html><head><title>${escapeHtml(title)}</title></head><body><main><h1>${escapeHtml(title)}</h1>${arrangement.html}</main></body></html>`;
        return new Response(html, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
      }
      const mapId = registeredMapIdsByUrl.get(url);
      if (mapId && knownClosedMapIds.has(mapId) && method === 'GET' && init.redirect === 'manual') {
        counters.closedKnownMappedGetCalls += 1;
        return new Response(null, { status: 503 });
      }
      counters.unexpectedMappedCalls += 1;
      return new Response(null, { status: 503 });
    };
    const discoveryAdapter = {
      async discoverOfficialSourceCandidates() { counters.discoveryCalls += 1; return []; },
      getLastFetchTrace() { return []; }
    };
    const officialDomainSearchAdapter = {
      async searchOfficialDomainCandidates() { counters.searchCalls += 1; return []; },
      getLastSearchTrace() { return []; }
    };
    const groundingOptions = {
      discoveryAdapter,
      officialDomainSearchAdapter,
      webRetriever: new ControlledWebRetriever(undefined, new SourceCache()),
      fetchOptions: { customFetch, timeoutMs: 5_000, useCache: false },
      authorityLevelDiscovery: false,
      localOnly: false,
      referenceDate: REFERENCE_DATE,
      questionUnderstanding,
      evidenceScope: {
        authority: 'IRAS',
        domain: issue.domain,
        topicIds,
        requestedConcepts,
        context: {
          domainId: sourceMap.domainId,
          population: issue.population,
          primarySubject: issue.subject,
          concepts: [issue.subject],
          requestedOperation: issue.operation
        }
      }
    };
    const grounded = await buildGroundedReasoningContext(frozenCase.query, null,
      defaultAdvancedSourceRetriever, undefined, groundingOptions);
    const rendered = renderIrasEvidenceResponse({}, grounded, frozenCase.query, null, 'SFRS_I', 'LOCAL');
    const workstreams = await buildAuthorityWorkstreams(frozenCase.query, reconciled.issuePlan, {
      retriever: defaultAdvancedSourceRetriever,
      questionUnderstanding,
      referenceDate: REFERENCE_DATE,
      groundingOptions
    });
    const finalIssue = workstreams.workstreams.flatMap(stream => stream.issues)
      .find(item => item.issueId === issue.id);
    assert.ok(finalIssue, `${arrangement.id}: the frozen issue reaches the central workstream.`);

    const mappedRecords = (grounded.evidenceQuality?.eligibleRecords || [])
      .filter(record => record.canonicalSourceUrl === sourceMap.canonicalSourceUrl);
    const accepted = (rendered.claimVerification?.accepted || []).filter(claim =>
      mappedRecords.some(record => record.id === claim.recordId));
    const helperSupportedRecordCount = mappedRecords.filter(record => requestedConcepts.some(concept =>
      supportGeneralIrasRuleConcept({
        sourceText: record.sourceText || '',
        domainId: sourceMap.domainId,
        topicIds: [...new Set([topicId, ...(concept.topicIds || [])])],
        subject: issue.subject,
        population: issue.population,
        concepts: [concept]
      }) === true)).length;
    const fullOpeningRecords = mappedRecords.filter(record => normalize(record.sourceText || '').includes(normalizedOpening));
    const quoteFlags = accepted.map(claim => {
      const quote = normalize(claim.quote);
      const record = mappedRecords.find(item => item.id === claim.recordId);
      const helperSupported = requestedConcepts.some(concept => supportGeneralIrasRuleConcept({
        sourceText: claim.quote,
        domainId: sourceMap.domainId,
        topicIds: [...new Set([topicId, ...(concept.topicIds || [])])],
        subject: issue.subject,
        population: issue.population,
        concepts: [concept]
      }) === true);
      return {
        quoteSha256: sha256(quote),
        sourceRecordIdKnown: Boolean(record),
        preservesCompleteSavedOpening: quote.includes(normalizedOpening),
        helperSupportedForRequestedConcept: helperSupported
      };
    });
    const acceptedPerSource = new Map();
    for (const claim of accepted) {
      const record = mappedRecords.find(item => item.id === claim.recordId);
      const key = record?.canonicalSourceUrl || 'UNKNOWN';
      acceptedPerSource.set(key, (acceptedPerSource.get(key) || 0) + 1);
    }
    const boundaryRecord = mappedRecords.find(record => normalize(record.sourceText || '').includes(normalizedOpening)) || mappedRecords[0];
    const sourceTextBlocks = boundaryRecord?.sourceText?.split(/\r?\n[\t ]*\r?\n+/)
      .map(block => block.trim()).filter(Boolean) || [];
    const openingBlockIndexes = sourceTextBlocks.flatMap((block, index) =>
      normalize(block).includes(normalizedOpening) ? [index] : []);
    const boundaryCounts = {
      blockCount: sourceTextBlocks.length,
      openingContainedInExtractedBlockCount: openingBlockIndexes.length,
      openingExtractedBlockIndexes: openingBlockIndexes,
      standaloneBulletBlockCount: sourceTextBlocks.filter(block => block === '•').length,
      bulletPrefixedBlockCount: sourceTextBlocks.filter(block => /^(?:\|\s*)*[•◦▪](?:\s|$)/.test(block)).length,
      precedingColonEndedBlockCount: sourceTextBlocks.filter((block, index) =>
        index < openingBlockIndexes[0] && /:$/.test(block)).length,
      extractedSourceTextSha256: boundaryRecord ? sha256(normalize(boundaryRecord.sourceText || '')) : undefined
    };
    if (arrangement.id === 'body_only_bullet_disclosed_removed') {
      assert.equal(boundaryCounts.openingContainedInExtractedBlockCount, 1);
      assert.equal(boundaryCounts.bulletPrefixedBlockCount, 0);
    } else if (arrangement.id === 'saved_excerpt_blocks_standalone_bullet') {
      assert.equal(boundaryCounts.standaloneBulletBlockCount, 1);
      assert.equal(boundaryCounts.openingContainedInExtractedBlockCount, 1);
    } else if (arrangement.id === 'saved_excerpt_text_inside_one_paragraph') {
      assert.equal(boundaryCounts.openingContainedInExtractedBlockCount, 1);
      assert.ok(boundaryCounts.bulletPrefixedBlockCount > 0,
        'The actual HTML extractor attaches the leading marker to a block containing the opening in this synthetic paragraph shape.');
    } else if (arrangement.id === 'synthetic_li_with_nested_paragraph') {
      assert.equal(boundaryCounts.openingContainedInExtractedBlockCount, 1);
      assert.ok(boundaryCounts.bulletPrefixedBlockCount > 0,
        'The actual HTML extractor retains visible list markers in the nested-paragraph shape.');
    } else if (arrangement.id === 'synthetic_colon_intro_followed_by_visible_list') {
      assert.equal(boundaryCounts.openingContainedInExtractedBlockCount, 1);
      assert.ok(boundaryCounts.precedingColonEndedBlockCount > 0 && boundaryCounts.bulletPrefixedBlockCount > 0);
    } else if (arrangement.id === 'synthetic_colon_intro_followed_by_unmarked_prose') {
      assert.equal(boundaryCounts.openingContainedInExtractedBlockCount, 1);
      assert.ok(boundaryCounts.precedingColonEndedBlockCount > 0);
      assert.equal(boundaryCounts.bulletPrefixedBlockCount, 0);
    }
    const finalClaims = finalIssue.verifiedClaims || [];
    const result = {
      arrangementId: arrangement.id,
      composition: SYNTHETIC_COMPOSITION,
      boundaryDisclosure: arrangement.boundary,
      savedStandaloneBulletRetained: arrangement.savedStandaloneBulletRetained,
      savedSourceDocumentSha256: savedExcerpt.documentSha256,
      savedExcerptSha256: sha256(normalize(savedExcerpt.text)),
      savedOpeningSha256: sha256(normalizedOpening),
      savedOpeningSentenceCount: 3,
      directSavedOpeningHelperSupport: sourceOnlySupport.includes(true),
      selectedMappedGetCount: counters.selectedMappedGetCalls - before.selectedMappedGetCalls,
      closedKnownMappedGetCount: counters.closedKnownMappedGetCalls - before.closedKnownMappedGetCalls,
      eligibleMappedRecordCount: mappedRecords.length,
      eligibleMappedRecordHelperSupportedCount: helperSupportedRecordCount,
      eligibleMappedRecordPreservingCompleteOpeningCount: fullOpeningRecords.length,
      extractedBoundaryCounts: boundaryCounts,
      rendererAcceptedMappedQuoteCount: accepted.length,
      rendererAcceptedMappedHelperSupportedQuoteCount: quoteFlags.filter(flag => flag.helperSupportedForRequestedConcept).length,
      rendererAcceptedMappedCompleteOpeningCount: quoteFlags.filter(flag => flag.preservesCompleteSavedOpening).length,
      rendererAcceptedWithinThreePerSource: [...acceptedPerSource.values()].every(count => count <= 3),
      acceptedQuoteHashesAndFlags: quoteFlags,
      rendererRejectedClaimCount: rendered.claimVerification?.rejected?.length || 0,
      centralFinalEvidenceStatus: finalIssue.evidenceStatus,
      centralFinalApplicationStatus: finalIssue.applicationStatus,
      centralFinalVerifiedClaimCount: finalClaims.length,
      centralFinalHelperSupportedClaimCount: finalClaims.filter(claim => requestedConcepts.some(concept =>
        supportGeneralIrasRuleConcept({
          sourceText: claim.quote,
          domainId: sourceMap.domainId,
          topicIds: [...new Set([topicId, ...(concept.topicIds || [])])],
          subject: issue.subject,
          population: issue.population,
          concepts: [concept]
        }) === true)).length,
      centralFinalCompleteOpeningCount: finalClaims.filter(claim => normalize(claim.quote).includes(normalizedOpening)).length,
      centralGapCodes: (finalIssue.gaps || []).map(gap => gap.code),
      mappedAttemptStatuses: (grounded.sourceMapFallbackTrace?.attempts || [])
        .filter(attempt => attempt.topicId === topicId).map(attempt => attempt.fetchStatus)
    };
    assert.equal(result.rendererAcceptedWithinThreePerSource, true);
    assert.ok(result.eligibleMappedRecordCount > 0, `${arrangement.id}: mapped source reaches the eligible-record stage.`);
    assert.ok(result.selectedMappedGetCount > 0, `${arrangement.id}: the selected map uses only injected transport.`);
    if (arrangement.id === 'body_only_bullet_disclosed_removed' ||
        arrangement.id === 'saved_excerpt_blocks_standalone_bullet') {
      assert.ok(result.rendererAcceptedMappedCompleteOpeningCount > 0,
        `${arrangement.id}: the exact complete opening survives this body arrangement.`);
      assert.ok(result.centralFinalCompleteOpeningCount > 0,
        `${arrangement.id}: the central workstream verifies the exact complete opening.`);
      assert.equal(result.centralFinalEvidenceStatus, 'VERIFIED');
      assert.equal(result.centralFinalApplicationStatus, 'NOT_REQUIRED');
    } else {
      assert.equal(result.rendererAcceptedMappedCompleteOpeningCount, 0,
        `${arrangement.id}: this synthetic list/colon boundary does not yield the complete opening as a quote.`);
      assert.equal(result.rendererAcceptedMappedHelperSupportedQuoteCount, 0,
        `${arrangement.id}: no renderer-selected mapped quote supports the requested general rule.`);
      assert.equal(result.centralFinalCompleteOpeningCount, 0,
        `${arrangement.id}: this synthetic boundary does not yield a final complete-opening claim.`);
      assert.equal(result.centralFinalHelperSupportedClaimCount, 0,
        `${arrangement.id}: the central workstream has no helper-supported final claim.`);
      assert.equal(result.centralFinalEvidenceStatus, 'INSUFFICIENT',
        `${arrangement.id}: without a supported opening claim the central issue remains insufficient.`);
    }
    variantResults.push(result);
  }
} finally {
  globalThis.fetch = previousFetch;
}

assert.equal(counters.ambientFetchCalls, 0, 'Ambient fetch is blocked.');
assert.equal(counters.unexpectedMappedCalls, 0, 'Every injected mapped request is selected or a known closed map.');
assert.equal(counters.nonGetOrRedirectModeCalls, 0, 'Injected transport requests remain GET with manual redirect handling.');
assert.equal(counters.discoveryCalls, 0, 'Official-source discovery remains closed.');
assert.equal(counters.searchCalls, 0, 'Official-domain search remains closed.');
assert.equal(counters.modelCalls, 0, 'No model provider or model call is configured for this probe.');

const report = {
  schemaVersion: 1,
  diagnosticOnly: true,
  interpretation: 'SYNTHETIC_HTML_ARRANGEMENTS_OF_INTACT_SAVED_PUBLIC_GST_BLOCK; DOES_NOT_ESTABLISH_ORIGINAL_LIVE_HTML_STRUCTURE_OR_ADJACENCY; no_tax_rule_inference',
  referenceDate: REFERENCE_DATE,
  source: {
    sourceMapId: gstMapId,
    topicId,
    savedBlockIndex: 7,
    savedUnitKind: savedExcerpt.unitKind,
    savedSourceDocumentSha256: savedExcerpt.documentSha256,
    savedExcerptSha256: sha256(normalize(savedExcerpt.text)),
    savedOpeningSha256: sha256(normalizedOpening),
    savedStandaloneBulletIncluded: true,
    savedOpeningSentenceCount: 3,
    savedOpeningDirectHelperSupport: sourceOnlySupport.includes(true)
  },
  observedMechanism: {
    separateBulletAndRuleBlocks: 'The saved standalone bullet block is excluded while the following unmarked complete paragraph remains selectable in this synthetic arrangement.',
    bulletAttachedToOpening: 'When the public HTML extractor produces a bullet-prefixed block containing the complete opening, the renderer selects no helper-supported complete opening; central evidence remains insufficient.',
    colonBoundaryControls: 'Synthetic colon-plus-visible-list and colon-plus-unmarked-prose arrangements both suppress the following opening through distinct structural boundaries.',
    colonVisibleListEligibleRecordHelperSupportCount: variantResults.find(result =>
      result.arrangementId === 'synthetic_colon_intro_followed_by_visible_list')?.eligibleMappedRecordHelperSupportedCount,
    colonVisibleListInterpretation: 'The colon-plus-visible-list row has zero full-record helper-supported records although the exact saved opening directly supports the helper. This combines a full-record helper-boundary loss with the selector colon/list boundary and does not isolate selector behavior alone.',
    limit: 'These measurements distinguish possible extraction/selector mechanisms only; the saved public text block does not establish original live HTML tags or adjacency.'
  },
  transportAndModel: counters,
  arrangementResults: variantResults
};
await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
process.stdout.write(`${JSON.stringify({
  reportPath: path.relative(ROOT, REPORT_PATH),
  transportAndModel: counters,
  arrangements: variantResults.map(result => ({
    id: result.arrangementId,
    eligible: result.eligibleMappedRecordCount,
    selectedComplete: result.rendererAcceptedMappedCompleteOpeningCount,
    finalComplete: result.centralFinalCompleteOpeningCount,
    evidence: result.centralFinalEvidenceStatus
  }))
})}\n`);
