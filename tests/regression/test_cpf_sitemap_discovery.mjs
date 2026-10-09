import assert from 'node:assert/strict';
import { ControlledWebRetriever } from '../../src/retrieval/controlledWebRetriever.ts';
import { SourceCache } from '../../src/retrieval/sourceCache.ts';
import { OfficialSitemapDiscoveryAdapter, OFFICIAL_SOURCE_DISCOVERY_PROVIDERS } from '../../src/retrieval/officialSitemapDiscovery.ts';
import { defaultSourceRetriever } from '../../src/retrieval/sourceRetriever.ts';
import { resolveMappedOfficialSourceFallback } from '../../src/services/groundingContextBuilder.ts';

const provider = OFFICIAL_SOURCE_DISCOVERY_PROVIDERS.CPF;
assert.deepEqual(provider.approvedHosts, ['www.cpf.gov.sg', 'cpf.gov.sg']);
assert.equal(provider.searchSite, 'cpf.gov.sg');
const pageUrl = 'https://www.cpf.gov.sg/employer/employer-obligations/what-constitutes-wages-for-cpf-contributions';
const dueUrl = 'https://www.cpf.gov.sg/employer/compliance-and-rectifications/enforcement-and-penalties-for-non-compliance';
const memberUrl = 'https://www.cpf.gov.sg/member/growing-your-savings/saving-more-with-cpf/top-up-to-enjoy-higher-retirement-payouts';
const response = html => new Response(html, { status: 200, headers: { 'content-type': 'text/html' } });
const article = (title, body) => `<html><head><title>CPF Board | ${title}</title></head><body><main><h1>${title}</h1><p>${body}</p></main></body></html>`;
const wageArticle = article('What constitutes wages for CPF contributions', 'Ordinary wages are wages due or granted wholly and exclusively in respect of employment in that month. CPF contributions are payable on ordinary wages, subject to the applicable wage ceiling. The employer must determine the payment period and applicable contribution rates.');
const memberArticle = article('Top up to enjoy higher retirement payouts', 'CPF members can make cash top-ups to grow their retirement savings. Top-ups (both cash top-ups and CPF transfers) are irreversible as they are a long-term commitment to boost your retirement savings for higher payouts. They cannot be withdrawn for any other purposes.');

async function run(topic, query, mode = 'sitemap', body = wageArticle) {
  const calls = [];
  const fetch = async url => {
    calls.push(url);
    if (url === 'https://www.cpf.gov.sg/employer/sitemap' || url === 'https://www.cpf.gov.sg/member/sitemap') {
      if (mode !== 'sitemap' && mode !== 'member-unrelated') return new Response('Unavailable', { status: 404 });
      return response(`<html><body><main><h1>CPF Sitemap</h1><p>SITEMAP_METADATA_ONLY</p>
        <a href="${pageUrl}">What constitutes wages for CPF contributions</a>
        <a href="${dueUrl}">Enforcement and penalties for non-compliance</a>
        <a href="${memberUrl}">Top up to enjoy higher retirement payouts</a>
        <a href="https://unapproved.example/ordinary-wages">Ordinary wages</a>
        <a href="http://www.cpf.gov.sg/ordinary-wages">Ordinary wages</a>
        <a href="https://www.cpf.gov.sg/member/healthcare">Healthcare options</a>
      </main></body></html>`);
    }
    if (url.endsWith('/robots.txt')) return mode === 'robots'
      ? new Response('Sitemap: https://unapproved.example/sitemap.xml\nSitemap: https://www.cpf.gov.sg/cpf-sitemap.xml', { status: 200 })
      : new Response('Unavailable', { status: 404 });
    if (url === 'https://www.cpf.gov.sg/cpf-sitemap.xml') return response(`<urlset><url><loc>${pageUrl}</loc></url><url><loc>https://unapproved.example/ordinary-wages</loc></url></urlset>`);
    if (url.startsWith('https://html.duckduckgo.com/html/?')) {
      assert.match(new URL(url).searchParams.get('q'), /^site:cpf\.gov\.sg /);
      return response(`<html><body><p>SEARCH_METADATA_ONLY</p><a href="${pageUrl}">Ordinary wages</a><a href="https://unapproved.example/ordinary-wages">Ordinary wages</a></body></html>`);
    }
    if (url === pageUrl) return response(body);
    if (url === dueUrl) return response(article('Enforcement and penalties for non-compliance', 'The CPF Board takes a serious view on employers who fail to pay CPF contributions correctly and promptly. The due date for CPF contributions is on the last day of the calendar month. The CPF Board charges late payment interest on contributions in arrears.'));
    if (url === memberUrl) return response(mode === 'member-unrelated' ? article('Top up to enjoy higher retirement payouts', 'CPF retirement savings help members plan for their future. This page describes general benefits and account options for retirement planning, with no details about the requested payment action.') : memberArticle);
    throw new Error(`Unexpected fetch: ${url}`);
  };
  const webRetriever = new ControlledWebRetriever(undefined, new SourceCache());
  const result = await resolveMappedOfficialSourceFallback([topic], query, defaultSourceRetriever, {
    webRetriever, referenceDate: '2026-10-09', fetchOptions: { customFetch: fetch, timeoutMs: 500, useCache: false }
  });
  return { ...result, calls };
}

