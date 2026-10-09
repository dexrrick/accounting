import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { classifyQuestion } from '../../src/classification/questionClassifier.ts';
import { IRAS_SOURCE_MAP_DEFINITIONS, getCoverageTopicById, getCoverageTopicsByIds } from '../../src/standards/coverageRegistry.ts';
import { UNIFIED_SOURCE_REGISTRY } from '../../src/standards/unifiedSourceModel.ts';
import { ControlledWebRetriever } from '../../src/retrieval/controlledWebRetriever.ts';
import { SourceCache } from '../../src/retrieval/sourceCache.ts';
import { defaultAdvancedSourceRetriever } from '../../src/retrieval/advancedSourceRetriever.ts';
import { ExternalSourceValidator, matchesTopicContentTerm } from '../../src/retrieval/externalSourceValidator.ts';
import { buildGroundedReasoningContext } from '../../src/services/groundingContextBuilder.ts';
import {
  getRequestedQuestionConcepts,
  reconcileQuestionUnderstanding,
  validateSemanticQuestionInterpretation
} from '../../src/services/semanticQuestionUnderstanding.ts';
import { irasResolverCases } from '../fixtures/irasResolverCases.mjs';

const referenceDate = '2026-10-02';
const validator = new ExternalSourceValidator();
const originalFetch = globalThis.fetch;
let ambientFetchCalls = 0;
globalThis.fetch = async () => {
  ambientFetchCalls += 1;
  throw new Error('AMBIENT_NETWORK_DISABLED');
};

function escape(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function html(title, body) {
  return `<html><head><title>${escape(title)}</title></head><body><main><h1>${escape(title)}</h1>${body}</main></body></html>`;
}

function expectationFor(topicId, sourceMapId) {
  const topic = getCoverageTopicById(topicId);
  const definition = IRAS_SOURCE_MAP_DEFINITIONS.find(item => item.id === sourceMapId);
  assert.ok(topic && definition);
  const pointer = UNIFIED_SOURCE_REGISTRY[definition.id];
  return {
    standardIdentifiers: [pointer.standardOrActCode, pointer.documentTitle].filter(Boolean),
    expectedTitles: [pointer.documentTitle],
    topicTerms: [...new Set([
      topic.title, ...(topic.aliases || []), ...topic.keywords,
      ...(topic.requiredContentTerms || []), ...(topic.paragraphHints || []), ...(topic.sectionHints || [])
    ])],
    allowIrasTopicTokenEquivalence: topic.domainId.startsWith('IRAS_')
  };
}

function validate(topicId, sourceMapId, body, titleOverride) {
  const definition = IRAS_SOURCE_MAP_DEFINITIONS.find(item => item.id === sourceMapId);
  const title = titleOverride || UNIFIED_SOURCE_REGISTRY[definition.id].documentTitle;
  return validator.validateTopicContent(html(title, body), expectationFor(topicId, sourceMapId));
}

const privateFixtures = JSON.parse(await readFile(
  new URL('../../docs/evaluation/multi-authority-workstreams/iras-first-local-2026-10-02-v4/local-evidence-fixtures.json', import.meta.url),
  'utf8'
));
const singularPrivatePassage = privateFixtures.cases['private-disallowed-general'].passage;
const pluralPrivatePassage = singularPrivatePassage.replace(
  'a private expense is that it is not tax deductible because it does not serve a business purpose',
  'private expenses are not tax deductible because they do not serve a business purpose'
);
assert.notEqual(pluralPrivatePassage, singularPrivatePassage);
assert.equal(validate('iras-cit-disallowed-expenses', 'IRAS_CIT_EXPENSES_SOURCE_MAP', `<p>${escape(pluralPrivatePassage)}</p>`).isValid, true,
  'IRAS topic compatibility accepts the exact private-expense passage in plural form');
assert.equal(matchesTopicContentTerm('private expenses are not deductible', 'private expense', true), true);
assert.equal(matchesTopicContentTerm('private expenses are not deductible', 'expense', true), false,
  'the alternate is unavailable for a single-word topic term');
assert.equal(matchesTopicContentTerm('company tax residence depends on control and management', 'tax residence company control management', true), false,
  'generic corporate-residency words cannot use the IRAS token-order alternate');
assert.equal(validate('iras-corporate-tax-residency', 'IRAS_CIT_RESIDENCY_SOURCE_MAP',
  `<p>${escape(privateFixtures.cases['foreign-dividend-conditional-rule'].passage)}</p>`).isValid, false,
  'a residency page title cannot borrow generic company/tax/residence tokens from a foreign-dividend body');

const whtExpectation = {
  standardIdentifiers: ['IRAS_WHT_RATES_SOURCE_MAP', 'Withholding Tax Rates'],
  expectedTitles: ['Withholding Tax Rates'],
  topicTerms: ['royalty withholding tax'],
  allowIrasTopicTokenEquivalence: true
};
const whtPage = html('Withholding Tax Rates', '<section><h2>Withholding tax</h2><table><thead><tr><th>Nature of payment</th><th>Applicable rate</th></tr></thead><tbody><tr><td>Royalties</td><td>Omitted in this synthetic probe</td></tr></tbody></table></section>');
assert.equal(validator.validateTopicContent(whtPage, whtExpectation).isValid, true,
  'IRAS page compatibility finds all topic tokens across a heading and table row');
const missingRoyaltyPage = html('Withholding Tax Rates', '<section><h2>Withholding tax</h2><p>Singapore rules apply when a payer makes covered payments to a non-resident recipient under the relevant legislation.</p></section>');
assert.equal(validator.validateTopicContent(missingRoyaltyPage, whtExpectation).isValid, false,
  'the alternate rejects a page missing the royalty token');
const missingWithholdingPage = '<html><head><title>Withholding Tax Rates</title></head><body><main><h1>Royalties</h1><p>Singapore rules apply when a payer makes covered royalty payments to a non-resident recipient under the relevant legislation.</p></main></body></html>';
assert.equal(validator.validateTopicContent(missingWithholdingPage, whtExpectation).isValid, false,
  'the alternate rejects a page missing the withholding-tax tokens');
assert.equal(validate('iras-withholding-tax-interest-royalties', 'IRAS_WHT_RATES_SOURCE_MAP',
  '<p>A Singapore company may claim a deduction for qualifying renovation and refurbishment expenditure under a separate tax rule.</p>',
  'Corporate tax renovation and refurbishment deduction guidance').isValid, false,
'an unrelated sibling page does not gain mapped-topic compatibility');
assert.equal(validator.validateTopicContent(
  html('Withholding Tax Rates', '<nav>Withholding tax royalties withholding tax royalties withholding tax</nav><p>This page body contains only general navigation and unrelated corporate tax information.</p>'),
  whtExpectation
).isValid, false, 'navigation chrome cannot satisfy topic-term compatibility');

assert.equal(matchesTopicContentTerm('tax withholding royalties', 'royalty withholding tax', false), false,
  'non-IRAS callers do not receive word-order equivalence');
assert.equal(matchesTopicContentTerm('private expenses are not deductible', 'private expense', false), false,
  'non-IRAS callers do not receive plural equivalence');
assert.equal(matchesTopicContentTerm('royalty withholding tax', 'royalty withholding tax', false), true,
  'the existing exact phrase path remains available without IRAS opt-in');

function syntheticInterpretation(testCase) {
  const issue = testCase.issues[0];
  return {
    schemaVersion: 2,
    jurisdiction: ['Singapore'],
    authorityCandidates: [issue.authority],
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
      governingAuthorities: [issue.authority],
      contextualAuthorities: [],
      operation: issue.operation,
      mappedTopicIds: [],
      evidenceRequirement: 'AUTHORITATIVE_SOURCE',
      confidence: 0.96
    }]
  };
}

