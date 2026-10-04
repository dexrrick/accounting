import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { buildAuthorityWorkstreams } from '../../../../src/services/authorityWorkstreams.ts';
import { classifyQuestion } from '../../../../src/classification/questionClassifier.ts';
import { defaultSourceRetriever } from '../../../../src/retrieval/sourceRetriever.ts';
import { ControlledWebRetriever } from '../../../../src/retrieval/controlledWebRetriever.ts';
import { SourceCache } from '../../../../src/retrieval/sourceCache.ts';
import { reconcileQuestionUnderstanding, validateSemanticQuestionInterpretation, getRequestedQuestionConcepts } from '../../../../src/services/semanticQuestionUnderstanding.ts';
import { evaluateEvidenceQuality } from '../../../../src/retrieval/evidenceQualityGate.ts';

const referenceDate = '2026-10-03';
const query = 'Is a private expense deductible for corporate income tax?';
const issue = {
  subject: 'private expense corporate tax deductibility',
  population: 'COMPANY',
  domain: 'IRAS_INCOME_TAX',
  governingAuthorities: ['IRAS'],
  contextualAuthorities: [],
  operation: 'CHECK_ELIGIBILITY',
  mappedTopicIds: [],
  evidenceRequirement: 'AUTHORITATIVE_SOURCE_AND_CASE_FACTS',
  confidence: 0.96
};
const rawSemantic = {
  schemaVersion: 2,
  jurisdiction: ['Singapore'],
  authorityCandidates: ['IRAS'],
  contextualAuthorities: [],
  domain: 'IRAS_INCOME_TAX',
  population: 'COMPANY',
  primarySubject: 'private expense corporate tax deductibility',
  concepts: [{ concept: 'private expense', role: 'PRIMARY' }],
  requestedOperation: 'CHECK_ELIGIBILITY',
  factsExplicitlyProvided: [],
  confidence: 0.96,
  issues: [issue]
};
const semantic = validateSemanticQuestionInterpretation(rawSemantic, query);
assert.ok(semantic, 'Synthetic V2 interpretation passes production validation.');
const reconciled = reconcileQuestionUnderstanding(query, classifyQuestion(query), {
  mode: 'SEMANTIC_INTERPRETATION', interpretation: semantic
});
const issuePlan = reconciled.issuePlan;
const requestedConcepts = getRequestedQuestionConcepts(query, reconciled.understanding);
const localTopics = reconciled.classification.topicIds;
const localCandidates = await defaultSourceRetriever.retrieveSources({
  query, domain: 'IRAS_TAX', authorities: ['IRAS'], topicIds: localTopics,
  requestedConcepts, maxResults: 40, referenceDate
});
const localQuality = evaluateEvidenceQuality({
  query, topicIds: localTopics, records: localCandidates, missingFacts: [], requestedConcepts,
  scopedSubject: issue.subject, scopedPopulation: issue.population,
  authorities: ['IRAS'], referenceDate
});

