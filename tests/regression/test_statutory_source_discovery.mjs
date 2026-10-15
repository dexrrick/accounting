import assert from 'node:assert/strict';
import { ControlledWebRetriever } from '../../src/retrieval/controlledWebRetriever.ts';
import { SourceCache } from '../../src/retrieval/sourceCache.ts';
import {
  OFFICIAL_SOURCE_DISCOVERY_PROVIDERS,
  OfficialSitemapDiscoveryAdapter
} from '../../src/retrieval/officialSitemapDiscovery.ts';
import { defaultSourceRetriever } from '../../src/retrieval/sourceRetriever.ts';
import { resolveMappedOfficialSourceFallback } from '../../src/services/groundingContextBuilder.ts';
import { buildAuthorityWorkstreams } from '../../src/services/authorityWorkstreams.ts';
import { defaultExternalSourceValidator } from '../../src/retrieval/externalSourceValidator.ts';

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
assert.equal(defaultExternalSourceValidator.validateCanonicalUrl('https://www.mas.gov.sg/regulation/guidelines', 'MAS').isValid, true);
assert.equal(defaultExternalSourceValidator.validateCanonicalUrl('https://www.mom.gov.sg/employment-practices', 'MAS').isValid, false);
assert.equal(defaultExternalSourceValidator.validateCanonicalUrl('https://sso.agc.gov.sg/Act/SFA2001', 'MAS').isValid, true);
assert.equal(defaultExternalSourceValidator.validateContentType('text/xml; charset=utf-8'), true);

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
  const run = (query = sample.query) => resolveMappedOfficialSourceFallback(
    [sample.topicId], query, defaultSourceRetriever,
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
  assert.equal(record.sourceText.includes(sample.title), false, 'Page headings do not flow into the selected rule excerpt.');
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

  const pageFetchCountBeforeHistorical = calls.filter(url => url === sample.url).length;
  const undatedHistoricalQueries = sample.authority === 'MOM'
    ? [
      'What were the older MOM Part IV overtime eligibility requirements?',
      'What were the old overtime pay rates under MOM?'
    ]
    : [
      'What were the superseded MAS capital markets services licence requirements?',
      'What were the previous licensing rules for MAS capital markets services licence holders?'
    ];
  for (const historicalQuery of undatedHistoricalQueries) {
    const undatedHistorical = await run(historicalQuery);
    assert.equal(undatedHistorical.records.length, 0, `${sample.authority} historical rules without a period remain unverified.`);
    assert.ok(undatedHistorical.trace.attempts.some(attempt => attempt.fetchStatus === 'HISTORICAL_SCOPE_UNVERIFIED'));
  }
  assert.equal(calls.filter(url => url === sample.url).length, pageFetchCountBeforeHistorical,
    'An undated historical request must not fetch a current official page.');

  if (sample.authority === 'MOM') {
    pageContent = html(sample.title, sample.paragraph);
    for (const currentFactQuery of [
      'My previous employer employed Part IV workers. What are the current overtime eligibility requirements?',
      'Our former employee worked on Part IV matters. What are the current overtime eligibility requirements?'
    ]) {
      const currentFactResult = await run(currentFactQuery);
      assert.equal(currentFactResult.records.length, 1,
        'A former-employer or former-employee fact does not turn a request for current MOM guidance into a historical-rule request.');
    }
  }
}

// Historical requests for other configured MOM/MAS topics are checked
// against their registered topic vocabulary, not a hard-coded topic list.
for (const historicalTopic of [
  { authority: 'MOM', topicId: 'mom_annual_leave', query: 'Explain previous MOM annual leave entitlements' },
  { authority: 'MAS', topicId: 'mas-aml-cft', query: 'Explain old MAS anti-money laundering requirements' }
]) {
  const provider = OFFICIAL_SOURCE_DISCOVERY_PROVIDERS[historicalTopic.authority];
  const currentPageCalls = [];
  const historicalOnlyRetriever = new ControlledWebRetriever(undefined, new SourceCache());
  const historicalResult = await resolveMappedOfficialSourceFallback(
    [historicalTopic.topicId], historicalTopic.query, defaultSourceRetriever,
    {
      webRetriever: historicalOnlyRetriever,
      referenceDate: '2026-10-14',
      fetchOptions: {
        customFetch: async url => {
          if (url.startsWith(`https://www.${historicalTopic.authority.toLowerCase()}.gov.sg/`)) currentPageCalls.push(url);
          throw new Error(`Unexpected fetch for an undated historical request: ${url}`);
        },
        useCache: false,
        timeoutMs: 500
      }
    }
  );
  assert.equal(historicalResult.records.length, 0, `${historicalTopic.topicId} cannot use a current page for an undated historical request.`);
  assert.ok(historicalResult.trace.attempts.some(attempt => attempt.fetchStatus === 'HISTORICAL_SCOPE_UNVERIFIED'),
    `${historicalTopic.topicId} must report the unverified historical scope.`);
  assert.equal(currentPageCalls.length, 0, `${provider.authority} current pages must not be fetched for the historical request.`);
}