const sitemap = await run('cpf-ordinary-wages', 'How are ordinary wages treated for CPF?');
assert.equal(sitemap.records.length, 1, JSON.stringify(sitemap.trace));
assert.equal(sitemap.records[0].officialSourceUrl, pageUrl);
assert.equal(sitemap.records[0].authority, 'CPF');
assert.equal(sitemap.records[0].sourceAuthority, 'CPF');
assert.equal(sitemap.records[0].sourcePublisher, 'Central Provident Fund Board (CPF Board)');
assert.equal(sitemap.records[0].lifecycleState, 'CANDIDATE');
assert.equal(sitemap.records[0].recordRole, 'DISCOVERED_EVIDENCE');
assert.ok(sitemap.calls.includes(pageUrl), 'The actual page must be fetched separately from the sitemap.');
assert.ok(sitemap.records[0].sourceText.includes('Ordinary wages'));
assert.ok(!sitemap.records[0].sourceText.includes('SITEMAP_METADATA_ONLY'));
assert.ok(!sitemap.calls.some(url => url.includes('unapproved.example') || url.startsWith('http:')));
assert.ok(!sitemap.calls.includes('https://www.cpf.gov.sg/member/sitemap'), 'Employer scope fetches only its selected index.');
assert.ok(!sitemap.calls.some(url => url.includes('duckduckgo')), 'Adequate sitemap evidence stops before search.');

const dueDates = await run('cpf-contribution-due-dates', 'What is the CPF payment deadline?');
assert.equal(dueDates.records.length, 1, JSON.stringify(dueDates.trace));
assert.equal(dueDates.records[0].officialSourceUrl, dueUrl);
assert.ok(dueDates.records[0].sourceText.includes('due date for CPF contributions'));

const member = await run('cpf-cash-top-up-tax-relief', 'How can I make a CPF cash top-up?');
assert.equal(member.records.length, 1, JSON.stringify(member.trace));
assert.equal(member.records[0].officialSourceUrl, memberUrl);
assert.ok(member.calls.includes('https://www.cpf.gov.sg/member/sitemap'));
assert.ok(!member.calls.includes('https://www.cpf.gov.sg/employer/sitemap'), 'Member scope selects one relevant index.');
const unrelatedMember = await run('cpf-cash-top-up-tax-relief', 'How can I make a CPF cash top-up?', 'member-unrelated');
assert.equal(unrelatedMember.records.length, 0, 'Generic CPF retirement body cannot establish a cash top-up topic despite a matching title.');

