import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
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

const acraAnnualPage = JSON.parse(await readFile(new URL('../fixtures/acra-company-guidance-2026-10-10.json', import.meta.url), 'utf8'))
  .find(page => page.name === 'annual');
const cases = [
  {
    authority: 'ACRA',
    topicId: 'acra_annual-returns',
    query: 'What annual return filing requirements apply to Singapore companies?',
    subject: 'annual returns',
    domain: 'ACRA_CORPORATE',
    population: 'COMPANY',
    url: acraAnnualPage.url,
    title: 'Deadline & requirements for annual returns | Accounting and Corporate Regulatory Authority',
    paragraph: 'All companies in Singapore must file annual returns with ACRA on time to avoid penalties of up to $600.',
    pageHtml: acraAnnualPage.html,
    sourcePublisher: 'ACRA'
  },
  {
    authority: 'CPF',
    topicId: 'cpf-ordinary-wages',
    query: 'How are ordinary wages treated for CPF?',
    subject: 'ordinary wages',
    domain: 'CPF_PAYROLL',
    population: 'EMPLOYER',
    url: 'https://www.cpf.gov.sg/employer/employer-obligations/what-constitutes-wages-for-cpf-contributions',
    title: 'CPF Board | What constitutes wages for CPF contributions',
    paragraph: 'Ordinary wages are wages due or granted wholly and exclusively in respect of employment in that month. CPF contributions are payable on ordinary wages, subject to the applicable wage ceiling.',
    pageHtml: '<html><head><title>CPF Board | What constitutes wages for CPF contributions</title></head><body><main><h1>What constitutes wages for CPF contributions</h1><p>Ordinary wages are wages due or granted wholly and exclusively in respect of employment in that month. CPF contributions are payable on ordinary wages, subject to the applicable wage ceiling. The employer must determine the payment period and applicable contribution rates.</p></main></body></html>',
    sourcePublisher: 'Central Provident Fund Board (CPF Board)'
  },
  {
    authority: 'MOM',
    topicId: 'mom-part-iv-overtime',
    query: 'What are Part IV overtime eligibility requirements?',
    subject: 'Part IV overtime eligibility',
    domain: 'MOM_EMPLOYMENT',
    population: 'EMPLOYEE',
    url: 'https://www.mom.gov.sg/employment-practices/hours-of-work-overtime-and-rest-days',
    title: 'Part IV Working Hours and Overtime Eligibility | Ministry of Manpower',
    paragraph: 'Employees covered by Part IV of the Employment Act are subject to working hours and overtime eligibility rules. Overtime pay is calculated from the hourly basic rate, subject to applicable overtime eligibility requirements.',
    sourcePublisher: 'Ministry of Manpower (MOM)'
  },
  {
    authority: 'MAS',
    topicId: 'mas-cms-licence',
    query: 'What is a Capital Markets Services Licence?',
    subject: 'Capital Markets Services Licence',
    domain: 'MAS_FUNDS',
    population: 'COMPANY',
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
const discoveryResults = new Map();

for (const sample of cases) {
  const provider = OFFICIAL_SOURCE_DISCOVERY_PROVIDERS[sample.authority];
  assert.equal(provider.authority, sample.authority);
  assert.ok(provider.approvedHosts.every(host => host.endsWith(sample.authority.toLowerCase() + '.gov.sg')));
  assert.ok(provider.sitemapUrls.length > 0);
  const calls = [];
  let pageContent = sample.pageHtml || html(sample.title, sample.paragraph);
  const customFetch = async url => {
    calls.push(url);
    if (provider.sitemapUrls.includes(url)) {
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
  discoveryResults.set(sample.authority, success);
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
  assert.ok(record.sourceText.includes(sample.paragraph), 'The selected excerpt contains substantive fetched page text.');
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
  const undatedHistoricalQueries = [
    `${sample.query} in 2023?`,
    ...(sample.authority === 'MOM'
      ? ['What were the older MOM Part IV overtime eligibility requirements?', 'What were the old overtime pay rates under MOM?']
      : sample.authority === 'MAS'
        ? ['What were the superseded MAS capital markets services licence requirements?', 'What were the previous licensing rules for MAS capital markets services licence holders?']
        : [])
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

// Official topic terms in headings, navigation, link-only labels and cards are not rule evidence.
for (const sample of cases) {
  const topicPhrase = sample.subject;
  const expectation = {
    standardIdentifiers: {
      ACRA: ['Accounting and Corporate Regulatory Authority'],
      CPF: ['Central Provident Fund Board', 'CPF Board'],
      MOM: ['Ministry of Manpower', 'MOM'],
      MAS: ['Monetary Authority of Singapore', 'MAS']
    }[sample.authority],
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
assert.deepEqual(result, [cases.find(sample => sample.authority === 'MOM').url],
  'An unrelated but approved Singapore government host is not an authorised authority source.');

const offlineRetriever = {
  retrieveSources: async () => [],
  getSourceById: () => undefined
};
const makeIssue = sample => ({
  id: `official-${sample.authority.toLowerCase()}-issue`,
  subject: sample.subject,
  population: sample.population,
  domain: sample.domain,
  governingAuthorities: [sample.authority], contextualAuthorities: [],
  operation: 'EXPLAIN_RULE', mappedTopicIds: [sample.topicId],
  evidenceRequirement: 'AUTHORITATIVE_SOURCE', confidence: 0.98, status: 'MAPPED'
});
const makeIssuePlan = issues => ({
  source: 'SEMANTIC_ISSUES', coverageEstablished: true, hasUnmappedResidual: false, issues
});
const pageFor = sample => sample.pageHtml || html(sample.title, sample.paragraph);
const runWorkstreams = async (samples, {
  query = samples.map(sample => sample.query).join(' '),
  pageOverrides = {},
  localOnly = false,
  providers
} = {}) => {
  const calls = [];
  const customFetch = async url => {
    calls.push(url);
    const sitemapOwner = cases.find(sample => OFFICIAL_SOURCE_DISCOVERY_PROVIDERS[sample.authority].sitemapUrls.includes(url));
    if (sitemapOwner) return response(`<urlset><url><loc>${sitemapOwner.url}</loc></url></urlset>`);
    const pageOwner = cases.find(sample => sample.url === url);
    if (pageOwner) return response(pageOverrides[pageOwner.authority] || pageFor(pageOwner));
    if (url.endsWith('/robots.txt')) return new Response('not found', { status: 404 });
    if (url.startsWith('https://html.duckduckgo.com/html/') || url.startsWith('https://r.jina.ai/'))
      return new Response('not found', { status: 404 });
    throw Error(`Unexpected workstream fetch ${url}`);
  };
  const result = await buildAuthorityWorkstreams(query, makeIssuePlan(samples.map(makeIssue)), {
    retriever: offlineRetriever,
    referenceDate: '2026-10-14',
    localOnly,
    providers,
    groundingOptions: {
      localOnly,
      webRetriever: new ControlledWebRetriever(undefined, new SourceCache()),
      fetchOptions: { customFetch, timeoutMs: 500, useCache: false }
    }
  });
  return { ...result, calls };
};

const successfulRuns = new Map();
const metadataOnlyAdmissionFailures = [];
for (const sample of cases) {
  // All four agencies use the same fetched-page, exact-quote and issue-scoped
  // admission path. Discovery metadata alone never becomes evidence.
  const success = await runWorkstreams([sample], { query: sample.query });
  successfulRuns.set(sample.authority, success);
  const stream = success.workstreams.find(item => item.authority === sample.authority);
  assert.ok(stream, `Expected ${sample.authority} workstream`);
  const issueEvidence = stream.issues[0];
  assert.equal(issueEvidence.evidenceStatus, 'VERIFIED', JSON.stringify(issueEvidence));
  assert.equal(issueEvidence.sources.length, 1);
  const record = issueEvidence.sources[0];
  assert.equal(record.authority, sample.authority);
  assert.equal(record.sourceAuthority, sample.authority);
  assert.equal(record.officialSourceUrl, sample.url);
  assert.equal(record.sourcePublisher, sample.sourcePublisher);
  assert.equal(record.provenance, 'LIVE_EXTERNAL');
  assert.equal(record.lifecycleState, 'CANDIDATE', 'Successful retrieval does not auto-approve or persist the candidate.');
  assert.equal(record.sourceStatus, 'NEEDS_REVIEW');
  assert.equal(record.verificationMethod, 'LIVE_OFFICIAL_TOPIC_VERIFIED');
  assert.ok(record.tags.includes(sample.topicId) || record.relatedTopicIds?.includes(sample.topicId) || record.sourceMapTopicIds?.includes(sample.topicId),
    'The candidate remains bound to the requested coverage topic.');
  assert.ok(success.calls.includes(sample.url), 'The official article is fetched separately from its sitemap entry.');
  assert.ok(issueEvidence.retrievalTrace.stages.some(stage => stage.stage === 'SITEMAP_DISCOVERY' && stage.status === 'SUFFICIENT'));
  assert.ok(issueEvidence.retrievalTrace.attempts.some(attempt => attempt.topicId === sample.topicId && attempt.fetchStatus === 'SUCCESS'));
  assert.ok(discoveryResults.get(sample.authority).trace.attempts.some(attempt => attempt.topicId === sample.topicId &&
    attempt.finalUrl === sample.url && attempt.contentMatched && attempt.titleMatched), 'The raw retrieval trace binds the topic to the fetched URL.');
  assert.ok(issueEvidence.verifiedClaims.length > 0);
  for (const claim of issueEvidence.verifiedClaims) {
    assert.ok(claim.recordId === record.id);
    assert.ok(record.sourceText.includes(claim.quote), 'Every verified quote is an exact substring of the fetched official page.');
  }

  const metadataOnlyHtml = `<html><head><title>${sample.title}</title></head><body><main>
    <h1>${sample.subject}</h1><nav><a href="/topic">${sample.subject}</a></nav>
    <div class="topic-card"><p><a href="/topic">${sample.subject} official guidance</a></p></div>
    <p>This page describes general public services and online information available from this Singapore authority.</p>
  </main></body></html>`;
  const metadataOnly = await runWorkstreams([sample], { query: sample.query, pageOverrides: { [sample.authority]: metadataOnlyHtml } });
  const metadataEvidence = metadataOnly.workstreams.find(item => item.authority === sample.authority).issues[0];
  if (metadataEvidence.evidenceStatus === 'VERIFIED') {
    metadataOnlyAdmissionFailures.push({ authority: sample.authority, sourceText: metadataEvidence.sources[0]?.sourceText,
      claims: metadataEvidence.verifiedClaims.map(claim => claim.quote) });
  } else {
    assert.equal(metadataEvidence.sources.length, 0);
    assert.equal(metadataEvidence.verifiedClaims.length, 0);
  }

  // An undated historic request cannot borrow a current page, and local-only
  // mode must not issue any network requests for any configured authority.
  const historical = await runWorkstreams([sample], { query: `${sample.query} in 2023?` });
  const historicalEvidence = historical.workstreams.find(item => item.authority === sample.authority).issues[0];
  assert.notEqual(historicalEvidence.evidenceStatus, 'VERIFIED');
  assert.equal(historicalEvidence.sources.length, 0);
  assert.ok(historicalEvidence.retrievalTrace.attempts?.some(attempt => attempt.fetchStatus === 'HISTORICAL_SCOPE_UNVERIFIED'));
  assert.equal(historical.calls.includes(sample.url), false, 'A current page is not fetched for an unverified historical request.');
  const localOnly = await runWorkstreams([sample], { query: sample.query, localOnly: true });
  assert.equal(localOnly.calls.length, 0, `${sample.authority} local-only mode must make zero requests.`);

  // Even with a real successful trace, authority, domain, and subject mismatches
  // fail admission. A live candidate without its exact fetch trace also fails.
  const candidateFromSuccess = successfulRuns.get(sample.authority).workstreams
    .find(item => item.authority === sample.authority).issues[0].sources[0];
  const successTrace = discoveryResults.get(sample.authority).trace;
  const runInjectedCandidate = candidate => runWorkstreams([sample], {
    query: sample.query,
    providers: { [sample.authority]: {
      authority: sample.authority,
      async retrieve() { return { candidates: [candidate], ...(successTrace ? { evidenceQualityTrace: successTrace } : {}) }; }
    } }
  });
  const missingTrace = await runWorkstreams([sample], {
    query: sample.query,
    providers: { [sample.authority]: { authority: sample.authority, async retrieve() { return { candidates: [candidateFromSuccess] }; } } }
  });
  assert.notEqual(missingTrace.workstreams.find(item => item.authority === sample.authority).issues[0].evidenceStatus, 'VERIFIED');
  assert.equal(missingTrace.workstreams.find(item => item.authority === sample.authority).issues[0].sources.length, 0);

  const other = cases.find(item => item.authority !== sample.authority);
  for (const candidate of [
    { ...candidateFromSuccess, authority: other.authority, sourceAuthority: other.authority },
    { ...candidateFromSuccess, domain: other.domain },
    { ...candidateFromSuccess, sourceText: 'This page provides general online information and public services.' }
  ]) {
    const rejected = await runInjectedCandidate(candidate);
    const rejectedIssue = rejected.workstreams.find(item => item.authority === sample.authority).issues[0];
    assert.notEqual(rejectedIssue.evidenceStatus, 'VERIFIED');
    assert.equal(rejectedIssue.sources.length, 0);
  }
}

// Mixed non-IRAS questions retain separate source ownership. A gap in one
// authority keeps the whole question insufficient without borrowing the other source.
const acraSample = cases.find(sample => sample.authority === 'ACRA');
const momSample = cases.find(sample => sample.authority === 'MOM');
const mixed = await runWorkstreams([acraSample, momSample], {
  query: 'What annual return filing requirements apply to Singapore companies, and what are Part IV overtime eligibility requirements?',
  pageOverrides: {
    MOM: `<html><head><title>${momSample.title}</title></head><body><main><h1>${momSample.subject}</h1><nav><a>${momSample.subject}</a></nav><p>General government services and public online information.</p></main></body></html>`
  }
});
const mixedAcra = mixed.workstreams.find(item => item.authority === 'ACRA');
const mixedMom = mixed.workstreams.find(item => item.authority === 'MOM');
assert.equal(mixedAcra.issues[0].evidenceStatus, 'VERIFIED');
assert.ok(mixedAcra.issues[0].sources.every(record => record.authority === 'ACRA' && record.sourceAuthority === 'ACRA'));
assert.notEqual(mixedMom.issues[0].evidenceStatus, 'VERIFIED');
assert.equal(mixedMom.issues[0].sources.length, 0);
assert.ok(mixed.gaps.some(gap => gap.issueId === mixedMom.issues[0].issueId && gap.authority === 'MOM'));
assert.equal(mixed.status, 'INSUFFICIENT', 'One uncovered authority issue keeps the whole question from being verified.');

assert.deepEqual(metadataOnlyAdmissionFailures, [],
  `Metadata-only fetched pages must be rejected at workstream admission: ${JSON.stringify(metadataOnlyAdmissionFailures)}`);
console.log('ACRA/CPF/MOM/MAS official discovery, workstream provenance, exact quotes and negative evidence guards: passed.');
