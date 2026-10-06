import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { classifyQuestion } from '../../src/classification/questionClassifier.ts';
import { ControlledWebRetriever } from '../../src/retrieval/controlledWebRetriever.ts';
import { defaultAdvancedSourceRetriever } from '../../src/retrieval/advancedSourceRetriever.ts';
import { SourceCache } from '../../src/retrieval/sourceCache.ts';
import { getCoverageTopicById, IRAS_SOURCE_MAP_DEFINITIONS } from '../../src/standards/coverageRegistry.ts';
import { buildAuthorityWorkstreams } from '../../src/services/authorityWorkstreams.ts';
import { buildGroundedReasoningContext } from '../../src/services/groundingContextBuilder.ts';
import { renderIrasEvidenceResponse } from '../../src/services/irasEvidencePolicy.ts';
import { supportGeneralIrasRuleConcept } from '../../src/retrieval/irasRuleConceptSupport.ts';
import { getRequestedQuestionConcepts, reconcileQuestionUnderstanding, validateSemanticQuestionInterpretation } from '../../src/services/semanticQuestionUnderstanding.ts';
import { irasResolverCases } from '../fixtures/irasResolverCases.mjs';

const testCase = irasResolverCases.find(item => item.id === 'foreign-dividend-treatment');
assert.ok(testCase && testCase.issues.length === 1);
const frozenIssue = testCase.issues[0];
const topicId = 'iras-foreign-sourced-income';
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
assert.equal(reconciled.issuePlan.source, 'SEMANTIC_ISSUES');
assert.equal(reconciled.issuePlan.issues.length, 1);
assert.ok(reconciled.classification.topicIds.includes(topicId));
const registeredTopic = getCoverageTopicById(topicId);
assert.ok(registeredTopic?.paragraphHints?.includes('Foreign income refers to income derived from outside Singapore'));
const requestedConcepts = getRequestedQuestionConcepts(testCase.query, questionUnderstanding);
const requestedConcept = requestedConcepts[0];
assert.ok(requestedConcept?.topicIds.includes(topicId));
const issue = reconciled.issuePlan.issues[0];
const topicIds = [...new Set([...issue.mappedTopicIds, topicId])];
const sourceMaps = IRAS_SOURCE_MAP_DEFINITIONS.filter(definition =>
  definition.domainId === 'IRAS_CORPORATE_TAX' && definition.topicIds.includes(topicId));
assert.equal(sourceMaps.length, 1);
const sourceMap = sourceMaps[0];
assert.equal(sourceMap.id, 'IRAS_CIT_FOREIGN_INCOME_SOURCE_MAP');
const report = JSON.parse(await readFile(new URL(
  '../../docs/evaluation/multi-authority-workstreams/iras-public-excerpts-2026-10-03-v2/iras-public-rule-excerpts-report-v2.json',
  import.meta.url), 'utf8'));
const savedExcerpt = report.results.find(row => row.mapId === sourceMap.id)?.excerpts
  ?.find(row => row.blockIndex === 10);
assert.ok(savedExcerpt && !savedExcerpt.truncated);
assert.equal(savedExcerpt.documentSha256, '4f7b80b92ab81ce3bc2d84604a5025d289b026bed0b358ee04d7a0dca1e37625');
const ruleParagraph = savedExcerpt.text.split(/\r?\n\s*\r?\n/).at(-1).trim();
const otherSavedExcerpt = report.results.find(row => row.mapId === sourceMap.id)?.excerpts
  ?.find(row => row.blockIndex === 37);
assert.ok(otherSavedExcerpt && !otherSavedExcerpt.truncated);
const v1Report = JSON.parse(await readFile(new URL(
  '../../docs/evaluation/multi-authority-workstreams/iras-public-excerpts-2026-10-03-v1/iras-public-rule-excerpts-report-v1.json',
  import.meta.url), 'utf8'));
const categoryListExcerpt = v1Report.results.find(row => row.mapId === sourceMap.id)?.excerpts
  ?.find(row => row.blockIndex === 41);
assert.ok(categoryListExcerpt && !categoryListExcerpt.truncated);

