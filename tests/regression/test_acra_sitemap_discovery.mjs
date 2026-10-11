import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ControlledWebRetriever } from '../../src/retrieval/controlledWebRetriever.ts';
import { SourceCache } from '../../src/retrieval/sourceCache.ts';
import { OfficialSitemapDiscoveryAdapter, OFFICIAL_SOURCE_DISCOVERY_PROVIDERS } from '../../src/retrieval/officialSitemapDiscovery.ts';
import { defaultSourceRetriever } from '../../src/retrieval/sourceRetriever.ts';
import { resolveMappedOfficialSourceFallback } from '../../src/services/groundingContextBuilder.ts';
import { buildAuthorityWorkstreams } from '../../src/services/authorityWorkstreams.ts';
import { defaultExternalSourceValidator } from '../../src/retrieval/externalSourceValidator.ts';

// Captured article text/markup, omitting presentation attributes while retaining
// semantic roles and aria labels. SHA256 identifies each full original capture.
const pages = JSON.parse(await readFile(new URL('../fixtures/acra-company-guidance-2026-10-10.json', import.meta.url), 'utf8'));
const bannerExpectation = { standardIdentifiers: ['Accounting and Corporate Regulatory Authority'],
  expectedTitles: ['annual returns'], topicTerms: ['annual return'] };
assert.equal(defaultExternalSourceValidator.validateTopicContent(pages.find(page => page.name === 'annual').html, bannerExpectation).isValid, false,
  'Generic extraction behavior remains unchanged when a preceding banner article exists.');
assert.equal(defaultExternalSourceValidator.validateTopicContent(pages.find(page => page.name === 'annual').html,
  { ...bannerExpectation, preferMainContent: true }).isValid, true,
  'Corporate ACRA extraction opts into the substantive main instead of the government banner.');
const provider = OFFICIAL_SOURCE_DISCOVERY_PROVIDERS.ACRA;
assert.deepEqual(provider.approvedHosts, ['www.acra.gov.sg', 'acra.gov.sg']);
assert.deepEqual(provider.sitemapUrls, ['https://www.acra.gov.sg/sitemap.xml']);
const cases = [
  ['annual', 'acra_annual-returns', 'What are the annual return filing requirements for a Singapore company?'],
  ['financial', 'acra_financial_statements', 'How should a Singapore company prepare financial statements?'],
  ['xbrl', 'acra_xbrl', 'What are the XBRL financial statement filing requirements for a Singapore company?'],
  ['audit', 'acra_small_company', 'What are the small company audit exemption criteria?'],
  ['compliance', 'acra_directors', 'Explain company director duties and compliance obligations.'],
  ['filings', 'acra_share-allotments', 'How does a Singapore company file a return of allotment of shares?']
];
const response = html => new Response(html, { status: 200, headers: { 'content-type': 'text/html' } });
const xml = urls => `<urlset>${urls.map(url => `<url><loc>${url}</loc></url>`).join('')}</urlset>`;
const irrelevant = title => `<html><head><title>${title} | Accounting and Corporate Regulatory Authority</title></head><body><main><h1>${title}</h1><nav><a href="#">annual returns financial statements XBRL audit exemption company directors share allotment</a></nav><p>This page describes general information about business services and helps you find further resources for your organisation.</p></main></body></html>`;
const prohibited = [
  'https://unapproved.example/annual-returns', 'http://www.acra.gov.sg/annual-returns',
  'https://www.acra.gov.sg.evil.example/annual-returns', 'https://www.acra.gov.sg@evil.example/annual-returns',
  'https://asc.acra.gov.sg/annual-returns', 'https://www.acra.gov.sg:8443/annual-returns',
  'https://www.acra.gov.sg/manage/variable-capital-companies/annual-returns/',
  'https://www.acra.gov.sg/manage/companies/legal-requirements-common-offences/annual-filing-for-foreign-companies/',
  'https://www.acra.gov.sg/regulations/accounting-standards/'
];