// Robots XML slugs may differ from article headings; the page still uses focused body validation.
const robots = await run('cpf-ordinary-wages', 'How are ordinary wages treated for CPF?', 'robots');
assert.equal(robots.records.length, 1, JSON.stringify(robots.trace));
assert.ok(robots.calls.includes('https://www.cpf.gov.sg/robots.txt'));
assert.ok(robots.calls.includes('https://www.cpf.gov.sg/cpf-sitemap.xml'));
assert.ok(!robots.calls.some(url => url.includes('unapproved.example')));

const search = await run('cpf-ordinary-wages', 'How are ordinary wages treated for CPF?', 'search');
assert.equal(search.records.length, 1, JSON.stringify(search.trace));
assert.ok(search.trace.attempts.some(attempt => attempt.discoveryStage === 'OFFICIAL_DOMAIN_SEARCH' && attempt.finalUrl === pageUrl));
assert.ok(!search.records[0].sourceText.includes('SEARCH_METADATA_ONLY'));

const unrelated = await run('cpf-ordinary-wages', 'How are ordinary wages treated for CPF?', 'sitemap', '<html><head><title>CPF Board | Ordinary wages</title></head><body><main><h1>Healthcare options</h1><p>CPF retirement savings help members plan for their future. This article describes healthcare options and different retirement accounts available to members. It contains no guidance about the requested payroll payment classification.</p></main></body></html>');
assert.equal(unrelated.records.length, 0, 'Relevant sitemap labels cannot substitute for relevant fetched body text.');

for (const query of ['How were ordinary wages treated for CPF in 2024?', 'How were ordinary wages treated for CPF last year?', 'What were the historical CPF rules on ordinary wages?']) {
  const historical = await run('cpf-ordinary-wages', query);
  assert.equal(historical.records.length, 0);
  assert.equal(historical.calls.length, 0, 'An unvetted current page cannot establish historical CPF evidence.');
  assert.ok(historical.trace.attempts.some(attempt => attempt.fetchStatus === 'HISTORICAL_SCOPE_UNVERIFIED'));
}

// A single cached adapter keeps employer/member index caches separate.
const indexes = [];
const cachedAdapter = new OfficialSitemapDiscoveryAdapter({ async fetchOfficialSource(url) {
  indexes.push(url);
  return { status: 'SUCCESS', finalUrl: url, content: `<urlset><url><loc>${url.includes('/member/') ? memberUrl : pageUrl}</loc></url></urlset>` };
} });
const request = { ...provider, query: 'ordinary wages', topicId: 'cpf-ordinary-wages', topicTitle: 'Ordinary wages', standardOrAct: 'CPF', topicHints: ['ordinary wages', 'What constitutes wages for CPF contributions'] };
assert.deepEqual(await cachedAdapter.discoverOfficialSourceCandidates(request), [pageUrl]);
assert.deepEqual(await cachedAdapter.discoverOfficialSourceCandidates({ ...request, query: 'cash top-ups', topicId: 'cpf-cash-top-up-tax-relief', topicTitle: 'Cash top-ups', topicHints: ['cash top-ups', 'Top up to enjoy higher retirement payouts'] }), [memberUrl]);
assert.equal(indexes.length, 2);
const ratesIndexes = [];
const ratesAdapter = new OfficialSitemapDiscoveryAdapter({ async fetchOfficialSource(url) {
  ratesIndexes.push(url);
  return { status: 'SUCCESS', finalUrl: url, content: `<urlset><url><loc>https://www.cpf.gov.sg/employer/employer-obligations/cpf-contribution-rates</loc></url></urlset>` };
} });
await ratesAdapter.discoverOfficialSourceCandidates({ ...request, query: 'CPF contribution rates for a retirement age employee', topicId: 'cpf_contribution_rates', topicDomainId: 'CPF_CONTRIBUTIONS', topicTitle: 'CPF Contribution Rates', topicHints: ['CPF contribution rates'] });
assert.deepEqual(ratesIndexes, ['https://www.cpf.gov.sg/employer/sitemap'], 'An employee payroll topic retains employer discovery despite incidental retirement wording.');
console.log('CPF sitemap discovery regression tests passed.');