function urlKey(value) {
  const url = new URL(String(value));
  const host = url.hostname.toLowerCase() === 'iras.gov.sg' ? 'www.iras.gov.sg' : url.hostname.toLowerCase();
  return `${host}${url.pathname.toLowerCase().replace(/\/$/, '')}`;
}

function makeWhtPlan() {
  const testCase = irasResolverCases.find(item => item.id === 'wht-royalty-general-rule');
  assert.ok(testCase);
  const interpretation = syntheticInterpretation(testCase);
  assert.ok(validateSemanticQuestionInterpretation(interpretation, testCase.query));
  const understanding = { mode: 'SEMANTIC_INTERPRETATION', interpretation };
  const reconciled = reconcileQuestionUnderstanding(testCase.query, classifyQuestion(testCase.query), understanding);
  const issue = reconciled.issuePlan.issues[0];
  const topics = getCoverageTopicsByIds(issue.mappedTopicIds).filter(topic => topic.domainId.startsWith('IRAS_') && !topic.routingOnly);
  const topicIds = [...new Set(topics.map(topic => topic.id))].sort();
  const definitionById = new Map();
  for (const topic of topics) {
    for (const definition of IRAS_SOURCE_MAP_DEFINITIONS.filter(item => item.topicIds.includes(topic.id) && item.domainId === topic.domainId)) {
      definitionById.set(definition.id, definition);
    }
  }
  const definitions = [...definitionById.values()];
  const concepts = getRequestedQuestionConcepts(testCase.query, understanding).filter(concept =>
    concept.topicIds.some(topicId => topicIds.includes(topicId)));
  assert.ok(topicIds.includes('iras-withholding-tax-interest-royalties') && definitions.length);
  return { testCase, issue, topics, topicIds, definitions, concepts, understanding };
}

const whtPlan = makeWhtPlan();
const tableBody = '<section><h2>Withholding tax</h2><table><thead><tr><th>Nature of payment</th><th>Applicable rate</th></tr></thead><tbody><tr><td>Royalties</td><td>Omitted in this synthetic probe</td></tr></tbody></table></section>';