async function run(name, topic, query, mode = 'sitemap', overrides = {}) {
  const page = pages.find(item => item.name === name);
  const calls = [];
  const fetch = async url => {
    calls.push(url);
    if (url === provider.sitemapUrls[0]) return mode === 'sitemap' || mode === 'competing'
      ? response(xml([...(mode === 'competing' ? page.discoveryCompetingUrls : [page.url]), ...prohibited])) : new Response('Unavailable', { status: 404 });
    if (url.endsWith('/robots.txt')) return mode === 'robots'
      ? response('Sitemap: https://unapproved.example/sitemap.xml\nSitemap: https://www.acra.gov.sg/declared.xml') : new Response('Unavailable', { status: 404 });
    if (url === 'https://www.acra.gov.sg/declared.xml') return response(xml([page.url, ...prohibited]));
    if (url.startsWith('https://html.duckduckgo.com/html/?')) {
      assert.match(new URL(url).searchParams.get('q'), /^site:acra\.gov\.sg /);
      return response(`<html><body>SEARCH_METADATA_ONLY<a href="${page.url}">${topic}</a></body></html>`);
    }
    if (url === page.url) return response(overrides.html || page.html);
    throw new Error(`Unexpected fetch ${url}`);
  };
  const result = await resolveMappedOfficialSourceFallback([topic], query, defaultSourceRetriever, {
    referenceDate: '2026-10-10', webRetriever: new ControlledWebRetriever(undefined, new SourceCache()),
    fetchOptions: { customFetch: fetch, timeoutMs: 500, useCache: false }, ...overrides.options
  });
  return { ...result, calls, page };
}

const inlineRule = await run(...cases[0], 'sitemap', { html: `<html><head><title>Deadline &amp; requirements for annual returns | Accounting and Corporate Regulatory Authority</title></head><body><main><p>All companies registered in Singapore must file an <a href="/manage/companies/">annual return</a> with ACRA each year. This applies as long as your company is listed as “live” with us.</p></main></body></html>` });
assert.equal(inlineRule.records.length, 1);
assert.ok(inlineRule.records[0].sourceText.includes('must file an annual return with ACRA each year'),
  'Inline links must not truncate legal instructions in source excerpts.');
const cardsOnly = await run(...cases[0], 'sitemap', { html: `<html><head><title>Deadline &amp; requirements for annual returns | Accounting and Corporate Regulatory Authority</title></head><body><main><p>This guide helps readers find official company resources and understand the available services for businesses and their officers.</p><a href="${pages.find(page => page.name === 'annual').url}"><div><h3>Annual returns</h3><p>Companies must file annual returns each year.</p></div></a></main></body></html>` });
assert.equal(cardsOnly.records.length, 0, 'Related-page cards cannot substitute for fetched article rule text.');
for (const breadcrumb of [
  '<ol><li><a href="/manage/companies/">Annual returns</a><svg><path/></svg></li></ol>',
  '<ol><li><a href="/manage/companies/">Managing a company</a><svg><path/></svg></li><li><span>Deadline &amp; requirements for annual returns</span></li></ol>',
  '<div aria-label="Breadcrumb" role="navigation"><div><ol><li><a href="/manage/companies/">Managing a company</a><svg><path/></svg></li><li><span>Deadline &amp; requirements for annual returns</span></li></ol></div></div>'
]) {
  const result = await run(...cases[0], 'sitemap', { html: `<html><head><title>Deadline &amp; requirements for annual returns | Accounting and Corporate Regulatory Authority</title></head><body><main>${breadcrumb}<p>This page describes general business resources and services available to help readers find information for their organisation and its officers.</p></main></body></html>` });
  assert.equal(result.records.length, 0, 'Breadcrumb labels/icons/current-page spans cannot establish body evidence.');
}
const orderedInstructions = await run(...cases[0], 'sitemap', { html: `<html><head><title>Deadline &amp; requirements for annual returns | Accounting and Corporate Regulatory Authority</title></head><body><main><ol><li>All companies registered in Singapore must file an <a href="/manage/companies/">annual return</a> with ACRA each year.</li><li>This applies as long as your company is listed as “live” with us.</li></ol></main></body></html>` });
assert.equal(orderedInstructions.records.length, 1, 'Substantive legal ordered lists remain eligible.');
assert.ok(orderedInstructions.records[0].sourceText.includes('must file an annual return with ACRA each year'));

