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
import { IRAS_SOURCE_MAP_DEFINITIONS, getCoverageTopicsByIds } from '../../../src/standards/coverageRegistry.ts';
import { buildAuthorityWorkstreams } from '../../../src/services/authorityWorkstreams.ts';
import { buildGroundedReasoningContext } from '../../../src/services/groundingContextBuilder.ts';
import { renderIrasEvidenceResponse } from '../../../src/services/irasEvidencePolicy.ts';
import { getRequestedQuestionConcepts, reconcileQuestionUnderstanding, validateSemanticQuestionInterpretation } from '../../../src/services/semanticQuestionUnderstanding.ts';
import { irasResolverCases } from '../../fixtures/irasResolverCases.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const OUTPUT_PATH = path.join(ROOT,
  'docs/evaluation/multi-authority-workstreams/iras-first-local-2026-10-02-v6/source-only-quote-selection-probe-v1.json');
const REFERENCE_DATE = '2026-10-02';
const SYNTHETIC_COMPOSITION = 'SYNTHETIC_COMPOSITION_NOT_ORIGINAL_PAGE_OR_BLOCK_ADJACENCY';
const sha256 = value => createHash('sha256').update(value).digest('hex');
const normalize = value => value.normalize('NFC').replace(/\s+/g, ' ').trim();
const escapeHtml = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

const readJson = async relativePath => JSON.parse(await readFile(path.join(ROOT, relativePath), 'utf8'));
const [foreignReport, gstReport] = await Promise.all([
  readJson('docs/evaluation/multi-authority-workstreams/iras-public-excerpts-2026-10-03-v2/iras-public-rule-excerpts-report-v2.json'),
  readJson('docs/evaluation/multi-authority-workstreams/iras-public-excerpts-2026-10-03-v1/iras-public-rule-excerpts-report-v1.json')
]);
const excerpt = (report, mapId, blockIndex) => {
  const result = report.results.find(row => row.mapId === mapId);
  const value = result?.excerpts.find(row => row.blockIndex === blockIndex);
  assert.ok(value && !value.truncated, `Saved public excerpt ${mapId}:${blockIndex} is intact.`);
  return value;
};

const foreignExcerpt = excerpt(foreignReport, 'IRAS_CIT_FOREIGN_INCOME_SOURCE_MAP', 10);
const foreignParts = foreignExcerpt.text.split(/\r?\n\s*\r?\n/);
assert.ok(foreignParts.length === 2 && /^Tax Reliefs on Foreign Income$/i.test(foreignParts[0]));
const foreignRule = foreignParts[1];
const gstExcerpt = excerpt(gstReport, 'IRAS_GST_INPUT_TAX_SOURCE_MAP', 7);
const gstHadStandaloneBullet = /^•\s*\r?\n\s*\r?\n/.test(gstExcerpt.text);
const gstRule = gstExcerpt.text.replace(/^•\s*\r?\n\s*\r?\n/, '').trim();
assert.equal(gstHadStandaloneBullet, true);
assert.equal(gstRule.split(/(?<=[.!?])\s+/).length, 3, 'The saved GST opening remains a complete three-sentence paragraph.');

const foreignCase = irasResolverCases.find(item => item.id === 'foreign-dividend-treatment');
const gstCase = irasResolverCases.find(item => item.id === 'gst-input-tax-general-rule');
assert.ok(foreignCase?.issues.length === 1 && gstCase?.issues.length === 1);
const syntheticForeignDistractors = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot'].map(label =>
  `Synthetic selection-only metadata ${label}: Singapore company, current year, Thai subsidiary, received, foreign dividend receipt, corporate income tax treatment, foreign-sourced income and exemption. This is query-topic metadata only; no tax outcome is stated.`);
const syntheticGstDistractors = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot'].map(label =>
  `Synthetic selection-only metadata ${label}: Singapore, GST-registered company, general GST rules, claiming input tax, business purchases, tax invoices and claim requirements. This is query-topic metadata only; no entitlement or tax outcome is stated.`);

