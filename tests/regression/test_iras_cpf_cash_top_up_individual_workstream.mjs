import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { classifyQuestion } from '../../src/classification/questionClassifier.ts';
import { ControlledWebRetriever } from '../../src/retrieval/controlledWebRetriever.ts';
import { SourceCache } from '../../src/retrieval/sourceCache.ts';
import { defaultAdvancedSourceRetriever } from '../../src/retrieval/advancedSourceRetriever.ts';
import { IRAS_SOURCE_MAP_DEFINITIONS } from '../../src/standards/coverageRegistry.ts';
import { buildAuthorityWorkstreams } from '../../src/services/authorityWorkstreams.ts';
import { completeIrasCpfCashTopUpLimitQuotes } from '../../src/verification/claimEvidenceVerifier.ts';
import { getRequestedQuestionConcepts, reconcileQuestionUnderstanding, validateSemanticQuestionInterpretation } from '../../src/services/semanticQuestionUnderstanding.ts';

const query = 'Under IRAS rules, can cash top-ups to my own CPF Special Account or Retirement Account qualify for tax relief? Explain the general eligibility conditions and relief limits using official IRAS guidance. This is a general rules question; do not calculate my personal tax or create journal entries.';
const topicId = 'iras-individual-cpf-cash-top-up-relief';
const issueSubject = 'individual CPF cash top-up relief eligibility and limits';
const interpretation = {
  schemaVersion: 2,
  jurisdiction: ['Singapore'],
  authorityCandidates: ['IRAS'],
  contextualAuthorities: [],
  domain: 'IRAS_INCOME_TAX',
  population: 'INDIVIDUAL',
  primarySubject: issueSubject,
  concepts: [{ concept: 'CPF cash top-up tax relief eligibility and limits', role: 'PRIMARY' }],
  requestedOperation: 'EXPLAIN_RULE',
  factsExplicitlyProvided: [],
  confidence: 0.96,
  issues: [{
    subject: issueSubject,
    population: 'INDIVIDUAL',
    domain: 'IRAS_INCOME_TAX',
    governingAuthorities: ['IRAS'],
    contextualAuthorities: [],
    operation: 'EXPLAIN_RULE',
    mappedTopicIds: [topicId],
    evidenceRequirement: 'AUTHORITATIVE_SOURCE',
    confidence: 0.96
  }]
};
const validatedInterpretation = validateSemanticQuestionInterpretation(interpretation, query);
assert.ok(validatedInterpretation);
const questionUnderstanding = { mode: 'SEMANTIC_INTERPRETATION', assessmentStatus: 'PASSED', interpretation: validatedInterpretation };
const reconciled = reconcileQuestionUnderstanding(query, classifyQuestion(query), questionUnderstanding);
assert.equal(reconciled.issuePlan.source, 'SEMANTIC_ISSUES');
assert.equal(reconciled.issuePlan.issues.length, 1);
const issue = reconciled.issuePlan.issues[0];
assert.equal(issue.population, 'INDIVIDUAL');
const requestedConcepts = getRequestedQuestionConcepts(query, questionUnderstanding);
assert.ok(requestedConcepts.some(concept => concept.id === 'cpf_cash_top_up_relief_eligibility'));
assert.ok(requestedConcepts.some(concept => concept.id === 'cpf_cash_top_up_relief_limits'));

const fixture = JSON.parse(await readFile(new URL('../fixtures/iras_cpf_cash_top_up_current_excerpt.json', import.meta.url), 'utf8'));
const sourceText = fixture.sourceLines.join('\n\n');
const pageTitle = 'IRAS | Central Provident Fund (CPF) Cash Top-up Relief';
const sourceMaps = IRAS_SOURCE_MAP_DEFINITIONS.filter(definition =>
  definition.domainId === 'IRAS_INDIVIDUAL_TAX' && definition.topicIds.includes(topicId));
