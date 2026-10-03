import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { classifyQuestion } from '../../src/classification/questionClassifier.ts';
import { ControlledWebRetriever } from '../../src/retrieval/controlledWebRetriever.ts';
import { defaultAdvancedSourceRetriever } from '../../src/retrieval/advancedSourceRetriever.ts';
import { SourceCache } from '../../src/retrieval/sourceCache.ts';
import { supportGeneralIrasRuleConcept } from '../../src/retrieval/irasRuleConceptSupport.ts';
import { IRAS_SOURCE_MAP_DEFINITIONS, getCoverageTopicsByIds } from '../../src/standards/coverageRegistry.ts';
import { buildAuthorityWorkstreams } from '../../src/services/authorityWorkstreams.ts';
import {
  getRequestedQuestionConcepts,
  reconcileQuestionUnderstanding,
  validateSemanticQuestionInterpretation
} from '../../src/services/semanticQuestionUnderstanding.ts';
import { irasResolverCases } from '../fixtures/irasResolverCases.mjs';

const CASE_ID = 'wht-royalty-general-rule';
const OVERVIEW_MAP_ID = 'IRAS_WHT_OVERVIEW_SOURCE_MAP';
const OVERVIEW_REPORT = new URL(
  '../../docs/evaluation/multi-authority-workstreams/iras-public-excerpts-2026-10-03-v1/iras-public-rule-excerpts-report-v1.json',
  import.meta.url
);
const TOPIC_IDS = ['iras-withholding-tax', 'iras-withholding-tax-interest-royalties'];
const REFERENCE_DATE = '2026-10-02';

const testCase = irasResolverCases.find(item => item.id === CASE_ID);
assert.ok(testCase && testCase.issues.length === 1, 'Frozen WHT fixture contract is available');
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
const questionUnderstanding = { mode: 'SEMANTIC_INTERPRETATION', interpretation };
const reconciled = reconcileQuestionUnderstanding(testCase.query, classifyQuestion(testCase.query), questionUnderstanding);
assert.equal(reconciled.issuePlan.source, 'SEMANTIC_ISSUES');
const plannedIssue = reconciled.issuePlan.issues.find(item => item.subject === issue.subject);
assert.ok(plannedIssue);
const topicIds = [...new Set(plannedIssue.mappedTopicIds)].sort();
assert.deepEqual(topicIds, [...TOPIC_IDS].sort());
const topics = getCoverageTopicsByIds(topicIds);
assert.ok(topics.every(topic => topic.domainId === 'IRAS_CORPORATE_TAX'));
const requestedConcepts = getRequestedQuestionConcepts(testCase.query, questionUnderstanding);
assert.ok(requestedConcepts.length > 0);

const report = JSON.parse(await readFile(OVERVIEW_REPORT, 'utf8'));
const overviewPage = report.results.find(row => row.mapId === OVERVIEW_MAP_ID);
const savedOverview = overviewPage?.excerpts.find(row => row.blockIndex === 10);
assert.ok(savedOverview && !savedOverview.truncated, 'Saved public V1 overview block 10 is available in full');
assert.equal(overviewPage.documentSha256, '25c6de0c2fd4d1d02103484329e9d3af77ea55886d512a754d43890fae64dc83');

const overviewMap = IRAS_SOURCE_MAP_DEFINITIONS.find(item => item.id === OVERVIEW_MAP_ID);
assert.ok(overviewMap);
assert.ok(TOPIC_IDS.every(topicId => overviewMap.topicIds.includes(topicId)),
  'The overview source map is registered for both general and royalty WHT topics');
const selectedMaps = [...new Map(topics.flatMap(topic => IRAS_SOURCE_MAP_DEFINITIONS
  .filter(definition => definition.domainId === topic.domainId && definition.topicIds.includes(topic.id))
  .map(definition => [definition.id, definition]))).values()];
assert.ok(selectedMaps.some(definition => definition.id === OVERVIEW_MAP_ID));
assert.ok(selectedMaps.length > 1, 'The WHT scope and rate pages remain separate mapped sources');