const selectorStopwords = new Set([
  'about', 'after', 'also', 'and', 'are', 'been', 'before', 'being', 'but', 'can', 'could', 'does', 'for', 'from',
  'has', 'have', 'how', 'into', 'its', 'may', 'need', 'not', 'our', 'should', 'that', 'the', 'their', 'there',
  'these', 'this', 'those', 'through', 'under', 'was', 'were', 'what', 'when', 'where', 'which', 'who', 'with', 'would'
]);
function fallbackTerms(value) {
  return value.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).map(word => {
    if (word.endsWith('ies') && word.length > 5) return `${word.slice(0, -3)}y`;
    if (word.endsWith('es') && word.length > 5) return word.slice(0, -2);
    if (word.endsWith('s') && word.length > 4) return word.slice(0, -1);
    if (word.endsWith('ing') && word.length > 6) return word.slice(0, -3);
    if (word.endsWith('ed') && word.length > 5) return word.slice(0, -2);
    return word;
  });
}
function selectorScoreTrace(query, topicIds, rule, distractors, positions) {
  const topics = getCoverageTopicsByIds([...topicIds]);
  const topicTerms = new Set(fallbackTerms(topics.flatMap(topic => [topic.title, ...topic.keywords, ...(topic.aliases || [])]).join(' '))
    .filter(term => term.length >= 4 && !selectorStopwords.has(term)));
  const queryTerms = new Set(fallbackTerms(query).filter(term => term.length >= 4 && !selectorStopwords.has(term)));
  const items = [
    ...distractors.slice(0, positions.before).map((text, index) => ({ text, kind: 'synthetic_distractor', order: index })),
    { text: rule, kind: 'saved_public_rule', order: positions.before },
    ...distractors.slice(positions.before).map((text, index) => ({ text, kind: 'synthetic_distractor', order: positions.before + 1 + index }))
  ];
  const ranked = items.map(item => {
    const words = new Set(fallbackTerms(item.text));
    const topicMatches = [...topicTerms].filter(term => words.has(term)).length;
    const queryMatches = [...queryTerms].filter(term => words.has(term)).length;
    return {
      kind: item.kind,
      lexicalScore: topicMatches * 2 + queryMatches * 3,
      topicMatchCount: topicMatches,
      queryMatchCount: queryMatches,
      structurallyEligible: item.text.length >= 40 && item.text.length <= 1_600 &&
        !/^(?:on this page|share)\s*:?$/i.test(item.text.trim()) &&
        !/^(?:\|\s*)*[•◦▪](?:\s|$)/.test(item.text.trim()) &&
        !/^\d+[.)]\s/.test(item.text.trim()) && /[.!?]["')\]]?$/.test(item.text.trim()),
      order: item.order
    };
  }).sort((left, right) => right.lexicalScore - left.lexicalScore || left.order - right.order);
  const ruleRank = ranked.findIndex(item => item.kind === 'saved_public_rule') + 1;
  return {
    rankedCandidateCount: ranked.length,
    savedRuleLexicalScore: ranked.find(item => item.kind === 'saved_public_rule')?.lexicalScore || 0,
    savedRuleRank: ruleRank,
    higherScoringSyntheticCandidateCount: ranked.filter(item => item.kind === 'synthetic_distractor' &&
      item.lexicalScore > (ranked.find(candidate => candidate.kind === 'saved_public_rule')?.lexicalScore || 0)).length,
    savedRuleInsidePerRecordTopFive: ruleRank > 0 && ruleRank <= 5,
    allSyntheticCandidatesStructurallyEligible: ranked.filter(item => item.kind === 'synthetic_distractor')
      .every(item => item.structurallyEligible),
    allProjectedCandidatesStructurallyEligible: ranked.every(item => item.structurallyEligible)
  };
}