// MOM/MAS topic terms in headings, navigation, link-only labels and cards are not rule evidence.
for (const sample of cases) {
  const topicPhrase = sample.authority === 'MOM' ? 'Part IV overtime eligibility' : 'Capital Markets Services Licence';
  const expectation = {
    standardIdentifiers: sample.authority === 'MOM' ? ['Ministry of Manpower', 'MOM'] : ['Monetary Authority of Singapore', 'MAS'],
    expectedTitles: [sample.title],
    topicTerms: [topicPhrase],
    requireSubstantiveBody: true
  };
  const metadataOnlyHtml = `<html><head><title>${sample.title}</title></head><body><main>
    <h1>${topicPhrase}</h1>
    <nav><a href="/topic">${topicPhrase}</a></nav>
    <div class="related-card"><h2>${topicPhrase}</h2><p><a href="/topic">${topicPhrase} details</a></p><span>Topic summary</span></div>
    <p><a href="/topic">Find out more about ${topicPhrase} and all applicable statutory requirements</a>.</p>
    <a href="/topic"><div><p>${topicPhrase} requirements apply to these entities under the statute and include specific eligibility conditions.</p></div></a>
    <ul><li><a href="/topic">${topicPhrase} guidance</a></li></ul>
    <p>This official page contains general information about Singapore government services and online resources for the public.</p>
  </main></body></html>`;
  const metadataOnly = defaultExternalSourceValidator.validateTopicContent(metadataOnlyHtml, expectation);
  assert.equal(metadataOnly.isValid, false, `${sample.authority} page metadata alone cannot substantiate the topic.`);
  assert.equal(metadataOnly.substantiveText?.includes(topicPhrase), false,
    'Headings, navigation, link-only labels and card metadata are removed from the substantive body.');

  const unclosedCardHtml = `<html><head><title>${sample.title}</title></head><body><main>
    <div class="topic-card"><p>${topicPhrase} requirements are described here with a full sentence and enough additional words to look like a rule.
  </main></body></html>`;
  const unclosedCard = defaultExternalSourceValidator.validateTopicContent(unclosedCardHtml, expectation);
  assert.equal(unclosedCard.isValid, false, 'An unclosed card cannot leak nested topic text into rule evidence.');
  assert.equal(unclosedCard.substantiveText?.includes(topicPhrase), false);

  const bodyRulesHtml = `<html><head><title>${sample.title}</title></head><body><main>
    <h1>${sample.title}</h1>
    <p>${sample.paragraph} The <a href="/legislation">relevant legislation</a> sets the statutory framework for this topic.</p>
    <ul><li>${topicPhrase} rules identify the businesses and employees covered by the statutory framework in Singapore.</li></ul>
    <table><thead><tr><th>Criterion</th><th>Requirement</th></tr></thead><tbody>
      <tr><td>Coverage</td><td>${topicPhrase} requirements apply to regulated activity and remain subject to the applicable statutory conditions.</td></tr>
      <tr><td>Secondary criterion</td><td>The relevant authority evaluates each applicant against separate statutory conditions.</td></tr>
    </tbody></table>
  </main></body></html>`;
  const bodyRules = defaultExternalSourceValidator.validateTopicContent(bodyRulesHtml, expectation);
  assert.equal(bodyRules.isValid, true, JSON.stringify(bodyRules));
  assert.ok(bodyRules.substantiveText?.includes('relevant legislation'), 'Inline legal-link text inside prose is preserved.');
  assert.ok(bodyRules.substantiveText?.includes('businesses and employees covered'), 'Substantive list items are preserved.');
  assert.ok(bodyRules.substantiveText?.includes('Coverage'), 'Substantive table cells are preserved.');
  assert.match(bodyRules.substantiveText || '', /Coverage \| [^\n]+\n\nSecondary criterion \|/,
    'Table rows keep their boundaries and preserve their label/value association.');

  const dataAttributeBody = defaultExternalSourceValidator.validateTopicContent(
    `<html><head><title>${sample.title}</title></head><body><main><div data-class="card" data-id="card"><p>${sample.paragraph} ${topicPhrase} requirements apply to the entities covered by this statutory framework and related eligibility conditions.</p></div></main></body></html>`,
    expectation
  );
  assert.equal(dataAttributeBody.isValid, true,
    'Data attributes named data-class/data-id do not make a substantive paragraph look like card metadata.');
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

// Verify that MOM and MAS follow the same workstream boundary used by IRAS:
// exact authority/topic provenance, full source page, and verified quotations.
for (const sample of cases) {
  const provider = OFFICIAL_SOURCE_DISCOVERY_PROVIDERS[sample.authority];
  let fetchedHtml = html(sample.title, sample.paragraph);
  const customFetch = async url => {
    if (url === provider.sitemapUrls[0]) return response(`<urlset><url><loc>${sample.url}</loc></url></urlset>`);
    if (url === sample.url) return response(fetchedHtml);
    if (url.endsWith('/robots.txt')) return new Response('not found', { status: 404 });
    if (url.startsWith('https://html.duckduckgo.com/html/') || url.startsWith('https://r.jina.ai/'))
      return new Response('not found', { status: 404 });
    throw Error(`Unexpected workstream fetch ${url}`);
  };
  const issue = {
    id: `official-${sample.authority.toLowerCase()}-issue`,
    subject: sample.authority === 'MOM' ? 'Part IV overtime eligibility' : 'Capital Markets Services Licence',
    population: 'COMPANY',
    domain: sample.authority === 'MOM' ? 'MOM_EMPLOYMENT' : 'MAS_FUND_MANAGEMENT',
    governingAuthorities: [sample.authority], contextualAuthorities: [],
    operation: 'EXPLAIN_RULE', mappedTopicIds: [sample.topicId],
    evidenceRequirement: 'AUTHORITATIVE_SOURCE', confidence: 0.98, status: 'MAPPED'
  };
  const offlineRetriever = {
    retrieveSources: async () => [],
    getSourceById: () => undefined
  };
  const result = await buildAuthorityWorkstreams(sample.query, {
    source: 'SEMANTIC_ISSUES', coverageEstablished: true, hasUnmappedResidual: false, issues: [issue]
  }, {
    retriever: offlineRetriever, referenceDate: '2026-10-14',
    groundingOptions: {
      webRetriever: new ControlledWebRetriever(undefined, new SourceCache()),
      fetchOptions: { customFetch, timeoutMs: 500, useCache: false }
    }
  });
  const stream = result.workstreams.find(item => item.authority === sample.authority);
  assert.ok(stream, `Expected ${sample.authority} workstream`);
  assert.ok(stream.issues[0].sources.every(source => source.authority === sample.authority));
  assert.ok(stream.issues[0].sources.every(source => source.sourceAuthority === sample.authority));
  assert.ok(stream.issues[0].retrievalTrace.stages.some(stage => stage.stage === 'SITEMAP_DISCOVERY' && stage.status === 'SUFFICIENT'));
  assert.equal(stream.issues[0].evidenceStatus, 'VERIFIED', JSON.stringify(stream.issues[0]));
  assert.ok(stream.verifiedClaims.length > 0, 'Verified claim must be backed by the retrieved official page.');

  fetchedHtml = `<html><head><title>${sample.title}</title></head><body><main>
    <h1>${sample.title}</h1>
    <nav><a href="/topic">${sample.title}</a></nav>
    <div class="topic-card"><p><a href="/topic">${sample.title} official guidance</a></p></div>
    <p>This page describes general public services and online information available from this Singapore authority.</p>
  </main></body></html>`;
  const metadataOnlyRuntime = await buildAuthorityWorkstreams(sample.query, {
    source: 'SEMANTIC_ISSUES', coverageEstablished: true, hasUnmappedResidual: false, issues: [issue]
  }, {
    retriever: offlineRetriever, referenceDate: '2026-10-14',
    groundingOptions: {
      webRetriever: new ControlledWebRetriever(undefined, new SourceCache()),
      fetchOptions: { customFetch, timeoutMs: 500, useCache: false }
    }
  });
  const metadataOnlyStream = metadataOnlyRuntime.workstreams.find(item => item.authority === sample.authority);
  assert.ok(metadataOnlyStream, `Expected ${sample.authority} workstream for the metadata-only page.`);
  assert.notEqual(metadataOnlyStream.issues[0].evidenceStatus, 'VERIFIED',
    `${sample.authority} heading/card metadata cannot verify an issue.`);
  assert.equal(metadataOnlyStream.verifiedClaims.length, 0,
    'A heading-only claim is never emitted as verified.');
  assert.ok(metadataOnlyStream.issues[0].retrievalTrace.stages.some(stage => stage.status !== 'SUFFICIENT'),
    'Metadata-only content does not pass the retrieval sufficiency boundary.');
}

console.log('MOM/MAS official sitemap candidates, source provenance and negative evidence guards: passed.');