const pageUrl = 'https://www.iras.gov.sg/taxes/corporate-income-tax/income-deductions-for-companies/business-expenses';
const syntheticPage = '<html><head><title>Corporate Tax Deductibility | Business Expenses | IRAS</title></head><body><main><h1>Business Expenses</h1><p>Under the Income Tax Act 1947, companies may claim a deduction for business expenses when wholly and exclusively incurred in producing income. Such expenses are deductible for tax under the general deduction rule in section 14. Section 15 disallows specified deductions, including domestic or private expenses, subject to statutory exceptions. This IRAS guidance explains which business expenses are deductible for tax.</p></main></body></html>';
const requestedSearches = [];
const fetchedUrls = [];
const webRetriever = new ControlledWebRetriever(undefined, new SourceCache());
const discoveryAdapter = {
  async discoverOfficialSourceCandidates(request) {
    requestedSearches.push({ topicId: request.topicId, topicTitle: request.topicTitle });
    return [pageUrl];
  },
  getCandidateTitle() { return 'Business Expenses | IRAS'; },
  getLastFetchTrace() { return []; }
};
const officialDomainSearchAdapter = {
  async searchOfficialDomainCandidates() { return []; },
  getLastSearchTrace() { return []; }
};
const syntheticFetch = async url => {
  fetchedUrls.push(String(url));
  return new Response(syntheticPage, { status: 200, headers: { 'content-type': 'text/html' } });
};
const workstreamResult = await buildAuthorityWorkstreams(query, issuePlan, {
  retriever: defaultSourceRetriever,
  questionUnderstanding: reconciled.understanding,
  referenceDate,
  groundingOptions: {
    localOnly: false,
    referenceDate,
    webRetriever,
    discoveryAdapter,
    officialDomainSearchAdapter,
    fetchOptions: { customFetch: syntheticFetch, useCache: false }
  }
});
const irasIssue = workstreamResult.workstreams.flatMap(workstream => workstream.issues)
  .find(item => item.issueId === issuePlan.issues[0].id);
assert.ok(irasIssue?.retrievalTrace?.attempts?.some(item => item.topicId === 'iras-cit-deductibility' && item.fetchStatus === 'SUCCESS'),
  'The normal local-first path fetches the mapped deductibility source when scoped local evidence is insufficient.');
assert.ok(irasIssue?.verifiedClaims.some(claim => claim.quote.includes('disallows specified deductions') &&
  claim.quote.includes('subject to statutory exceptions')),
  'The caveated private-expense rule remains literal verified evidence.');
assert.equal(irasIssue?.applicationStatus, 'UNRESOLVED',
  'Verified rule coverage does not resolve case-specific application without facts.');
assert.equal(irasIssue?.gaps.some(gap => gap.stage === 'covered'), false,
  'The live official page fills the registered deductibility topic and private-expense concept gap.');
const proof = {
  provenance: 'API-free semantic V2 mock; production defaultSourceRetriever; synthetic HTML through injected ControlledWebRetriever fetch; no provider/network access',
  referenceDate,
  query,
  issuePlan: {
    coverageEstablished: issuePlan.coverageEstablished,
    hasUnmappedResidual: issuePlan.hasUnmappedResidual,
    issueTopics: issuePlan.issues.map(item => item.mappedTopicIds)
  },
  reconciledClassification: { authorities: reconciled.classification.authorities, topicIds: localTopics },
  requestedConcepts: requestedConcepts.map(item => ({ id: item.id, label: item.label, topicIds: item.topicIds })),
  local: {
    candidateIds: localCandidates.map(record => record.id),
    status: localQuality.status,
    eligibleIds: localQuality.eligibleRecords.map(record => record.id),
    coveredTopicIds: localQuality.coveredTopicIds,
    uncoveredTopicIds: localQuality.uncoveredTopicIds,
    uncoveredConcepts: localQuality.uncoveredConcepts
  },
  fallback: {
    requestedSearches,
    fetchedUrls,
    path: irasIssue?.retrievalTrace?.path,
    attempts: irasIssue?.retrievalTrace?.attempts,
    stages: irasIssue?.retrievalTrace?.stages
  },
  finalIssue: {
    evidenceStatus: irasIssue?.evidenceStatus,
    applicationStatus: irasIssue?.applicationStatus,
    admittedSourceIds: irasIssue?.sources.map(record => record.id),
    verifiedClaimQuotes: irasIssue?.verifiedClaims?.map(claim => ({ recordId: claim.recordId, quote: claim.quote })),
    gaps: irasIssue?.gaps?.map(gap => ({ stage: gap.stage, code: gap.code, reason: gap.reason }))
  }
};
await writeFile(new URL('./lifecycle-local-mapped-proof-final.json', import.meta.url), JSON.stringify(proof, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
console.log(JSON.stringify(proof, null, 2));