assert.ok(sourceMaps.length > 0);
const mappedUrls = new Map(sourceMaps.map(definition => {
  const source = defaultAdvancedSourceRetriever.getSourceById(definition.id);
  assert.ok(source?.officialSourceUrl);
  return [source.officialSourceUrl, source.documentTitle || pageTitle];
}));
const escapeHtml = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const fetchCalls = [];
const customFetch = async url => {
  const title = mappedUrls.get(String(url));
  assert.ok(title, `Only the mapped CPF relief page may be fetched: ${String(url)}`);
  fetchCalls.push(String(url));
  const html = `<html><head><title>${escapeHtml(pageTitle)}</title></head><body><main><h1>${escapeHtml(pageTitle)}</h1>${fixture.sourceLines.map(line => `<p>${escapeHtml(line)}</p>`).join('')}</main></body></html>`;
  return new Response(html, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
};
const emptyRetriever = {
  async retrieveSources() { return []; },
  getSourceById: id => defaultAdvancedSourceRetriever.getSourceById(id),
  findSourcesByStandardOrAct: (...args) => defaultAdvancedSourceRetriever.findSourcesByStandardOrAct(...args)
};
const emptyAdapters = {
  discoveryAdapter: { async discoverOfficialSourceCandidates() { return []; }, getLastFetchTrace() { return []; } },
  officialDomainSearchAdapter: { async searchOfficialDomainCandidates() { return []; }, getLastSearchTrace() { return []; } }
};
const actualFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('AMBIENT_NETWORK_BLOCKED'); };
let result;
try {
  result = await buildAuthorityWorkstreams(query, reconciled.issuePlan, {
    retriever: emptyRetriever,
    questionUnderstanding,
    referenceDate: '2026-10-24',
    groundingOptions: {
      ...emptyAdapters,
      webRetriever: new ControlledWebRetriever(undefined, new SourceCache()),
      fetchOptions: { timeoutMs: 1000, useCache: false, customFetch },
      authorityLevelDiscovery: false,
      localOnly: false,
      referenceDate: '2026-10-24'
    }
  });
} finally {
  globalThis.fetch = actualFetch;
}
const finalIssue = result.workstreams.flatMap(workstream => workstream.issues)
  .find(candidate => candidate.issueId === issue.id);
assert.ok(finalIssue);
assert.ok(fetchCalls.length > 0, 'The current mapped IRAS page is replayed through the ordinary source-fetch path.');
assert.equal(finalIssue.evidenceStatus, 'VERIFIED', JSON.stringify({
  gaps: finalIssue.gaps,
  concepts: requestedConcepts.map(concept => concept.id),
  quotes: finalIssue.verifiedClaims.map(claim => ({ recordId: claim.recordId, quoteLength: claim.quote.length })),
  excerptLength: finalIssue.sources[0]?.sourceText.length,
  excerptLimitQuoteLengths: finalIssue.sources[0] ? completeIrasCpfCashTopUpLimitQuotes(finalIssue.sources[0].sourceText).map(quote => quote.length) : [],
  excerptTableBlocks: finalIssue.sources[0]?.sourceText.split(/\r?\n[\t ]*\r?\n+/).map(value => value.trim()).filter(value => /Age of recipients|recipients below age 55|recipients aged 55 years and above|to check your top-up limit|Basic Healthcare Sum|the BHS/i.test(value))
}));
assert.ok(finalIssue.verifiedClaims.some(claim => /Singapore Citizen\/Permanent Resident/.test(claim.quote) &&
  /MRSS/.test(claim.quote) && /MMSS/.test(claim.quote)),
'The exact complete eligibility span includes both numbered conditions and both matching-grant exclusions.');
const limitQuotes = completeIrasCpfCashTopUpLimitQuotes(finalIssue.sources[0].sourceText);
assert.equal(limitQuotes.length, 2);
assert.ok(limitQuotes.every(quote => finalIssue.verifiedClaims.some(claim => claim.recordId === finalIssue.sources[0].id && claim.quote === quote)),
'The annual cap and full own-account table are retained as two separately verified exact source spans.');
assert.equal(finalIssue.lifecycle.covered, true,
  'The two exact CPF limit spans jointly cover the limits concept for the same admitted individual source record.');
console.log('IRAS individual CPF cash top-up workstream regression passed.');
