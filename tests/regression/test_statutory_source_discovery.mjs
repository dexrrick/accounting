import assert from 'node:assert/strict';
import { ControlledWebRetriever } from '../../src/retrieval/controlledWebRetriever.ts';
import { SourceCache } from '../../src/retrieval/sourceCache.ts';
import {
  OFFICIAL_SOURCE_DISCOVERY_PROVIDERS,
  OfficialSitemapDiscoveryAdapter
} from '../../src/retrieval/officialSitemapDiscovery.ts';
import { defaultSourceRetriever } from '../../src/retrieval/sourceRetriever.ts';
import { resolveMappedOfficialSourceFallback } from '../../src/services/groundingContextBuilder.ts';

const cases = [
  {
    authority: 'MOM',
    topicId: 'mom-part-iv-overtime',
    query: 'What are Part IV overtime eligibility requirements?',
    url: 'https://www.mom.gov.sg/employment-practices/hours-of-work-overtime-and-rest-days',
    title: 'Part IV Working Hours and Overtime Eligibility | Ministry of Manpower',
    paragraph: 'Employees covered by Part IV of the Employment Act are subject to working hours and overtime eligibility rules. Overtime pay is calculated from the hourly basic rate, subject to applicable overtime eligibility requirements.',
    sourcePublisher: 'Ministry of Manpower (MOM)'
  },
  {
    authority: 'MAS',
    topicId: 'mas-cms-licence',
    query: 'What is a Capital Markets Services Licence?',
    url: 'https://www.mas.gov.sg/regulation/capital-markets-services/capital-markets-services-licence',
    title: 'Capital Markets Services Licence | Monetary Authority of Singapore',
    paragraph: 'A Capital Markets Services Licence is generally required by a business that carries on a regulated activity under the Securities and Futures Act in Singapore. Capital markets services licence holders must comply with the applicable licensing requirements.',
    sourcePublisher: 'Monetary Authority of Singapore (MAS)'
  }
];
const html = (title, body) => `<html><head><title>${title}</title></head><body><main><h1>${title}</h1><p>${body}</p></main></body></html>`;
const response = body => new Response(body, { status: 200, headers: { 'content-type': 'text/html' } });

for (const sample of cases) {
  const provider = OFFICIAL_SOURCE_DISCOVERY_PROVIDERS[sample.authority];
  assert.equal(provider.authority, sample.authority);
  assert.ok(provider.approvedHosts.every(host => host.endsWith(sample.authority.toLowerCase() + '.gov.sg')));
  assert.equal(provider.sitemapUrls.length, 1);
  const calls = [];
  let pageContent = html(sample.title, sample.paragraph);
  const customFetch = async url => {
    calls.push(url);
    if (url === provider.sitemapUrls[0]) {
      // Discovery metadata is untrusted: an attacker-controlled result must not be fetched.
      return response(`<urlset><url><loc>${sample.url}</loc></url>
        <url><loc>https://unapproved.example/off-topic</loc></url>
        <url><loc>http://${provider.searchSite}/insecure</loc></url></urlset>`);
    }
    if (url === sample.url) return response(pageContent);
    if (url.endsWith('/robots.txt')) return new Response('not found', { status: 404 });
    if (url.startsWith('https://html.duckduckgo.com/html/')) return response('<html><body></body></html>');
    if (url.startsWith('https://r.jina.ai/')) return new Response('not found', { status: 404 });
    throw Error(`Unexpected fetch ${url}`);
  };
  const webRetriever = new ControlledWebRetriever(undefined, new SourceCache());
  const run = () => resolveMappedOfficialSourceFallback(
    [sample.topicId], sample.query, defaultSourceRetriever,
    { webRetriever, referenceDate: '2026-10-14', fetchOptions: { customFetch, useCache: false, timeoutMs: 500 } }
  );
  const success = await run();
  assert.equal(success.records.length, 1, JSON.stringify(success.trace));
  const record = success.records[0];
  assert.equal(record.authority, sample.authority);
  assert.equal(record.sourceAuthority, sample.authority);
  assert.equal(record.sourcePublisher, sample.sourcePublisher);
  assert.equal(record.officialSourceUrl, sample.url);
  assert.equal(record.provenance, 'LIVE_EXTERNAL');
  assert.equal(record.lifecycleState, 'CANDIDATE');
  assert.equal(record.sourceStatus, 'NEEDS_REVIEW');
  assert.equal(record.verificationMethod, 'LIVE_OFFICIAL_TOPIC_VERIFIED');
  assert.ok(record.documentHash?.match(/^[a-f0-9]{64}$/));
  assert.ok(record.sourceText.includes(sample.paragraph.slice(0, 30)));
  assert.ok(calls.includes(provider.sitemapUrls[0]));
  assert.ok(calls.includes(sample.url), 'Sitemap metadata must be followed by an independently fetched page.');
  assert.ok(!calls.some(url => url.includes('unapproved.example') || url.startsWith('http:')));
  assert.ok(success.trace.attempts.some(attempt => attempt.discoveryStage === 'SITEMAP_DISCOVERY' &&
    attempt.finalUrl === sample.url && attempt.contentMatched && attempt.titleMatched));

  // A site-map entry is a URL hint, not evidence. A matching title alone is insufficient.
  pageContent = html(sample.title, 'Generic navigation for Singapore government agencies and online services. This introduction contains no rule about the requested statutory requirements.');
  const unrelated = await run();
  assert.equal(unrelated.records.length, 0, 'An off-topic page must never be promoted based on sitemap metadata and title.');

  // Current pages cannot establish historical rates, duties or eligibility without vetted dates.
  const historic = await resolveMappedOfficialSourceFallback(
    [sample.topicId], sample.query + ' in 2023?', defaultSourceRetriever,
    { webRetriever, referenceDate: '2026-10-14', fetchOptions: { customFetch, useCache: false, timeoutMs: 500 } }
  );
  assert.equal(historic.records.length, 0);
  assert.ok(historic.trace.attempts.some(attempt => attempt.fetchStatus === 'HISTORICAL_SCOPE_UNVERIFIED'));
}

// Shared generic XML parser must still preserve authority boundaries.
const provider = OFFICIAL_SOURCE_DISCOVERY_PROVIDERS.MOM;
const adapter = new OfficialSitemapDiscoveryAdapter({
  async fetchOfficialSource(url) {
    return { status: 'SUCCESS', finalUrl: url, content:
      '<urlset><url><loc>https://www.mom.gov.sg/employment-practices/hours-of-work-overtime-and-rest-days</loc></url>' +
      '<url><loc>https://www.mas.gov.sg/regulation/capital-markets-services/capital-markets-services-licence</loc></url></urlset>' };
  }
});
const result = await adapter.discoverOfficialSourceCandidates({
  ...provider, query: 'Part IV overtime eligibility',
  topicId: 'mom-part-iv-overtime',
  topicTitle: 'Part IV Working Hours and Overtime Eligibility',
  standardOrAct: 'Employment Act', topicHints: ['part iv', 'overtime eligibility']
});
assert.deepEqual(result, [cases[0].url], 'An unrelated but approved Singapore government host is not an authorised authority source.');
console.log('MOM/MAS official sitemap candidates, source provenance and negative evidence guards: passed.');
