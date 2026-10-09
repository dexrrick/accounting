import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyQuestion } from '../../../../src/classification/questionClassifier.ts';
import { ControlledWebRetriever } from '../../../../src/retrieval/controlledWebRetriever.ts';
import { SourceCache } from '../../../../src/retrieval/sourceCache.ts';
import { defaultAdvancedSourceRetriever } from '../../../../src/retrieval/advancedSourceRetriever.ts';
import { IRAS_SOURCE_MAP_DEFINITIONS, getCoverageTopicsByIds } from '../../../../src/standards/coverageRegistry.ts';
import { UNIFIED_SOURCE_REGISTRY } from '../../../../src/standards/unifiedSourceModel.ts';
import { IRAS_STATUTE_RULES } from '../../../../src/standards/statutes/iras.ts';
import { buildGroundedReasoningContext } from '../../../../src/services/groundingContextBuilder.ts';
import {
  getRequestedQuestionConcepts,
  reconcileQuestionUnderstanding,
  validateSemanticQuestionInterpretation
} from '../../../../src/services/semanticQuestionUnderstanding.ts';

const directory = path.dirname(fileURLToPath(import.meta.url));
const referenceDate = '2026-10-02';
const ids = ['private-holiday-expense', 'wht-royalty-general-rule'];
const resolverCases = (await import('../../../../tests/fixtures/irasResolverCases.mjs')).irasResolverCases;
const localFixtures = JSON.parse(await readFile(path.join(directory, 'local-evidence-fixtures.json'), 'utf8'));
const mapsByTopic = new Map();
for (const definition of IRAS_SOURCE_MAP_DEFINITIONS) {
  for (const topicId of definition.topicIds) {
    const current = mapsByTopic.get(topicId) || [];
    current.push(definition);
    mapsByTopic.set(topicId, current);
  }
}

const originalFetch = globalThis.fetch;
let ambientFetchCalls = 0;
globalThis.fetch = async () => {
  ambientFetchCalls += 1;
  throw new Error('AMBIENT_NETWORK_DISABLED');
};

function hash(value) {
  return createHash('sha256').update(value).digest('hex');
}

function urlKey(value) {
  const url = new URL(String(value));
  const host = url.hostname.toLowerCase() === 'iras.gov.sg' ? 'www.iras.gov.sg' : url.hostname.toLowerCase();
  return `${host}${url.pathname.toLowerCase().replace(/\/$/, '')}`;
}

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
      evidenceRequirement: issue.facts ? 'AUTHORITATIVE_SOURCE_AND_CASE_FACTS' : 'AUTHORITATIVE_SOURCE',
      confidence: 0.96
    }]
  };
}

function buildPlan(caseId) {
  const testCase = resolverCases.find(item => item.id === caseId);
  assert.ok(testCase, `Frozen V4 resolver case exists: ${caseId}`);
  assert.equal(testCase.issues.length, 1);
  const interpretation = syntheticInterpretation(testCase);
  assert.ok(validateSemanticQuestionInterpretation(interpretation, testCase.query));
  const understanding = { mode: 'SEMANTIC_INTERPRETATION', interpretation };
  const reconciled = reconcileQuestionUnderstanding(testCase.query, classifyQuestion(testCase.query), understanding);
  assert.equal(reconciled.issuePlan.source, 'SEMANTIC_ISSUES');
  const issue = reconciled.issuePlan.issues[0];
  const topics = getCoverageTopicsByIds(issue.mappedTopicIds).filter(topic =>
    topic.domainId.startsWith('IRAS_') && !topic.routingOnly);
  const topicIds = [...new Set(topics.map(topic => topic.id))].sort();
  const definitionById = new Map();
  for (const topic of topics) {
    for (const definition of mapsByTopic.get(topic.id) || []) {
      if (definition.domainId === topic.domainId) definitionById.set(definition.id, definition);
    }
  }
  const definitions = [...definitionById.values()];
  const concepts = getRequestedQuestionConcepts(testCase.query, understanding)
    .filter(concept => concept.topicIds.some(topicId => topicIds.includes(topicId)));
  assert.ok(topicIds.length && definitions.length);
  return { caseId, testCase, issue, topics, topicIds, definitions, concepts, understanding };
}

function emptyLocalRetriever() {
  return {
    async retrieveSources() { return []; },
    getSourceById: id => defaultAdvancedSourceRetriever.getSourceById(id),
    findSourcesByStandardOrAct: (...args) => defaultAdvancedSourceRetriever.findSourcesByStandardOrAct(...args)
  };
}