function understandingFor(testCase) {
  const frozenIssue = testCase.issues[0];
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
  assert.ok(validateSemanticQuestionInterpretation(interpretation, testCase.query));
  const questionUnderstanding = { mode: 'SEMANTIC_INTERPRETATION', interpretation };
  const classification = classifyQuestion(testCase.query);
  const reconciled = reconcileQuestionUnderstanding(testCase.query, classification, questionUnderstanding);
  const issue = reconciled.issuePlan.issues[0];
  const topicIds = [...new Set([...(issue.mappedTopicIds || []), ...(testCase.requiredTopicIds || [])])];
  const requestedConcepts = getRequestedQuestionConcepts(testCase.query, questionUnderstanding);
  assert.ok(topicIds.length > 0 && requestedConcepts.length > 0);
  return { questionUnderstanding, classification, reconciled, issue, topicIds, requestedConcepts };
}

function supportFor(text, domainId, issue, topicIds, requestedConcepts) {
  return requestedConcepts.map(concept => supportGeneralIrasRuleConcept({
    sourceText: text,
    domainId,
    topicIds: [...new Set([...topicIds, ...(concept.topicIds || [])])],
    subject: issue.subject,
    population: issue.population,
    concepts: [concept]
  }));
}

const cases = [
  {
    testCase: foreignCase,
    mapId: 'IRAS_CIT_FOREIGN_INCOME_SOURCE_MAP',
    sourceReport: foreignReport,
    sourceExcerpt: foreignExcerpt,
    topicId: 'iras-foreign-sourced-income',
    savedRule: foreignRule,
    heading: foreignParts[0],
    distractors: syntheticForeignDistractors,
    incompleteRule: foreignRule.split(/(?<=[.!?])\s+/).slice(0, 2).join(' '),
    bodyFor: (variant, distractors) => {
      const ruleBlock = `<section><h2>${escapeHtml(foreignParts[0])}</h2><p>${escapeHtml(variant === 'incomplete_only' ? foreignRule.split(/(?<=[.!?])\s+/).slice(0, 2).join(' ') : foreignRule)}</p></section>`;
      const before = variant === 'distractors_before_and_after' ? distractors.slice(0, 3).map(text => `<p>${escapeHtml(text)}</p>`).join('') : '';
      const after = variant === 'distractors_before_and_after' ? distractors.slice(3).map(text => `<p>${escapeHtml(text)}</p>`).join('') : '';
      return `${before}${ruleBlock}${after}`;
    },
    bulletOmitted: false
  },
  {
    testCase: gstCase,
    mapId: 'IRAS_GST_INPUT_TAX_SOURCE_MAP',
    sourceReport: gstReport,
    sourceExcerpt: gstExcerpt,
    topicId: 'iras-gst-input-tax',
    savedRule: gstRule,
    heading: undefined,
    distractors: syntheticGstDistractors,
    incompleteRule: gstRule.slice(0, gstRule.indexOf('. ') + 1),
    bodyFor: (variant, distractors) => {
      const rule = variant === 'incomplete_only' ? gstRule.slice(0, gstRule.indexOf('. ') + 1) : gstRule;
      const before = variant === 'distractors_before_and_after' ? distractors.slice(0, 3).map(text => `<p>${escapeHtml(text)}</p>`).join('') : '';
      const after = variant === 'distractors_before_and_after' ? distractors.slice(3).map(text => `<p>${escapeHtml(text)}</p>`).join('') : '';
      return `${before}<p>${escapeHtml(rule)}</p>${after}`;
    },
    bulletOmitted: true
  }
];

const closedCalls = {
  ambientFetch: 0,
  mappedFetch: 0,
  closedKnownMapFetch: 0,
  unexpectedMappedFetch: 0,
  discovery: 0,
  search: 0
};
const closedKnownMaps = new Map(['IRAS_GST_INVOICING_SOURCE_MAP'].map(id => {
  const definition = IRAS_SOURCE_MAP_DEFINITIONS.find(item => item.id === id);
  assert.ok(definition, `Frozen closed source map ${id} remains registered.`);
  return [definition.canonicalSourceUrl, id];
}));
const observedClosedKnownMapIds = new Set();
const actualFetch = globalThis.fetch;
globalThis.fetch = async () => {
  closedCalls.ambientFetch += 1;
  throw new Error('AMBIENT_NETWORK_DISABLED');
};

