import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { classifyQuestion } from '../../src/classification/questionClassifier.ts';
import { ControlledWebRetriever } from '../../src/retrieval/controlledWebRetriever.ts';
import { defaultAdvancedSourceRetriever } from '../../src/retrieval/advancedSourceRetriever.ts';
import { SourceCache } from '../../src/retrieval/sourceCache.ts';
import { IRAS_SOURCE_MAP_DEFINITIONS, getCoverageTopicById } from '../../src/standards/coverageRegistry.ts';
import { UNIFIED_SOURCE_REGISTRY } from '../../src/standards/unifiedSourceModel.ts';
import { buildAuthorityWorkstreams } from '../../src/services/authorityWorkstreams.ts';
import { buildGroundedReasoningContext } from '../../src/services/groundingContextBuilder.ts';
import { renderIrasEvidenceResponse } from '../../src/services/irasEvidencePolicy.ts';
import {
  getRequestedQuestionConcepts,
  reconcileQuestionUnderstanding,
  validateSemanticQuestionInterpretation
} from '../../src/services/semanticQuestionUnderstanding.ts';
import { supportGeneralIrasRuleConcept } from '../../src/retrieval/irasRuleConceptSupport.ts';
import { irasResolverCases } from '../fixtures/irasResolverCases.mjs';

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const V1_REPORT_PATH = path.join(REPOSITORY_ROOT,
  'docs/evaluation/multi-authority-workstreams/iras-public-excerpts-2026-10-03-v1/iras-public-rule-excerpts-report-v1.json');
const MAP_ID = 'IRAS_GST_INPUT_TAX_SOURCE_MAP';
const TOPIC_ID = 'iras-gst-input-tax';
const REFERENCE_DATE = new Date().toISOString().slice(0, 10);
const normalize = value => String(value || '').normalize('NFC').replace(/\s+/g, ' ').trim();
const escapeHtml = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

const topic = getCoverageTopicById(TOPIC_ID);
const mapDefinition = IRAS_SOURCE_MAP_DEFINITIONS.find(row => row.id === MAP_ID);
const mapPointer = UNIFIED_SOURCE_REGISTRY[MAP_ID];
assert.ok(topic && mapDefinition && mapPointer);
assert.equal(topic.domainId, 'IRAS_GST');

// Preserve the prior retrieval terms and source governance contract. The new
// final phrase is a descriptive source locator, not a paragraph citation.
assert.deepEqual(topic.paragraphHints.slice(0, 4), [
  'input tax claim', 'claim input tax', 'claiming input tax', 'recover input tax'
]);
assert.deepEqual(topic.keywords, [
  'input tax claim', 'tax invoice requirements', 'claim input gst', 'input gst', 'claimed tax invoices', 'input taxes'
]);
assert.deepEqual(topic.queryPatterns, [
  String.raw`\b(?:gst|input tax|input gst)\b[\s\S]{0,140}\b(?:meals?|dining|entertainment)\b[\s\S]{0,100}\b(?:customers?|clients?|suppliers?)\b`,
  String.raw`\b(?:meals?|dining|entertainment)\b[\s\S]{0,140}\b(?:customers?|clients?|suppliers?)\b[\s\S]{0,100}\b(?:gst|input tax|input gst)\b`,
  String.raw`(?=[\s\S]*\b(?:gst|goods and services tax)\b)(?=[\s\S]*\binput[ -]?tax\b)(?=[\s\S]*\b(?:claim\w*|recover\w*|recovery)\b)(?=[\s\S]*\b(?:business|purchase|company)\b)`
]);
const expectedTopicMaps = [
  ['IRAS_GST_INPUT_TAX_SOURCE_MAP', 'https://www.iras.gov.sg/taxes/goods-services-tax-(gst)/claiming-gst-(input-tax)/conditions-for-claiming-input-tax'],
  ['IRAS_GST_INVOICING_SOURCE_MAP', 'https://www.iras.gov.sg/taxes/goods-services-tax-(gst)/basics-of-gst/invoicing-price-display-and-record-keeping/invoicing-customers']
].sort(([left], [right]) => left.localeCompare(right));
assert.deepEqual(IRAS_SOURCE_MAP_DEFINITIONS.filter(row => row.topicIds.includes(TOPIC_ID))
  .map(row => [row.id, row.canonicalSourceUrl]).sort(([left], [right]) => left.localeCompare(right)), expectedTopicMaps,
'Appending the locator does not change mapped source IDs or URLs.');
assert.deepEqual([mapDefinition.domainId, mapDefinition.topicIds, mapDefinition.canonicalSourceUrl, mapDefinition.pageTitle], [
  'IRAS_GST', ['iras-gst-input-tax', 'iras-gst-entertainment'],
  expectedTopicMaps.find(([id]) => id === MAP_ID)[1], 'Conditions for Claiming Input Tax'
]);