const normalize = text => text.normalize('NFC').replace(/\s+/g, ' ').trim();
const subject = frozenIssue.subject;
const concept = { label: requestedConcept.label, terms: requestedConcept.terms };
const ruleSupport = (sourceText, overrides = {}) => supportGeneralIrasRuleConcept({
  sourceText,
  domainId: 'IRAS_CORPORATE_TAX',
  topicIds,
  subject,
  population: frozenIssue.population,
  concepts: [concept],
  ...overrides
});
const ruleSupportForConcept = (sourceText, selectedConcept, requestSubject = subject) => supportGeneralIrasRuleConcept({
  sourceText,
  domainId: 'IRAS_CORPORATE_TAX',
  topicIds,
  subject: requestSubject,
  population: frozenIssue.population,
  concepts: [selectedConcept]
});

// This is the exact saved V2:10 three-sentence paragraph, without the block
// heading. Family selection bounds the conditional guidance path; the source
// definition scopes the general rule, while the dividend's origin stays unresolved.
assert.equal(ruleSupport(ruleParagraph), true,
  'The universal foreign-income definition plus its immediately linked general tax rule and complete qualification supports this frozen dividend scope.');
assert.equal(ruleSupport('Foreign income is taxable when received in Singapore.'), false,
  'A generic foreign-income statement without the definition and complete qualification remains unsupported.');
assert.equal(ruleSupport(otherSavedExcerpt.text), false,
  'The separate tax-resident-company exemption opening does not establish the general receipt rule.');
assert.equal(ruleSupport(categoryListExcerpt.text), false,
  'A category list that names foreign dividends without the linked tax rule does not establish support.');
assert.equal(ruleSupport(ruleParagraph.replace('Foreign income refers to income derived from outside Singapore.',
  'Foreign business profits refer to profits derived from outside Singapore.')), false,
  'A restricted profit definition cannot substitute for the unrestricted foreign-income definition.');
assert.equal(ruleSupport(`${ruleParagraph} Foreign dividends are excluded.`), false,
  'An explicit dividend exclusion prevents applying the universal definition to the requested dividend.');
assert.equal(ruleSupport(`${ruleParagraph} This definition excludes dividends.`), false,
  'An explicit definition-level dividend exclusion prevents applying the general rule.');
for (const exclusion of [
  'Dividends are excluded from this definition.',
  'This general rule does not cover dividends.',
  'This definition does not include foreign dividends.',
  'Foreign dividends are not covered by this rule.'
]) {
  assert.equal(ruleSupport(`${ruleParagraph}\n\n${exclusion}`), false,
    'An explicit dividend exclusion or noncoverage in a separate paragraph overrides the general rule paragraph.');
}
assert.equal(ruleSupport(ruleParagraph.replace('Generally, such income',
  'Interest is taxable in Singapore. Generally, such income')), false,
  'An intervening antecedent breaks the immediate link from the definition to the general rule.');
assert.equal(ruleSupport(ruleParagraph.replace('Foreign income refers to', 'Foreign income does not refer to')), false,
  'A negated definition cannot establish the source category.');
assert.equal(ruleSupport(ruleParagraph.replace('such income is taxable', 'such income is not taxable')), false,
  'A negated general taxability statement cannot establish the rule.');
assert.equal(ruleSupport(ruleParagraph.replace('Generally, such income', 'Generally, such interest')), false,
  'An unrelated interest predicate cannot establish foreign-income tax treatment.');
assert.equal(ruleSupport(ruleParagraph.split(' Where the foreign income arises')[0]), false,
  'Omitting the trade/business accrual qualification leaves the required source form incomplete.');
assert.equal(ruleSupport(ruleParagraph.replace('it is taxable in Singapore upon accrual',
  'it is not taxable in Singapore upon accrual')), false,
  'A negated trade/business accrual qualification cannot complete the rule.');
assert.notEqual(ruleSupport(ruleParagraph, {
  subject: 'Singapore corporate tax treatment of dividend paid by an overseas payer',
  concepts: [{ label: 'Singapore corporate tax treatment of dividend paid by an overseas payer', terms: [] }]
}), true, 'A foreign-payer-only request is not treated as foreign-sourced dividend scope.');
assert.equal(ruleSupport(ruleParagraph, {
  concepts: [{ label: subject, terms: ['treaty exemption conditions'] }]
}), undefined, 'A broader exemption request remains outside general foreign-income rule support.');
assert.equal(ruleSupport(ruleParagraph, {
  subject: 'Singapore corporate tax treatment of tax-free foreign dividend receipt',
  concepts: [{ label: 'tax-free treatment of foreign dividend receipt', terms: ['tax-free'] }]
}), undefined, 'The general receipt-tax paragraph cannot establish an explicit tax-free outcome.');

