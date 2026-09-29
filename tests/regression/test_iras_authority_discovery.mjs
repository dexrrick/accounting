import assert from 'node:assert/strict';
import { ControlledWebRetriever } from '../../src/retrieval/controlledWebRetriever.ts';
import { SourceCache } from '../../src/retrieval/sourceCache.ts';
import {
  OFFICIAL_SOURCE_DISCOVERY_PROVIDERS,
  OfficialDomainSearchAdapter,
  OfficialSitemapDiscoveryAdapter
} from '../../src/retrieval/officialSitemapDiscovery.ts';
import { defaultSourceRetriever } from '../../src/retrieval/sourceRetriever.ts';
import { evaluateEvidenceQuality } from '../../src/retrieval/evidenceQualityGate.ts';
import { buildGroundedReasoningContext, postProcessAIResponse, resolveMappedOfficialSourceFallback } from '../../src/services/groundingContextBuilder.ts';
import { classifyQuestion } from '../../src/classification/questionClassifier.ts';
import { verifyEvidenceClaims } from '../../src/verification/claimEvidenceVerifier.ts';
import { getCoverageTopicById } from '../../src/standards/coverageRegistry.ts';
import { getRequestedQuestionConcepts } from '../../src/services/semanticQuestionUnderstanding.ts';

const query = 'What is the tax treatment for overseas income received in Singapore by an individual?';
const pageUrl = 'https://www.iras.gov.sg/taxes/individual-income-tax/employees/scenario-based-faqs-for-working-in-singapore-and-abroad/i-want-to-know-the-tax-treatment-on-working-outside-singapore';
const calls = [];
const pageHtml = `<html><head><title>IRAS | Working Outside Singapore</title><link rel="canonical" href="${pageUrl}"></head><body><main>
  <h1>Working Outside Singapore</h1>
  <p>Generally, overseas income received in Singapore on or after 1 Jan 2004 is not taxable.</p>
  <h2>Taxable overseas income</h2>
  <p>Overseas income received in Singapore by an individual may be taxable in specific circumstances. If you are contracted to be based overseas to render your full employment services wholly outside Singapore, your employment income is sourced outside Singapore.</p>
  <p>Overseas employment is taxable when it is incidental to Singapore employment, such as when an employee travels overseas as part of work based in Singapore.</p>
</main></body></html>`;
const customFetch = async (url, init = {}) => {
  calls.push({ url, method: init.method || 'GET' });
  if (url === 'https://www.iras.gov.sg/sitemap') {
    return new Response('<html><body><main><h1>IRAS Sitemap</h1><p>SITEMAP_RULE_TEXT_MUST_NOT_BE_EVIDENCE</p></main></body></html>', {
      status: 200, headers: { 'content-type': 'text/html' }
    });
  }
  if (url === 'https://www.iras.gov.sg/robots.txt') {
    return new Response('not found', { status: 404, headers: { 'content-type': 'text/plain' } });
  }
  if (url.startsWith('https://html.duckduckgo.com/html/?')) {
    assert.match(new URL(url).searchParams.get('q') || '', /^site:iras\.gov\.sg\s/);
    return new Response(`<html><body>
      <a href="https://example.com/not-iras">Unofficial mirror</a>
      <div class="result"><a href="${pageUrl}">Working Outside Singapore | IRAS</a><span>SEARCH_SNIPPET_MUST_NOT_BE_EVIDENCE</span></div>
    </body></html>`, { status: 200, headers: { 'content-type': 'text/html' } });
  }
  if (url === pageUrl) return new Response(pageHtml, { status: 200, headers: { 'content-type': 'text/html' } });
  throw new Error(`Unexpected test fetch: ${url}`);
};

const webRetriever = new ControlledWebRetriever(undefined, new SourceCache());
const sitemapAdapter = new OfficialSitemapDiscoveryAdapter(webRetriever, { customFetch, timeoutMs: 500 });
const searchAdapter = new OfficialDomainSearchAdapter(webRetriever, { customFetch, timeoutMs: 500 });
assert.deepEqual(Object.keys(OFFICIAL_SOURCE_DISCOVERY_PROVIDERS), ['IRAS'], 'IRAS is the only configured authority in this phase.');
assert.deepEqual(OFFICIAL_SOURCE_DISCOVERY_PROVIDERS.IRAS.approvedHosts, ['www.iras.gov.sg', 'iras.gov.sg']);
assert.equal(OFFICIAL_SOURCE_DISCOVERY_PROVIDERS.IRAS.searchSite, 'iras.gov.sg');
assert.deepEqual(OFFICIAL_SOURCE_DISCOVERY_PROVIDERS.IRAS.sitemapUrls, ['https://www.iras.gov.sg/sitemap']);
const routed = classifyQuestion(query);
assert.ok(routed.authorities.includes('IRAS'));
assert.ok(!routed.topicIds.some(topicId => topicId === 'iras-foreign-sourced-income' || topicId === 'iras-foreign-tax-credit'),
  'Individual employment queries do not match corporate foreign-income topics.');

const result = await resolveMappedOfficialSourceFallback([], query, defaultSourceRetriever, {
  authorityLevelDiscovery: true,
  webRetriever,
  fetchOptions: { customFetch, timeoutMs: 500, useCache: false },
  discoveryAdapter: sitemapAdapter,
  officialDomainSearchAdapter: searchAdapter
});

assert.deepEqual(result.trace.sourceMapIds, [], 'Authority-level discovery does not require a source-map pointer.');
assert.ok(calls.includes('https://www.iras.gov.sg/sitemap') || calls.some(call => call.url === 'https://www.iras.gov.sg/sitemap'), 'The official IRAS sitemap was attempted first.');
assert.ok(calls.some(call => call.url.startsWith('https://html.duckduckgo.com/html/?')), 'Official-domain search followed an exhausted sitemap.');
assert.ok(calls.some(call => call.url === pageUrl), 'The official search result page was fetched independently.');
assert.ok(result.trace.stages?.some(stage => stage.stage === 'SITEMAP_DISCOVERY' && stage.status === 'EXHAUSTED'));
assert.ok(result.trace.stages?.some(stage => stage.stage === 'OFFICIAL_DOMAIN_SEARCH' && stage.status === 'SUFFICIENT'));
assert.equal(result.records.length, 1);
assert.equal(result.records[0].officialSourceUrl, pageUrl);
assert.ok(!result.records[0].sourceText.includes('SEARCH_SNIPPET_MUST_NOT_BE_EVIDENCE'));
assert.ok(!result.records[0].sourceText.includes('SITEMAP_RULE_TEXT_MUST_NOT_BE_EVIDENCE'));
assert.equal(result.trace.attempts.find(attempt => attempt.discoveryStage === 'OFFICIAL_DOMAIN_SEARCH')?.fetchStatus, 'SUCCESS');

// Discovery adapters consume provider metadata rather than requiring
// authority-specific search and sitemap branches. This test-only provider is
// deliberately not registered for production use.
const testAuthorityHost = 'regulator.example';
const testAuthorityQuery = 'If a Singapore tax resident works overseas, when may foreign tax paid on the same income be credited?';
const testAuthorityPage = `https://${testAuthorityHost}/tax/individual-foreign-tax-credit`;
const weakSitemapPage = `https://${testAuthorityHost}/work/overseas-employment`;
const configuredSitemapCalls = [];
const configuredSitemapRetriever = {
  async fetchOfficialSource(url) {
    configuredSitemapCalls.push(url);
    assert.equal(url, `https://${testAuthorityHost}/sitemap.xml`);
    return {
      status: 'SUCCESS', finalUrl: url,
      content: `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
        <url><loc>${weakSitemapPage}</loc></url>
        <url><loc>${testAuthorityPage}</loc></url>
        <url><loc>https://unapproved.example/page</loc></url>
      </urlset>`
    };
  }
};
const configuredSitemap = new OfficialSitemapDiscoveryAdapter(configuredSitemapRetriever);
const testAuthorityRequest = {
  authority: 'TEST_AUTHORITY',
  query: testAuthorityQuery,
  topicId: 'test-individual-foreign-tax-credit',
  topicTitle: 'Individual Foreign Tax Credit',
  standardOrAct: 'Official tax guidance',
  topicHints: ['foreign tax credit', 'foreign tax paid on same income'],
  approvedHosts: [testAuthorityHost],
  sitemapUrls: [`https://${testAuthorityHost}/sitemap.xml`],
  preferredHosts: [testAuthorityHost],
  searchSite: testAuthorityHost,
  searchEndpoint: 'https://html.duckduckgo.com/html/',
  searchRedirectHost: 'html.duckduckgo.com',
  searchRedirectParameter: 'uddg',
  lexicalDiscovery: true,
  maxCandidates: 2
};
assert.deepEqual(await configuredSitemap.discoverOfficialSourceCandidates(testAuthorityRequest), [testAuthorityPage],
  'Sitemap ranking uses the full query and topic context to rank the matching candidate above a weaker general page.');
assert.deepEqual(configuredSitemapCalls, [`https://${testAuthorityHost}/sitemap.xml`]);
assert.equal(configuredSitemap.getIndexedCandidates()[0]?.authority, 'TEST_AUTHORITY',
  'Sitemap index metadata records the configured authority instead of relying on a hard-coded host lookup.');