const positives = [];
for (const [name, topic, query] of cases) {
  const result = await run(name, topic, query);
  positives.push(result);
  assert.equal(result.records.length, 1, `${name}: ${JSON.stringify(result.trace)}`);
  const record = result.records[0];
  assert.equal(record.authority, 'ACRA');
  assert.equal(record.sourceAuthority, 'ACRA');
  assert.equal(record.officialSourceUrl, result.page.url);
  assert.equal(record.provenance, 'LIVE_EXTERNAL');
  assert.equal(record.lifecycleState, 'CANDIDATE');
  assert.equal(record.recordRole, 'DISCOVERED_EVIDENCE');
  assert.equal(result.trace.candidateOnly, true);
  assert.ok(result.calls.includes(result.page.url), 'Article is fetched independently of sitemap metadata.');
  assert.ok(!result.calls.some(url => prohibited.includes(url)));
  assert.ok(!record.sourceText.includes('SEARCH_METADATA_ONLY'));
  assert.ok(!record.sourceText.includes('Government agencies communicate'));
  assert.ok(!result.calls.some(url => url.includes('duckduckgo')), 'Adequate article stops before search.');
  const rejected = await run(name, topic, query, 'sitemap', { html: irrelevant(record.documentTitle) });
  assert.equal(rejected.records.length, 0, 'Relevant title/navigation labels cannot establish substantive rules.');
}
const competingSharePages = await run(...cases[5], 'competing');
assert.equal(competingSharePages.records.length, 1,
  'Observed allotment title hints prioritize its route within the fixed cap despite competing share filings.');
assert.equal(competingSharePages.records[0].officialSourceUrl, competingSharePages.page.url);
assert.ok(competingSharePages.calls.filter(url => url !== provider.sitemapUrls[0]).length <= 4);

for (const mode of ['robots', 'search']) {
  const result = await run(...cases[0], mode);
  assert.equal(result.records.length, 1, JSON.stringify(result.trace));
  assert.ok(result.calls.some(url => mode === 'robots' ? url.endsWith('/declared.xml') : url.includes('duckduckgo')));
}

for (const query of [
  'What were the annual return rules in 2024?', 'What were the filing requirements on 01/06/2025?',
  'What were the annual return rules last year?', 'Explain historical annual return requirements.',
  'Explain old ACRA annual return rules.', 'Explain the previous audit exemption requirements.'
]) {
  const result = await run('annual', 'acra_annual-returns', query);
  assert.equal(result.records.length, 0);
  assert.equal(result.calls.length, 0, 'Current discovery cannot establish historical corporate rules.');
  assert.ok(result.trace.attempts.some(attempt => attempt.fetchStatus === 'HISTORICAL_SCOPE_UNVERIFIED'));
}

// Injected adapters still encounter the same final-URL and evidence boundary.
for (const finalUrl of [
  ...prohibited, 'https://www.acra.gov.sg/manage/companies/',
  'https://www.acra.gov.sg/manage/companies/legal-requirements-common-offences/'
]) {
  const record = positives[0].records[0];
  const result = await run(...cases[0], 'sitemap', { options: {
    discoveryAdapter: { discoverOfficialSourceCandidates: async () => [record.officialSourceUrl] },
    officialDomainSearchAdapter: { searchOfficialDomainCandidates: async () => [] },
    webRetriever: { async fetchOfficialSource() {
      return { status: 'SUCCESS', content: positives[0].page.html, finalUrl, topicMatched: true, titleMatched: true,
        contentMatched: true, pageTitle: record.documentTitle, contentHash: record.contentHash, retrievedAt: record.retrievedAt };
    } }
  } });
  assert.equal(result.records.length, 0, `Reject final URL ${finalUrl}`);
}