const savedUnits = [savedExcerpt.text, otherSavedExcerpt.text, categoryListExcerpt.text];
const sourceComposition = 'SYNTHETIC_COMPOSITION_NOT_ORIGINAL_PAGE';
const escapeHtml = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const [v2Block10, v2Block37, v1Block41] = savedUnits;
const sourceMapByUrl = new Map([[sourceMap.canonicalSourceUrl, sourceMap]]);
const fetchEvents = [];
const closedCalls = { discovery: 0, search: 0, model: 0 };
const discoveryAdapter = {
  async discoverOfficialSourceCandidates() { closedCalls.discovery += 1; return []; },
  getLastFetchTrace() { return []; }
};
const officialDomainSearchAdapter = {
  async searchOfficialDomainCandidates() { closedCalls.search += 1; return []; },
  getLastSearchTrace() { return []; }
};
const emptyAdapters = { discoveryAdapter, officialDomainSearchAdapter };
const sourceCache = new SourceCache();
const webRetriever = new ControlledWebRetriever(undefined, sourceCache);
const customFetch = async (urlValue, init = {}) => {
  const requestedMap = sourceMapByUrl.get(String(urlValue));
  assert.ok(requestedMap, 'The injected fetch refuses URLs outside the frozen foreign-income map.');
  assert.equal((init.method || 'GET').toUpperCase(), 'GET');
  fetchEvents.push({ mapId: requestedMap.id, status: 200 });
  const title = `${requestedMap.pageTitle} | IRAS`;
  const body = [v2Block10, v2Block37, v1Block41]
    .map(text => `<section><p>${escapeHtml(text)}</p></section>`).join('');
  return new Response(`<html><head><title>${escapeHtml(title)}</title></head><body><main><h1>${escapeHtml(title)}</h1>${body}</main></body></html>`, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' }
  });
};
const actualFetch = globalThis.fetch;
let ambientFetchCalls = 0;
globalThis.fetch = async () => { ambientFetchCalls += 1; throw new Error('AMBIENT_NETWORK_DISABLED'); };
const retriever = {
  retrieveSources: retrievalQuery => defaultAdvancedSourceRetriever.retrieveSources(retrievalQuery),
  getSourceById: id => defaultAdvancedSourceRetriever.getSourceById(id),
  findSourcesByStandardOrAct: (...args) => defaultAdvancedSourceRetriever.findSourcesByStandardOrAct(...args)
};
const helperForQuote = quote => ruleSupport(quote);