function emptyLocalRetriever() {
  return {
    async retrieveSources() { return []; },
    getSourceById: id => defaultAdvancedSourceRetriever.getSourceById(id),
    findSourcesByStandardOrAct: (...args) => defaultAdvancedSourceRetriever.findSourcesByStandardOrAct(...args)
  };
}

async function runMappedTableProbe({ unrelated = false, wrongDomain = false } = {}) {
  const pages = new Map(whtPlan.definitions.map(definition => {
    const pointer = UNIFIED_SOURCE_REGISTRY[definition.id];
    const body = unrelated
      ? '<p>A Singapore company may claim a deduction for qualifying renovation and refurbishment expenditure under a separate tax rule.</p>'
      : tableBody;
    return [urlKey(definition.canonicalSourceUrl), {
      title: unrelated ? 'Corporate tax renovation and refurbishment deduction guidance' : pointer.documentTitle,
      body
    }];
  }));
  const attempts = [];
  const customFetch = async url => {
    const page = pages.get(urlKey(url));
    assert.ok(page, 'only the selected source-map URLs are fetched');
    const response = new Response(html(page.title, page.body), { status: 200, headers: { 'content-type': 'text/html' } });
    if (wrongDomain) Object.defineProperty(response, 'url', { value: 'https://www.iras.gov.sg/taxes/individual-income-tax/foreign-source-guidance' });
    attempts.push(urlKey(url));
    return response;
  };
  const topics = whtPlan.topics;
  const evidenceScope = {
    authority: 'IRAS',
    domain: whtPlan.issue.domain,
    topicIds: whtPlan.topicIds,
    requestedConcepts: whtPlan.concepts,
    context: {
      domainId: topics[0].domainId,
      population: whtPlan.issue.population,
      primarySubject: whtPlan.issue.subject,
      concepts: [whtPlan.issue.subject],
      requestedOperation: whtPlan.issue.operation
    }
  };
  const context = await buildGroundedReasoningContext(whtPlan.testCase.query, null, emptyLocalRetriever(), undefined, {
    localOnly: false,
    authorityLevelDiscovery: false,
    referenceDate,
    questionUnderstanding: whtPlan.understanding,
    evidenceScope,
    webRetriever: new ControlledWebRetriever(undefined, new SourceCache()),
    fetchOptions: { timeoutMs: 1000, useCache: false, customFetch },
    discoveryAdapter: { async discoverOfficialSourceCandidates() { return []; }, getLastFetchTrace() { return []; } },
    officialDomainSearchAdapter: { async searchOfficialDomainCandidates() { return []; }, getLastSearchTrace() { return []; } }
  });
  return { context, attempts };
}

try {
  const admittedTable = await runMappedTableProbe();
  const royaltyTopicSuccesses = admittedTable.context.sourceMapFallbackTrace?.attempts.filter(attempt =>
    attempt.topicId === 'iras-withholding-tax-interest-royalties' && attempt.fetchStatus === 'SUCCESS') || [];
  const expectedRoyaltyTopicSuccessMapIds = [
    'IRAS_WHT_RATES_SOURCE_MAP',
    'IRAS_WHT_SCOPE_SOURCE_MAP',
    'IRAS_WHT_OVERVIEW_SOURCE_MAP'
  ];
  assert.equal(royaltyTopicSuccesses.length, expectedRoyaltyTopicSuccessMapIds.length,
    'the split heading/table phrase admits the reviewed royalty-topic maps for compatibility checks');
  assert.deepEqual(royaltyTopicSuccesses.map(attempt => attempt.sourceMapId).sort(),
    [...expectedRoyaltyTopicSuccessMapIds].sort(),
    'the exact successful map set reflects the overview topic association without asserting tax-rule support');
  assert.ok(admittedTable.context.evidenceQuality?.eligibleRecords.length > 0);
  // These synthetic successes establish compatibility/admission only; they assert no supported rate or verified tax rule.

  const unrelated = await runMappedTableProbe({ unrelated: true });
  assert.equal(unrelated.context.sourceMapFallbackTrace?.attempts.some(attempt => attempt.fetchStatus === 'SUCCESS'), false,
    'unrelated renovation content remains rejected');

  const wrongDomain = await runMappedTableProbe({ wrongDomain: true });
  assert.ok(wrongDomain.context.sourceMapFallbackTrace?.attempts.some(attempt =>
    attempt.topicId === 'iras-withholding-tax-interest-royalties' && attempt.fetchStatus === 'DOMAIN_MISMATCH'),
  'a matching WHT page returned under an individual-income-tax route remains rejected by the domain gate');
  assert.equal(ambientFetchCalls, 0, 'the focused regression uses no ambient network request');
} finally {
  globalThis.fetch = originalFetch;
}

process.stdout.write('IRAS bounded source-term compatibility regression passed.\n');