try {
  const variantResults = [];
  const caseDiagnoses = [];
  for (const sourceCase of cases) {
    const { testCase } = sourceCase;
    const caseResultStart = variantResults.length;
    const { questionUnderstanding, classification, reconciled, issue, topicIds, requestedConcepts } = understandingFor(testCase);
    assert.ok(classification.authorities.includes('IRAS'));
    assert.ok(topicIds.includes(sourceCase.topicId));
    const sourceMap = IRAS_SOURCE_MAP_DEFINITIONS.find(definition => definition.id === sourceCase.mapId);
    assert.ok(sourceMap && sourceMap.topicIds.includes(sourceCase.topicId));
    const sourceRuleSupport = supportFor(sourceCase.savedRule, sourceMap.domainId, issue, topicIds, requestedConcepts);
    assert.ok(sourceRuleSupport.includes(true), `${testCase.id} saved complete source rule is helper-supported.`);
    const incompleteSupport = supportFor(sourceCase.incompleteRule, sourceMap.domainId, issue, topicIds, requestedConcepts);
    assert.equal(incompleteSupport.includes(true), false, `${testCase.id} incomplete source-only control is unsupported.`);
    const distractorScoreTrace = selectorScoreTrace(testCase.query, topicIds, sourceCase.savedRule,
      sourceCase.distractors, { before: 3 });

    const variants = [
      { id: 'source_only', pageDistractors: [], pageRuleKind: 'complete' },
      { id: 'distractors_before_and_after', pageDistractors: sourceCase.distractors, pageRuleKind: 'complete' },
      { id: 'incomplete_only', pageDistractors: [], pageRuleKind: 'incomplete' }
    ];
    for (const variant of variants) {
      const sourceMapUrl = sourceMap.canonicalSourceUrl;
      const fetchEvents = [];
      const customFetch = async (urlValue, init = {}) => {
        const requestedUrl = String(urlValue);
        const method = (init.method || 'GET').toUpperCase();
        closedCalls.mappedFetch += 1;
        if (requestedUrl !== sourceMapUrl) {
          const frozenMapId = closedKnownMaps.get(requestedUrl);
          if (frozenMapId) {
            closedCalls.closedKnownMapFetch += 1;
            observedClosedKnownMapIds.add(frozenMapId);
          } else {
            closedCalls.unexpectedMappedFetch += 1;
          }
          return new Response(null, { status: 503 });
        }
        if (method !== 'GET') {
          closedCalls.unexpectedMappedFetch += 1;
          return new Response(null, { status: 503 });
        }
        fetchEvents.push({ status: 200 });
        const title = `${sourceMap.pageTitle} | IRAS`;
        const pageBody = sourceCase.bodyFor(variant.id, sourceCase.distractors);
        return new Response(`<html><head><title>${escapeHtml(title)}</title></head><body><main><h1>${escapeHtml(title)}</h1>${pageBody}</main></body></html>`, {
          status: 200,
          headers: { 'content-type': 'text/html; charset=utf-8' }
        });
      };
      const discoveryAdapter = {
        async discoverOfficialSourceCandidates() { closedCalls.discovery += 1; return []; },
        getLastFetchTrace() { return []; }
      };
      const officialDomainSearchAdapter = {
        async searchOfficialDomainCandidates() { closedCalls.search += 1; return []; },
        getLastSearchTrace() { return []; }
      };
      const webRetriever = new ControlledWebRetriever(undefined, new SourceCache());
      const adapters = { discoveryAdapter, officialDomainSearchAdapter };
      const groundingOptions = {
        ...adapters,
        webRetriever,
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
      const grounded = await buildGroundedReasoningContext(testCase.query, null,
        defaultAdvancedSourceRetriever, undefined, groundingOptions);
      const rendered = renderIrasEvidenceResponse({}, grounded, testCase.query, null, 'SFRS_I', 'LOCAL');
      const workstreams = await buildAuthorityWorkstreams(testCase.query, reconciled.issuePlan, {
        retriever: defaultAdvancedSourceRetriever,
        questionUnderstanding,
        referenceDate: REFERENCE_DATE,
        groundingOptions
      });
      const finalIssue = workstreams.workstreams.flatMap(stream => stream.issues).find(item => item.issueId === issue.id);
      assert.ok(finalIssue, `${testCase.id} returns its frozen issue in the central workstream.`);
      const eligibleRecords = (grounded.evidenceQuality?.eligibleRecords || [])
        .filter(record => record.canonicalSourceUrl === sourceMapUrl);
      const acceptedQuotes = (rendered.claimVerification?.accepted || []).filter(claim =>
        eligibleRecords.some(record => record.id === claim.recordId));
      const finalClaims = finalIssue.verifiedClaims || [];
      const acceptedFlags = acceptedQuotes.map(claim => {
        const supportFlags = supportFor(claim.quote, sourceMap.domainId, issue, topicIds, requestedConcepts);
        const normalizedQuote = normalize(claim.quote);
        return {
          quoteSha256: sha256(normalizedQuote),
          supportedRequestedConceptCount: supportFlags.filter(value => value === true).length,
          preservesCompleteSavedRule: normalizedQuote.includes(normalize(sourceCase.savedRule)),
          matchesSyntheticDistractor: sourceCase.distractors.some(text => normalizedQuote === normalize(text))
        };
      });
      const supportedEligibleRecords = eligibleRecords.filter(record =>
        supportFor(record.sourceText || '', sourceMap.domainId, issue, topicIds, requestedConcepts).includes(true));
      const eligibleRecordsPreservingSavedRule = eligibleRecords.filter(record =>
        normalize(record.sourceText || '').includes(normalize(sourceCase.savedRule)));
      const acceptedPerSource = new Map();
      for (const claim of acceptedQuotes) {
        const record = eligibleRecords.find(candidate => candidate.id === claim.recordId);
        const key = record?.canonicalSourceUrl || 'UNKNOWN_SOURCE';
        acceptedPerSource.set(key, (acceptedPerSource.get(key) || 0) + 1);
      }
      const result = {
        caseId: testCase.id,
        topicId: sourceCase.topicId,
        sourceMapId: sourceCase.mapId,
        variant: variant.id,
        composition: SYNTHETIC_COMPOSITION,
        sourceDocumentSha256: sourceCase.sourceExcerpt.documentSha256,
        savedRuleSha256: sha256(normalize(sourceCase.savedRule)),
        savedRuleDirectHelperSupport: sourceRuleSupport.includes(true),
        incompleteControlHelperSupport: incompleteSupport.includes(true),
        gstStandaloneLeadingBulletOmitted: sourceCase.bulletOmitted,
        syntheticDistractorCount: variant.pageDistractors.length,
        syntheticDistractorSha256: variant.pageDistractors.map(text => sha256(normalize(text))),
        syntheticDistractorScoreProjection: variant.id === 'distractors_before_and_after' ? distractorScoreTrace : undefined,
        mappedFetchCount: fetchEvents.length,
        eligibleMappedRecordCount: eligibleRecords.length,
        eligibleMappedRecordSourceTextSha256: eligibleRecords.map(record => sha256(normalize(record.sourceText || ''))),
        eligibleMappedRecordHelperSupportedCount: supportedEligibleRecords.length,
        eligibleMappedRecordPreservingCompleteRuleCount: eligibleRecordsPreservingSavedRule.length,
        rendererAcceptedMappedQuoteCount: acceptedQuotes.length,
        rendererRejectedClaimCount: rendered.claimVerification?.rejected?.length || 0,
        rendererAcceptedMappedHelperSupportedQuoteCount: acceptedFlags.filter(flag => flag.supportedRequestedConceptCount > 0).length,
        rendererAcceptedMappedQuotesPreservingCompleteRuleCount: acceptedFlags.filter(flag => flag.preservesCompleteSavedRule).length,
        acceptedQuoteHashesAndFlags: acceptedFlags,
        rendererAcceptedWithinThreePerSource: [...acceptedPerSource.values()].every(count => count <= 3),
        centralFinalVerifiedClaimCount: finalClaims.length,
        centralFinalHelperSupportedClaimCount: finalClaims.filter(claim =>
          supportFor(claim.quote, sourceMap.domainId, issue, topicIds, requestedConcepts).includes(true)).length,
        finalEvidenceStatus: finalIssue.evidenceStatus,
        finalApplicationStatus: finalIssue.applicationStatus,
        finalGapCodes: (finalIssue.gaps || []).map(gap => gap.code)
      };
      variantResults.push(result);
      if (variant.id === 'incomplete_only') {
        assert.equal(result.rendererAcceptedMappedHelperSupportedQuoteCount, 0,
          `${testCase.id} incomplete-only content produces no helper-supported renderer quote.`);
      }
    }

    const caseResults = variantResults.slice(caseResultStart);
    const sourceOnly = caseResults.find(result => result.variant === 'source_only');
    const withDistractors = caseResults.find(result => result.variant === 'distractors_before_and_after');
    const incompleteOnly = caseResults.find(result => result.variant === 'incomplete_only');
    assert.ok(sourceOnly && withDistractors && incompleteOnly);
    assert.ok(sourceOnly.eligibleMappedRecordHelperSupportedCount > 0,
      `${testCase.id} source-only mapped record contains complete helper-supported evidence.`);
    assert.ok(sourceOnly.rendererAcceptedMappedHelperSupportedQuoteCount > 0 &&
      sourceOnly.rendererAcceptedMappedQuotesPreservingCompleteRuleCount > 0,
      `${testCase.id} source-only renderer keeps the complete supported rule.`);
    assert.ok(sourceOnly.centralFinalVerifiedClaimCount > 0 && sourceOnly.centralFinalHelperSupportedClaimCount > 0,
      `${testCase.id} source-only central workstream retains a supported rule claim.`);
    assert.ok(withDistractors.eligibleMappedRecordHelperSupportedCount > 0 &&
      withDistractors.eligibleMappedRecordPreservingCompleteRuleCount > 0,
      `${testCase.id} the complete supported rule remains in admitted record text after distractors are added.`);
    const projection = withDistractors.syntheticDistractorScoreProjection;
    assert.ok(projection && projection.higherScoringSyntheticCandidateCount >= 5 &&
      projection.savedRuleRank > 5 && !projection.savedRuleInsidePerRecordTopFive,
      `${testCase.id} synthetic distractors rank the complete rule below the per-record top five.`);
    assert.equal(withDistractors.rendererAcceptedMappedHelperSupportedQuoteCount, 0);
    assert.equal(withDistractors.rendererAcceptedMappedQuotesPreservingCompleteRuleCount, 0);
    assert.ok(withDistractors.rendererAcceptedMappedQuoteCount <= 3 && withDistractors.rendererAcceptedWithinThreePerSource,
      `${testCase.id} distractor quotes stay within the per-source cap.`);
    assert.ok(withDistractors.acceptedQuoteHashesAndFlags.length > 0 &&
      withDistractors.acceptedQuoteHashesAndFlags.every(flag => flag.matchesSyntheticDistractor),
      `${testCase.id} accepted distractor-variant quotes match synthetic paragraphs.`);
    assert.equal(withDistractors.centralFinalVerifiedClaimCount, 0);
    assert.equal(withDistractors.centralFinalHelperSupportedClaimCount, 0);
    assert.equal(incompleteOnly.incompleteControlHelperSupport, false);
    assert.equal(incompleteOnly.rendererAcceptedMappedHelperSupportedQuoteCount, 0);
    assert.equal(incompleteOnly.centralFinalHelperSupportedClaimCount, 0);
    caseDiagnoses.push({
      caseId: testCase.id,
      sourceOnly: {
        admittedHelperSupportedRecordCount: sourceOnly.eligibleMappedRecordHelperSupportedCount,
        rendererAcceptedCompleteSupportedRuleCount: sourceOnly.rendererAcceptedMappedQuotesPreservingCompleteRuleCount,
        centralFinalHelperSupportedClaimCount: sourceOnly.centralFinalHelperSupportedClaimCount
      },
      syntheticDistractors: {
        composition: SYNTHETIC_COMPOSITION,
        paragraphCount: withDistractors.syntheticDistractorCount,
        higherScoringSyntheticParagraphCount: projection.higherScoringSyntheticCandidateCount,
        completeRuleProjectedRank: projection.savedRuleRank,
        completeRuleWithinPerRecordTopFive: projection.savedRuleInsidePerRecordTopFive,
        acceptedQuoteCount: withDistractors.rendererAcceptedMappedQuoteCount,
        acceptedQuotesMatchingSyntheticParagraphs: withDistractors.acceptedQuoteHashesAndFlags.filter(flag => flag.matchesSyntheticDistractor).length,
        rendererAcceptedHelperSupportedQuoteCount: withDistractors.rendererAcceptedMappedHelperSupportedQuoteCount,
        centralFinalHelperSupportedClaimCount: withDistractors.centralFinalHelperSupportedClaimCount
      },
      incompleteControl: {
        helperSupported: incompleteOnly.incompleteControlHelperSupport,
        rendererAcceptedHelperSupportedQuoteCount: incompleteOnly.rendererAcceptedMappedHelperSupportedQuoteCount,
        centralFinalHelperSupportedClaimCount: incompleteOnly.centralFinalHelperSupportedClaimCount
      },
      interpretation: 'In this synthetic composition, the complete rule falls outside the per-record top five before the separate three-per-source cap is applied.'
    });
  }

  assert.equal(closedCalls.ambientFetch, 0, 'All network access remains closed except the injected mapped transport.');
  assert.equal(closedCalls.unexpectedMappedFetch, 0, 'Only the selected frozen mapped source and enumerated closed maps are requested.');
  assert.equal(closedCalls.discovery, 0);
  assert.equal(closedCalls.search, 0);
  const report = {
    schemaVersion: 1,
    diagnosticOnly: true,
    interpretation: 'SYNTHETIC_COMPOSITION_NOT_ORIGINAL_PAGE_OR_BLOCK_ADJACENCY; hashes_and_counts_only; no_rule_inference',
    referenceDate: REFERENCE_DATE,
    savedSourceFingerprints: {
      foreign: foreignExcerpt.documentSha256,
      gst: gstExcerpt.documentSha256
    },
    selectorMechanicsInspected: {
      lexicalScore: '2 * distinctTopicTokenMatches + 3 * distinctQueryTokenMatches',
      candidatesKeptPerRecord: 5,
      acceptedClaimsCappedPerSource: 3,
      totalQuoteBoundForOneTopic: 5,
      scoreTraceIsDiagnosticOnly: true
    },
    caseDiagnoses,
    transportAndModel: {
      ambientFetchCalls: closedCalls.ambientFetch,
      injectedMappedGetCalls: closedCalls.mappedFetch,
      closedKnownMappedGetCalls: closedCalls.closedKnownMapFetch,
      closedKnownMappedSourceMapIds: [...observedClosedKnownMapIds],
      unexpectedMappedGetCalls: closedCalls.unexpectedMappedFetch,
      discoveryCalls: closedCalls.discovery,
      searchCalls: closedCalls.search,
      modelCalls: 0,
      modelResponse: 'EMPTY_LOCAL_OBJECT'
    },
    results: variantResults
  };
  await writeFile(OUTPUT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify({
    outputSha256: sha256(JSON.stringify(report)),
    results: variantResults.map(({ caseId, variant, eligibleMappedRecordCount,
      eligibleMappedRecordHelperSupportedCount, rendererAcceptedMappedQuoteCount,
      rendererAcceptedMappedHelperSupportedQuoteCount, rendererAcceptedMappedQuotesPreservingCompleteRuleCount,
      centralFinalVerifiedClaimCount, finalEvidenceStatus, finalApplicationStatus,
      syntheticDistractorScoreProjection }) => ({ caseId, variant, eligibleMappedRecordCount,
      eligibleMappedRecordHelperSupportedCount, rendererAcceptedMappedQuoteCount,
      rendererAcceptedMappedHelperSupportedQuoteCount, rendererAcceptedMappedQuotesPreservingCompleteRuleCount,
      centralFinalVerifiedClaimCount, finalEvidenceStatus, finalApplicationStatus,
      syntheticDistractorScoreProjection })),
    closedCalls
  })}\n`);
} finally {
  globalThis.fetch = actualFetch;
}
