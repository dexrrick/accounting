import assert from 'node:assert/strict';
import { classifyQuestion } from '../../src/classification/questionClassifier.ts';
import { ControlledWebRetriever } from '../../src/retrieval/controlledWebRetriever.ts';
import { SourceCache } from '../../src/retrieval/sourceCache.ts';
import { defaultSourceRetriever } from '../../src/retrieval/sourceRetriever.ts';
import { buildAuthorityWorkstreams } from '../../src/services/authorityWorkstreams.ts';
import {
  reconcileQuestionUnderstanding,
  validateSemanticQuestionInterpretation
} from '../../src/services/semanticQuestionUnderstanding.ts';
import { UNIFIED_SOURCE_REGISTRY } from '../../src/standards/unifiedSourceModel.ts';

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
const interpretation = validateSemanticQuestionInterpretation({
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
}, query);
assert.ok(interpretation, 'The bounded semantic issue mock passes production validation.');
const reconciled = reconcileQuestionUnderstanding(query, classifyQuestion(query), {
  mode: 'SEMANTIC_INTERPRETATION', interpretation
});

const pageUrl = 'https://www.iras.gov.sg/taxes/corporate-income-tax/income-deductions-for-companies/business-expenses';
const syntheticPage = '<html><head><title>Corporate Tax Deductibility | Business Expenses | IRAS</title></head><body><main><h1>Business Expenses</h1><p>Under the Income Tax Act 1947, companies may claim a deduction for business expenses when wholly and exclusively incurred in producing income. Such expenses are deductible for tax under the general deduction rule in section 14. Section 15 disallows specified deductions, including domestic or private expenses, subject to statutory exceptions. This IRAS guidance explains which business expenses are deductible for tax.</p></main></body></html>';
const fetches = [];
const searches = [];
const webRetriever = new ControlledWebRetriever(undefined, new SourceCache());
const discoveryAdapter = {
  async discoverOfficialSourceCandidates(request) {
    searches.push(request.topicId);
    return [pageUrl];
  },
  getCandidateTitle() { return 'Business Expenses | IRAS'; },
  getLastFetchTrace() { return []; }
};
const officialDomainSearchAdapter = {
  async searchOfficialDomainCandidates() { return []; },
  getLastSearchTrace() { return []; }
};
const customFetch = async url => {
  fetches.push(String(url));
  return new Response(syntheticPage, { status: 200, headers: { 'content-type': 'text/html' } });
};

const result = await buildAuthorityWorkstreams(query, reconciled.issuePlan, {
  retriever: defaultSourceRetriever,
  questionUnderstanding: reconciled.understanding,
  referenceDate,
  groundingOptions: {
    localOnly: false,
    referenceDate,
    webRetriever,
    discoveryAdapter,
    officialDomainSearchAdapter,
    fetchOptions: { customFetch, useCache: false }
  }
});
const evidence = result.workstreams.flatMap(workstream => workstream.issues)
  .find(item => item.issueId === reconciled.issuePlan.issues[0].id);
assert.ok(evidence, 'The mapped IRAS issue reaches the default local-to-mapped evidence path.');
assert.ok(fetches.includes(pageUrl), 'The mapped IRAS page is fetched through the injected synthetic response.');
assert.ok(evidence.retrievalTrace?.attempts?.some(attempt =>
  attempt.topicId === 'iras-cit-deductibility' && attempt.fetchStatus === 'SUCCESS'));
assert.ok(evidence.sources.some(source => source.id.startsWith('LIVE_TOPIC_iras-cit-deductibility_')),
  'The sufficient official HTML candidate survives admission and supports the mapped topic.');
assert.ok(evidence.sources.some(source => source.id === 'ITA_SEC15_PROHIBITED_DEDUCTIONS'),
  'The local Section 15 summary remains eligible alongside the mapped page.');
const reviewedSection15 = UNIFIED_SOURCE_REGISTRY.ITA_SEC15_PROHIBITED_DEDUCTIONS.sourceText;
assert.ok(evidence.verifiedClaims.some(claim => claim.recordId === 'ITA_SEC15_PROHIBITED_DEDUCTIONS' &&
  claim.quote === reviewedSection15 && /subject to statutory exceptions/i.test(claim.quote) && /not an exhaustive list/i.test(claim.quote)),
  'The full caveated Section 15 quote remains literal verified evidence.');
assert.equal(evidence.evidenceStatus, 'VERIFIED', 'Rule evidence covers the mapped topic and private-expense concept.');
assert.equal(evidence.applicationStatus, 'UNRESOLVED',
  'Rule evidence alone does not determine application without taxpayer facts.');
assert.equal(evidence.gaps.some(gap => gap.stage === 'covered'), false,
  'No scoped topic or concept gap remains after mapped evidence is admitted.');
console.log('Private-expense scoped local-to-mapped fallback regression passed.');