const v1Report = JSON.parse(await readFile(V1_REPORT_PATH, 'utf8'));
const v1Result = v1Report.results.find(row => row.mapId === MAP_ID);
const savedUnit = v1Result?.excerpts?.find(row => row.blockIndex === 7);
assert.equal(v1Result?.status, 'VALIDATED');
assert.ok(savedUnit && !savedUnit.truncated);
const sourceBlocks = savedUnit.text.split(/\r?\n\s*\r?\n/).map(value => value.trim()).filter(Boolean);
assert.equal(sourceBlocks[0], '•', 'The approved saved unit has a separate leading bullet marker.');
const completeOpeningParagraph = sourceBlocks.slice(1).join('\n\n');
const openingSentences = completeOpeningParagraph.split(/(?<=[.!?])\s+/).filter(Boolean);
assert.equal(openingSentences.length, 3);
const firstSentenceLocator = openingSentences[0].replace(/[.!?]+$/, '').trim();
assert.equal(topic.paragraphHints[4], firstSentenceLocator,
  'Append only the exact first saved sentence, without terminal punctuation, as the fifth locator.');
assert.equal(topic.paragraphHints.length, 5);
assert.doesNotMatch(firstSentenceLocator, /\b(?:paragraph|section)\s+\d/i,
  'The appended phrase is a body-text locator, not a citation number.');

const distractorLabelTerms = ['tax invoice requirements', 'claimed tax invoices', 'input taxes', 'recover input tax'];
function syntheticDistractor(term) {
  const prefix = `Synthetic lexical-index entry, not source guidance: ${term}. `;
  return `${prefix}${'metadata '.repeat(Math.ceil((1600 - prefix.length) / 9))}`.slice(0, 1600);
}
const distractors = distractorLabelTerms.map(syntheticDistractor);
// Synthetic layout only: the standalone bullet is removed and the exact saved
// paragraph is placed among non-entailing label entries; this is not V4 page adjacency.
const competition = [
  ...distractors,
  'Synthetic separator metadata.',
  completeOpeningParagraph,
  'Synthetic separator metadata.',
  ...distractors
];
const visibleFixtureText = competition.join('\n\n');
assert.ok(visibleFixtureText.length > 5000,
  'The synthetic mapped page must exercise the full bounded selector input.');
assert.ok(distractors.every(text => text.startsWith('Synthetic lexical-index entry, not source guidance:')),
  'All competitors are explicitly disclosed non-entailing synthetic metadata.');
const completeParagraphNormalized = normalize(completeOpeningParagraph);
const closed = { selectedGets: 0, closedKnownMappedGets: 0, unexpectedMappedGets: 0, discovery: 0, search: 0, ambient: 0 };
const knownMapsByUrl = new Map(IRAS_SOURCE_MAP_DEFINITIONS.map(row => [row.canonicalSourceUrl, row]));
const previousFetch = globalThis.fetch;
globalThis.fetch = async () => {
  closed.ambient += 1;
  throw new Error('AMBIENT_NETWORK_BLOCKED');
};