const configuredSearchCalls = [];
const configuredSearchQueries = [];
const configuredSearch = new OfficialDomainSearchAdapter(new ControlledWebRetriever(undefined, new SourceCache()), {
  customFetch: async url => {
    configuredSearchCalls.push(url);
    const searchQuery = new URL(url).searchParams.get('q') || '';
    configuredSearchQueries.push(searchQuery);
    if (configuredSearchQueries.length === 1) {
      assert.equal(searchQuery, `site:${testAuthorityHost} ${testAuthorityQuery}`,
        'The first search preserves the complete user question on the configured official domain.');
      assert.ok(searchQuery.length < `site:${testAuthorityHost} ${testAuthorityQuery} "foreign tax credit"`.length,
        'The full-question search does not append extra terms that could over-constrain the request.');
      return new Response('<html><body><p>No results for the full question.</p></body></html>', { status: 200, headers: { 'content-type': 'text/html' } });
    }
    assert.ok(searchQuery.startsWith(`site:${testAuthorityHost} `) && !searchQuery.includes(testAuthorityQuery),
      'Later searches relax to registry topic terms while preserving the configured site restriction.');
    if (configuredSearchQueries.length > 2) return new Response('<html><body><p>No results for this additional bounded topic hint.</p></body></html>', {
      status: 200, headers: { 'content-type': 'text/html' }
    });
    return new Response(`<html><body>
      <a href="${testAuthorityPage}">Employment Leave Policy</a>
      <a href="https://unapproved.example/?uddg=${encodeURIComponent(`https://${testAuthorityHost}/wrapped-copy`)}">Wrapped official result</a>
      <a href="https://unapproved.example/official-copy">Employment Leave Policy</a>
      <a href="http://${testAuthorityHost}/insecure">Employment Leave Policy</a>
    </body></html>`, { status: 200, headers: { 'content-type': 'text/html' } });
  }, timeoutMs: 500
});
assert.deepEqual(await configuredSearch.searchOfficialDomainCandidates(testAuthorityRequest), [testAuthorityPage],
  'The bounded fallback discovers the topic page while keeping HTTPS and approved-host checks for every authority.');
assert.equal(configuredSearchQueries.length, 3, 'The full query runs first, then distinct topic-specific fallback variants until the candidate cap is reached.');
assert.deepEqual(configuredSearch.getLastSearchTrace().map(trace => [trace.variant, trace.status]), [
  ['FULL_QUERY', 'NO_CANDIDATES'], ['TOPIC_HINT_1', 'RESULTS'], ['TOPIC_HINT_2', 'NO_CANDIDATES']
], 'Search traces identify empty and productive query variants without treating result metadata as evidence.');
const partialFirstPage = `https://${testAuthorityHost}/tax/foreign-tax-credit`;
const partialSecondPage = `https://${testAuthorityHost}/tax/foreign-tax-credit-conditions`;
const partialQueryAttempts = [];
const partialCandidateSearch = new OfficialDomainSearchAdapter(new ControlledWebRetriever(undefined, new SourceCache()), {
  customFetch: async url => {
    const searchQuery = new URL(url).searchParams.get('q') || '';
    partialQueryAttempts.push(searchQuery);
    const page = searchQuery.includes(testAuthorityQuery) ? partialFirstPage : partialSecondPage;
    return new Response(`<html><body><a href="${page}">Foreign Tax Credit</a></body></html>`, {
      status: 200, headers: { 'content-type': 'text/html' }
    });
  }, timeoutMs: 500
});
const partialCandidates = await partialCandidateSearch.searchOfficialDomainCandidates(testAuthorityRequest);
assert.equal(partialQueryAttempts.length, 2,
  'The bounded topic query still runs when the full query returns candidates but has not filled the candidate limit.');
assert.deepEqual(new Set(partialCandidates), new Set([partialFirstPage, partialSecondPage]));
const unapprovedSiteRequest = { ...testAuthorityRequest, searchSite: 'unapproved.example' };
assert.deepEqual(await configuredSearch.searchOfficialDomainCandidates(unapprovedSiteRequest), [],
  'A search site outside the provider host allowlist is rejected before search.');
assert.deepEqual(await configuredSearch.searchOfficialDomainCandidates({ ...testAuthorityRequest, lexicalDiscovery: false }), [],
  'A provider may disable lexical online discovery.');
assert.equal(configuredSearchCalls.length, 3, 'Invalid site or disabled lexical policy never initiates another network request.');

const irasProvider = OFFICIAL_SOURCE_DISCOVERY_PROVIDERS.IRAS;
const wrappedIrasPage = 'https://www.iras.gov.sg/taxes/individual-income-tax/basics-of-individual-income-tax/tax-residency-and-tax-rates/claiming-exemptions-under-Avoidance-of-Double-Taxation-Agreements-(DTAs)';
const wrappedSearch = new OfficialDomainSearchAdapter(new ControlledWebRetriever(undefined, new SourceCache()), {
  customFetch: async () => new Response(`<html><body><a href="http://${irasProvider.searchRedirectHost}/l/?uddg=${encodeURIComponent(wrappedIrasPage)}">Claiming Foreign Tax Credit</a></body></html>`, {
    status: 200, headers: { 'content-type': 'text/html' }
  }), timeoutMs: 500
});
const irasSearchRequest = {
  authority: irasProvider.authority,
  query: testAuthorityQuery,
  topicId: 'iras-individual-foreign-tax-credit',
  topicTitle: 'Individual Foreign Tax Credit',
  standardOrAct: 'IRAS individual tax guidance',
  topicHints: ['foreign tax credit', 'foreign tax paid on same income'],
  approvedHosts: irasProvider.approvedHosts,
  searchSite: irasProvider.searchSite,
  searchEndpoint: irasProvider.searchEndpoint,
  searchRedirectHost: irasProvider.searchRedirectHost,
  searchRedirectParameter: irasProvider.searchRedirectParameter,
  lexicalDiscovery: irasProvider.lexicalDiscovery
};
assert.deepEqual(await wrappedSearch.searchOfficialDomainCandidates(irasSearchRequest), [wrappedIrasPage],
  'Only the configured search host may unwrap its configured redirect parameter.');
const jinaWrappedSearchQueries = [];
const jinaWrappedSearch = new OfficialDomainSearchAdapter(new ControlledWebRetriever(undefined, new SourceCache()), {
  customFetch: async url => {
    if (url.startsWith('https://html.duckduckgo.com/html/')) {
      jinaWrappedSearchQueries.push(new URL(url).searchParams.get('q') || '');
      return new Response('challenge', { status: 202, headers: { 'content-type': 'text/html' } });
    }
    assert.ok(url.startsWith('https://r.jina.ai/http://html.duckduckgo.com/html/?q='));
    return new Response(`## [Claiming exemptions under Avoidance of Double Taxation Agreements - IRAS](http://${irasProvider.searchRedirectHost}/l/?uddg=${encodeURIComponent(wrappedIrasPage)}&rut=tracking-only)`, {
      status: 200, headers: { 'content-type': 'text/plain' }
    });
  }, timeoutMs: 500
});
assert.deepEqual(await jinaWrappedSearch.searchOfficialDomainCandidates({ ...irasSearchRequest, maxCandidates: 1 }), [wrappedIrasPage],
  'The configured DDG wrapper in Jina Markdown is unwrapped only after parsing the actual proxy response, then checked against approved IRAS hosts.');
assert.equal(jinaWrappedSearchQueries.length, 1, 'The full query candidate fills the configured cap, so extra search variants are skipped.');
const offsiteWrapper = new OfficialDomainSearchAdapter(new ControlledWebRetriever(undefined, new SourceCache()), {
  customFetch: async () => new Response(`<html><body><a href="https://untrusted.example/?uddg=${encodeURIComponent(wrappedIrasPage)}">Claiming Foreign Tax Credit</a></body></html>`, {
    status: 200, headers: { 'content-type': 'text/html' }
  }), timeoutMs: 500
});
assert.deepEqual(await offsiteWrapper.searchOfficialDomainCandidates(irasSearchRequest), [],
  'An off-site wrapper cannot smuggle an otherwise approved IRAS URL into discovery.');

// Topic context should bring the actual individual FTC guidance above a weaker
// overseas-employment sitemap candidate. The index only supplies a candidate;
// the page is then fetched independently, admitted by the normal evidence gate,
// and cited only after literal claim verification.
const irasFtcQuery = 'If a Singapore tax resident earns employment income while physically working overseas on a temporary secondment, under what conditions is that foreign-sourced income taxable in Singapore or eligible for double taxation relief?';
const irasFtcPage = 'https://www.iras.gov.sg/taxes/individual-income-tax/basics-of-individual-income-tax/tax-residency-and-tax-rates/claiming-foreign-tax-credit';
const weakerEmploymentPage = 'https://www.iras.gov.sg/taxes/individual-income-tax/employees/scenario-based-faqs-for-working-in-singapore-and-abroad/overseas-employment';
const irasFtcHtml = `<html><head><title>IRAS | Claiming foreign tax credit</title><link rel="canonical" href="${irasFtcPage}"></head><body><main>
  <h1>Claiming foreign tax credit</h1>
  <h2>Double taxation on foreign income</h2>
  <p>If you are a Singapore tax resident, you may claim foreign tax credit if you have been taxed twice on the same income.</p>
  <h2>Conditions for claiming FTC</h2>
  <p>Anyone claiming FTC must satisfy all of the following conditions:</p>
  <ol><li>The individual must be a tax resident in Singapore for the relevant basis year;</li><li>Tax has been paid or is payable on the same income in the foreign country; and</li><li>The income is taxable in Singapore.</li></ol>
  <p>The amount of FTC is dependent on the nature of income, and subject to the specific terms and conditions as specified in the DTA with the relevant treaty country.</p>
</main></body></html>`;
const ftcRouteCalls = [];
const ftcRouteFetch = async url => {
  ftcRouteCalls.push(url);
  if (url === 'https://www.iras.gov.sg/sitemap') return new Response(`<html><body>
    <a href="${weakerEmploymentPage}">Overseas Employment</a>
    <a href="${irasFtcPage}">Claiming foreign tax credit</a>
  </body></html>`, { status: 200, headers: { 'content-type': 'text/html' } });
  if (url === irasFtcPage) return new Response(irasFtcHtml, { status: 200, headers: { 'content-type': 'text/html' } });
  if (url === 'https://www.iras.gov.sg/robots.txt') return new Response('not found', { status: 404 });
  throw new Error(`Unexpected FTC discovery fetch: ${url}`);
};
const ftcWebRetriever = new ControlledWebRetriever(undefined, new SourceCache());
const ftcSitemapAdapter = new OfficialSitemapDiscoveryAdapter(ftcWebRetriever, { customFetch: ftcRouteFetch, timeoutMs: 500 });
const ftcSearchMustNotRun = new OfficialDomainSearchAdapter(ftcWebRetriever, {
  customFetch: async url => { throw new Error(`A sitemap FTC result should skip search: ${url}`); }, timeoutMs: 500
});
const ftcDiscovery = await resolveMappedOfficialSourceFallback(['iras-individual-foreign-tax-credit'], irasFtcQuery, defaultSourceRetriever, {
  authorityLevelDiscovery: true,
  webRetriever: ftcWebRetriever,
  fetchOptions: { customFetch: ftcRouteFetch, timeoutMs: 500, useCache: false },
  discoveryAdapter: ftcSitemapAdapter,
  officialDomainSearchAdapter: ftcSearchMustNotRun
});
assert.equal(ftcDiscovery.trace.stages?.find(stage => stage.stage === 'SITEMAP_DISCOVERY')?.status, 'SUFFICIENT');
assert.ok(ftcDiscovery.trace.stages?.some(stage => stage.stage === 'OFFICIAL_DOMAIN_SEARCH' && stage.status === 'SKIPPED'));
assert.deepEqual(ftcRouteCalls.filter(url => url === irasFtcPage), [irasFtcPage], 'The selected sitemap URL is separately fetched exactly once as a page.');
assert.ok(ftcDiscovery.records.some(record => record.officialSourceUrl === irasFtcPage));
assert.ok(!ftcDiscovery.records.some(record => record.sourceText.includes('Claiming foreign tax credit</a>')),
  'Sitemap link labels never enter admitted source text.');
const ftcEvidence = evaluateEvidenceQuality({ query: irasFtcQuery, topicIds: ['iras-individual-foreign-tax-credit'],
  provisionalTopics: [], authorities: ['IRAS'], records: ftcDiscovery.records, missingFacts: [], sourceMapFallbackTrace: ftcDiscovery.trace });
assert.equal(ftcEvidence.status, 'RETRIEVED_SUFFICIENT');
assert.deepEqual(ftcEvidence.eligibleRecords.map(record => record.officialSourceUrl), [irasFtcPage]);
const ftcQuote = 'If you are a Singapore tax resident, you may claim foreign tax credit if you have been taxed twice on the same income.';
assert.ok(ftcEvidence.eligibleRecords[0].sourceText.includes(ftcQuote));
const ftcClaims = verifyEvidenceClaims([{ kind: 'RULE', text: ftcQuote, quote: ftcQuote,
  recordId: ftcEvidence.eligibleRecords[0].id, citationUrl: ftcEvidence.eligibleRecords[0].canonicalSourceUrl }], ftcEvidence.eligibleRecords, { missingFacts: [] });
assert.equal(ftcClaims.accepted.length, 1);
assert.equal(ftcClaims.rejected.length, 0);

const ftcSearchQueries = [];
const corporateFtcPage = 'https://www.iras.gov.sg/taxes/corporate-income-tax/income-deductions-for-companies/claiming-reliefs/foreign-tax-credit';
const corporateFtcHtml = `<html><head><title>IRAS | Foreign Tax Credit</title><link rel="canonical" href="${corporateFtcPage}"></head><body><main>
  <h1>Foreign Tax Credit</h1><p>Companies may claim foreign tax credit for foreign tax paid on income also taxed in Singapore.</p>
</main></body></html>`;
const ftcSearchAdapter = new OfficialDomainSearchAdapter(new ControlledWebRetriever(undefined, new SourceCache()), {
  customFetch: async url => {
    const searchQuery = new URL(url).searchParams.get('q') || '';
    ftcSearchQueries.push(searchQuery);
    if (ftcSearchQueries.length === 1) return new Response('<html><body><p>No full-query results.</p></body></html>', {
      status: 200, headers: { 'content-type': 'text/html' }
    });
    return new Response(`<html><body><a href="${irasFtcPage}">Claiming foreign tax credit - IRAS</a><p>SEARCH_RESULT_SNIPPET_MUST_NOT_BE_EVIDENCE</p></body></html>`, {
      status: 200, headers: { 'content-type': 'text/html' }
    });
  }, timeoutMs: 500
});
const emptyFtcSitemap = { async discoverOfficialSourceCandidates() { return []; } };
const ftcSearchPageCalls = [];
const ftcSearchPageFetch = async url => {
  ftcSearchPageCalls.push(url);
  if (url === corporateFtcPage) return new Response(corporateFtcHtml, { status: 200, headers: { 'content-type': 'text/html' } });
  if (url === irasFtcPage) return new Response(irasFtcHtml, { status: 200, headers: { 'content-type': 'text/html' } });
  throw new Error(`Unexpected FTC search-page fetch: ${url}`);
};
const ftcSearchWebRetriever = new ControlledWebRetriever(undefined, new SourceCache());
const ftcSearchFallback = await resolveMappedOfficialSourceFallback(['iras-individual-foreign-tax-credit'], irasFtcQuery, defaultSourceRetriever, {
  authorityLevelDiscovery: true,
  webRetriever: ftcSearchWebRetriever,
  fetchOptions: { customFetch: ftcSearchPageFetch, timeoutMs: 500, useCache: false },
  discoveryAdapter: emptyFtcSitemap,
  officialDomainSearchAdapter: ftcSearchAdapter
});
assert.ok(ftcSearchQueries.length >= 2 && ftcSearchQueries.length <= 8,
  'Each unresolved registered/provisional topic is limited to one full query plus three topic variants.');
assert.ok(ftcSearchQueries.some(searchQuery => searchQuery === `site:iras.gov.sg ${irasFtcQuery}`));
assert.ok(ftcSearchQueries.some(searchQuery => /^site:iras\.gov\.sg [^"]+$/.test(searchQuery) && !searchQuery.includes(irasFtcQuery)),
  'Topic-specific official-domain query variants are bounded and separate from the full question.');
assert.ok(ftcSearchPageCalls.includes(irasFtcPage),
  'The individual FTC page is separately fetched after official search.');
assert.ok(ftcSearchFallback.trace.attempts.some(attempt => attempt.candidateUrl === irasFtcPage && attempt.fetchStatus === 'SUCCESS'));
assert.equal(ftcSearchFallback.trace.stages?.find(stage => stage.stage === 'SITEMAP_DISCOVERY')?.status, 'EXHAUSTED');
assert.equal(ftcSearchFallback.trace.stages?.find(stage => stage.stage === 'OFFICIAL_DOMAIN_SEARCH')?.status, 'SUFFICIENT');
assert.ok(ftcSearchFallback.records.every(record => !record.sourceText.includes('SEARCH_RESULT_SNIPPET_MUST_NOT_BE_EVIDENCE')));
const ftcSearchEvidence = evaluateEvidenceQuality({ query: irasFtcQuery, topicIds: ['iras-individual-foreign-tax-credit'],
  provisionalTopics: [], authorities: ['IRAS'], records: ftcSearchFallback.records, missingFacts: [], sourceMapFallbackTrace: ftcSearchFallback.trace });
assert.equal(ftcSearchEvidence.status, 'RETRIEVED_SUFFICIENT');
const ftcSearchClaims = verifyEvidenceClaims([{ kind: 'RULE', text: ftcQuote, quote: ftcQuote,
  recordId: ftcSearchEvidence.eligibleRecords[0].id, citationUrl: ftcSearchEvidence.eligibleRecords[0].canonicalSourceUrl }],
  ftcSearchEvidence.eligibleRecords, { missingFacts: [] });
assert.equal(ftcSearchClaims.accepted.length, 1);
assert.equal(ftcSearchClaims.rejected.length, 0);

const corporateOnlySearch = new OfficialDomainSearchAdapter(new ControlledWebRetriever(undefined, new SourceCache()), {
  customFetch: async () => new Response(`<html><body><a href="${corporateFtcPage}">Foreign Tax Credit - IRAS</a></body></html>`, {
    status: 200, headers: { 'content-type': 'text/html' }
  }), timeoutMs: 500
});
const corporateOnlyFallback = await resolveMappedOfficialSourceFallback(['iras-individual-foreign-tax-credit'], irasFtcQuery, defaultSourceRetriever, {
  webRetriever: new ControlledWebRetriever(undefined, new SourceCache()),
  fetchOptions: { customFetch: ftcSearchPageFetch, timeoutMs: 500, useCache: false },
  discoveryAdapter: emptyFtcSitemap,
  officialDomainSearchAdapter: corporateOnlySearch
});
const corporateFtcAttempt = corporateOnlyFallback.trace.attempts.find(attempt => attempt.candidateUrl === corporateFtcPage);
assert.ok(!corporateFtcAttempt || corporateFtcAttempt.fetchStatus !== 'SUCCESS',
  'A corporate FTC candidate is rejected or filtered before it can count as a successful individual-tax retrieval.');
assert.ok(!corporateOnlyFallback.records.some(record => record.officialSourceUrl === corporateFtcPage));

const individualDtaPage = 'https://www.iras.gov.sg/taxes/individual-income-tax/basics-of-individual-income-tax/tax-residency-and-tax-rates/claiming-exemptions-under-avoidance-of-double-taxation-agreements';
const observedWithholdingDtaPage = 'https://www.iras.gov.sg/taxes/withholding-tax/withholding-tax-filing/claim-of-relief-under-the-avoidance-of-double-taxation-agreement-(dta)';
const individualDtaHtml = `<html><head><title>IRAS | Claiming exemptions under Avoidance of Double Taxation Agreements</title><link rel="canonical" href="${individualDtaPage}"></head><body><main>
  <h1>Claiming exemptions under Avoidance of Double Taxation Agreements</h1>
  <p>Singapore has concluded Double Taxation Agreements (DTAs) with treaty partners. An individual may claim an exemption from Singapore tax on employment income where the applicable DTA conditions are met.</p>
  <p>The relevant treaty must be considered together with the person's residence and the nature of the employment income.</p>
</main></body></html>`;
const observedWithholdingDtaHtml = `<html><head><title>IRAS | Claim of Relief under the Avoidance of Double Taxation Agreement (DTA)</title><link rel="canonical" href="${observedWithholdingDtaPage}"></head><body><main>
  <h1>Claim of Relief under the Avoidance of Double Taxation Agreement (DTA)</h1>
  <p>A non-resident company may claim relief under an applicable Avoidance of Double Taxation Agreement for specified payments.</p>
  <p>Use the S45 Double Taxation Relief Tax Rate Calculator to check if the non-resident company is eligible for DTR and the applicable tax rate under the DTA.</p>
</main></body></html>`;
const dtaQueryVariants = [];
const dtaFixtureFetch = async url => {
  const searchUrl = new URL(url);
  if (searchUrl.hostname === 'html.duckduckgo.com') {
    const searchQuery = searchUrl.searchParams.get('q') || '';
    dtaQueryVariants.push(searchQuery);
    if (dtaQueryVariants.length <= 2) return new Response('<html><body><p>No results for this restricted variant.</p></body></html>', {
      status: 200, headers: { 'content-type': 'text/html' }
    });
    const resultUrl = individualDtaPage;
    return new Response(`<html><body><a href="${resultUrl}">Double Taxation Agreement Relief - IRAS</a></body></html>`, {
      status: 200, headers: { 'content-type': 'text/html' }
    });
  }
  if (url === observedWithholdingDtaPage) return new Response(observedWithholdingDtaHtml, { status: 200, headers: { 'content-type': 'text/html' } });
  if (url === individualDtaPage) return new Response(individualDtaHtml, { status: 200, headers: { 'content-type': 'text/html' } });
  throw new Error(`Unexpected individual DTA fixture request: ${url}`);
};
const dtaSearchAdapter = new OfficialDomainSearchAdapter(new ControlledWebRetriever(undefined, new SourceCache()), {
  customFetch: dtaFixtureFetch, timeoutMs: 500
});
const dtaSitemap = { async discoverOfficialSourceCandidates() { return [observedWithholdingDtaPage]; },
  getCandidateTitle(url) { return url === observedWithholdingDtaPage ? 'Claim of Relief under the Avoidance of Double Taxation Agreement (DTA)' : undefined; } };
const dtaWebRetriever = new ControlledWebRetriever(undefined, new SourceCache());
const dtaFallback = await resolveMappedOfficialSourceFallback(['iras-individual-double-tax-agreements'], irasFtcQuery, defaultSourceRetriever, {
  authorityLevelDiscovery: true,
  webRetriever: dtaWebRetriever,
  fetchOptions: { customFetch: dtaFixtureFetch, timeoutMs: 500, useCache: false },
  discoveryAdapter: dtaSitemap,
  officialDomainSearchAdapter: dtaSearchAdapter
});
assert.ok(dtaQueryVariants.length >= 3 && dtaQueryVariants.length <= 8,
  'The registered DTA topic and remaining full-query scope each use bounded topic-specific search variants.');
assert.ok(dtaQueryVariants[0].includes(irasFtcQuery));
assert.ok(dtaFallback.trace.attempts.some(attempt => attempt.candidateUrl === observedWithholdingDtaPage && attempt.fetchStatus !== 'SUCCESS'),
  'The live-observed WHT DTA filing page is fetched but rejected before becoming individual-tax evidence.');
assert.ok(dtaFallback.trace.attempts.some(attempt => attempt.candidateUrl === individualDtaPage && attempt.fetchStatus === 'SUCCESS' && attempt.searchQueryVariant === 'TOPIC_HINT_3'),
  'The individual DTA page is discovered by a later topic-specific search variant, fetched independently, and admitted only after validation.');
assert.equal(dtaFallback.records.filter(record => record.officialSourceUrl === individualDtaPage).length, 1);
assert.ok(!dtaFallback.records.some(record => record.officialSourceUrl === observedWithholdingDtaPage));
const dtaEvidence = evaluateEvidenceQuality({ query: irasFtcQuery, topicIds: ['iras-individual-double-tax-agreements'],
  provisionalTopics: [], authorities: ['IRAS'], records: dtaFallback.records, missingFacts: [], sourceMapFallbackTrace: dtaFallback.trace });
assert.equal(dtaEvidence.status, 'RETRIEVED_SUFFICIENT');
const dtaQuote = 'Singapore has concluded Double Taxation Agreements (DTAs) with treaty partners. An individual may claim an exemption from Singapore tax on employment income where the applicable DTA conditions are met.';
const dtaClaims = verifyEvidenceClaims([{ kind: 'RULE', text: dtaQuote, quote: dtaQuote,
  recordId: dtaEvidence.eligibleRecords[0].id, citationUrl: dtaEvidence.eligibleRecords[0].canonicalSourceUrl }], dtaEvidence.eligibleRecords, { missingFacts: [] });
assert.equal(dtaClaims.accepted.length, 1);
assert.equal(dtaClaims.rejected.length, 0);

const quality = evaluateEvidenceQuality({
  query,
  topicIds: [],
  provisionalTopics: result.provisionalTopics,
  authorities: ['IRAS'],
  records: result.records,
  missingFacts: [],
  sourceMapFallbackTrace: result.trace
});
assert.equal(quality.status, 'RETRIEVED_SUFFICIENT');
assert.deepEqual(quality.eligibleRecords.map(record => record.officialSourceUrl), [pageUrl]);

const unmatchedQuery = 'What is the tax treatment for overseas income received in Singapore by an individual?';
const unmatchedClassification = classifyQuestion(unmatchedQuery);
assert.deepEqual(unmatchedClassification.authorities, ['IRAS']);
assert.deepEqual(unmatchedClassification.topicIds, [], 'This routing test is intentionally outside the topic registry.');
const emptyLocalRetriever = {
  async retrieveSources() { return []; },
  getSourceById() { return undefined; }
};
const authorityContext = await buildGroundedReasoningContext(unmatchedQuery, null, emptyLocalRetriever, undefined, {
  webRetriever,
  fetchOptions: { customFetch, timeoutMs: 500, useCache: false },
  discoveryAdapter: sitemapAdapter,
  officialDomainSearchAdapter: searchAdapter
});
assert.equal(authorityContext.evidenceQuality?.status, 'RETRIEVED_SUFFICIENT');
assert.deepEqual(authorityContext.sourceMapFallbackTrace?.sourceMapIds, []);
assert.ok(authorityContext.sourceMapFallbackTrace?.stages?.some(stage => stage.stage === 'OFFICIAL_DOMAIN_SEARCH' && stage.status === 'SUFFICIENT'));
assert.ok(authorityContext.primaryEvidence.concat(authorityContext.officialGuidance, authorityContext.curatedSummaries)
  .some(record => record.officialSourceUrl === pageUrl), 'The production grounding builder discovers evidence for an unmatched IRAS query.');

const registeredButPartialQuery = 'For an employee on overseas employment, how does Singapore tax the employment income earned while physically working in a host country during a temporary assignment?';
const registeredButPartialClassification = classifyQuestion(registeredButPartialQuery);
assert.deepEqual(registeredButPartialClassification.topicIds, ['iras-individual-overseas-employment'],
  'This caller regression has one registered topic match and additional material query concepts outside the registry entry.');
const localOverseasEmploymentRecord = {
  id: 'TEST_LOCAL_OVERSEAS_EMPLOYMENT', authority: 'IRAS', authorityName: 'IRAS', sourceAuthority: 'IRAS',
  sourcePublisher: 'IRAS', legalOrStandardInstrument: 'Income Tax Act 1947', documentTitle: 'Overseas employment',
  standardOrActCode: 'ITA1947', paragraphOrSection: 'Individual employment income',
  sourceText: 'IRAS guidance explains that overseas employment income is treated according to where employment duties are exercised.',
  principleSummary: 'Overseas employment income',
  officialSourceUrl: 'https://www.iras.gov.sg/taxes/individual-income-tax/employees/overseas-employment',
  canonicalSourceUrl: 'https://www.iras.gov.sg/taxes/individual-income-tax/employees/overseas-employment',
  domain: 'IRAS_INDIVIDUAL_TAX', jurisdiction: 'Singapore', tags: ['iras-individual-overseas-employment'],
  sourceStatus: 'VERIFIED', verificationMethod: 'CURATED_EDITORIAL_REVIEW', sourceType: 'OFFICIAL_GUIDANCE',
  evidenceTier: 'OFFICIAL_GUIDANCE', isVerbatimText: false, validFrom: '2026-01-01', lastVerifiedDate: '2026-09-26',
  lifecycleState: 'ACTIVE', provenance: 'LOCAL_STATIC', recordRole: 'EVIDENCE', groundingEligible: true
};
const discoveryAfterPartialLocalEvents = [];
const localThenDiscoveryContext = await buildGroundedReasoningContext(registeredButPartialQuery, null, {
  async retrieveSources() { return [localOverseasEmploymentRecord]; },
  getSourceById() { return undefined; },
  findSourcesByStandardOrAct() { return []; }
}, undefined, {
  discoveryAdapter: { async discoverOfficialSourceCandidates(request) {
    discoveryAfterPartialLocalEvents.push({ stage: 'SITEMAP', topicId: request.topicId, query: request.query });
    return [];
  } },
  officialDomainSearchAdapter: { async searchOfficialDomainCandidates(request) {
    discoveryAfterPartialLocalEvents.push({ stage: 'SEARCH', topicId: request.topicId, query: request.query });
    return [];
  } }
});
assert.ok(localThenDiscoveryContext.evidenceQuality?.coveredTopicIds.includes('iras-individual-overseas-employment'),
  'The reviewed local record remains usable for the registered overseas-employment topic.');
assert.ok(localThenDiscoveryContext.evidenceQuality?.uncoveredTopicIds.some(id => id.startsWith('iras-authority-query-')),
  'Local adequacy also includes the full-query concept scope, which remains uncovered.');
assert.ok(discoveryAfterPartialLocalEvents.some(event => event.stage === 'SITEMAP'),
  'A registered local topic match cannot suppress authority discovery for additional uncovered user-query concepts.');

const fullyCoveredLocalRecord = {
  ...localOverseasEmploymentRecord,
  id: 'TEST_LOCAL_COMPLETE_OVERSEAS_EMPLOYMENT',
  sourceText: `IRAS official guidance: ${registeredButPartialQuery} Overseas employment income is treated according to where employment duties are exercised during the assignment.`
};
const unnecessaryDiscoveryEvents = [];
const fullyCoveredLocalContext = await buildGroundedReasoningContext(registeredButPartialQuery, null, {
  async retrieveSources() { return [fullyCoveredLocalRecord]; },
  getSourceById() { return undefined; },
  findSourcesByStandardOrAct() { return []; }
}, undefined, {
  discoveryAdapter: { async discoverOfficialSourceCandidates() { unnecessaryDiscoveryEvents.push('SITEMAP'); return []; } },
  officialDomainSearchAdapter: { async searchOfficialDomainCandidates() { unnecessaryDiscoveryEvents.push('SEARCH'); return []; } }
});
assert.equal(fullyCoveredLocalContext.evidenceQuality?.status, 'LOCAL_SUFFICIENT');
assert.deepEqual(unnecessaryDiscoveryEvents, [], 'Sufficient local evidence for both registered and full-query scopes preserves the local short-circuit.');

const courseFeesQuery = 'Can an employee claim personal tax relief for professional course fees paid during the year, and what conditions and exclusions apply?';
const courseFeesTopic = classifyQuestion(courseFeesQuery).topicIds.find(id => id === 'iras-individual-reliefs');
assert.ok(courseFeesTopic, 'The broad individual-reliefs topic remains available as a routing hint.');
assert.equal(getCoverageTopicById(courseFeesTopic).routingOnly, true,
  'The aggregate relief topic is explicitly marked as routing-only.');
const courseFeesPageUrl = 'https://www.iras.gov.sg/taxes/individual-income-tax/basics-of-individual-income-tax/tax-reliefs-rebates-and-deductions/tax-reliefs/course-fees-relief';
const courseFeesQuote = 'Any amount paid or reimbursed by your employer or any other organisations (including the use of SkillsFuture Credit) cannot be claimed as Course Fees Relief.';
const courseFeesFetchCalls = [];
const courseFeesPageHtml = `<html><head><title>IRAS | Course Fees Relief</title><link rel="canonical" href="${courseFeesPageUrl}"></head><body><main>
  <h1>Course Fees Relief</h1>
  <p>Course Fees Relief has been discontinued with effect from Year of Assessment (YA) 2026. The final year in which Course Fees Relief may be claimed is in YA 2025.</p>
  <p>You may claim Course Fees Relief for the YA 2025 if you have attended a course for the purpose of gaining an approved professional qualification.</p>
  <p>${courseFeesQuote}</p>
</main></body></html>`;
const courseFeesFetch = async url => {
  courseFeesFetchCalls.push(url);
  if (url === 'https://www.iras.gov.sg/sitemap') {
    return new Response(`<html><body><a href="${courseFeesPageUrl}">IRAS Course Fees Relief</a></body></html>`, {
      status: 200, headers: { 'content-type': 'text/html' }
    });
  }
  if (url === courseFeesPageUrl) return new Response(courseFeesPageHtml, { status: 200, headers: { 'content-type': 'text/html' } });
  throw new Error(`Unexpected course-fee fixture fetch: ${url}`);
};
const courseFeesWebRetriever = new ControlledWebRetriever(undefined, new SourceCache());
const courseFeesSitemapAdapter = new OfficialSitemapDiscoveryAdapter(courseFeesWebRetriever, {
  customFetch: courseFeesFetch, timeoutMs: 500
});
const courseFeesContext = await buildGroundedReasoningContext(courseFeesQuery, null, emptyLocalRetriever, undefined, {
  webRetriever: courseFeesWebRetriever,
  fetchOptions: { customFetch: courseFeesFetch, timeoutMs: 500, useCache: false },
  discoveryAdapter: courseFeesSitemapAdapter,
  officialDomainSearchAdapter: { async searchOfficialDomainCandidates() { throw new Error('Successful course-fee sitemap evidence should skip search.'); } }
});
assert.deepEqual(courseFeesContext.sourceMapFallbackTrace?.sourceMapIds, [],
  'A routing-only aggregate relief topic does not trigger its unrelated source-map pointer.');
assert.ok(courseFeesFetchCalls.includes('https://www.iras.gov.sg/sitemap'));
assert.ok(courseFeesFetchCalls.includes(courseFeesPageUrl), 'The actual course-fee page is fetched independently from sitemap metadata.');
assert.ok(courseFeesContext.sourceMapFallbackTrace?.stages?.some(stage => stage.stage === 'SITEMAP_DISCOVERY' && stage.status === 'SUFFICIENT'));
assert.ok(courseFeesContext.evidenceQuality?.eligibleRecords.some(record => record.canonicalSourceUrl === courseFeesPageUrl));
assert.ok(!courseFeesContext.evidenceQuality?.uncoveredTopicIds.includes('iras-individual-reliefs'),
  'The aggregate routing aid does not block query-scoped evidence coverage for this specific relief question.');
const courseFeesEvidence = courseFeesContext.evidenceQuality.eligibleRecords;
const courseFeesClaims = verifyEvidenceClaims([{ kind: 'RULE', text: courseFeesQuote, quote: courseFeesQuote,
  recordId: courseFeesEvidence.find(record => record.canonicalSourceUrl === courseFeesPageUrl).id,
  citationUrl: courseFeesPageUrl }], courseFeesEvidence, { missingFacts: [] });
assert.equal(courseFeesClaims.accepted.length, 1, 'The specific relief answer still requires exact claim verification against the fetched page.');
assert.equal(courseFeesClaims.rejected.length, 0);

const branchIncomeQuery = 'A Singapore company remits profits from an overseas branch into Singapore. The company is also GST registered, but I am asking specifically whether the branch profits are exempt or taxable as corporate income.';
const gstDecoyUrl = 'https://www.iras.gov.sg/taxes/goods-services-tax-(gst)/claiming-gst-(input-tax)/conditions-for-claiming-input-tax';
const gstDecoyClaim = 'A Singapore company remitting overseas branch profits is taxable here if the income is not exempt under the applicable conditions.';
const gstDecoyHtml = `<html><head><title>IRAS | Conditions for Claiming Input Tax</title><link rel="canonical" href="${gstDecoyUrl}"></head><body><main>
  <h1>Conditions for Claiming Input Tax</h1>
  <h2>Overseas Branch Profits</h2>
  <p>${gstDecoyClaim}</p>
  <p>To claim input tax, a GST-registered business must hold the appropriate tax invoice and acquire the goods or services for business purposes.</p>
</main></body></html>`;
const branchFetchCalls = [];
const branchFetch = async url => {
  branchFetchCalls.push(url);
  if (url === gstDecoyUrl) return new Response(gstDecoyHtml, { status: 200, headers: { 'content-type': 'text/html' } });
  throw new Error(`Unexpected branch-query fetch: ${url}`);
};
const branchWebRetriever = new ControlledWebRetriever(undefined, new SourceCache());
const branchSearchRequests = [];
const branchContext = await buildGroundedReasoningContext(branchIncomeQuery, null, emptyLocalRetriever, undefined, {
  webRetriever: branchWebRetriever,
  fetchOptions: { customFetch: branchFetch, timeoutMs: 500, useCache: false },
  discoveryAdapter: {
    async discoverOfficialSourceCandidates() { return [gstDecoyUrl]; },
    getCandidateTitle(url) { return url === gstDecoyUrl ? 'IRAS | Conditions for Claiming Input Tax' : undefined; }
  },
  officialDomainSearchAdapter: {
    async searchOfficialDomainCandidates(request) { branchSearchRequests.push(request); return []; }
  }
});
assert.ok(branchFetchCalls.includes(gstDecoyUrl), 'The discovered GST candidate is independently fetched before scope rejection.');
assert.ok(branchContext.sourceMapFallbackTrace?.attempts.some(attempt => attempt.candidateUrl === gstDecoyUrl &&
  attempt.fetchStatus === 'DOMAIN_MISMATCH' && /GST domain/.test(attempt.error || '')),
  `A GST-page candidate is rejected with a domain-specific trace reason for an IRAS corporate-income query: ${JSON.stringify(branchContext.sourceMapFallbackTrace?.attempts)}`);
assert.ok(branchSearchRequests.length > 0, 'Rejected sitemap evidence does not stop the final official-domain search stage.');
assert.ok(branchContext.sourceMapFallbackTrace?.stages?.some(stage => stage.stage === 'OFFICIAL_DOMAIN_SEARCH' && stage.status === 'EXHAUSTED'));
assert.equal(branchContext.evidenceQuality?.status, 'INSUFFICIENT');
assert.deepEqual(branchContext.primaryEvidence.concat(branchContext.officialGuidance, branchContext.curatedSummaries), [],
  'Rejected GST content is not available to source-only fallback or citations.');
const rejectedGstCitationResponse = postProcessAIResponse({
  taxClaims: [{ kind: 'RULE', text: gstDecoyClaim, quote: gstDecoyClaim, recordId: 'GST_DECOY', citationUrl: gstDecoyUrl }],
  directAnswer: gstDecoyClaim
}, null, branchIncomeQuery, branchContext);
assert.match(rejectedGstCitationResponse.messageText, /cannot establish the tax treatment/i);
assert.doesNotMatch(rejectedGstCitationResponse.messageText, /GST_DECOY|conditions-for-claiming-input-tax|overseas branch profits is taxable/i,
  'An unverified GST citation and its decoy rule are absent from the fail-closed answer.');

const mixedBackgroundQuery = 'A Singapore company remits profits from an overseas branch into Singapore. The company is also GST registered and employs an overseas employee, but I am asking specifically whether those branch profits are exempt or taxable as corporate income in Singapore.';
const mixedCorporateUrl = 'https://www.iras.gov.sg/taxes/corporate-income-tax/foreign-branch-income';
const mixedCorporateHtml = `<html><head><title>IRAS | Corporate Income Tax</title></head><body><main>
  <h1>Corporate Income Tax</h1>
  <p>Corporate income tax treatment determines whether profits from an overseas branch are exempt or taxable in Singapore.</p>
</main></body></html>`;
const mixedCorporateFetchCalls = [];
const mixedCorporateFetch = async url => {
  mixedCorporateFetchCalls.push(url);
  if (url === mixedCorporateUrl) return new Response(mixedCorporateHtml, { status: 200, headers: { 'content-type': 'text/html' } });
  throw new Error(`Unexpected mixed-query fixture fetch: ${url}`);
};
let mixedDiscoveryRequest;
const mixedCorporateFallback = await resolveMappedOfficialSourceFallback([], mixedBackgroundQuery, emptyLocalRetriever, {
  authorityLevelDiscovery: true,
  webRetriever: new ControlledWebRetriever(undefined, new SourceCache()),
  fetchOptions: { customFetch: mixedCorporateFetch, timeoutMs: 500, useCache: false },
  discoveryAdapter: {
    async discoverOfficialSourceCandidates(request) { mixedDiscoveryRequest = request; return [mixedCorporateUrl]; },
    getCandidateTitle(url) { return url === mixedCorporateUrl ? 'IRAS | Corporate Income Tax' : undefined; }
  },
  officialDomainSearchAdapter: { async searchOfficialDomainCandidates() { throw new Error('A relevant corporate page should cover the explicit requested outcome.'); } }
});
assert.ok(mixedDiscoveryRequest?.topicTitle.startsWith('IRAS company guidance'),
  'Explicit company branch-profit subject determines provisional population despite employee background context.');
assert.deepEqual(mixedCorporateFetchCalls, [mixedCorporateUrl]);
const mixedCorporateQuality = evaluateEvidenceQuality({ query: mixedBackgroundQuery, topicIds: [],
  provisionalTopics: mixedCorporateFallback.provisionalTopics, authorities: ['IRAS'], domain: 'IRAS_CORPORATE_TAX',
  records: mixedCorporateFallback.records, missingFacts: [], sourceMapFallbackTrace: mixedCorporateFallback.trace });
assert.equal(mixedCorporateQuality.status, 'RETRIEVED_SUFFICIENT',
  'The requested corporate income-tax evidence is adequate without repeating unrelated GST-registration or employee background facts.');
assert.ok(mixedCorporateQuality.eligibleRecords.some(record => record.canonicalSourceUrl === mixedCorporateUrl));
assert.ok(mixedCorporateFallback.trace.stages?.some(stage => stage.stage === 'OFFICIAL_DOMAIN_SEARCH' && stage.status === 'SKIPPED'));

const employeeBenefitQuery = 'When our company pays employee housing allowances and personal insurance, are these taxable employment benefits or non-taxable reimbursements?';
const employeeBenefitCorporateCandidates = [
  {
    url: 'https://www.iras.gov.sg/taxes/corporate-income-tax/capital-allowances/employee-housing-benefits',
    title: 'IRAS | Capital Allowances for Employee Housing Benefits'
  },
  {
    url: 'https://www.iras.gov.sg/taxes/corporate-income-tax/filing-taxes/form-c-s-employee-benefits',
    title: 'IRAS | Form C-S and Employee Benefits'
  },
  {
    url: 'https://www.iras.gov.sg/taxes/corporate-income-tax/deductions/employee-allowances',
    title: 'IRAS | Company Deductions for Employee Allowances'
  }
];
const employeeBenefitCorporateHtml = candidate => `<html><head><title>${candidate.title}</title><link rel="canonical" href="${candidate.url}"></head><body><main>
  <h1>${candidate.title.replace('IRAS | ', '')}</h1>
  <p>For corporate income tax, a company may claim qualifying capital allowances and deduct employee housing allowances and personal insurance costs. An employee may receive a taxable housing benefit or personal-insurance perquisite which is treated as employment income.</p>
</main></body></html>`;
for (const candidate of employeeBenefitCorporateCandidates) {
  const employeeBenefitCandidateFallback = await resolveMappedOfficialSourceFallback([], employeeBenefitQuery, emptyLocalRetriever, {
    authorityLevelDiscovery: true,
    webRetriever: new ControlledWebRetriever(undefined, new SourceCache()),
    fetchOptions: {
      customFetch: async url => url === candidate.url
        ? new Response(employeeBenefitCorporateHtml(candidate), { status: 200, headers: { 'content-type': 'text/html' } })
        : new Response('', { status: 404 }),
      timeoutMs: 500,
      useCache: false
    },
    discoveryAdapter: {
      async discoverOfficialSourceCandidates() { return [candidate.url]; },
      getCandidateTitle(url) { return url === candidate.url ? candidate.title : undefined; }
    },
    officialDomainSearchAdapter: { async searchOfficialDomainCandidates() { return []; } }
  });
  assert.deepEqual(employeeBenefitCandidateFallback.records, [],
    `A relevant-looking corporate tax page cannot support employee benefit treatment: ${candidate.url}`);
  assert.ok(employeeBenefitCandidateFallback.trace.attempts.some(attempt =>
    attempt.candidateUrl === candidate.url && attempt.fetchStatus === 'DOMAIN_MISMATCH'),
  `Corporate capital allowance, Form C-S, and company-deduction candidates are rejected by tax domain: ${candidate.url}`);
}

const employeeBenefitCostOnlyUrl = 'https://www.iras.gov.sg/taxes/individual-income-tax/employers/employee-housing-costs';
const employeeBenefitCostOnlyTitle = 'IRAS | Employee Housing Allowances and Personal Insurance Costs';
const employeeBenefitCostOnlyHtml = `<html><head><title>${employeeBenefitCostOnlyTitle}</title><link rel="canonical" href="${employeeBenefitCostOnlyUrl}"></head><body><main>
  <h1>Employee housing allowances and personal insurance costs</h1>
  <p>Employers may reimburse housing allowances and insurance costs, which are recorded as staff costs in the company accounts.</p>
</main></body></html>`;
const employeeBenefitCostOnlyFallback = await resolveMappedOfficialSourceFallback([], employeeBenefitQuery, emptyLocalRetriever, {
  authorityLevelDiscovery: true,
  webRetriever: new ControlledWebRetriever(undefined, new SourceCache()),
  fetchOptions: {
    customFetch: async url => url === employeeBenefitCostOnlyUrl
      ? new Response(employeeBenefitCostOnlyHtml, { status: 200, headers: { 'content-type': 'text/html' } })
      : new Response('', { status: 404 }),
    timeoutMs: 500,
    useCache: false
  },
  discoveryAdapter: {
    async discoverOfficialSourceCandidates() { return [employeeBenefitCostOnlyUrl]; },
    getCandidateTitle(url) { return url === employeeBenefitCostOnlyUrl ? employeeBenefitCostOnlyTitle : undefined; }
  },
  officialDomainSearchAdapter: { async searchOfficialDomainCandidates() { return []; } }
});
assert.deepEqual(employeeBenefitCostOnlyFallback.records, [],
  'A page that only discusses housing and insurance costs cannot establish taxable benefit or reimbursement treatment.');
assert.ok(employeeBenefitCostOnlyFallback.trace.attempts.some(attempt =>
  attempt.candidateUrl === employeeBenefitCostOnlyUrl && attempt.fetchStatus !== 'SUCCESS'));

const adjacentInsuranceQuestion = 'Are employer-funded personal insurance premiums taxable as employment benefits?';
const adjacentInsuranceUrl = 'https://www.iras.gov.sg/taxes/individual-income-tax/employers/understanding-the-tax-treatment/insurance-premium';
const adjacentInsuranceTitle = 'IRAS | Insurance Premium';
const adjacentInsuranceHtml = `<html><head><title>${adjacentInsuranceTitle}</title><link rel="canonical" href="${adjacentInsuranceUrl}"></head><body><main>
  <h1>Insurance Premium</h1>
  <p>Learn about the tax treatment of insurance premiums paid by employers.</p>
  <table><tr><td>Personal Insurance policy where employee is the policyholder.</td><td>Taxable</td></tr></table>
</main></body></html>`;
const adjacentInsuranceFallback = await resolveMappedOfficialSourceFallback([], adjacentInsuranceQuestion, emptyLocalRetriever, {
  authorityLevelDiscovery: true,
  webRetriever: new ControlledWebRetriever(undefined, new SourceCache()),
  fetchOptions: {
    customFetch: async url => url === adjacentInsuranceUrl
      ? new Response(adjacentInsuranceHtml, { status: 200, headers: { 'content-type': 'text/html' } })
      : new Response('', { status: 404 }),
    timeoutMs: 500,
    useCache: false
  },
  discoveryAdapter: {
    async discoverOfficialSourceCandidates() { return [adjacentInsuranceUrl]; },
    getCandidateTitle(url) { return url === adjacentInsuranceUrl ? adjacentInsuranceTitle : undefined; }
  },
  officialDomainSearchAdapter: { async searchOfficialDomainCandidates() { return []; } }
});
const adjacentInsuranceTopic = adjacentInsuranceFallback.provisionalTopics.find(topic =>
  topic.requestedConcepts?.some(concept => concept.id === 'employee_personal_insurance_tax_treatment'));
assert.ok(adjacentInsuranceTopic, 'The original question creates a personal-insurance concept independent of interpretation labels.');
assert.ok(adjacentInsuranceFallback.records.some(record => record.canonicalSourceUrl === adjacentInsuranceUrl),
  'IRAS insurance evidence is admitted when employee context and the tax result occupy adjacent table cells.');
assert.ok(adjacentInsuranceFallback.trace.attempts.some(attempt =>
  attempt.topicId === adjacentInsuranceTopic.id && attempt.candidateUrl === adjacentInsuranceUrl && attempt.fetchStatus === 'SUCCESS'));

const gstQuestion = 'For GST input tax claims, what supporting invoice and business purposes are required?';
const gstContext = await buildGroundedReasoningContext(gstQuestion, null, emptyLocalRetriever, undefined, {
  webRetriever: new ControlledWebRetriever(undefined, new SourceCache()),
  fetchOptions: { customFetch: branchFetch, timeoutMs: 500, useCache: false },
  discoveryAdapter: {
    async discoverOfficialSourceCandidates() { return [gstDecoyUrl]; },
    getCandidateTitle(url) { return url === gstDecoyUrl ? 'IRAS | Conditions for Claiming Input Tax' : undefined; }
  },
  officialDomainSearchAdapter: {
    async searchOfficialDomainCandidates() { return []; }
  }
});
const admittedGstRecord = gstContext.evidenceQuality?.eligibleRecords.find(record => record.canonicalSourceUrl === gstDecoyUrl);
assert.ok(admittedGstRecord, `The same GST page remains eligible for a genuine GST input-tax subtopic: ${JSON.stringify({ attempts: gstContext.sourceMapFallbackTrace?.attempts, quality: gstContext.evidenceQuality })}`);
assert.match(admittedGstRecord.sourceText, /appropriate tax invoice and acquire the goods or services for business purposes/i);
assert.ok(!admittedGstRecord.tags.some(tag => /corporate.*(?:income|profit)/i.test(tag)),
  'GST evidence is scoped to GST and cannot be tagged as corporate branch-profit evidence.');

const sitemapQuestion = 'What is taxable and what is not under Singapore individual income tax?';
const sitemapPageUrl = 'https://www.iras.gov.sg/taxes/individual-income-tax/basics-of-individual-income-tax/what-is-taxable-what-is-not';
const sitemapPageHtml = `<html><head><title>IRAS | What is taxable, what is not</title><link rel="canonical" href="${sitemapPageUrl}"></head><body><main>
  <h1>What is taxable, what is not</h1>
  <p>Generally, income earned in or derived from Singapore is chargeable to income tax, while overseas income received in Singapore is not taxable, except in some circumstances.</p>
  <h2>Income from employment</h2>
  <p>Employment income is taxable under the individual income tax rules.</p>
</main></body></html>`;
const sitemapCalls = [];
let sitemapDiscoveryCount = 0;
const sitemapFetch = async (url, init = {}) => {
  sitemapCalls.push({ url, method: init.method || 'GET' });
  if (url === 'https://www.iras.gov.sg/sitemap') {
    return new Response(`<html><body><a href="${sitemapPageUrl}">What is taxable, what is not</a></body></html>`, {
      status: 200, headers: { 'content-type': 'text/html' }
    });
  }
  if (url === sitemapPageUrl) return new Response(sitemapPageHtml, { status: 200, headers: { 'content-type': 'text/html' } });
  throw new Error(`Unexpected sitemap-route fetch: ${url}`);
};
const sitemapWebRetriever = new ControlledWebRetriever(undefined, new SourceCache());
const sitemapOnlyAdapter = new OfficialSitemapDiscoveryAdapter(sitemapWebRetriever, { customFetch: sitemapFetch, timeoutMs: 500 });
const countedSitemapAdapter = {
  async discoverOfficialSourceCandidates(request) {
    sitemapDiscoveryCount += 1;
    return sitemapOnlyAdapter.discoverOfficialSourceCandidates(request);
  },
  getCandidateTitle(url) { return sitemapOnlyAdapter.getCandidateTitle(url); }
};
const searchMustNotRun = new OfficialDomainSearchAdapter(sitemapWebRetriever, {
  customFetch: async (url) => { throw new Error(`Sitemap success should skip online search: ${url}`); }, timeoutMs: 500
});
const sitemapResult = await resolveMappedOfficialSourceFallback([], sitemapQuestion, defaultSourceRetriever, {
  authorityLevelDiscovery: true,
  webRetriever: sitemapWebRetriever,
  fetchOptions: { customFetch: sitemapFetch, timeoutMs: 500, useCache: false },
  discoveryAdapter: countedSitemapAdapter,
  officialDomainSearchAdapter: searchMustNotRun
});
assert.equal(sitemapDiscoveryCount, 1, 'An unmatched nonhistorical query uses one authority-level sitemap pass, without a duplicate provisional pass.');
assert.ok(sitemapCalls.some(call => call.url === 'https://www.iras.gov.sg/sitemap'));
assert.ok(sitemapCalls.some(call => call.url === sitemapPageUrl), 'A sitemap candidate is fetched as an official page before admission.');
assert.ok(sitemapResult.trace.stages?.some(stage => stage.stage === 'SITEMAP_DISCOVERY' && stage.status === 'SUFFICIENT'), JSON.stringify(sitemapResult.trace, null, 2));
assert.ok(sitemapResult.trace.stages?.some(stage => stage.stage === 'OFFICIAL_DOMAIN_SEARCH' && stage.status === 'SKIPPED'));
assert.ok(sitemapResult.records.some(record => record.officialSourceUrl === sitemapPageUrl));
assert.ok(!sitemapResult.records.some(record => record.sourceText.includes('SITEMAP_RULE_TEXT_MUST_NOT_BE_EVIDENCE')));
const sitemapQuality = evaluateEvidenceQuality({ query: sitemapQuestion, topicIds: [], provisionalTopics: sitemapResult.provisionalTopics,
  authorities: ['IRAS'], records: sitemapResult.records, missingFacts: [], sourceMapFallbackTrace: sitemapResult.trace });
assert.equal(sitemapQuality.status, 'RETRIEVED_SUFFICIENT');
const sitemapQuote = sitemapQuality.eligibleRecords[0]?.sourceText.split(/\n{2,}/).map(text => text.trim()).find(text =>
  text.length >= 60 && /[.!?]["')\]]?$/.test(text) && /\b(?:chargeable to income tax|is not taxable|is taxable)\b/i.test(text)
);
assert.ok(sitemapQuote, 'The admitted page contains a verifiable tax-treatment paragraph.');
assert.notEqual(sitemapQuote, 'What is taxable, what is not', 'A page heading cannot be submitted as a claim.');
const sitemapClaims = verifyEvidenceClaims([{ kind: 'RULE', text: sitemapQuote, quote: sitemapQuote,
  recordId: sitemapQuality.eligibleRecords[0].id, citationUrl: sitemapQuality.eligibleRecords[0].canonicalSourceUrl }], sitemapQuality.eligibleRecords, { missingFacts: [] });
assert.equal(sitemapClaims.accepted.length, 1);
assert.equal(sitemapClaims.rejected.length, 0);

const linkedLeafQuery = 'When is employment income sourced outside Singapore for services rendered wholly outside Singapore?';
const faqIndexUrl = 'https://www.iras.gov.sg/taxes/individual-income-tax/employees/scenario-based-faqs-for-working-in-singapore-and-abroad';
const faqLeafUrl = `${faqIndexUrl}/i-want-to-know-the-tax-treatment-on-working-outside-singapore`;
const faqDataHrefDecoyUrl = `${faqIndexUrl}/working-outside-singapore-data-href-decoy`;
const faqChromeNoise = Array.from({ length: 220 }, (_, index) => `<a href='/navigation/${index}'>Navigation item ${index}</a>`).join('');
const faqIndexHtml = `<html><head><title>IRAS | FAQ index</title></head><body><main>
  <nav>${faqChromeNoise}</nav>
  <article>
  <h1>FAQ index</h1>
  <p>LINK_TARGET_ONLY_PARENT_TEXT_MUST_NOT_BE_EVIDENCE</p>
  <a href='${faqLeafUrl}'>Read more</a>
  <a data-href='${faqDataHrefDecoyUrl}'>Other link</a>
  </article>
</main></body></html>`;
const faqLeafClaim = 'If you are contracted to be based overseas to render your full employment services wholly outside Singapore, you are not liable to tax in Singapore as your employment income is sourced outside Singapore.';
const faqLeafHtml = `<html><head><title>IRAS | Working Outside Singapore</title><link rel="canonical" href="${faqLeafUrl}"></head><body><main>
  <h1>Working Outside Singapore</h1><h2>Overseas employment</h2><p>${faqLeafClaim}</p>
</main></body></html>`;
const faqFetchCalls = [];
const faqFetch = async url => {
  faqFetchCalls.push(url);
  if (url === faqIndexUrl) return new Response(faqIndexHtml, { status: 200, headers: { 'content-type': 'text/html' } });
  if (url === faqLeafUrl) return new Response(faqLeafHtml, { status: 200, headers: { 'content-type': 'text/html' } });
  throw new Error(`Unexpected FAQ link-expansion fetch: ${url}`);
};
const faqLinkResult = await resolveMappedOfficialSourceFallback([], linkedLeafQuery, emptyLocalRetriever, {
  authorityLevelDiscovery: true,
  webRetriever: new ControlledWebRetriever(undefined, new SourceCache()),
  fetchOptions: { customFetch: faqFetch, timeoutMs: 500, useCache: false },
  discoveryAdapter: {
    async discoverOfficialSourceCandidates(request) {
      return request.topicId.startsWith('iras-authority-query-') ? [faqIndexUrl] : [];
    },
    getCandidateTitle(url) { return url === faqIndexUrl ? 'IRAS | FAQ index' : undefined; }
  },
  officialDomainSearchAdapter: {
    async searchOfficialDomainCandidates() { return []; }
  }
});
assert.ok(faqFetchCalls.includes(faqIndexUrl) && faqFetchCalls.includes(faqLeafUrl),
  `The sitemap-discovered FAQ index and its explicit child page are independently fetched. calls=${JSON.stringify(faqFetchCalls)} trace=${JSON.stringify(faqLinkResult.trace)}`);
assert.ok(!faqFetchCalls.includes(faqDataHrefDecoyUrl), 'A data-href value is not treated as an explicit link target.');
const faqTrace = faqLinkResult.trace.attempts;
assert.ok(faqTrace.some(attempt => attempt.candidateUrl === faqIndexUrl && attempt.discoveryStage === 'SITEMAP_DISCOVERY'),
  'The parent FAQ index remains visible as the sitemap discovery source.');
assert.ok(faqTrace.some(attempt => attempt.candidateUrl === faqLeafUrl && attempt.discoverySourceUrl === faqIndexUrl &&
  attempt.discoveryStage === 'SITEMAP_DISCOVERY' && attempt.fetchStatus === 'SUCCESS'),
  'The explicit child link is traceable to its parent and validated through the normal sitemap stage.');
const faqAdmitted = faqLinkResult.records.find(record => record.canonicalSourceUrl === faqLeafUrl);
assert.ok(faqAdmitted, 'Only the separately fetched leaf page is admitted as evidence.');
const faqQuality = evaluateEvidenceQuality({ query: linkedLeafQuery, topicIds: [], provisionalTopics: faqLinkResult.provisionalTopics,
  authorities: ['IRAS'], records: faqLinkResult.records, missingFacts: [], sourceMapFallbackTrace: faqLinkResult.trace });
assert.ok(faqQuality.eligibleRecords.some(record => record.canonicalSourceUrl === faqLeafUrl));
assert.ok(!faqQuality.eligibleRecords.some(record => record.canonicalSourceUrl === faqIndexUrl),
  'The parent index and its link metadata never pass evidence admission.');
const faqVerified = verifyEvidenceClaims([{ kind: 'RULE', text: faqLeafClaim, quote: faqLeafClaim,
  recordId: faqAdmitted.id, citationUrl: faqLeafUrl }], [faqAdmitted], { missingFacts: [] });
assert.equal(faqVerified.accepted.length, 1, 'The leaf rule still passes exact claim-to-source verification.');
assert.equal(faqVerified.rejected.length, 0);

const adequateLinkedParentQuery = 'What are the foreign tax credit conditions?';
const adequateLinkedParentUrl = 'https://www.iras.gov.sg/taxes/individual-income-tax/foreign-tax-credit-conditions';
const unusedAdequateChildUrl = `${adequateLinkedParentUrl}/additional-conditions`;
const adequateLinkedParentHtml = `<html><head><title>IRAS | Foreign Tax Credit Conditions</title></head><body><main>
  <h1>Foreign Tax Credit Conditions</h1>
  <p>The foreign tax credit conditions explain when a Singapore tax resident may claim a foreign tax credit.</p>
  <a href="${unusedAdequateChildUrl}">Foreign tax credit conditions details</a>
</main></body></html>`;
const adequateParentFetchCalls = [];
const adequateParentFetch = async url => {
  adequateParentFetchCalls.push(url);
  if (url === adequateLinkedParentUrl) return new Response(adequateLinkedParentHtml, { status: 200, headers: { 'content-type': 'text/html' } });
  throw new Error(`Unexpected adequate-parent fixture fetch: ${url}`);
};
const adequateParentContext = await resolveMappedOfficialSourceFallback([], adequateLinkedParentQuery, emptyLocalRetriever, {
  authorityLevelDiscovery: true,
  webRetriever: new ControlledWebRetriever(undefined, new SourceCache()),
  fetchOptions: { customFetch: adequateParentFetch, timeoutMs: 500, useCache: false },
  discoveryAdapter: {
    async discoverOfficialSourceCandidates() { return [adequateLinkedParentUrl]; },
    getCandidateTitle(url) { return url === adequateLinkedParentUrl ? 'IRAS | Foreign Tax Credit Conditions' : undefined; }
  },
  officialDomainSearchAdapter: { async searchOfficialDomainCandidates() { throw new Error('A sufficient fetched parent must stop discovery.'); } }
});
assert.deepEqual(adequateParentFetchCalls, [adequateLinkedParentUrl],
  'A parent page that covers the full provisional concept set is sufficient; its related links are not fetched.');
assert.ok(adequateParentContext.trace.stages?.some(stage => stage.stage === 'SITEMAP_DISCOVERY' && stage.status === 'SUFFICIENT'));
assert.ok(adequateParentContext.trace.stages?.some(stage => stage.stage === 'OFFICIAL_DOMAIN_SEARCH' && stage.status === 'SKIPPED'));

const secondmentQuery = 'If a Singapore tax resident earns employment income while physically working overseas on a temporary secondment, under what conditions is that foreign-sourced income taxable in Singapore or eligible for double taxation relief?';
const dtrTopic = 'iras-individual-double-tax-agreements';
const scopedDtrUrl = 'https://www.iras.gov.sg/taxes/individual-income-tax/employees/scenario-based-faqs-for-working-in-singapore-and-abroad/i-want-to-know-the-tax-treatment-on-working-outside-singapore';
const employmentRuleUrl = 'https://www.iras.gov.sg/taxes/individual-income-tax/employees/scenario-based-faqs-for-working-in-singapore-and-abroad/overseas-employment';
const dtrQuote = 'Should your gains from your employment be taxed in the foreign country, you may apply for double taxation relief or tax remission in Singapore, to avoid being taxed twice on the same income.';
const scopedDtrHtml = `<html><head><title>IRAS | Double Taxation Agreements (DTA)</title><link rel="canonical" href="${scopedDtrUrl}"></head><body><main>
  <h1>Double Taxation Agreements (DTA)</h1>
  <p>• You are employed outside of Singapore on behalf of the Government of Singapore.</p>
  <h2>a. Tax treatment in Singapore</h2>
  <p>As a Singapore citizen or tax resident in Singapore, the income from your employment exercised outside Singapore on behalf of Singapore government is deemed to have been derived from Singapore.</p>
  <h2>b. Tax treatment outside Singapore</h2>
  <p>Your gains from such employment are exempt from tax in the foreign country where you worked if there is:</p>
  <ul><li>Double Taxation Agreements (DTA) between Singapore and the foreign country; or</li><li>Provision for reciprocal exemption by Singapore and foreign governments.</li></ul>
  <p>${dtrQuote}</p>
</main></body></html>`;
const employmentRuleQuote = 'If you are contracted to be based overseas to render your full employment services wholly outside Singapore, you are not liable to tax in Singapore as your employment income is sourced outside Singapore.';
const employmentRuleHtml = `<html><head><title>IRAS | Overseas Employment</title><link rel="canonical" href="${employmentRuleUrl}"></head><body><main>
  <h1>Overseas employment</h1>
  <h2>Working outside Singapore</h2>
  <p>${employmentRuleQuote} It does not matter where and how you are being paid.</p>
  <p>Employment income attributable to services rendered in Singapore is subject to tax under the applicable conditions.</p>
</main></body></html>`;
const fallbackRequests = [];
const fallbackEvents = [];
const fallbackFetchUrls = [];
const fallbackFetch = async (url) => {
  fallbackFetchUrls.push(url);
  if (url === scopedDtrUrl) return new Response(scopedDtrHtml, { status: 200, headers: { 'content-type': 'text/html' } });
  if (url === employmentRuleUrl) return new Response(employmentRuleHtml, { status: 200, headers: { 'content-type': 'text/html' } });
  throw new Error(`Unexpected scoped fallback fetch: ${url}`);
};
const fallbackWebRetriever = new ControlledWebRetriever(undefined, new SourceCache());
const fullQueryDiscoveryAdapter = {
  async discoverOfficialSourceCandidates(request) {
    fallbackEvents.push(`SITEMAP:${request.topicId}`);
    fallbackRequests.push(request);
    if (request.topicId === dtrTopic) return [scopedDtrUrl];
    if (request.authorityLevelFallback === true) return [employmentRuleUrl];
    return [];
  },
  getCandidateTitle(url) {
    return url === scopedDtrUrl ? 'IRAS | Double Taxation Agreements (DTA)' : 'IRAS | Overseas Employment';
  }
};
const finalSearchAdapter = {
  async searchOfficialDomainCandidates(request) {
    fallbackEvents.push(`SEARCH:${request.topicId}`);
    return [];
  }
};
const fullQueryFallback = await resolveMappedOfficialSourceFallback([dtrTopic], secondmentQuery, defaultSourceRetriever, {
  authorityLevelDiscovery: true,
  webRetriever: fallbackWebRetriever,
  fetchOptions: { customFetch: fallbackFetch, timeoutMs: 500, useCache: false },
  discoveryAdapter: fullQueryDiscoveryAdapter,
  officialDomainSearchAdapter: finalSearchAdapter
});
assert.deepEqual(fallbackRequests.map(request => request.topicId), [dtrTopic, fullQueryFallback.provisionalTopics[0]?.id],
  'After an unsuitable registered relief page, the full user query receives a separate authority-level sitemap request.');
assert.equal(fallbackRequests[1]?.query, secondmentQuery, 'Authority discovery receives the complete user question.');
assert.equal(fallbackRequests[1]?.authorityLevelFallback, true);
assert.ok(fallbackFetchUrls.includes(scopedDtrUrl) && fallbackFetchUrls.includes(employmentRuleUrl),
  'Every sitemap candidate is fetched as a page independently of sitemap metadata.');
const firstSearchEvent = fallbackEvents.findIndex(event => event.startsWith('SEARCH:'));
assert.ok(firstSearchEvent > fallbackEvents.map((event, index) => event.startsWith('SITEMAP:') ? index : -1).at(-1),
  'Official-domain search starts only after every sitemap discovery request is complete.');
assert.ok(fallbackEvents.includes(`SEARCH:${fullQueryFallback.provisionalTopics[0]?.id}`),
  'A fetched page that covers only part of the full-query concepts does not suppress official search for the still-uncovered authority-level request.');
const fullQueryQuality = evaluateEvidenceQuality({ query: secondmentQuery, topicIds: [dtrTopic],
  provisionalTopics: fullQueryFallback.provisionalTopics, authorities: ['IRAS'], records: fullQueryFallback.records,
  missingFacts: [], sourceMapFallbackTrace: fullQueryFallback.trace });
assert.ok(fullQueryQuality.eligibleRecords.some(record => record.sourceText.includes(employmentRuleQuote)),
  `The query-scoped discovery record can admit the actual overseas-employment rule. ${JSON.stringify({ provisional: fullQueryFallback.provisionalTopics.map(topic => topic.id), selected: fullQueryFallback.trace.selectedRecordIds, eligible: fullQueryQuality.eligibleRecords.map(record => record.tags), rejected: fullQueryQuality.rejectedRecords, uncovered: fullQueryQuality.uncoveredConceptGroups, attempts: fullQueryFallback.trace.attempts, records: fullQueryFallback.records.map(record => ({ tags: record.tags, sourceText: record.sourceText })) })}`);
assert.ok(!fullQueryQuality.coveredTopicIds.includes(fullQueryFallback.provisionalTopics[0].id),
  'One admitted employment passage cannot cover the full query while resident and double-tax concepts remain unsupported.');
assert.ok(fullQueryQuality.uncoveredConceptGroups?.[fullQueryFallback.provisionalTopics[0].id]?.some(group =>
  group.includes('double') && group.includes('taxation')
), 'Unmatched provisional query concepts remain traceable for progressive discovery.');
assert.ok(!fullQueryQuality.coveredTopicIds.includes(dtrTopic),
  'The authority-query employment rule does not mark the unresolved registered DTA topic covered.');
assert.ok(fullQueryQuality.rejectedRecords.some(item => item.code === 'TOPIC_SCOPE_MISMATCH'),
  `The qualifying Government-employment DTR passage is rejected for this private/unspecified secondment query: ${JSON.stringify({ rejected: fullQueryQuality.rejectedRecords, attempts: fullQueryFallback.trace.attempts, covered: fullQueryQuality.coveredTopicIds, records: fullQueryFallback.records.map(record => ({ tags: record.tags, text: record.sourceText })) })}`);
const admittedEmploymentRecord = fullQueryQuality.eligibleRecords.find(record => record.sourceText.includes(employmentRuleQuote));
const verifiedEmploymentClaim = verifyEvidenceClaims([{ kind: 'RULE', text: employmentRuleQuote, quote: employmentRuleQuote,
  recordId: admittedEmploymentRecord.id, citationUrl: admittedEmploymentRecord.canonicalSourceUrl }],
fullQueryQuality.eligibleRecords, { missingFacts: [] });
assert.equal(verifiedEmploymentClaim.accepted.length, 1, 'The retrieved employment rule remains subject to and passes exact claim verification.');

const mapOrderQuery = 'What corporate income tax rate applies and which business expenses are deductible for tax?';
const mapPointerIds = ['IRAS_CIT_RATE_SOURCE_MAP', 'IRAS_CIT_EXPENSES_SOURCE_MAP'];
const mapPointers = mapPointerIds.map(id => defaultSourceRetriever.getSourceById(id)).filter(Boolean);
assert.equal(mapPointers.length, 2, 'The stage-order regression uses two existing reviewed source-map routes.');
const mapUrls = new Set(mapPointers.map(pointer => pointer.officialSourceUrl));
const stageOrder = [];
const mapFetch = async (url) => {
  if (mapUrls.has(url)) stageOrder.push(`MAP:${url}`);
  return new Response('not found', { status: 404, headers: { 'content-type': 'text/plain' } });
};
const stageOrderResult = await resolveMappedOfficialSourceFallback(['iras-cit-tax-rate', 'iras-cit-deductibility'], mapOrderQuery, defaultSourceRetriever, {
  webRetriever: new ControlledWebRetriever(undefined, new SourceCache()),
  fetchOptions: { customFetch: mapFetch, timeoutMs: 500, useCache: false },
  discoveryAdapter: { async discoverOfficialSourceCandidates(request) { stageOrder.push(`SITEMAP:${request.topicId}`); return []; } },
  officialDomainSearchAdapter: { async searchOfficialDomainCandidates(request) { stageOrder.push(`SEARCH:${request.topicId}`); return []; } }
});
const mapEventIndices = stageOrder.map((event, index) => event.startsWith('MAP:') ? index : -1).filter(index => index >= 0);
const sitemapEventIndices = stageOrder.map((event, index) => event.startsWith('SITEMAP:') ? index : -1).filter(index => index >= 0);
const searchEventIndices = stageOrder.map((event, index) => event.startsWith('SEARCH:') ? index : -1).filter(index => index >= 0);
assert.equal(mapEventIndices.length, 2, 'Both applicable reviewed pointers are attempted.');
assert.ok(Math.max(...mapEventIndices) < Math.min(...sitemapEventIndices), 'All reviewed source-map fetches precede every sitemap request.');
assert.ok(Math.max(...sitemapEventIndices) < Math.min(...searchEventIndices), 'Every sitemap request precedes the first official-domain search.');
assert.ok(stageOrderResult.trace.stages?.some(stage => stage.stage === 'MAPPED_SOURCE' && stage.status === 'EXHAUSTED'));

const shortCircuitEvents = [];
const localShortCircuit = await resolveMappedOfficialSourceFallback([], query, defaultSourceRetriever, {
  authorityLevelDiscovery: true,
  localEvidenceAdequate: true,
  discoveryAdapter: { async discoverOfficialSourceCandidates() { shortCircuitEvents.push('SITEMAP'); return []; } },
  officialDomainSearchAdapter: { async searchOfficialDomainCandidates() { shortCircuitEvents.push('SEARCH'); return []; } }
});
assert.deepEqual(shortCircuitEvents, [], 'Adequate reviewed local evidence prevents unnecessary live discovery.');
assert.ok(localShortCircuit.trace.stages?.every(stage => stage.stage === 'LOCAL_VERIFIED' || stage.status === 'SKIPPED'));

const carryForwardUrl = 'https://www.iras.gov.sg/taxes/corporate-income-tax/income-deductions-for-companies/unutilised-items-(capital-allowances-trade-losses-donations)';
const carryForwardHtml = `<html><head><title>IRAS | Unutilised Items (Capital Allowances, Trade Losses & Donations)</title><link rel="canonical" href="${carryForwardUrl}"></head><body><main>
  <h1>Unutilised Items (Capital Allowances, Trade Losses &amp; Donations)</h1>
  <p>Unutilised capital allowances and unutilised trade losses may be carried forward to future Years of Assessment.</p>
  <p>Carry-forward is subject to qualifying conditions, including the shareholding test.</p>
  <p>Compare shareholding on the relevant dates to determine if there has been a substantial change in shareholders.</p>
</main></body></html>`;
const mappedShortCircuitEvents = [];
const mappedShortCircuit = await resolveMappedOfficialSourceFallback(['iras-cit-loss-carry-forward'], 'Can the company use prior-year losses?', defaultSourceRetriever, {
  webRetriever: new ControlledWebRetriever(undefined, new SourceCache()),
  fetchOptions: { customFetch: async (url) => {
    if (url === carryForwardUrl) return new Response(carryForwardHtml, { status: 200, headers: { 'content-type': 'text/html' } });
    throw new Error(`Unexpected mapped short-circuit fetch: ${url}`);
  }, timeoutMs: 500, useCache: false },
  discoveryAdapter: { async discoverOfficialSourceCandidates() { mappedShortCircuitEvents.push('SITEMAP'); return []; } },
  officialDomainSearchAdapter: { async searchOfficialDomainCandidates() { mappedShortCircuitEvents.push('SEARCH'); return []; } }
});
assert.equal(mappedShortCircuit.trace.stages?.find(stage => stage.stage === 'MAPPED_SOURCE')?.status, 'SUFFICIENT');
assert.ok(mappedShortCircuit.trace.stages?.some(stage => stage.stage === 'SITEMAP_DISCOVERY' && stage.status === 'SKIPPED'));
assert.deepEqual(mappedShortCircuitEvents, [], 'Adequate mapped evidence prevents sitemap and search calls.');

const pluralLabelReliefQuestion = 'Given the overall personal income tax relief cap of SGD 80,000, how are overlapping claims prioritized between mandatory CPF contributions, the Supplementary Retirement Scheme (SRS), and parenthood/caregiver reliefs?';
const pluralLabelReliefUnderstanding = {
  mode: 'SEMANTIC_INTERPRETATION',
  interpretation: {
    jurisdiction: ['Singapore'], authorityCandidates: ['IRAS'], contextualAuthorities: ['CPF'],
    domain: 'IRAS_INCOME_TAX', population: 'INDIVIDUAL',
    primarySubject: 'overall personal income tax relief cap',
    concepts: [
      { concept: 'mandatory CPF contributions', role: 'RELATED' },
      { concept: 'Supplementary Retirement Scheme reliefs', role: 'RELATED' },
      { concept: 'parenthood and caregiver reliefs', role: 'RELATED' }
    ],
    requestedOperation: 'EXPLAIN_INTERACTION', requiresUserSpecificFacts: false,
    calculationRequested: false, factsExplicitlyProvided: [], confidence: 0.94
  }
};
const pluralReliefDiscoveryRequests = [];
const pluralReliefDiscovery = await resolveMappedOfficialSourceFallback([], pluralLabelReliefQuestion, emptyLocalRetriever, {
  authorityLevelDiscovery: true,
  questionUnderstanding: pluralLabelReliefUnderstanding,
  discoveryAdapter: {
    async discoverOfficialSourceCandidates(request) { pluralReliefDiscoveryRequests.push(request); return []; }
  },
  officialDomainSearchAdapter: { async searchOfficialDomainCandidates() { return []; } }
});
const expectedPluralReliefConceptIds = [
  'personal_income_tax_relief_cap', 'cpf_relief', 'srs_relief', 'parent_relief',
  'grandparent_caregiver_relief', 'working_mother_child_relief', 'qualifying_child_relief',
  'relief_claim_prioritization'
];
const discoveredPluralReliefConceptIds = pluralReliefDiscovery.provisionalTopics.flatMap(topic =>
  topic.requestedConcepts?.map(concept => concept.id) || []);
assert.deepEqual(discoveredPluralReliefConceptIds, expectedPluralReliefConceptIds,
  'Resolver discovery retains all eight canonical relief concepts without plural-label duplicates.');
assert.equal(pluralReliefDiscoveryRequests.some(request => /semantic_(?:mandatory_cpf_contributions|parenthood_and_caregiver_reliefs)/.test(request.topicId)), false,
  'The plural Gemini labels do not create extra resolver discovery requests.');
assert.ok(pluralReliefDiscoveryRequests.every(request => request.query === pluralLabelReliefQuestion),
  'Every relief concept discovery remains governed by the complete original question.');

const mappedReliefPages = [
  ['iras-individual-relief-cap', 'Tax Reliefs', 'Overall personal income tax relief cap. The total amount of personal income tax reliefs that an individual can claim is capped at $80,000 per Year of Assessment.'],
  ['iras-individual-cpf-relief', 'Central Provident Fund (CPF) Relief for employees', 'CPF Relief for employees applies to compulsory CPF contributions made by an employee.'],
  ['iras-individual-srs-relief', 'SRS contributions and tax relief', 'Individuals may claim Supplementary Retirement Scheme (SRS) Relief for qualifying SRS contributions.'],
  ['iras-individual-parent-relief', 'Parent Relief/Parent Relief (Disability)', 'An individual may claim Parent Relief for supporting a parent who meets the conditions.'],
  ['iras-individual-grandparent-caregiver-relief', 'Grandparent Caregiver Relief', 'Grandparent Caregiver Relief may be claimed by an individual who meets the caregiver conditions.'],
  ['iras-individual-wmcr', "Working Mother's Child Relief (WMCR)", "Working Mother's Child Relief (WMCR) may be claimed by eligible working mothers."],
  ['iras-individual-qcr', 'Qualifying Child Relief (QCR)/Child Relief (Disability)', 'Qualifying Child Relief (QCR) may be claimed by an eligible individual for a qualifying child.']
];
const reliefPageBodies = new Map(mappedReliefPages.map(([id, title, body]) => {
  const url = getCoverageTopicById(id)?.canonicalSourceUrl;
  assert.ok(url, `Registered ${id} has a reviewed IRAS URL pointer.`);
  return [url, `<html><head><title>IRAS | ${title}</title><link rel="canonical" href="${url}"></head><body><main><h1>${title}</h1><p>${body}</p></main></body></html>`];
}));
const mappedReliefFetches = [];
const mappedReliefResult = await resolveMappedOfficialSourceFallback(
  mappedReliefPages.map(([id]) => id), pluralLabelReliefQuestion, defaultSourceRetriever, {
    fetchOptions: {
      useCache: false,
      customFetch: async url => {
        mappedReliefFetches.push(url);
        const html = reliefPageBodies.get(url);
        return new Response(html || 'Unavailable', { status: html ? 200 : 503, headers: { 'content-type': 'text/html' } });
      }
    },
    authorityLevelDiscovery: false
  }
);
assert.equal(mappedReliefResult.records.length, mappedReliefPages.length,
  `Every material registered relief concept fetches its own verified official page: ${JSON.stringify(mappedReliefResult.trace.attempts.map(attempt => [attempt.topicId, attempt.fetchStatus]))}`);
assert.deepEqual(new Set(mappedReliefFetches), new Set(reliefPageBodies.keys()),
  'Mapped retrieval fetches only the seven reviewed IRAS relief URLs.');
const mappedReliefCoverage = evaluateEvidenceQuality({
  query: pluralLabelReliefQuestion,
  topicIds: mappedReliefPages.map(([id]) => id),
  records: mappedReliefResult.records,
  missingFacts: [],
  requestedConcepts: getRequestedQuestionConcepts(pluralLabelReliefQuestion, pluralLabelReliefUnderstanding),
  provisionalTopics: mappedReliefResult.provisionalTopics,
  sourceMapFallbackTrace: mappedReliefResult.trace,
  authorities: ['IRAS']
});
assert.deepEqual(mappedReliefCoverage.uncoveredConcepts, ['Order or prioritization among relief claims'],
  'Specific relief pages cover their concepts, while an unsupported claim-priority interaction remains uncovered.');

console.log('PASS | IRAS authority discovery covers search after sitemap exhaustion and sitemap-first evidence admission with independent claim verification.');