const normalize = text => text.normalize('NFC').replace(/\s+/g, ' ').trim();
const support = (sourceText, domainId = 'IRAS_CORPORATE_TAX') => supportGeneralIrasRuleConcept({
  sourceText,
  domainId,
  topicIds,
  subject: issue.subject,
  population: issue.population,
  concepts: requestedConcepts
});
assert.equal(support(savedOverview.text), true,
  'The literal saved overview statement supports the bounded non-resident royalty rule');
assert.notEqual(support(savedOverview.text, 'IRAS_INDIVIDUAL_TAX'), true,
  'The same sentence cannot support a mismatched accounting domain');
assert.notEqual(support(savedOverview.text.replace('to a non-resident company or individual', 'to a company or individual')), true,
  'Removing the non-resident qualification leaves this request unsupported');

const escapeHtml = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const mapByUrl = new Map(selectedMaps.map(definition => [definition.canonicalSourceUrl, definition]));
// Controlled fallback case: filter default-local evidence retrieval while
// retaining the real registered source-map pointer lookup. This isolates
// whether the overview page itself supports the requested topic. The unfiltered
// default-retriever control above reports its result and provenance separately.
const mappedFallbackRetriever = {
  async retrieveSources() { return []; },
  getSourceById(id) { return defaultAdvancedSourceRetriever.getSourceById(id); },
  findSourcesByStandardOrAct(...args) { return defaultAdvancedSourceRetriever.findSourcesByStandardOrAct(...args); }
};

async function runScenario({ overviewText, retriever = mappedFallbackRetriever }) {
  const fetchEvents = [];
  const adapterCalls = { discovery: 0, search: 0 };
  const webRetriever = new ControlledWebRetriever(undefined, new SourceCache());
  const adapters = {
    discoveryAdapter: {
      async discoverOfficialSourceCandidates() { adapterCalls.discovery += 1; return []; },
      getLastFetchTrace() { return []; }
    },
    officialDomainSearchAdapter: {
      async searchOfficialDomainCandidates() { adapterCalls.search += 1; return []; },
      getLastSearchTrace() { return []; }
    }
  };
  const fetchOptions = {
    timeoutMs: 10_000,
    useCache: false,
    customFetch: async urlValue => {
      const map = mapByUrl.get(new URL(urlValue).toString());
      assert.ok(map, `Synthetic fetch is restricted to selected IRAS maps: ${urlValue}`);
      const status = map.id === OVERVIEW_MAP_ID ? 200 : 503;
      fetchEvents.push({ mapId: map.id, status });
      if (status !== 200) return new Response('', { status });
      const title = `${map.pageTitle} | IRAS`;
      return new Response(`<!doctype html><html><head><title>${escapeHtml(title)}</title></head><body><main>` +
        `<h1>${escapeHtml(title)}</h1><p>${escapeHtml(overviewText)}</p></main></body></html>`, {
        status,
        headers: { 'content-type': 'text/html; charset=utf-8' }
      });
    }
  };
  const priorFetch = globalThis.fetch;
  let ambientFetchAttempts = 0;
  globalThis.fetch = async () => {
    ambientFetchAttempts += 1;
    throw new Error('AMBIENT_FETCH_BLOCKED');
  };
  try {
    const result = await buildAuthorityWorkstreams(testCase.query, reconciled.issuePlan, {
      retriever,
      questionUnderstanding,
      localOnly: false,
      referenceDate: REFERENCE_DATE,
      groundingOptions: {
        webRetriever,
        fetchOptions,
        ...adapters,
        authorityLevelDiscovery: false,
        localOnly: false,
        referenceDate: REFERENCE_DATE
      }
    });
    const finalIssue = result.workstreams.flatMap(workstream => workstream.issues)
      .find(item => item.issueId === plannedIssue.id);
    assert.ok(finalIssue, 'Central workstream retains the frozen WHT issue');
    assert.equal(ambientFetchAttempts, 0, 'No live network requests are made');
    assert.ok(fetchEvents.filter(event => event.mapId !== OVERVIEW_MAP_ID).every(event => event.status === 503));
    return { result, finalIssue, fetchEvents };
  } finally {
    globalThis.fetch = priorFetch;
  }
}