function understandingFor(testCase) {
  assert.ok(testCase?.issues?.length === 1, 'Each control remains single-issue.');
  const issueSource = testCase.issues[0];
  const interpretation = {
    schemaVersion: 2,
    jurisdiction: ['Singapore'],
    authorityCandidates: ['IRAS'],
    contextualAuthorities: [],
    domain: issueSource.domain,
    population: issueSource.population,
    primarySubject: issueSource.subject,
    concepts: [{ concept: issueSource.subject, role: 'PRIMARY' }],
    requestedOperation: issueSource.operation,
    factsExplicitlyProvided: [],
    confidence: 0.96,
    issues: [{
      subject: issueSource.subject,
      population: issueSource.population,
      domain: issueSource.domain,
      governingAuthorities: ['IRAS'],
      contextualAuthorities: [],
      operation: issueSource.operation,
      mappedTopicIds: [],
      evidenceRequirement: 'AUTHORITATIVE_SOURCE',
      confidence: 0.96
    }]
  };
  assert.ok(validateSemanticQuestionInterpretation(interpretation, testCase.query));
  const questionUnderstanding = { mode: 'SEMANTIC_INTERPRETATION', interpretation };
  const classification = classifyQuestion(testCase.query);
  const reconciled = reconcileQuestionUnderstanding(testCase.query, classification, questionUnderstanding);
  const issue = reconciled.issuePlan.issues.find(row => row.subject === issueSource.subject);
  assert.ok(issue);
  const topicIds = [...new Set([...(issue.mappedTopicIds || []), ...(testCase.requiredTopicIds || []), TOPIC_ID])];
  const requestedConcepts = getRequestedQuestionConcepts(testCase.query, questionUnderstanding)
    .filter(concept => !concept.topicIds.length || concept.topicIds.some(topicId => topicIds.includes(topicId)));
  return { questionUnderstanding, reconciled, issue, topicIds, requestedConcepts };
}

async function runPipeline(testCase, ruleText) {
  const { questionUnderstanding, reconciled, issue, topicIds, requestedConcepts } = understandingFor(testCase);
  const selectedPageHtml = `<html><head><title>${escapeHtml(mapPointer.documentTitle)} | IRAS</title></head>` +
    `<body><main><h1>${escapeHtml(mapPointer.documentTitle)} | IRAS</h1>` +
    competition.map((text, index) => index === distractors.length + 1
      ? `<p>${escapeHtml(ruleText)}</p>` : `<p>${escapeHtml(text)}</p>`).join('') +
    `</main></body></html>`;
  const discoveryAdapter = {
    async discoverOfficialSourceCandidates() { closed.discovery += 1; return []; },
    getLastFetchTrace() { return []; }
  };
  const officialDomainSearchAdapter = {
    async searchOfficialDomainCandidates() { closed.search += 1; return []; },
    getLastSearchTrace() { return []; }
  };
  const customFetch = async (urlValue, init = {}) => {
    const url = new URL(String(urlValue)).toString();
    assert.equal((init.method || 'GET').toUpperCase(), 'GET');
    if (url === mapDefinition.canonicalSourceUrl) {
      closed.selectedGets += 1;
      return new Response(selectedPageHtml, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
    }
    if (knownMapsByUrl.has(url) && knownMapsByUrl.get(url).domainId === 'IRAS_GST') {
      closed.closedKnownMappedGets += 1;
      return new Response(null, { status: 503 });
    }
    closed.unexpectedMappedGets += 1;
    return new Response(null, { status: 503 });
  };
  const webRetriever = new ControlledWebRetriever(undefined, new SourceCache());
  const groundingOptions = {
    discoveryAdapter,
    officialDomainSearchAdapter,
    webRetriever,
    fetchOptions: { customFetch, timeoutMs: 5000, useCache: false },
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
        domainId: mapDefinition.domainId,
        population: issue.population,
        primarySubject: issue.subject,
        concepts: [issue.subject],
        requestedOperation: issue.operation
      }
    }
  };
  const context = await buildGroundedReasoningContext(testCase.query, null,
    defaultAdvancedSourceRetriever, undefined, groundingOptions);
  const liveRecords = (context.evidenceQuality?.eligibleRecords || []).filter(record =>
    record.provenance === 'LIVE_EXTERNAL' && record.canonicalSourceUrl === mapDefinition.canonicalSourceUrl &&
    record.tags?.includes(TOPIC_ID));
  const rendered = renderIrasEvidenceResponse({}, context, testCase.query, null, 'SFRS_I', 'LOCAL');
  const workstreams = await buildAuthorityWorkstreams(testCase.query, reconciled.issuePlan, {
    retriever: defaultAdvancedSourceRetriever,
    questionUnderstanding,
    referenceDate: REFERENCE_DATE,
    groundingOptions
  });
  const finalIssue = workstreams.workstreams.flatMap(stream => stream.issues)
    .find(row => row.issueId === issue.id);
  assert.ok(finalIssue, 'The central workstream retains the frozen issue.');
  return { context, liveRecords, rendered, finalIssue };
}