function escape(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function makeHtml(title, body) {
  return `<html><head><title>${escape(title)}</title></head><body><main><h1>${escape(title)}</h1>${body}</main></body></html>`;
}

function syntheticPages(plan, variant) {
  if (plan.caseId === 'private-holiday-expense') {
    const singularPassage = localFixtures.cases['private-disallowed-general'].passage;
    const pluralOnlyPassage = singularPassage.replace(
      'a private expense is that it is not tax deductible because it does not serve a business purpose',
      'private expenses are not tax deductible because they do not serve a business purpose'
    );
    assert.notEqual(pluralOnlyPassage, singularPassage, 'plural-only probe changes only grammatical number and agreement');
    const passage = variant === 'plural-only-control'
      ? pluralOnlyPassage
      : variant === 'approved-statute-wording'
        ? IRAS_STATUTE_RULES.ITA_SEC15_PROHIBITED_DEDUCTIONS.practicalRules[0]
        : variant === 'unrelated-sibling-control'
          ? 'A Singapore company may claim a deduction for qualifying renovation and refurbishment expenditure under the separate Section 14N rules.'
          : singularPassage;
    const body = `<p>${escape(passage)}</p>`;
    return new Map(plan.definitions.map(definition => [urlKey(definition.canonicalSourceUrl), {
      title: UNIFIED_SOURCE_REGISTRY[definition.id].documentTitle,
      body,
      sourcePhraseHash: hash(passage).slice(0, 12)
    }]));
  }

  const contiguousPassage = localFixtures.cases['wht-royalty-hyphenated-query'].passage;
  const tableBody = '<section><h2>Withholding tax</h2><table><thead><tr><th>Nature of payment</th><th>Applicable rate</th></tr></thead><tbody><tr><td>Royalties</td><td>Omitted in this synthetic probe</td></tr></tbody></table></section>';
  const unrelatedBody = '<p>A Singapore company may claim a deduction for qualifying renovation and refurbishment expenditure under the separate Section 14N rules. This renovation guidance does not address payments to non-resident companies.</p>';
  return new Map(plan.definitions.map(definition => {
    const pointer = UNIFIED_SOURCE_REGISTRY[definition.id];
    const body = variant === 'category-table-only'
      ? tableBody
      : variant === 'unrelated-sibling-control'
        ? unrelatedBody
        : `<p>${escape(contiguousPassage)}</p>`;
    return [urlKey(definition.canonicalSourceUrl), {
      title: variant === 'unrelated-sibling-control'
        ? 'Corporate tax renovation and refurbishment deduction guidance'
        : pointer.documentTitle,
      body,
      sourcePhraseHash: hash(variant === 'category-table-only' ? tableBody :
        variant === 'unrelated-sibling-control' ? unrelatedBody : contiguousPassage).slice(0, 12)
    }];
  }));
}

async function runProbe(plan, variant) {
  const pages = syntheticPages(plan, variant);
  const fetches = [];
  const customFetch = async url => {
    const key = urlKey(url);
    const page = pages.get(key);
    assert.ok(page, `${plan.caseId}: fixture transport only serves selected approved source-map URLs`);
    fetches.push(hash(key).slice(0, 12));
    return new Response(makeHtml(page.title, page.body), {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' }
    });
  };
  const topics = plan.topics;
  const evidenceScope = {
    authority: 'IRAS',
    domain: plan.issue.domain,
    topicIds: plan.topicIds,
    requestedConcepts: plan.concepts,
    context: {
      domainId: topics[0].domainId,
      population: plan.issue.population,
      primarySubject: plan.issue.subject,
      concepts: [plan.issue.subject],
      requestedOperation: plan.issue.operation
    }
  };
  const context = await buildGroundedReasoningContext(plan.testCase.query, null,
    emptyLocalRetriever(), undefined, {
      localOnly: false,
      authorityLevelDiscovery: false,
      referenceDate,
      questionUnderstanding: plan.understanding,
      evidenceScope,
      webRetriever: new ControlledWebRetriever(undefined, new SourceCache()),
      fetchOptions: { timeoutMs: 1000, useCache: false, customFetch },
      discoveryAdapter: { async discoverOfficialSourceCandidates() { return []; }, getLastFetchTrace() { return []; } },
      officialDomainSearchAdapter: { async searchOfficialDomainCandidates() { return []; }, getLastSearchTrace() { return []; } }
    });
  const trace = context.sourceMapFallbackTrace;
  const uncoveredConceptLabels = context.evidenceQuality?.uncoveredConcepts || [];
  return {
    caseId: plan.caseId,
    variant,
    selectedTopicIds: plan.topicIds,
    sourceMapIds: [...new Set(plan.definitions.map(definition => definition.id))].sort(),
    sourcePhraseSha256Prefixes: [...new Set([...pages.values()].map(page => page.sourcePhraseHash))].sort(),
    mapFetchCount: fetches.length,
    mapFetchUrlSha256Prefixes: fetches,
    sourceMapPath: trace?.path,
    selectedCandidateRecordCount: trace?.selectedRecordIds?.length || 0,
    eligibleRecordCount: context.evidenceQuality?.eligibleRecords.length || 0,
    rejectedCandidateCodes: (context.evidenceQuality?.rejectedRecords || []).map(item => item.code),
    uncoveredTopicIds: context.evidenceQuality?.uncoveredTopicIds || [],
    uncoveredConceptIds: plan.concepts.filter(concept => uncoveredConceptLabels.includes(concept.label)).map(concept => concept.id),
    attempts: (trace?.attempts || []).map(attempt => ({
      topicId: attempt.topicId,
      sourceMapId: attempt.sourceMapId,
      fetchStatus: attempt.fetchStatus,
      rejectionStage: attempt.fetchStatus === 'TOPIC_MISMATCH'
        ? 'MAPPED_PAGE_TOPIC_COMPATIBILITY'
        : attempt.fetchStatus === 'SUCCESS' ? 'MAPPED_PAGE_ADMITTED_TO_EXCERPT_CHECKS' : attempt.fetchStatus
    }))
  };
}

try {
  const plans = ids.map(buildPlan);
  const sourceProbes = [];
  for (const plan of plans) {
    const variants = plan.caseId === 'private-holiday-expense'
      ? ['singular-local-control', 'plural-only-control', 'approved-statute-wording', 'unrelated-sibling-control']
      : ['contiguous-phrase-control', 'category-table-only', 'unrelated-sibling-control'];
    for (const variant of variants) sourceProbes.push(await runProbe(plan, variant));
  }
  assert.equal(ambientFetchCalls, 0, 'No ambient network request occurred');
  const getProbe = (caseId, variant) => sourceProbes.find(probe => probe.caseId === caseId && probe.variant === variant);
  const privateSingular = getProbe('private-holiday-expense', 'singular-local-control');
  const privatePlural = getProbe('private-holiday-expense', 'plural-only-control');
  const privateUnrelated = getProbe('private-holiday-expense', 'unrelated-sibling-control');
  const whtContiguous = getProbe('wht-royalty-general-rule', 'contiguous-phrase-control');
  const whtTable = getProbe('wht-royalty-general-rule', 'category-table-only');
  const whtUnrelated = getProbe('wht-royalty-general-rule', 'unrelated-sibling-control');
  assert.ok(privateSingular.eligibleRecordCount > 0, 'the original private-expense wording remains the positive baseline');
  assert.equal(privateSingular.attempts.find(attempt => attempt.topicId === 'iras-cit-disallowed-expenses')?.fetchStatus, 'SUCCESS');
  assert.equal(privatePlural.attempts.find(attempt => attempt.topicId === 'iras-cit-disallowed-expenses')?.fetchStatus, 'TOPIC_MISMATCH',
    'the plural-only probe fails only at the intended disallowed-expenses topic boundary');
  assert.equal(privateUnrelated.eligibleRecordCount, 0, 'an unrelated sibling topic does not admit private-expense evidence');
  assert.ok(whtContiguous.eligibleRecordCount > 0, 'contiguous royalty-withholding wording is the WHT positive control');
  assert.ok(whtTable.eligibleRecordCount > 0, 'the category/table probe admits mapped evidence for compatibility-stage analysis');
  assert.equal(whtTable.attempts.some(attempt => attempt.topicId === 'iras-withholding-tax-interest-royalties' && attempt.fetchStatus === 'TOPIC_MISMATCH'), true);
  assert.equal(whtUnrelated.eligibleRecordCount, 0, 'an unrelated sibling topic does not admit WHT evidence');
  const report = {
    schemaVersion: 1,
    profileVersion: 'private-wht-source-phrase-diagnostic-v1',
    mode: 'API_FREE_APPROVED_REGISTRY_AND_SYNTHETIC_MAPPED_PAGE_PROBES',
    referenceDate,
    selectedCaseIds: ids,
    modelRequests: 0,
    ambientFetchCalls,
    sourceHintSnapshot: plans.map(plan => ({
      caseId: plan.caseId,
      topicIds: plan.topics.map(topic => topic.id),
      topics: plan.topics.map(topic => ({
        topicId: topic.id,
        paragraphHints: topic.paragraphHints || [],
        sectionHints: topic.sectionHints || [],
        keywords: topic.keywords
      }))
    })),
    caveats: [
      'The private plural-only probe is a minimal grammatical-number transformation of the original local fixture; approved Section 15 wording is a separate comparison. Source-map pages are synthetic in-memory HTML.',
      'The WHT category table is synthetic and states no rate or substantive tax conclusion; its royalty label is separated from the withholding-tax heading.',
      'Attempt statuses identify the generic mapped-page compatibility stage only; normalized title/content flags are omitted. These probes do not reproduce or infer unretained V4 raw page text.'
    ],
    probes: sourceProbes
  };
  const outputPath = path.join(directory, 'private-wht-source-phrase-diagnostic-v1.json');
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} finally {
  globalThis.fetch = originalFetch;
}