const defaultPathControl = await runScenario({
  overviewText: savedOverview.text,
  retriever: defaultAdvancedSourceRetriever
});
assert.equal(defaultPathControl.result.status, 'VERIFIED');
assert.equal(defaultPathControl.finalIssue.evidenceStatus, 'VERIFIED');
assert.equal(defaultPathControl.finalIssue.applicationStatus, 'NOT_REQUIRED');
assert.deepEqual(defaultPathControl.finalIssue.gaps, []);
const defaultPathClaimRecords = defaultPathControl.finalIssue.verifiedClaims.map(claim =>
  defaultPathControl.finalIssue.sources.find(record => record.id === claim.recordId)).filter(Boolean);
const defaultPathSummary = {
  status: defaultPathControl.result.status,
  verifiedClaimCount: defaultPathControl.finalIssue.verifiedClaims.length,
  sourceCount: defaultPathControl.finalIssue.sources.length,
  localVerifiedClaimCount: defaultPathClaimRecords.filter(record => record.provenance === 'LOCAL_STATIC').length,
  verifiedClaimProvenance: [...new Set(defaultPathClaimRecords.map(record => record.provenance))].sort(),
  overviewFetchCount: defaultPathControl.fetchEvents.filter(event => event.mapId === OVERVIEW_MAP_ID && event.status === 200).length
};
process.stdout.write(`DEFAULT_RETRIEVER_WHT_CONTROL ${JSON.stringify(defaultPathSummary)}\n`);

const positive = await runScenario({ overviewText: savedOverview.text });
assert.ok(positive.fetchEvents.some(event => event.mapId === OVERVIEW_MAP_ID && event.status === 200));
assert.equal(positive.result.status, 'VERIFIED');
assert.equal(positive.finalIssue.evidenceStatus, 'VERIFIED');
assert.equal(positive.finalIssue.applicationStatus, 'NOT_REQUIRED');
assert.deepEqual(positive.finalIssue.gaps, []);
const retainedOverviewClaims = positive.finalIssue.verifiedClaims.map(claim => ({
  claim,
  source: positive.finalIssue.sources.find(record => record.id === claim.recordId)
})).filter(({ source }) => source?.canonicalSourceUrl === overviewMap.canonicalSourceUrl);
assert.ok(retainedOverviewClaims.length > 0, 'A retained verified claim cites the fetched overview page');
const sameQuoteBindings = new Map();
for (const binding of retainedOverviewClaims) {
  const key = normalize(binding.claim.quote);
  const current = sameQuoteBindings.get(key) || [];
  current.push(binding);
  sameQuoteBindings.set(key, current);
}
assert.ok([...sameQuoteBindings.values()].some(bindings => {
  const topicBoundBindings = bindings.filter(({ claim, source }) => {
    const associatedTopicIds = new Set([
      ...(source.tags || []),
      ...(source.relatedTopicIds || []),
      ...(source.sourceMapTopicIds || []),
      ...(source.retrievalHints || [])
    ]);
    return TOPIC_IDS.some(topicId => associatedTopicIds.has(topicId)) &&
      normalize(claim.quote).includes(normalize(savedOverview.text)) &&
      support(claim.quote) === true &&
      source.urlVerificationStatus === 'VERIFIED' &&
      source.provenance === 'LIVE_EXTERNAL' &&
      source.sourceAuthority === 'IRAS';
  });
  const boundTopicIds = new Set(topicBoundBindings.flatMap(({ source }) => source.tags || []));
  return TOPIC_IDS.every(topicId => boundTopicIds.has(topicId));
}), 'The exact qualified quotation is independently verified from the same official page under both topic bindings');

const unsupportedText = 'Royalties to a non-resident company are mentioned in this withholding-tax overview.';
assert.notEqual(support(unsupportedText), true, 'A topical statement without the withholding rule is unsupported');
const negative = await runScenario({ overviewText: unsupportedText });
assert.ok(negative.fetchEvents.some(event => event.mapId === OVERVIEW_MAP_ID && event.status === 200));
assert.notEqual(negative.finalIssue.evidenceStatus, 'VERIFIED',
  'An official URL and related page title cannot establish the requested rule without supporting page text');
assert.equal(negative.finalIssue.verifiedClaims.length, 0,
  'Unsupported overview content cannot be borrowed into a retained claim');

process.stdout.write('IRAS WHT overview topic-binding regression passed.\n');