// Oversized injected results cannot enlarge the four initial-candidate cap.
let boundedFetches = 0;
const urls = Array.from({ length: 12 }, (_, index) => `${positives[0].page.url}?candidate=${index}`);
await run(...cases[0], 'sitemap', { options: {
  discoveryAdapter: { discoverOfficialSourceCandidates: async () => urls },
  officialDomainSearchAdapter: { searchOfficialDomainCandidates: async () => [] },
  webRetriever: { async fetchOfficialSource(url) { boundedFetches++; return { status: 'NOT_FOUND', finalUrl: url }; } }
} });
assert.equal(boundedFetches, 4);
const indexCalls = [];
const adapter = new OfficialSitemapDiscoveryAdapter({ async fetchOfficialSource(url) {
  indexCalls.push(url);
  return { status: 'SUCCESS', finalUrl: url, content: xml(pages.map(page => page.url)) };
} });
const request = { ...provider, query: cases[0][2], topicId: cases[0][1], topicDomainId: 'ACRA_COMPANIES',
  topicTitle: 'Annual Returns', standardOrAct: 'Companies Act', topicHints: ['annual returns'], maxCandidates: 4 };
const ranked = await adapter.discoverOfficialSourceCandidates(request);
assert.equal(ranked[0], positives[0].page.url);
assert.ok(ranked.length <= 4);
await adapter.discoverOfficialSourceCandidates({ ...request, topicId: 'acra_xbrl', topicTitle: 'XBRL financial statements', topicHints: ['XBRL financial statements'] });
assert.equal(indexCalls.length, 1, 'Authority index cache is reusable across corporate topics.');

// Accounting standards keep their ASC/IFRS route instead of corporate ACRA config.
let accountingRequest;
await resolveMappedOfficialSourceFallback(['sfrsi_intangibles_cap'], 'Explain SFRS(I) 1-38 development cost capitalisation.', defaultSourceRetriever, {
  referenceDate: '2026-10-10',
  discoveryAdapter: { async discoverOfficialSourceCandidates(request) { accountingRequest = request; return []; } },
  officialDomainSearchAdapter: { async searchOfficialDomainCandidates() { throw new Error('Corporate search must not run for standards.'); } }
});
assert.ok(accountingRequest.approvedHosts.includes('asc.acra.gov.sg'));
assert.ok(accountingRequest.approvedHosts.includes('www.ifrs.org'));
assert.equal(accountingRequest.sitemapUrls, undefined);

const candidate = positives[0].records[0];
const governed = await buildAuthorityWorkstreams(cases[0][2], {
  source: 'SEMANTIC_ISSUES', coverageEstablished: true, hasUnmappedResidual: false,
  issues: [{ id: 'acra-candidate-only', subject: 'annual return filing requirements', population: 'COMPANY', domain: 'ACRA_CORPORATE',
    governingAuthorities: ['ACRA'], contextualAuthorities: [], operation: 'EXPLAIN_RULE', mappedTopicIds: ['acra_annual-returns'],
    evidenceRequirement: 'AUTHORITATIVE_SOURCE', confidence: 0.96, status: 'MAPPED' }]
}, { referenceDate: '2026-10-10', providers: { ACRA: { authority: 'ACRA', retrieve: async () => ({ candidates: [candidate] }) } } });
assert.equal(governed.status, 'INSUFFICIENT', 'Discovery cannot bypass approved governed evidence admission.');
assert.equal(governed.workstreams[0].issues[0].lifecycle.evidenceFound, true);
assert.equal(governed.workstreams[0].issues[0].lifecycle.admitted, false);
assert.ok(governed.workstreams.every(stream => stream.verifiedClaims.length === 0));
console.log('ACRA sitemap discovery regression tests passed.');