const generalCase = irasResolverCases.find(row => row.id === 'gst-input-tax-general-rule');
assert.ok(generalCase);
try {
  const complete = await runPipeline(generalCase, completeOpeningParagraph);
  assert.ok(complete.liveRecords.length > 0, 'The selected registered GST map supplies an eligible live record.');
  assert.ok(complete.liveRecords.some(record => normalize(record.sourceText).includes(completeParagraphNormalized)),
    'The full live page retention preserves the complete original opening paragraph.');
  assert.ok(complete.liveRecords.some(record => supportGeneralIrasRuleConcept({
    sourceText: record.sourceText,
    domainId: mapDefinition.domainId,
    topicIds: record.tags,
    subject: generalCase.issues[0].subject,
    population: generalCase.issues[0].population,
    concepts: understandingFor(generalCase).requestedConcepts
  }) === true), 'The complete retained paragraph supports the requested general-rule concept.');
  const accepted = complete.rendered.claimVerification?.accepted || [];
  assert.ok(accepted.some(claim => normalize(claim.quote).includes(completeParagraphNormalized)),
    'The central renderer accepts a literal quote containing the complete saved opening paragraph.');
  assert.equal(complete.finalIssue.evidenceStatus, 'VERIFIED');
  assert.equal(complete.finalIssue.applicationStatus, 'NOT_REQUIRED');
  assert.deepEqual(complete.finalIssue.gaps, []);
  assert.ok(complete.finalIssue.verifiedClaims?.some(claim => normalize(claim.quote).includes(completeParagraphNormalized)));

  const firstSentenceOnly = await runPipeline(generalCase, openingSentences[0]);
  const missingCondition = await runPipeline(generalCase, `${openingSentences[0]} ${openingSentences[2]}`);
  for (const [label, control] of [['first-sentence-only', firstSentenceOnly], ['missing-condition-sentence', missingCondition]]) {
    assert.equal(control.liveRecords.some(record => supportGeneralIrasRuleConcept({
      sourceText: record.sourceText,
      domainId: mapDefinition.domainId,
      topicIds: record.tags,
      subject: generalCase.issues[0].subject,
      population: generalCase.issues[0].population,
      concepts: understandingFor(generalCase).requestedConcepts
    }) === true), false, `${label}: an incomplete passage does not support the complete rule.`);
    assert.notEqual(control.finalIssue.evidenceStatus, 'VERIFIED',
      `${label}: incomplete evidence cannot verify the full general entitlement.`);
    assert.equal(control.finalIssue.verifiedClaims?.some(claim => normalize(claim.quote).includes(completeParagraphNormalized)), false,
      `${label}: the omitted source sentences cannot appear in a verified quote.`);
  }

  const specificCase = irasResolverCases.find(row => row.id === 'private-holiday-gst-no-corporate-income-tax');
  assert.ok(specificCase, 'The adjacent private-holiday GST eligibility fixture exists.');
  const specific = await runPipeline(specificCase, completeOpeningParagraph);
  assert.equal(specific.finalIssue.applicationStatus, 'UNRESOLVED',
    'A general input-tax rule does not decide eligibility for a specific private-expense request without its application facts.');
  assert.ok(specific.finalIssue.gaps.length > 0,
    'The specific eligibility question retains its unresolved application gap.');
} finally {
  globalThis.fetch = previousFetch;
}

assert.equal(closed.ambient, 0, 'Ambient fetch remains blocked.');
assert.equal(closed.unexpectedMappedGets, 0, 'Only registered GST maps enter the closed injected transport.');
assert.equal(closed.discovery, 0, 'Official source discovery stays closed.');
assert.equal(closed.search, 0, 'Official-domain search stays closed.');
assert.ok(closed.selectedGets > 0, 'The registered IRAS GST input-tax page uses the injected synthetic response.');
process.stdout.write(`${JSON.stringify({
  status: 'OK',
  syntheticVisibleInputCharacterCount: visibleFixtureText.length,
  selectedRegisteredMapGetCount: closed.selectedGets,
  closedOtherGstMapGetCount: closed.closedKnownMappedGets,
  unexpectedMappedGetCount: closed.unexpectedMappedGets,
  ambientFetchCount: closed.ambient,
  discoveryCount: closed.discovery,
  searchCount: closed.search,
  positiveRetainedLiveRecordCount: 1,
  completeOpeningAcceptedAndVerified: true,
  incompleteControlsRemainUnverified: true,
  specificApplicationStatus: 'UNRESOLVED'
})}\n`);