try {
  const evidenceScope = {
    authority: 'IRAS',
    domain: 'IRAS_CORPORATE_TAX',
    topicIds,
    requestedConcepts: [requestedConcept],
    context: {
      domainId: 'IRAS_CORPORATE_TAX',
      population: issue.population,
      primarySubject: issue.subject,
      concepts: [issue.subject],
      requestedOperation: issue.operation
    }
  };
  const context = await buildGroundedReasoningContext(testCase.query, null, retriever, undefined, {
    webRetriever,
    fetchOptions: { customFetch, timeoutMs: 10_000 },
    ...emptyAdapters,
    authorityLevelDiscovery: false,
    localOnly: false,
    referenceDate: '2026-10-02',
    questionUnderstanding,
    evidenceScope
  });
  const rendered = renderIrasEvidenceResponse({}, context, testCase.query, null, 'SFRS_I', 'LOCAL');
  const workstreams = await buildAuthorityWorkstreams(testCase.query, reconciled.issuePlan, {
    retriever,
    questionUnderstanding,
    referenceDate: '2026-10-02',
    groundingOptions: {
      webRetriever,
      fetchOptions: { customFetch, timeoutMs: 10_000 },
      ...emptyAdapters,
      authorityLevelDiscovery: false,
      localOnly: false,
      referenceDate: '2026-10-02'
    }
  });
  const finalIssue = workstreams.workstreams.flatMap(row => row.issues).find(row => row.issueId === issue.id);
  assert.ok(finalIssue);
  const acceptedClaims = rendered.claimVerification?.accepted || [];
  const finalClaims = finalIssue.verifiedClaims || [];
  const contextRecords = context.evidenceQuality?.eligibleRecords || [];
  const supportState = value => value === true ? 'SUPPORTED' : value === false ? 'RECOGNIZED_UNSUPPORTED' : 'UNRECOGNIZED';
  const isTopicAssociated = record => [...(record.tags || []), ...(record.relatedTopicIds || []),
    ...(record.sourceMapTopicIds || []), ...(record.retrievalHints || [])].includes(topicId);
  const issueConceptTrace = requestedConcepts.map(selectedConcept => ({
    conceptId: selectedConcept.id,
    topicAssociated: selectedConcept.topicIds.includes(topicId),
    conceptTextFlags: {
      hasDividendToken: /\bdividends?\b/i.test([selectedConcept.label, ...selectedConcept.terms].join(' ')),
      hasForeignOriginToken: /\b(?:foreign|overseas|outside)\b/i.test([selectedConcept.label, ...selectedConcept.terms].join(' ')),
      hasGeneralTaxToken: /\b(?:tax|taxable|treatment|income)\b/i.test([selectedConcept.label, ...selectedConcept.terms].join(' '))
    },
    fullParagraphSupport: supportState(ruleSupportForConcept(ruleParagraph, selectedConcept)),
    standaloneLabelSupport: supportState(ruleSupportForConcept(ruleParagraph, selectedConcept, selectedConcept.label)),
    retainedRecordSupport: contextRecords.map((record, recordIndex) => ({
      recordIndex,
      topicAssociated: isTopicAssociated(record),
      support: supportState(ruleSupportForConcept(record.sourceText || '', selectedConcept))
    })),
    acceptedQuoteSupport: acceptedClaims.map((claim, quoteIndex) => ({
      quoteIndex,
      support: supportState(ruleSupportForConcept(claim.quote, selectedConcept))
    })),
    finalQuoteSupport: finalClaims.map((claim, quoteIndex) => ({
      quoteIndex,
      support: supportState(ruleSupportForConcept(claim.quote, selectedConcept))
    }))
  }));
  const uncoveredTargets = (finalIssue.gaps || []).filter(gap => gap.code === 'ISSUE_CONCEPT_UNCOVERED')
    .map(gap => {
      const match = /requested (?:IRAS\s+)?(concept|topic)[:\s]+([a-z0-9_-]+)/i.exec(gap.reason || '');
      return { targetType: match?.[1]?.toLowerCase() || 'UNPARSED', targetId: match?.[2] || 'UNPARSED_FIXED_TARGET' };
    });
  const qualificationFlags = claims => claims.map(claim => {
    const normalizedQuote = normalize(claim.quote);
    return {
      hasDefinition: normalizedQuote.includes(normalize('Foreign income refers to income derived from outside Singapore.')),
      hasGeneralReceiptTaxability: normalizedQuote.includes(normalize('Generally, such income is taxable in Singapore when remitted to and received in Singapore.')),
      hasTradeBusinessAccrualQualification: normalizedQuote.includes(normalize('Where the foreign income arises from a trade or business carried on in Singapore, it is taxable in Singapore upon accrual, regardless of whether it is received in Singapore.')),
      includesSeparateExemptionOpening: normalizedQuote.includes(normalize(v2Block37))
    };
  });
  process.stdout.write(`${JSON.stringify({
    contextEligibleRecordCount: context.evidenceQuality?.eligibleRecords.length || 0,
    contextUncoveredConceptCount: context.evidenceQuality?.uncoveredConcepts.length || 0,
    fixedConceptIds: requestedConcepts.map(requested => requested.id),
    uncoveredTargets,
    sourceTopicAssociationFlags: contextRecords.map(isTopicAssociated),
    issueConceptTrace,
    rendererAcceptedCount: acceptedClaims.length,
    rendererRejectedCount: rendered.claimVerification?.rejected?.length || 0,
    acceptedQuoteFlags: acceptedClaims.map(claim => ({
      helperSupported: helperForQuote(claim.quote) === true,
      preservesWholeRuleParagraph: normalize(claim.quote).includes(normalize(ruleParagraph)),
      preservesExemptionOpening: normalize(claim.quote).includes(normalize(v2Block37)),
      sentenceFlags: [
        'Foreign income refers to income derived from outside Singapore.',
        'Generally, such income is taxable in Singapore when remitted to and received in Singapore.',
        'Where the foreign income arises from a trade or business carried on in Singapore, it is taxable in Singapore upon accrual, regardless of whether it is received in Singapore.'
      ].map(sentence => normalize(claim.quote).includes(normalize(sentence))),
      containsDividendExclusion: /\b(?:foreign(?:[ -]sourced)?|overseas)\s+dividends?\b[^.!?]{0,55}\b(?:excluded|not included|not covered)\b/i.test(claim.quote),
      paragraphCount: claim.quote.split(/\r?\n[\t ]*\r?\n+/).filter(Boolean).length
    })),
    finalClaimCount: finalClaims.length,
    finalEvidenceStatus: finalIssue.evidenceStatus,
    finalApplicationStatus: finalIssue.applicationStatus,
    finalGapCodes: (finalIssue.gaps || []).map(gap => gap.code),
    finalRuleClaimVerified: finalIssue.lifecycle?.verified === true,
    anyOriginFactClaim: finalClaims.some(claim => /\b(?:this|the) dividend\b[^.!?]{0,80}\b(?:is|was|has been) foreign(?:[ -]sourced)?\b/i.test(claim.text || '')),
    finalLifecycle: finalIssue.lifecycle
  })}\n`);
  assert.equal(sourceComposition, 'SYNTHETIC_COMPOSITION_NOT_ORIGINAL_PAGE');
  assert.ok(fetchEvents.length > 0);
  assert.ok(fetchEvents.every(event => event.mapId === sourceMap.id && event.status === 200));
  assert.equal(ambientFetchCalls, 0);
  assert.equal(closedCalls.discovery, 0);
  assert.equal(closedCalls.search, 0);
  assert.equal(closedCalls.model, 0);
  assert.ok(context.evidenceQuality?.eligibleRecords.length > 0);
  assert.ok(acceptedClaims.some(claim => normalize(claim.quote).includes(normalize(ruleParagraph))),
    'The renderer accepts a literal quote preserving the complete three-sentence paragraph.');
  assert.equal(finalIssue.lifecycle?.verified, true, 'The general rule quotation is verified.');
  assert.equal(finalIssue.applicationStatus, 'UNRESOLVED');
  assert.ok(finalClaims.length >= 1);
  assert.ok(finalClaims.some(claim => normalize(claim.quote).includes(normalize(ruleParagraph))),
    'The final verified claim preserves the complete paragraph and its qualification.');
  assert.ok(qualificationFlags(finalClaims).every(flags => flags.hasDefinition && flags.hasGeneralReceiptTaxability &&
    flags.hasTradeBusinessAccrualQualification && !flags.includesSeparateExemptionOpening));
  assert.ok(finalClaims.every(claim => helperForQuote(claim.quote) === true),
    'Every final claim is supported by the bounded general foreign-income rule, with no unsupported exemption claim.');
  assert.equal(finalIssue.evidenceStatus, 'VERIFIED', 'The exact public definition phrase closes the requested topic-support boundary.');
  assert.deepEqual(uncoveredTargets, [], 'The frozen foreign-income topic is covered by the complete supported rule quote.');
  assert.ok(issueConceptTrace.some(row => row.conceptId === requestedConcept.id && row.fullParagraphSupport === 'SUPPORTED' &&
    row.retainedRecordSupport.some(record => record.support === 'SUPPORTED') &&
    row.finalQuoteSupport.some(quote => quote.support === 'SUPPORTED')));
  assert.equal(finalClaims.some(claim => /\bdividend\b/i.test(claim.quote)), false,
    'The verified rule quote does not assert that the user’s dividend is foreign-sourced.');
  assert.equal(finalClaims.some(claim => /\b(?:this|the) dividend\b[^.!?]{0,80}\b(?:is|was|has been) foreign(?:[ -]sourced)?\b/i.test(claim.text || '')), false,
    'No workstream conclusion infers the origin of the user-specific dividend.');
} finally {
  globalThis.fetch = actualFetch;
}

process.stdout.write('IRAS defined foreign-income rule regression passed.\n');
