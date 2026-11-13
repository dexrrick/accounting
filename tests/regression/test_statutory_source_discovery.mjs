import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ControlledWebRetriever } from '../../src/retrieval/controlledWebRetriever.ts';
import { SourceCache } from '../../src/retrieval/sourceCache.ts';
import {
  OFFICIAL_SOURCE_DISCOVERY_PROVIDERS,
  OfficialSitemapDiscoveryAdapter
} from '../../src/retrieval/officialSitemapDiscovery.ts';
import { defaultSourceRetriever } from '../../src/retrieval/sourceRetriever.ts';
import { TargetDateResolver } from '../../src/retrieval/targetDateResolver.ts';
import { provisionalAuthorityIssueTopic, resolveMappedOfficialSourceFallback } from '../../src/services/groundingContextBuilder.ts';
import { buildAuthorityWorkstreams } from '../../src/services/authorityWorkstreams.ts';
import { classifyQuestion } from '../../src/classification/questionClassifier.ts';
import {
  getRequestedQuestionConcepts,
  reconcileQuestionUnderstanding,
  validateSemanticQuestionInterpretation
} from '../../src/services/semanticQuestionUnderstanding.ts';
import { shouldUseAuthorityEvidenceRuntime } from '../../src/utils/authorityEvidenceRouting.ts';
import {
  createAuthorityEvidencePresentation,
  groupExactIssueClaimsByDocument
} from '../../src/utils/authorityEvidencePresentation.ts';
import { renderAuthorityEvidenceResponseText } from '../../src/services/authorityEvidenceResponse.ts';
import { defaultExternalSourceValidator, extractCompleteHtmlBodyContext } from '../../src/retrieval/externalSourceValidator.ts';
import { STATUTORY_COVERAGE_OFFICIAL_PAGE_FIXTURES } from '../fixtures/statutoryCoverageOfficialPages.mjs';
import {
  getMomSalaryPaymentRuleEvidence,
  supportMomSalaryPaymentConcept,
  supportMomSalaryPaymentIssue
} from '../../src/retrieval/momSalaryPaymentRule.ts';
import { practicalExpansionDiscoveryPointers } from '../../src/retrieval/practicalStatutoryExpansion.ts';
import { getCoverageTopicsByIds } from '../../src/standards/coverageRegistry.ts';

const acraAnnualPage = JSON.parse(await readFile(new URL('../fixtures/acra-company-guidance-2026-10-10.json', import.meta.url), 'utf8'))
  .find(page => page.name === 'annual');
// Official CPF wording: https://www.cpf.gov.sg/employer/employer-obligations/what-constitutes-wages-for-cpf-contributions
// The native action-card description contains the complete definition; the earlier introduction remains insufficient alone.
const cpfIntroOnlyParagraph = 'Ordinary wages are wages due or granted wholly and exclusively in respect of employment in that month. CPF contributions are payable on ordinary wages, subject to the applicable wage ceiling.';
const cpfCompleteDefinitionParagraph = 'For wages to be classified as Ordinary Wages for the month, they must meet both of the following conditions:';
const cpfNativeDefinitionCard = `<div class="action-card carousel"><div class="teaser cmp-action-card"><div class="cmp-teaser"><div class="cmp-teaser__content"><div class="cmp-teaser__description">
  <p>${cpfCompleteDefinitionParagraph}</p>
  <ul><li>They are given to an employee for their employment in that month, and</li><li>They are payable by the 14th of the following month.</li></ul>
  <p>For example, monthly salary.</p>
</div></div></div></div></div>`;
// Official MOM guidance: https://www.mom.gov.sg/employment-practices/hours-of-work-overtime-and-rest-days
// This positive fixture includes both covered workman categories, their monthly basic-salary limits, and the managers/executives exclusion.
const momIntroOnlyParagraph = 'Employees covered by Part IV of the Employment Act are subject to working hours and overtime eligibility rules. Overtime pay is calculated from the hourly basic rate, subject to applicable overtime eligibility requirements.';
const momCompleteCoverageParagraph = 'Employees covered by Part IV overtime eligibility under the Employment Act include workmen who earn a monthly basic salary of $4,500 or less. Non-workmen who earn a monthly basic salary of $2,600 or less are also covered. Managers and executives are not covered under Part IV.';
const cases = [
  {
    authority: 'ACRA',
    topicId: 'acra_annual-returns',
    query: 'What annual return filing requirements apply to Singapore companies?',
    runtimeQuery: 'Under ACRA guidance, must Singapore-incorporated companies file annual returns? Explain the general filing duty using official ACRA guidance. Do not calculate a deadline or create journal entries.',
    subject: 'annual return filing requirements',
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
    query: 'What makes wages ordinary wages for CPF contributions?',
    runtimeQuery: 'Under CPF Board guidance, what makes a payment ordinary wages for CPF contributions? Explain the general definition using official CPF Board guidance. Do not calculate contribution rates or amounts and do not create journal entries.',
    subject: 'ordinary wages',
    domain: 'CPF_PAYROLL',
    population: 'EMPLOYER',
    url: 'https://www.cpf.gov.sg/employer/employer-obligations/what-constitutes-wages-for-cpf-contributions',
    title: 'CPF Board | What constitutes wages for CPF contributions',
    paragraph: cpfCompleteDefinitionParagraph,
    pageHtml: `<html><head><title>CPF Board | What constitutes wages for CPF contributions</title></head><body><main><h1>What constitutes wages for CPF contributions</h1><p>${cpfIntroOnlyParagraph}</p>${cpfNativeDefinitionCard}</main></body></html>`,
    sourcePublisher: 'Central Provident Fund Board (CPF Board)'
  },
  {
    authority: 'MOM',
    topicId: 'mom-part-iv-overtime',
    query: 'What are Part IV overtime eligibility requirements?',
    runtimeQuery: 'Under MOM guidance, which employees are covered by Part IV of the Employment Act for working hours and overtime? Explain the general coverage using official MOM guidance. Do not calculate pay or create journal entries.',
    subject: 'Part IV overtime eligibility',
    domain: 'MOM_EMPLOYMENT',
    population: 'EMPLOYEE',
    url: 'https://www.mom.gov.sg/employment-practices/hours-of-work-overtime-and-rest-days',
    title: 'Part IV Working Hours and Overtime Eligibility | Ministry of Manpower',
    paragraph: momCompleteCoverageParagraph,
    sourcePublisher: 'Ministry of Manpower (MOM)'
  },
  {
    authority: 'MAS',
    topicId: 'mas-cms-licence',
    query: 'What is a Capital Markets Services Licence?',
    runtimeQuery: 'Under MAS guidance, what is a Capital Markets Services Licence and when is it generally required? Explain the general licensing requirement using official MAS guidance. Do not assess a particular business or create journal entries.',
    subject: 'Capital Markets Services Licence',
    domain: 'MAS_FUNDS',
    population: 'COMPANY',
    url: 'https://www.mas.gov.sg/regulation/capital-markets-services/capital-markets-services-licence',
    title: 'Capital Markets Services Licence | Monetary Authority of Singapore',
    paragraph: 'If your company wishes to conduct regulated activities under the SFA, it must hold a CMS licence. Individuals conducting regulated activities on behalf of CMS licensees or exempt CMS entities (such as banks) need to be appointed as representatives.',
    sourcePublisher: 'Monetary Authority of Singapore (MAS)'
  }
];
// These new questions use the same retrieval, admission, quote and rendering
// helpers below, while the established four-authority fixture bank keeps its
// original authority-keyed controls intact.
const salaryPaymentHtml = `<html><head><title>Paying salary | Ministry of Manpower</title></head><body><main>
  <h1>Paying salary</h1>
  <p>In accordance with the Employment Act, your employer must pay your salary at least once a month and within 7 days after the end of the salary period. There are exceptions for overtime, resignation without notice and other situations.</p>
  <p>If you are covered by the Employment Act, your employer must pay your salary at least once a month.</p>
  <p>Salary must be paid:</p>
  <ul><li>Within 7 days after the end of the salary period.</li>
  <li>For overtime work, within 14 days after the end of the salary period.</li></ul>
  <p>Your final salary payment could vary depending on the reason employment ends. Commission payment depends on your employment contract. Tax clearance may require withholding money.</p>
</main></body></html>`;
const salaryPaymentSamples = [
  {
    key: 'regular-salary',
    authority: 'MOM', topicId: 'mom-salary-payment',
    query: 'Under MOM guidance, how often must salary be paid and when is regular salary due after the salary period?',
    runtimeQuery: 'Under MOM guidance, how often must salary be paid and when is regular salary due after the salary period?',
    subject: 'salary payment frequency and due dates', domain: 'MOM_EMPLOYMENT', population: 'EMPLOYER',
    url: 'https://www.mom.gov.sg/employment-practices/salary/paying-salary',
    title: 'Paying salary | Ministry of Manpower',
    paragraph: 'If you are covered by the Employment Act, your employer must pay your salary at least once a month.',
    pageHtml: salaryPaymentHtml, sourcePublisher: 'Ministry of Manpower (MOM)',
    expectedExplanation: /regular salary must be paid at least once a month and within 7 days after the salary period ends/i
  },
  {
    key: 'overtime-salary',
    authority: 'MOM', topicId: 'mom-salary-payment',
    query: 'When is overtime salary payment due after the salary period?',
    runtimeQuery: 'Under MOM guidance, when is overtime salary payment due after the salary period?',
    subject: 'overtime salary payment period deadline', domain: 'MOM_EMPLOYMENT', population: 'EMPLOYER',
    url: 'https://www.mom.gov.sg/employment-practices/salary/paying-salary',
    title: 'Paying salary | Ministry of Manpower',
    paragraph: 'For overtime work, within 14 days after the end of the salary period.',
    pageHtml: salaryPaymentHtml, sourcePublisher: 'Ministry of Manpower (MOM)',
    expectedExplanation: /for employees covered by the Employment Act, overtime pay must be paid within 14 days after the salary period ends/i
  }
];
const regularSalaryQuery = salaryPaymentSamples[0].query;
const regularSalarySubject = salaryPaymentSamples[0].subject;
const completeRegularSalaryProof = 'In accordance with the Employment Act, your employer must pay your salary at least once a month and within 7 days after the end of the salary period.';
const salaryPaymentHtmlWithHiddenQualification = `<html><head><title>Paying salary | Ministry of Manpower</title></head><body>
  <main><h1>Paying salary</h1><p>${completeRegularSalaryProof}</p>
    <div hidden><h2>Additional qualification outside selected excerpt</h2>
      <p>There are exceptions for overtime, resignation without notice and other situations.</p>
    </div>
  </main>
</body></html>`;
assert.equal(supportMomSalaryPaymentIssue(regularSalaryQuery, regularSalarySubject, completeRegularSalaryProof), true);
assert.equal(supportMomSalaryPaymentIssue(regularSalaryQuery, regularSalarySubject,
  'Your final salary payment could vary depending on the reason employment ends.'), false,
  'A final-salary caveat alone cannot establish regular salary timing.');
assert.equal(supportMomSalaryPaymentConcept(regularSalaryQuery, regularSalarySubject,
  'salary payment frequency and due dates', ['salary payment frequency and due dates'], completeRegularSalaryProof), true,
  'The bounded semantic frequency/due-date alias is accepted with complete same-source rule proof.');
assert.equal(supportMomSalaryPaymentConcept(regularSalaryQuery, regularSalarySubject,
  'salary payment frequency and due dates', ['salary payment frequency and due dates', 'final salary amount'], completeRegularSalaryProof), false,
  'A supported alias label cannot carry an out-of-scope final-salary amount term.');
assert.equal(supportMomSalaryPaymentIssue(regularSalaryQuery, 'overtime salary payment period deadline', completeRegularSalaryProof), false,
  'A regular salary rule cannot support the separate overtime issue.');
assert.equal(defaultExternalSourceValidator.validateCanonicalUrl('https://www.mas.gov.sg/regulation/guidelines', 'MAS').isValid, true);
assert.equal(defaultExternalSourceValidator.validateCanonicalUrl('https://www.mom.gov.sg/employment-practices', 'MAS').isValid, false);
assert.equal(defaultExternalSourceValidator.validateCanonicalUrl('https://sso.agc.gov.sg/Act/SFA2001', 'MAS').isValid, true);
assert.equal(defaultExternalSourceValidator.validateContentType('text/xml; charset=utf-8'), true);

const html = (title, body) => `<html><head><title>${title}</title></head><body><main><h1>${title}</h1><p>${body}</p></main></body></html>`;
const response = body => new Response(body, { status: 200, headers: { 'content-type': 'text/html' } });
const completeBodyContext = extractCompleteHtmlBodyContext(`<html><head><title>Page title</title><script>head script secret</script></head><body>
  <!-- comment secret -->
  <nav>Navigation text</nav><h1>Complete body heading</h1><p>Direct <span>span text</span> and a paragraph.</p>
  <ul><li>Whole list item.</li></ul><table><tr><th>Condition</th><td>Whole table cell.</td></tr></table>
  <div hidden>Conservative hidden disclosure text.</div><script>body script secret</script>
  <style>body { display: none }</style><template>template secret</template>
</body></html>`);
assert.ok(completeBodyContext?.includes('Complete body heading'));
assert.ok(completeBodyContext?.includes('Navigation text'));
assert.ok(completeBodyContext?.includes('span text'));
assert.ok(completeBodyContext?.includes('Whole list item.'));
assert.ok(completeBodyContext?.includes('Condition | Whole table cell.'));
assert.ok(completeBodyContext?.includes('Conservative hidden disclosure text.'));
assert.doesNotMatch(completeBodyContext || '', /comment secret|script secret|template secret|display: none/i);
assert.equal(extractCompleteHtmlBodyContext('<html><body><p>missing close'), undefined,
  'An incomplete body boundary cannot be represented as a complete document context.');
assert.equal(extractCompleteHtmlBodyContext('<html><body><p>One</p></body><body><p>Two</p></body></html>'), undefined,
  'Ambiguous body boundaries cannot be represented as a complete document context.');
assert.equal(extractCompleteHtmlBodyContext('<html><!-- unfinished comment <body>fake</body>'), undefined,
  'An unclosed comment cannot supply a fabricated body boundary.');
assert.equal(extractCompleteHtmlBodyContext('<html><body><script>unfinished executable text</body></html>'), undefined,
  'Incomplete executable elements fail closed.');
assert.equal(extractCompleteHtmlBodyContext('<html><body><p>For wages < $5,000 and age > 55, this condition applies.</p></body></html>'), undefined,
  'Ambiguous unescaped comparator markup is not silently discarded from a complete context.');
assert.match(extractCompleteHtmlBodyContext('<html><body><p>For wages &lt; $5,000 and age &gt; 55, this condition applies.</p></body></html>') || '',
  /For wages < \$5,000 and age > 55, this condition applies\./,
  'Escaped comparator text survives HTML cleanup as a complete condition.');
assert.equal(extractCompleteHtmlBodyContext(`<html><body>${'x'.repeat(12_001)}</body></html>`), undefined,
  'Oversized complete body text is rejected without truncation.');
const cachedHtml = '<html><head><title>Cache source</title></head><body><h1>Cache source</h1><p>Full cached body.</p></body></html>';
const cacheUrl = 'https://www.mom.gov.sg/employment-practices/salary/paying-salary';
const sameRetrieverCache = new SourceCache();
const sameRetriever = new ControlledWebRetriever(undefined, sameRetrieverCache);
let cacheNetworkRequests = 0;
const cacheTransport = async () => {
  cacheNetworkRequests++;
  return new Response(cachedHtml, { status: 200, headers: { 'content-type': 'text/html', etag: '"context-v1"' } });
};
const cacheFirst = await sameRetriever.fetchOfficialSource(cacheUrl, { customFetch: cacheTransport, useCache: true });
const cacheHit = await sameRetriever.fetchOfficialSource(cacheUrl, { customFetch: cacheTransport, useCache: true });
assert.equal(cacheNetworkRequests, 1, 'A consecutive fetch from the same retriever uses its fresh response cache.');
assert.equal(cacheHit.cached, true);
assert.equal(cacheHit.contentType, cacheFirst.contentType);
assert.equal(extractCompleteHtmlBodyContext(cacheHit.content), extractCompleteHtmlBodyContext(cacheFirst.content),
  'A cached HTML response retains the same complete document context and media identity.');

const revalidationRetriever = new ControlledWebRetriever(undefined, new SourceCache());
let revalidationRequests = 0;
const staleFirst = await revalidationRetriever.fetchOfficialSource(cacheUrl, {
  customFetch: async () => {
    revalidationRequests++;
    return new Response(cachedHtml, { status: 200, headers: { 'content-type': 'text/html', etag: '"context-v1"' } });
  }, useCache: true, ttlMs: 0
});
const notModified = await revalidationRetriever.fetchOfficialSource(cacheUrl, {
  customFetch: async (_url, init) => {
    revalidationRequests++;
    assert.equal(new Headers(init.headers).get('if-none-match'), '"context-v1"');
    return new Response(null, { status: 304 });
  }, useCache: true, ttlMs: 60_000
});
assert.equal(revalidationRequests, 2, 'A stale source is conditionally revalidated once by the same retriever.');
assert.equal(notModified.httpStatus, 304);
assert.equal(notModified.contentType, staleFirst.contentType);
assert.equal(extractCompleteHtmlBodyContext(notModified.content), extractCompleteHtmlBodyContext(staleFirst.content),
  'A 304 response retains the cached complete HTML body and its media identity.');
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
  if (sample.authority === 'CPF') {
    assert.ok(record.sourceText.includes('They are given to an employee for their employment in that month,'),
      'The native CPF rule-card passage retains the employment-month condition in the final record.');
    assert.ok(record.sourceText.includes('They are payable by the 14th of the following month.'),
      'The native CPF rule-card passage retains the following-month payment deadline in the final record.');
  }
  const mappedSourceSucceeded = success.trace.attempts.some(attempt => attempt.discoveryStage === 'MAPPED_SOURCE' &&
    attempt.finalUrl === sample.url && attempt.fetchStatus === 'SUCCESS');
  assert.ok(calls.includes(provider.sitemapUrls[0]) || mappedSourceSucceeded);
  assert.ok(calls.includes(sample.url), 'Sitemap metadata must be followed by an independently fetched page.');
  assert.ok(!calls.some(url => url.includes('unapproved.example') || url.startsWith('http:')));
  assert.ok(success.trace.attempts.some(attempt => ['SITEMAP_DISCOVERY', 'MAPPED_SOURCE'].includes(attempt.discoveryStage) &&
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

const cpfDefinitionRequest = {
  authority: 'CPF',
  topicId: 'cpf-ordinary-wages',
  subject: 'ordinary wages',
  originalQuery: 'What makes wages ordinary wages for CPF contributions?'
};
const cpfDefinitionExpectation = {
  standardIdentifiers: ['CPF Board', 'Central Provident Fund Board'],
  expectedTitles: ['What constitutes wages for CPF contributions'],
  topicTerms: ['ordinary wages'],
  requireSubstantiveBody: true,
  cpfOrdinaryWageDefinitionRequest: cpfDefinitionRequest
};
const cpfAdditionalWageDefinitionRequest = {
  authority: 'CPF',
  topicId: 'cpf-additional-wages',
  subject: 'CPF Treatment of Additional Wages',
  originalQuery: 'Under CPF Board guidance, what are Additional Wages?'
};
const cpfAdditionalWageDefinitionExpectation = {
  ...cpfDefinitionExpectation,
  topicTerms: ['additional wages'],
  cpfOrdinaryWageDefinitionRequest: undefined,
  cpfAdditionalWageDefinitionRequest
};
const cpfDefinitionPage = (card, { main = true, title = 'CPF Board | What constitutes wages for CPF contributions', wrapper = '' } = {}) =>
  `<html><head><title>${title}</title></head><body>${main ? '<main>' : ''}<h1>What constitutes wages for CPF contributions</h1><p>${cpfIntroOnlyParagraph}</p>${wrapper}${card}${main ? '</main>' : ''}</body></html>`;
const cpfNativePositive = defaultExternalSourceValidator.validateTopicContent(
  cpfDefinitionPage(cpfNativeDefinitionCard), cpfDefinitionExpectation
);
assert.equal(cpfNativePositive.isValid, true, JSON.stringify(cpfNativePositive));
assert.ok(cpfNativePositive.substantiveText?.includes('They are given to an employee for their employment in that month,'));
assert.ok(cpfNativePositive.substantiveText?.includes('They are payable by the 14th of the following month.'));
const cpfNativeAdditionalWageCard = `<div class="action-card carousel panelcontainer"><div class="teaser cmp-action-card"><div class="cmp-teaser cmp-action-card--transparent"><div class="cmp-teaser__content">
  <div class="action-card-header headline-5">What are Additional Wages?</div>
  <div class="cmp-teaser__description"><p>Wages which are not classified as Ordinary Wages will be Additional Wages for the month.</p><p>For example, annual performance bonus.</p></div>
</div></div></div></div>`;
const cpfNativeAdditionalWagePositive = defaultExternalSourceValidator.validateTopicContent(
  cpfDefinitionPage(cpfNativeAdditionalWageCard), cpfAdditionalWageDefinitionExpectation
);
assert.equal(cpfNativeAdditionalWagePositive.isValid, true, JSON.stringify(cpfNativeAdditionalWagePositive));
assert.match(cpfNativeAdditionalWagePositive.substantiveText || '', /Wages which are not classified as Ordinary Wages will be Additional Wages for the month\./i);

const cpfEmployerQualificationNote = 'Note: If your employee earns above $50 but not more than $500 per month, there is no employee’s share of CPF contributions. You will still need to pay the employer’s share of CPF contributions.';
const cpfEmployerDisclosureCard = `<div class="action-card carousel panelcontainer"><div class="teaser cmp-action-card"><div class="cmp-teaser cmp-action-card--transparent"><div class="cmp-teaser__content">
  <div class="action-card-header headline-4">Obligations of an employer</div>
  <div class="cmp-teaser__description" data-external-icon="true">
    <p>As an employer, you are required to pay CPF contributions for employees who are Singapore Citizens or Permanent Residents and earn more than $50 a month.</p>
    <p>You need to pay total CPF contributions (comprising of employer and employee shares). You can recover the employee share when paying your employees.</p>
    <p><i>${cpfEmployerQualificationNote}</i></p>
  </div>
</div></div></div></div>`;
const cpfEmployerDisclosureExpectation = {
  standardIdentifiers: ['CPF Board', 'Central Provident Fund Board'],
  expectedTitles: ['Employer obligations'],
  topicTerms: ['total CPF contributions', 'CPF contributions'],
  minimumTopicTermMatches: 2,
  requireSubstantiveBody: true,
  preserveNativeDisclosureProse: true
};
const cpfEmployerDisclosurePage = (card, wrapper = '') =>
  `<html><head><title>CPF Board | Employer obligations</title></head><body><main>
    <h1>Employer obligations</h1><p>Find helpful services and information for employers.</p>${wrapper}${card}
  </main></body></html>`;
const cpfEmployerDisclosurePositive = defaultExternalSourceValidator.validateTopicContent(
  cpfEmployerDisclosurePage(cpfEmployerDisclosureCard), cpfEmployerDisclosureExpectation
);
assert.equal(cpfEmployerDisclosurePositive.isValid, true, JSON.stringify(cpfEmployerDisclosurePositive));
const cpfEmployerDisclosureText = cpfEmployerDisclosurePositive.substantiveText || '';
const cpfEmployerRemittanceParagraph = 'You need to pay total CPF contributions (comprising of employer and employee shares). You can recover the employee share when paying your employees.';

assert.ok(cpfEmployerDisclosureText.includes(cpfEmployerRemittanceParagraph),
  'The registered native disclosure retains the source remittance paragraph verbatim.');
assert.ok(cpfEmployerDisclosureText.includes(cpfEmployerQualificationNote),
  'The registered native disclosure retains its following employee-share qualification.');
assert.ok(cpfEmployerDisclosureText.includes('earns above $50 but not more than $500 per month'),
  'The registered native disclosure retains the source wage-band qualification.');
assert.ok(cpfEmployerDisclosureText.indexOf(cpfEmployerRemittanceParagraph) < cpfEmployerDisclosureText.indexOf(cpfEmployerQualificationNote),
  'Native disclosure paragraphs remain in source order.');
assert.equal(defaultExternalSourceValidator.validateTopicContent(
  cpfEmployerDisclosurePage(cpfEmployerDisclosureCard),
  { ...cpfEmployerDisclosureExpectation, preserveNativeDisclosureProse: false }
).substantiveText?.includes('total CPF contributions'), false,
'Unregistered native disclosures remain excluded from ordinary extraction.');
for (const [key, card, wrapper] of [
  ['hidden', cpfEmployerDisclosureCard.replace('class="cmp-teaser__description"', 'class="cmp-teaser__description" hidden'), ''],
  ['linked', cpfEmployerDisclosureCard.replace(cpfEmployerRemittanceParagraph, `<a href="/cpf">${cpfEmployerRemittanceParagraph}</a>`), ''],
  ['navigation', cpfEmployerDisclosureCard, '<nav>'],
  ['malformed', cpfEmployerDisclosureCard.replace('</div></div></div></div>', '</div></div></div>'), ''],
  ['heading-qualification', cpfEmployerDisclosureCard.replace('<p><i>' + cpfEmployerQualificationNote + '</i></p>',
    '<h3>' + cpfEmployerQualificationNote + '</h3>'), ''],
  ['span-qualification', cpfEmployerDisclosureCard.replace('<p><i>' + cpfEmployerQualificationNote + '</i></p>',
    '<span>' + cpfEmployerQualificationNote + '</span>'), ''],
  ['direct-text-qualification', cpfEmployerDisclosureCard.replace('<p><i>' + cpfEmployerQualificationNote + '</i></p>',
    cpfEmployerQualificationNote), ''],
  ['incomplete', cpfEmployerDisclosureCard.replace(/<p>[\s\S]*?<\/p>[\s\S]*?<p>[\s\S]*?<\/p>[\s\S]*?<p>[\s\S]*?<\/p>/,
    '<p>Employer services are available through the online portal.</p>'), '']
]) {
  const invalid = defaultExternalSourceValidator.validateTopicContent(
    cpfEmployerDisclosurePage(card, wrapper), cpfEmployerDisclosureExpectation
  );
  assert.equal(invalid.isValid, false, `Registered disclosure ${key} control remains insufficient.`);
  assert.equal(invalid.substantiveText?.includes('total CPF contributions'), false,
    `Registered disclosure ${key} control does not leak unqualified card text.`);
}
const cpfBoundedRequestDoesNotEnableDisclosure = defaultExternalSourceValidator.validateTopicContent(
  cpfEmployerDisclosurePage(cpfEmployerDisclosureCard), {
    ...cpfEmployerDisclosureExpectation,
    cpfOrdinaryWageDefinitionRequest: cpfDefinitionRequest
  }
);
assert.equal(cpfBoundedRequestDoesNotEnableDisclosure.isValid, false,
  'Standalone disclosure extraction is disabled when a bounded wage-definition request is present.');
assert.equal(cpfBoundedRequestDoesNotEnableDisclosure.substantiveText?.includes(cpfEmployerRemittanceParagraph), false,
  'The registered disclosure path does not bypass the bounded wage-definition proof.');
const defaultCpfAdditionalCard = defaultExternalSourceValidator.validateTopicContent(cpfDefinitionPage(cpfNativeAdditionalWageCard), {
  ...cpfAdditionalWageDefinitionExpectation,
  cpfAdditionalWageDefinitionRequest: undefined
});
assert.equal(defaultCpfAdditionalCard.isValid, false,
  'Without the bounded Additional Wages definition request, the native card remains stripped.');
assert.equal(defaultExternalSourceValidator.validateTopicContent(
  cpfDefinitionPage(cpfNativeAdditionalWageCard.replace('<div class="cmp-teaser__description">', '<div class="cmp-teaser__description" hidden>')),
  cpfAdditionalWageDefinitionExpectation
).isValid, false, 'Hidden Additional Wages card descriptions remain excluded.');
assert.equal(defaultExternalSourceValidator.validateTopicContent(
  cpfDefinitionPage(cpfNativeAdditionalWageCard.replace(
    '<p>Wages which are not classified as Ordinary Wages will be Additional Wages for the month.</p>',
    '<p><a href="/definition">Wages which are not classified as Ordinary Wages will be Additional Wages for the month.</a></p>'
  )), cpfAdditionalWageDefinitionExpectation
).isValid, false, 'Link-wrapped Additional Wages definitions remain excluded.');
assert.equal(defaultExternalSourceValidator.validateTopicContent(
  cpfDefinitionPage(cpfNativeAdditionalWageCard.replace(
    '<p>For example, annual performance bonus.</p></div>',
    '<p>For example, annual performance bonus.</p><p>No wages which are not classified as Ordinary Wages will be Additional Wages for the month.</p></div>'
  )), cpfAdditionalWageDefinitionExpectation
).isValid, false, 'Contradictory native-card text blocks the Additional Wages exception.');
assert.equal(defaultExternalSourceValidator.validateTopicContent(cpfDefinitionPage(cpfNativeDefinitionCard), {
  ...cpfDefinitionExpectation,
  cpfOrdinaryWageDefinitionRequest: undefined,
  cpfAdditionalWageDefinitionRequest
}).isValid, false, 'The Additional Wages request cannot enable the Ordinary Wages card.');
const defaultCpfCard = defaultExternalSourceValidator.validateTopicContent(cpfDefinitionPage(cpfNativeDefinitionCard), {
  ...cpfDefinitionExpectation,
  cpfOrdinaryWageDefinitionRequest: undefined
});
assert.equal(defaultCpfCard.substantiveText?.includes('They are payable by the 14th of the following month.'), false,
  'Without the exact bounded request, default metadata stripping continues to exclude the native card.');
assert.equal(defaultExternalSourceValidator.validateTopicContent(
  cpfDefinitionPage(cpfNativeDefinitionCard.replace('They are given to an employee for their employment in that month,', '')),
  cpfDefinitionExpectation
).isValid, false, 'A card missing the employment-month condition remains insufficient.');
assert.equal(defaultExternalSourceValidator.validateTopicContent(
  cpfDefinitionPage(cpfNativeDefinitionCard.replace('They are payable by the 14th of the following month.', '')),
  cpfDefinitionExpectation
).isValid, false, 'A card missing the following-month payment condition remains insufficient.');
assert.equal(defaultExternalSourceValidator.validateTopicContent(
  cpfDefinitionPage(cpfNativeDefinitionCard, { main: false }), cpfDefinitionExpectation
).isValid, false, 'A native-looking card outside the page main is not admitted.');
assert.equal(defaultExternalSourceValidator.validateTopicContent(
  cpfDefinitionPage(cpfNativeDefinitionCard, { wrapper: '<div class="related-content">' }).replace('</body>', '</div></body>'),
  cpfDefinitionExpectation
).isValid, false, 'A card inside a related-content wrapper is not admitted.');
assert.equal(defaultExternalSourceValidator.validateTopicContent(
  cpfDefinitionPage(cpfNativeDefinitionCard, { wrapper: '<nav>' }).replace('</main>', '</nav></main>'),
  cpfDefinitionExpectation
).isValid, false, 'Navigation-wrapped card text is not admitted.');
assert.equal(defaultExternalSourceValidator.validateTopicContent(
  cpfDefinitionPage(cpfNativeDefinitionCard, { wrapper: '<div class="navigation"><div><p>Menu placeholder</p></div>' })
    .replace('</main>', '</div></main>'),
  cpfDefinitionExpectation
).isValid, false, 'A card nested in a navigation-marked div is not admitted even when other page chrome can be stripped.');
assert.equal(defaultExternalSourceValidator.validateTopicContent(
  cpfDefinitionPage(cpfNativeDefinitionCard.replace('<div class="cmp-teaser__description">', '<div class="cmp-teaser__description" hidden>')),
  cpfDefinitionExpectation
).isValid, false, 'Hidden card descriptions are not admitted.');
assert.equal(defaultExternalSourceValidator.validateTopicContent(
  cpfDefinitionPage(cpfNativeDefinitionCard.replace(
    `<p>${cpfCompleteDefinitionParagraph}</p>`,
    `<p><a href="/criteria">${cpfCompleteDefinitionParagraph}</a></p>`
  )),
  cpfDefinitionExpectation
).isValid, false, 'Link-wrapped card descriptions are not admitted.');
const cpfTitleAndLinkOnlyCard = cpfNativeDefinitionCard.replace(
  /<div class="cmp-teaser__description">[\s\S]*?<\/div>/,
  '<div class="cmp-teaser__description"><h2>Ordinary wage criteria</h2><p><a href="/ordinary-wages">Full ordinary wage definition and both conditions</a></p></div>'
);
assert.equal(defaultExternalSourceValidator.validateTopicContent(
  cpfDefinitionPage(cpfTitleAndLinkOnlyCard), cpfDefinitionExpectation
).isValid, false, 'A heading and linked card summary do not count as description prose.');
assert.equal(defaultExternalSourceValidator.validateTopicContent(
  cpfDefinitionPage(cpfNativeDefinitionCard.slice(0, cpfNativeDefinitionCard.lastIndexOf('</div>'))),
  cpfDefinitionExpectation
).isValid, false, 'Malformed nested card markup cannot leak description text into source evidence.');
assert.equal(defaultExternalSourceValidator.validateTopicContent(
  cpfDefinitionPage(cpfNativeDefinitionCard, { title: 'CPF Board | General services' }),
  cpfDefinitionExpectation
).isValid, false, 'The card exception does not bypass the mapped page-title check.');
assert.equal(defaultExternalSourceValidator.validateTopicContent(
  cpfDefinitionPage(cpfNativeDefinitionCard), {
    ...cpfDefinitionExpectation,
    cpfOrdinaryWageDefinitionRequest: { ...cpfDefinitionRequest, authority: 'MOM' }
  }
).isValid, false, 'A request with the wrong authority cannot enable the CPF card exception.');
assert.equal(defaultExternalSourceValidator.validateTopicContent(
  cpfDefinitionPage(cpfNativeDefinitionCard), {
    ...cpfDefinitionExpectation,
    cpfOrdinaryWageDefinitionRequest: { ...cpfDefinitionRequest, topicId: 'cpf-contributions' }
  }
).isValid, false, 'A different CPF topic cannot enable the CPF card exception.');

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

const salaryPageUrl = 'https://www.mom.gov.sg/employment-practices/salary/paying-salary';
const unrelatedEmploymentPracticeUrl = 'https://www.mom.gov.sg/employment-practices/leave-and-holidays/annual-leave';
const salaryCandidateAdapter = new OfficialSitemapDiscoveryAdapter({
  async fetchOfficialSource(url) {
    assert.equal(url, provider.sitemapUrls[0]);
    return { status: 'SUCCESS', finalUrl: url, content: `<urlset>
      <url><loc>https://www.mom.gov.sg/passes-and-permits/s-pass/paying-salaries</loc></url>
      <url><loc>https://www.mom.gov.sg/employment-practices/salary</loc></url>
      <url><loc>${salaryPageUrl}</loc></url>
      <url><loc>${unrelatedEmploymentPracticeUrl}</loc></url>
      <url><loc>https://www.mom.gov.sg/faq/work-permit/salary-period</loc></url>
    </urlset>` };
  }
});
const salaryCandidates = await salaryCandidateAdapter.discoverOfficialSourceCandidates({
  ...provider,
  topicId: 'mom-salary-payment',
  topicDomainId: 'MOM_EMPLOYMENT',
  topicTitle: 'Salary Periods, Payment and Deductions',
  topicHints: ['salary payment', 'salary period', 'when must salary be paid'],
  standardOrAct: 'Employment Act',
  query: 'Under MOM guidance, how often must salary be paid and when is regular salary due after the salary period?'
});
assert.ok(salaryCandidates.length <= 4 && salaryCandidates.includes(salaryPageUrl),
  `The Employment Act salary page stays within the bounded candidate set despite similarly worded work-pass pages: ${JSON.stringify(salaryCandidates)}`);
assert.equal(salaryCandidates.includes(unrelatedEmploymentPracticeUrl), false,
  'An Employment Practices route receives no relevance score without salary/topic overlap.');

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
const oracleUnderstandingFor = samples => {
  const primary = samples[0];
  const interpretation = {
    jurisdiction: ['Singapore'],
    authorityCandidates: [...new Set(samples.map(sample => sample.authority))],
    contextualAuthorities: [],
    domain: primary.domain,
    population: primary.population,
    primarySubject: samples.map(sample => sample.subject).join(' and '),
    concepts: samples.map((sample, index) => ({ concept: sample.subject, role: index === 0 ? 'PRIMARY' : 'RELATED' })),
    requestedOperation: 'EXPLAIN_RULE',
    requiresUserSpecificFacts: false,
    calculationRequested: false,
    factsExplicitlyProvided: [],
    confidence: 0.98,
    issues: samples.map(sample => ({
      subject: sample.subject,
      population: sample.population,
      domain: sample.domain,
      governingAuthorities: [sample.authority],
      contextualAuthorities: [],
      operation: 'EXPLAIN_RULE',
      mappedTopicIds: [sample.topicId],
      evidenceRequirement: 'AUTHORITATIVE_SOURCE',
      confidence: 0.98
    }))
  };
  return { mode: 'SEMANTIC_INTERPRETATION', assessmentStatus: 'PASSED', interpretation };
};
const pageFor = sample => sample.pageHtml || html(sample.title, sample.paragraph);
const runWorkstreams = async (samples, {
  query = samples.map(sample => sample.query).join(' '),
  referenceDate = '2026-10-14',
  issuePlan = makeIssuePlan(samples.map(makeIssue)),
  pageOverrides = {},
  localOnly = false,
  providers,
  questionUnderstanding,
  discoveryAdapter,
  officialDomainSearchAdapter
} = {}) => {
  const calls = [];
  const fetchedPages = new Map();
  const allSamples = [...cases, ...salaryPaymentSamples];
  const customFetch = async url => {
    calls.push(url);
    const sitemapOwner = allSamples.find(sample => OFFICIAL_SOURCE_DISCOVERY_PROVIDERS[sample.authority].sitemapUrls.includes(url));
    if (sitemapOwner) return response(`<urlset>${allSamples.filter(sample => sample.authority === sitemapOwner.authority)
      .map(sample => `<url><loc>${sample.url}</loc></url>`).join('')}</urlset>`);
    const pageOwner = allSamples.find(sample => sample.url === url);
    if (pageOwner) {
      const page = pageOverrides[url] || pageOverrides[pageOwner.key] || pageOverrides[pageOwner.authority] || pageFor(pageOwner);
      fetchedPages.set(url, page);
      return response(page);
    }
    if (url.endsWith('/robots.txt')) return new Response('not found', { status: 404 });
    if (url.startsWith('https://html.duckduckgo.com/html/') || url.startsWith('https://r.jina.ai/'))
      return new Response('not found', { status: 404 });
    throw Error(`Unexpected workstream fetch ${url}`);
  };
  const result = await buildAuthorityWorkstreams(query, issuePlan, {
    retriever: offlineRetriever,
    referenceDate,
    localOnly,
    providers,
    questionUnderstanding,
    groundingOptions: {
      localOnly,
      ...(discoveryAdapter ? { discoveryAdapter } : {}),
      ...(officialDomainSearchAdapter ? { officialDomainSearchAdapter } : {}),
      webRetriever: new ControlledWebRetriever(undefined, new SourceCache()),
      fetchOptions: { customFetch, timeoutMs: 500, useCache: false }
    }
  });
  return { ...result, calls, fetchedPages };
};

const hyphenatedMomQuery = 'Under MOM guidance, explain employer salary-payment deadlines.';
const hyphenatedMomScope = {
  authority: 'MOM', domain: 'MOM_EMPLOYMENT', topicIds: [], requestedConcepts: [],
  context: { domainId: 'MOM_EMPLOYMENT', population: 'EMPLOYER',
    primarySubject: 'MOM salary-payment deadlines', concepts: ['MOM salary-payment deadlines'], requestedOperation: 'EXPLAIN_RULE' }
};
const hyphenatedMomTopic = provisionalAuthorityIssueTopic(hyphenatedMomScope);
assert.ok(hyphenatedMomTopic, 'A known MOM issue can form a transient discovery target without registry mapping.');
const discoverHyphenatedMom = async allowed => {
  const requests = [];
  const result = await resolveMappedOfficialSourceFallback([], hyphenatedMomQuery, offlineRetriever, {
    authorityLevelDiscovery: true, localEvidenceAdequate: false, evidenceScope: hyphenatedMomScope,
    ...(allowed ? { allowTransientAuthorityIssueDiscovery: true } : {}),
    webRetriever: new ControlledWebRetriever(undefined, new SourceCache()),
    fetchOptions: { customFetch: async () => new Response('', { status: 404 }), timeoutMs: 500, useCache: false },
    discoveryAdapter: {
      async discoverOfficialSourceCandidates(request) { requests.push(request); return []; },
      getLastFetchTrace() { return []; }
    },
    officialDomainSearchAdapter: {
      async searchOfficialDomainCandidates() { return []; },
      getLastSearchTrace() { return []; }
    }
  });
  return { requests, result };
};
const deniedHyphenatedMom = await discoverHyphenatedMom(false);
assert.equal(deniedHyphenatedMom.requests.length, 0,
  'The fallback adapter cannot create a transient target unless the validated caller opts in.');
const allowedHyphenatedMom = await discoverHyphenatedMom(true);
assert.ok(allowedHyphenatedMom.requests.some(request => request.topicId === hyphenatedMomTopic.id &&
  /salary-payment/i.test(request.topicTitle)),
  'Issue-scoped MOM discovery preserves the hyphenated salary-payment subject.');
assert.ok(allowedHyphenatedMom.result.provisionalTopics.some(topic => topic.id === hyphenatedMomTopic.id));
const salarySeedScope = {
  authority: 'MOM', domain: 'MOM_EMPLOYMENT', topicIds: [], requestedConcepts: [],
  context: { domainId: 'MOM_EMPLOYMENT', population: 'EMPLOYER',
    primarySubject: 'ordinary salary and overtime payment deadlines',
    concepts: ['ordinary salary deadlines', 'overtime payment deadline'], requestedOperation: 'EXPLAIN_RULE' }
};
const salarySeedCalls = [];
const salarySeedResult = await resolveMappedOfficialSourceFallback([],
  'Under MOM guidance, explain when ordinary salary and overtime pay are due after the salary period.', offlineRetriever, {
    authorityLevelDiscovery: true, localEvidenceAdequate: false,
    allowTransientAuthorityIssueDiscovery: true, evidenceScope: salarySeedScope,
    webRetriever: new ControlledWebRetriever(undefined, new SourceCache()),
    fetchOptions: { customFetch: async url => {
      salarySeedCalls.push(url);
      return url === salaryPageUrl ? response(salaryPaymentHtml) : new Response('', { status: 404 });
    }, timeoutMs: 500, useCache: false },
    discoveryAdapter: {
      async discoverOfficialSourceCandidates() { return []; },
      getLastFetchTrace() { return []; }
    },
    officialDomainSearchAdapter: {
      async searchOfficialDomainCandidates() { return []; },
      getLastSearchTrace() { return []; }
    }
  });
assert.ok(salarySeedCalls.includes(salaryPageUrl), 'Validated subject-scoped retrieval tries the registered MOM salary page before broad discovery.');
assert.ok(salarySeedResult.records.some(record => record.canonicalSourceUrl === salaryPageUrl),
  'The existing registered URL remains only a fetched candidate that passes the ordinary topic and source gates.');

// Captured semantic labels drive the data-only candidate ranking. Selection is
// still only a candidate fetch; ordinary source admission remains in force.
const capturedSeedSamples = [
  {
    authority: 'CPF', domain: 'CPF_PAYROLL', population: 'EMPLOYER',
    query: 'We are hiring a Singapore citizen employee on a contract of service. Who is responsible for paying CPF contributions, and what employee and pay details should payroll collect before calculating them? Do not calculate a contribution or create a journal.',
    url: 'https://www.cpf.gov.sg/employer/employer-obligations',
    title: 'Employer obligations | Central Provident Fund Board',
    pageHtml: html('Employer obligations | Central Provident Fund Board',
      'Obligations of an employer. An employer is responsible for paying the total CPF contributions for eligible employees. The total CPF contributions comprise both the employer and employee shares, which the employer is required to pay to CPF Board. The employer is entitled to recover the employee share when paying the employee wages for the month.'),
    scope: {
      authority: 'CPF', domain: 'CPF_PAYROLL', topicIds: [],
      requestedConcepts: [
        { id: 'cpf-contributions', label: 'CPF contributions', terms: ['CPF contributions'], topicIds: ['cpf-contribution-computation'] },
        { id: 'contract-of-service', label: 'contract of service', terms: ['contract of service'], topicIds: ['cpf-employee-coverage'] },
        { id: 'employee-details', label: 'employee details', terms: ['employee details'], topicIds: ['cpf-contribution-computation'] },
        { id: 'pay-details', label: 'pay details', terms: ['pay details'], topicIds: ['cpf-contribution-computation'] }
      ],
      context: {
        domainId: 'CPF_BOARD', population: 'EMPLOYER',
        primarySubject: 'responsibility for paying CPF contributions',
        concepts: ['CPF contributions', 'contract of service', 'employee details', 'pay details'],
        requestedOperation: 'EXPLAIN_RULE'
      }
    }
  },
  {
    authority: 'MOM', domain: 'MOM_EMPLOYMENT', population: 'EMPLOYEE',
    query: 'Our employee is covered by the Employment Act and the overtime provisions. Do ordinary salary and overtime have the same payment deadline after the salary period ends? Explain the practical payroll steps and cite the relevant official guidance. No journal is required.',
    url: salaryPageUrl, title: 'Paying salary | Ministry of Manpower', pageHtml: salaryPaymentHtml,
    scope: {
      authority: 'MOM', domain: 'MOM_EMPLOYMENT', topicIds: [],
      requestedConcepts: [
        { id: 'employment-act', label: 'Employment Act', terms: ['Employment Act'], topicIds: ['mom-salary-payment'] },
        { id: 'overtime-provisions', label: 'overtime provisions', terms: ['overtime provisions'], topicIds: ['mom-salary-payment'] },
        { id: 'ordinary-salary-deadline', label: 'ordinary salary payment deadline', terms: ['ordinary salary payment deadline'], topicIds: ['mom-salary-payment'] },
        { id: 'overtime-payment-deadline', label: 'overtime payment deadline', terms: ['overtime payment deadline'], topicIds: ['mom-salary-payment'] },
        { id: 'payroll-steps', label: 'practical payroll steps', terms: ['practical payroll steps'], topicIds: ['mom-salary-payment'] }
      ],
      context: {
        domainId: 'MOM_EMPLOYMENT', population: 'EMPLOYEE',
        primarySubject: 'comparison of ordinary salary and overtime payment deadlines under the Employment Act',
        concepts: ['Employment Act', 'overtime provisions', 'ordinary salary payment deadline', 'overtime payment deadline', 'practical payroll steps'],
        requestedOperation: 'COMPARE'
      }
    }
  },
  {
    authority: 'MOM', domain: 'MOM_EMPLOYMENT', population: 'EMPLOYER',
    query: 'Our employee is covered by the Employment Act and the overtime provisions. Do ordinary salary and overtime have the same payment deadline after the salary period ends? Explain the practical payroll steps and cite the relevant official guidance. No journal is required.',
    url: salaryPageUrl, title: 'Paying salary | Ministry of Manpower', pageHtml: salaryPaymentHtml,
    scope: {
      authority: 'MOM', domain: 'MOM_EMPLOYMENT', topicIds: [],
      requestedConcepts: [
        { id: 'practical-payroll-steps', label: 'practical payroll steps', terms: ['practical payroll steps'], topicIds: [] }
      ],
      context: {
        domainId: 'MOM_EMPLOYMENT', population: 'EMPLOYER',
        primarySubject: 'practical payroll steps', concepts: ['practical payroll steps'],
        requestedOperation: 'EXPLAIN_RULE'
      }
    }
  },
  {
    authority: 'MAS', domain: 'MAS_FUNDS', population: 'FUND',
    query: "We plan to start managing external investors' portfolios from Singapore. What should we establish about MAS licensing or exemptions before starting, and what facts would you need to assess our position? Do not assume we qualify for an exemption. I only need advisory guidance.",
    url: 'https://www.mas.gov.sg/regulation/capital-markets/apply-for-licensing-or-registration-of-capital-market-entities/fund-management-licensing',
    title: 'Fund Management Licensing | Monetary Authority of Singapore',
    pageHtml: html('Fund Management Licensing | Monetary Authority of Singapore',
      'A company that conducts fund management activities regulated under the Securities and Futures Act must apply to be a licensed fund management company holding a Capital Markets Services licence. An applicable class exemption may mean that a company does not require a licence.'),
    scope: {
      authority: 'MAS', domain: 'MAS_FUNDS', topicIds: [],
      requestedConcepts: [
        { id: 'mas-licensing', label: 'MAS licensing', terms: ['MAS licensing'], topicIds: ['mas-lfmc'] },
        { id: 'regulatory-exemptions', label: 'regulatory exemptions', terms: ['regulatory exemptions'], topicIds: ['mas-lfmc'] },
        { id: 'external-portfolio-management', label: 'external portfolio management', terms: ['external portfolio management'], topicIds: ['mas-lfmc'] }
      ],
      context: {
        domainId: 'MAS_FUNDS', population: 'FUND',
        primarySubject: 'MAS licensing requirements and exemptions for portfolio management',
        concepts: ['MAS licensing', 'regulatory exemptions', 'external portfolio management'],
        requestedOperation: 'EXPLAIN_RULE'
      }
    }
  }
];
const practicalDiscoveryPointers = practicalExpansionDiscoveryPointers();
const practicalDiscoveryUrls = new Set(practicalDiscoveryPointers.map(pointer => pointer.url));
const runCapturedSeedSelection = async (sample, allowTransientAuthorityIssueDiscovery = true) => {
  const calls = [];
  const result = await resolveMappedOfficialSourceFallback([], sample.query, offlineRetriever, {
    authorityLevelDiscovery: true, localEvidenceAdequate: false,
    ...(allowTransientAuthorityIssueDiscovery ? { allowTransientAuthorityIssueDiscovery: true } : {}),
    evidenceScope: sample.scope,
    webRetriever: new ControlledWebRetriever(undefined, new SourceCache()),
    fetchOptions: { customFetch: async url => {
      calls.push(url);
      return url === sample.url ? response(sample.pageHtml) : new Response('', { status: 404 });
    }, timeoutMs: 500, useCache: false },
    discoveryAdapter: {
      async discoverOfficialSourceCandidates() { return []; },
      getLastFetchTrace() { return []; }
    },
    officialDomainSearchAdapter: {
      async searchOfficialDomainCandidates() { return []; },
      getLastSearchTrace() { return []; }
    }
  });
  return { calls, result, seedUrls: [...new Set(calls.filter(url => practicalDiscoveryUrls.has(url)))] };
};
for (const sample of capturedSeedSamples) {
  const selected = await runCapturedSeedSelection(sample);
  assert.ok(selected.seedUrls.includes(sample.url),
    sample.authority + ' captured subject/concepts/population selects ' + sample.url + '; tried=' + JSON.stringify(selected.seedUrls));
  assert.ok(selected.seedUrls.length <= 2, sample.authority + ' seed selection stays within the two-URL cap.');
  const transientTopic = provisionalAuthorityIssueTopic(sample.scope);
  for (const url of selected.seedUrls) {
    const pointer = practicalDiscoveryPointers.find(item => item.url === url);
    assert.ok(pointer && pointer.authority === sample.authority,
      sample.authority + ' seed selection excludes pointers for another authority.');
    assert.ok(getCoverageTopicsByIds(pointer.topicIds).some(topic =>
      topic.authorities.includes(sample.authority) && topic.legacyDomains.some(domain => transientTopic.legacyDomains.includes(domain))),
      sample.authority + ' seed selection excludes taxonomy-incompatible pointers.');
  }
  const selectedRecord = selected.result.records.find(record => record.canonicalSourceUrl === sample.url);
  assert.ok(selectedRecord, sample.authority + ' page is fetched through ordinary candidate retrieval; trace=' +
    JSON.stringify(selected.result.trace.attempts.filter(attempt => attempt.candidateUrl === sample.url)));
  assert.equal(selectedRecord.lifecycleState, 'CANDIDATE', 'Pointer selection does not activate a source.');
}
const capturedPracticalPayrollSteps = capturedSeedSamples.find(sample =>
  sample.authority === 'MOM' && sample.scope.context.primarySubject === 'practical payroll steps');
assert.ok(capturedPracticalPayrollSteps, 'The captured practical-payroll issue remains independently scoped.');
const practicalPayrollSelection = await runCapturedSeedSelection(capturedPracticalPayrollSteps);
const admittedPracticalPayrollSource = practicalPayrollSelection.result.records.find(record =>
  record.canonicalSourceUrl === salaryPageUrl);
assert.ok(admittedPracticalPayrollSource,
  'The original question and captured practical-payroll steps / EMPLOYER / EXPLAIN_RULE / mapped-empty frame admit Paying salary for this issue.');
assert.equal(admittedPracticalPayrollSource.lifecycleState, 'CANDIDATE',
  'The Paying salary URL remains a retrieved candidate under ordinary source admission.');
const wrongPracticalPayrollPage = await runCapturedSeedSelection({
  ...capturedPracticalPayrollSteps,
  pageHtml: html('Annual leave', 'Employees may take annual leave according to their service period.')
});
assert.equal(wrongPracticalPayrollPage.result.records.some(record => record.canonicalSourceUrl === salaryPageUrl), false,
  'A wrong page returned at the Paying salary URL remains rejected by existing title/content admission checks.');
const unvalidatedSeedControl = await runCapturedSeedSelection(capturedSeedSamples[0], false);
assert.deepEqual(unvalidatedSeedControl.seedUrls, [],
  'Without validated transient-discovery permission, registered metadata is not fetched as a seed.');
assert.equal(unvalidatedSeedControl.result.provisionalTopics.some(topic => topic.id.startsWith('iras-authority-query-issue-cpf-')), false,
  'Missing validated context cannot create a transient CPF target.');
const wrongDomainSeedControl = await runCapturedSeedSelection({
  ...capturedSeedSamples[0],
  scope: { ...capturedSeedSamples[0].scope, context: { ...capturedSeedSamples[0].scope.context, domainId: 'ACRA_COMPANIES' } }
});
assert.deepEqual(wrongDomainSeedControl.seedUrls, [],
  'A CPF authority scope with an ACRA taxonomy domain cannot select CPF seed URLs.');

// A rate-topic match does not settle the separate employer-responsibility
// question. Keep the registered 2026 PDF as an actual fetched candidate, then
// verify that the bounded current-issue discovery still tries its official
// employer overview. Only that exact overview URL is an expected offline miss.
const cpfRateTableUrl = 'https://www.cpf.gov.sg/content/dam/web/employer/employer-obligations/documents/CPFcontributionratesfrom1Jan2026.pdf';
const cpfComputationUrl = 'https://www.cpf.gov.sg/employer/employer-obligations/how-much-cpf-contributions-to-pay';
const cpfEmployerOverviewUrl = 'https://www.cpf.gov.sg/employer/employer-obligations';
const [cpfRateTablePdf, cpfComputationHtml] = await Promise.all([
  readFile(new URL('../fixtures/statutoryKnowledge20261027b/cpf-rates-native-2026.pdf', import.meta.url)),
  readFile(new URL('../fixtures/statutoryDevelopment20261027/cpf-contribution-computation.html', import.meta.url), 'utf8')
]);
const cpfResponsibilitySample = capturedSeedSamples[0];
const cpfRateMappedResponsibilityScope = {
  ...cpfResponsibilitySample.scope,
  topicIds: ['cpf_contribution_rates'],
  context: { ...cpfResponsibilitySample.scope.context, domainId: 'CPF_CONTRIBUTIONS' }
};
const cpfResponsibilityCalls = [];
const cpfResponsibilityResult = await resolveMappedOfficialSourceFallback(['cpf_contribution_rates'],
  cpfResponsibilitySample.query, offlineRetriever, {
    authorityLevelDiscovery: true, localEvidenceAdequate: false, allowTransientAuthorityIssueDiscovery: true,
    evidenceScope: cpfRateMappedResponsibilityScope, referenceDate: TargetDateResolver.CURRENT_SYSTEM_DATE,
    webRetriever: new ControlledWebRetriever(undefined, new SourceCache()),
    fetchOptions: { customFetch: async url => {
      cpfResponsibilityCalls.push(url);
      if (url === cpfRateTableUrl) return new Response(cpfRateTablePdf, {
        status: 200, headers: { 'content-type': 'application/pdf' }
      });
      if (url === cpfComputationUrl) return new Response(cpfComputationHtml, {
        status: 200, headers: { 'content-type': 'text/html' }
      });
      if (url === cpfEmployerOverviewUrl) return new Response('', { status: 404 });
      throw new Error(`Unexpected CPF responsibility regression URL: ${url}`);
    }, timeoutMs: 500, useCache: false },
    discoveryAdapter: {
      async discoverOfficialSourceCandidates() { return []; },
      getLastFetchTrace() { return []; }
    },
    officialDomainSearchAdapter: {
      async searchOfficialDomainCandidates() { return []; },
      getLastSearchTrace() { return []; }
    }
  });
assert.ok(cpfResponsibilityCalls.includes(cpfRateTableUrl),
  'The semantic rate-topic match still fetches the retained native CPF rate PDF through ordinary mapped retrieval.');
assert.ok(cpfResponsibilityResult.records.some(record => record.canonicalSourceUrl === cpfRateTableUrl),
  'The actual 2026 CPF rate PDF remains a retrieved candidate in the responsibility-scoped query.');
assert.ok(cpfResponsibilityCalls.includes(cpfEmployerOverviewUrl),
  'A valid rate-PDF candidate does not suppress the separate current employer-responsibility overview attempt.');
const successfulRuns = new Map();
const metadataOnlyAdmissionFailures = [];
// Oracle interpretations and official pages are deterministic fixtures. This
// verifies the shared offline runtime path; it is not model or live acceptance.
for (const sample of cases) {
  const routeQuery = sample.runtimeQuery || sample.query;
  // All four agencies use the same fetched-page, exact-quote and issue-scoped
  // admission path after classifier reconciliation. Discovery metadata alone
  // never becomes evidence.
  const classification = classifyQuestion(routeQuery);
  const oracleUnderstanding = oracleUnderstandingFor([sample]);
  assert.ok(validateSemanticQuestionInterpretation(oracleUnderstanding.interpretation, routeQuery),
    `${sample.authority} oracle interpretation satisfies the validated semantic contract.`);
  const reconciled = reconcileQuestionUnderstanding(routeQuery, classification, oracleUnderstanding);
  const reconciledIssue = reconciled.issuePlan.issues.find(issue => issue.governingAuthorities.includes(sample.authority));
  assert.ok(reconciledIssue, `${sample.authority} governing issue survives reconciliation.`);
  assert.equal(reconciledIssue.status, 'MAPPED', `${sample.authority} subject maps through the existing topic taxonomy.`);
  assert.ok(reconciledIssue.mappedTopicIds.includes(sample.topicId),
    `${sample.authority} subject maps to its registered coverage topic.`);
  assert.equal(reconciledIssue.operation, 'EXPLAIN_RULE');
  assert.deepEqual(reconciledIssue.contextualAuthorities || [], []);
  assert.equal(shouldUseAuthorityEvidenceRuntime({
    issuePlan: reconciled.issuePlan,
    classification: reconciled.classification,
    explicitIrasEvidenceRequest: false,
    hasImages: false
  }), true, `${sample.authority} reconciled statutory issue selects the shared authority runtime.`);

  const success = await runWorkstreams([sample], { query: routeQuery, issuePlan: reconciled.issuePlan });
  successfulRuns.set(sample.authority, success);
  const stream = success.workstreams.find(item => item.authority === sample.authority);
  assert.ok(stream, `Expected ${sample.authority} workstream`);
  const issueEvidence = stream.issues[0];
  assert.equal(issueEvidence.evidenceStatus, 'VERIFIED', JSON.stringify(issueEvidence));
  assert.ok(issueEvidence.sources.length > 0, `${sample.authority} admission retains issue-scoped sources.`);
  for (const record of issueEvidence.sources) {
    assert.equal(record.authority, sample.authority);
    assert.equal(record.sourceAuthority, sample.authority);
    assert.equal(record.officialSourceUrl, sample.url);
    assert.equal(record.sourcePublisher, sample.sourcePublisher);
    assert.equal(record.provenance, 'LIVE_EXTERNAL');
    assert.equal(record.lifecycleState, 'CANDIDATE', 'Successful retrieval does not auto-approve or persist the candidate.');
    assert.equal(record.sourceStatus, 'NEEDS_REVIEW');
    assert.equal(record.verificationMethod, 'LIVE_OFFICIAL_TOPIC_VERIFIED');
  }
  assert.ok(issueEvidence.sources.some(record => record.tags.includes(sample.topicId) ||
    record.relatedTopicIds?.includes(sample.topicId) || record.sourceMapTopicIds?.includes(sample.topicId)),
    'At least one candidate remains bound to the requested coverage topic.');
  assert.ok(success.calls.includes(sample.url), 'The official article is fetched separately from its sitemap entry.');
  assert.ok(issueEvidence.retrievalTrace.stages.some(stage => ['SITEMAP_DISCOVERY', 'MAPPED_SOURCE'].includes(stage.stage) && stage.status === 'SUFFICIENT'));
  assert.ok(issueEvidence.retrievalTrace.attempts.some(attempt => attempt.topicId === sample.topicId && attempt.fetchStatus === 'SUCCESS'));
  assert.ok(discoveryResults.get(sample.authority).trace.attempts.some(attempt => attempt.topicId === sample.topicId &&
    attempt.finalUrl === sample.url && attempt.contentMatched && attempt.titleMatched), 'The raw retrieval trace binds the topic to the fetched URL.');
  assert.ok(issueEvidence.verifiedClaims.length > 0);
  for (const claim of issueEvidence.verifiedClaims) {
    const record = issueEvidence.sources.find(source => source.id === claim.recordId);
    assert.ok(record, 'Every verified claim is bound to an admitted source record.');
    assert.ok(record.sourceText.includes(claim.quote), 'Every verified quote is an exact substring of the fetched official page.');
  }
  const presentation = createAuthorityEvidencePresentation(success);
  const renderedResponse = renderAuthorityEvidenceResponseText(presentation, false);
  const presentedStream = presentation.workstreams.find(item => item.authority === sample.authority);
  assert.ok(presentedStream);
  assert.equal(presentedStream.evidenceStatus, 'VERIFIED');
  assert.ok(presentedStream.sources.some(source => source.officialUrl === sample.url));
  for (const claim of presentedStream.sources.flatMap(source => source.claims)) {
    assert.ok(issueEvidence.sources.some(record => record.sourceText.includes(claim.text)),
      'Rendered evidence remains an exact quote from the fetched official page.');
    assert.ok(renderedResponse.includes(claim.text));
  }
  assert.ok(renderedResponse.includes(sample.url), 'The shared response renders the verified official link.');
  if (sample.expectedExplanation) {
    assert.match(renderedResponse, sample.expectedExplanation,
      'A claim-backed MOM salary answer explains the rule instead of showing a source excerpt alone.');
    const suppressExplanation = (mutate, query = routeQuery) => {
      const candidate = structuredClone(presentation);
      candidate.query = query;
      mutate(candidate.workstreams.find(item => item.authority === 'MOM'));
      assert.doesNotMatch(renderAuthorityEvidenceResponseText(candidate, false), /MOM rule explanation:/,
        'The MOM salary explanation is suppressed when scope or complete same-source evidence is missing.');
    };
    suppressExplanation(stream => { stream.authority = 'CPF'; });
    suppressExplanation(stream => { stream.applicationStatus = 'UNRESOLVED'; });
    suppressExplanation(stream => { stream.sources[0].officialUrl = 'https://www.cpf.gov.sg/member/'; });
    suppressExplanation(stream => {
      const claim = stream.sources.flatMap(source => source.claims).find(item => item.issueIds.includes(stream.issues[0].id));
      claim.text = 'Salary must be paid within 7 days after the end of the salary period.';
    });
    suppressExplanation(stream => {
      const claim = stream.sources.flatMap(source => source.claims).find(item => item.issueIds.includes(stream.issues[0].id));
      claim.text = claim.text.replace('Within 7 days after the end of the salary period.', 'Not within 7 days after the end of the salary period.');
      claim.text = claim.text.replace('For overtime work, within 14 days', 'For overtime work, within 7 days');
    });
    suppressExplanation(stream => { stream.issues[0].applicationStatus = 'UNRESOLVED'; });
    suppressExplanation(() => {}, `${routeQuery} in 2023`);
    suppressExplanation(() => {}, `${routeQuery} when is my final salary due?`);
  }
  assert.match(renderedResponse, /Evidence verified/);
  assert.doesNotMatch(renderedResponse, /\bjournal\b/i,
    'A generic statutory response does not claim or create a journal.');

  // Without a semantic provider, deterministic taxonomy fallback stays
  // explicitly incomplete even when it recognizes the authority topic.
  const noProvider = reconcileQuestionUnderstanding(routeQuery, classification, {
    mode: 'DETERMINISTIC_FALLBACK', failure: 'NO_PROVIDER'
  });
  assert.equal(noProvider.issuePlan.source, 'TAXONOMY_FALLBACK');
  assert.equal(noProvider.issuePlan.coverageEstablished, false);
  assert.equal(noProvider.issuePlan.hasUnmappedResidual, true);
  assert.equal(shouldUseAuthorityEvidenceRuntime({
    issuePlan: noProvider.issuePlan,
    classification: noProvider.classification,
    explicitIrasEvidenceRequest: false,
    hasImages: false
  }), true, `${sample.authority} known fallback scope remains reviewable with its incomplete state.`);
  const fallbackResult = await runWorkstreams([sample], {
    query: routeQuery,
    issuePlan: noProvider.issuePlan,
    localOnly: true
  });
  assert.equal(fallbackResult.calls.length, 0, 'The local fallback does not fetch external sources.');
  const fallbackPresentation = createAuthorityEvidencePresentation(fallbackResult);
  const fallbackResponse = renderAuthorityEvidenceResponseText(fallbackPresentation, false);
  assert.equal(fallbackPresentation.status, 'INSUFFICIENT');
  assert.ok(fallbackPresentation.gaps.length > 0);
  assert.match(fallbackResponse, /Evidence is incomplete/);
  assert.doesNotMatch(fallbackResponse, /\bjournal\b/i);
  if (sample.authority === 'ACRA') {
    assert.ok(issueEvidence.verifiedClaims.some(claim => {
      const record = issueEvidence.sources.find(source => source.id === claim.recordId);
      const completeSourceBlock = record?.sourceText.split(/\r?\n[\t ]*\r?\n+/)
        .map(block => block.trim()).includes(claim.quote.trim());
      return completeSourceBlock &&
        /All companies registered in Singapore must file an annual return with ACRA each year\./i.test(claim.quote) &&
        /This applies as long as your company is listed as [“"]?live[”"]? with us\./i.test(claim.quote);
    }), 'the complete operative company filing-rule paragraph remains sufficient, including its live-company qualification');
    const nonOperativeHtml = html(sample.title, [
      'ACRA provides reminder notifications to help you comply with annual return (AR) and annual declaration (AD) deadlines.',
      'Meet their annual filing deadlines.',
      'ACRA only sends notifications (pop-up alerts and emails) for annual returns and declarations.',
      'Find out whether companies must file annual returns.',
      'Do companies need to file annual returns?',
      'Companies must sign up for reminders to file annual returns.',
      'Companies must not file annual returns.',
      'Variable capital companies must file annual returns.'
    ].join(' '));
    const nonOperative = await runWorkstreams([sample], {
      query: sample.query,
      pageOverrides: { ACRA: nonOperativeHtml }
    });
    const nonOperativeIssue = nonOperative.workstreams.find(item => item.authority === 'ACRA').issues[0];
    assert.equal(nonOperativeIssue.evidenceStatus, 'INSUFFICIENT',
      'reminders, questions, navigation text, indirect objects, negation and VCC-only duties do not prove company filing requirements');
    assert.deepEqual(nonOperativeIssue.verifiedClaims, [],
      'non-operative and VCC-only passages produce no verified filing-rule quote');

    const passiveRule = await runWorkstreams([sample], {
      query: sample.query,
      pageOverrides: { ACRA: html(sample.title,
        'Annual returns must be filed by companies in Singapore. This is the annual return filing requirement.') }
    });
    const passiveIssue = passiveRule.workstreams.find(item => item.authority === 'ACRA').issues[0];
    assert.equal(passiveIssue.evidenceStatus, 'VERIFIED',
      'an operative passive filing rule is sufficient exact-quote support');
    assert.ok(passiveIssue.verifiedClaims.some(claim => /annual returns must be filed by companies/i.test(claim.quote)),
      'the passive-rule verification retains its exact source quote');
  }

  if (sample.authority === 'CPF' || sample.authority === 'MOM') {
    const introOnlyParagraph = sample.authority === 'CPF' ? cpfIntroOnlyParagraph : momIntroOnlyParagraph;
    const introOnly = await runWorkstreams([sample], {
      query: routeQuery,
      pageOverrides: { [sample.authority]: html(sample.title, introOnlyParagraph) }
    });
    const introOnlyIssue = introOnly.workstreams.find(item => item.authority === sample.authority).issues[0];
    assert.equal(introOnlyIssue.evidenceStatus, 'INSUFFICIENT',
      `${sample.authority} introductory rule text cannot support the requested definition or coverage answer.`);
    assert.deepEqual(introOnlyIssue.verifiedClaims, [],
      `${sample.authority} introductory text cannot publish a definition or eligibility quote.`);
    assert.equal(introOnlyIssue.sources.length, 0,
      `${sample.authority} introductory text fails the substantive source-body admission check.`);
  }

  const metadataOnlyHtml = `<html><head><title>${sample.title}</title></head><body><main>
    <h1>${sample.subject}</h1><nav><a href="/topic">${sample.subject}</a></nav>
    <div class="topic-card"><p><a href="/topic">${sample.subject} official guidance</a></p></div>
    <p>This page describes general public services and online information available from this Singapore authority.</p>
  </main></body></html>`;
  const metadataOnly = await runWorkstreams([sample], { query: routeQuery, pageOverrides: { [sample.authority]: metadataOnlyHtml } });
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
  const historical = await runWorkstreams([sample], { query: `${routeQuery} in 2023?` });
  const historicalEvidence = historical.workstreams.find(item => item.authority === sample.authority).issues[0];
  assert.notEqual(historicalEvidence.evidenceStatus, 'VERIFIED');
  assert.equal(historicalEvidence.sources.length, 0);
  assert.ok(historicalEvidence.retrievalTrace.attempts?.some(attempt => attempt.fetchStatus === 'HISTORICAL_SCOPE_UNVERIFIED'));
  assert.equal(historical.calls.includes(sample.url), false, 'A current page is not fetched for an unverified historical request.');
  const localOnly = await runWorkstreams([sample], { query: routeQuery, localOnly: true });
  assert.equal(localOnly.calls.length, 0, `${sample.authority} local-only mode must make zero requests.`);

  // Even with a real successful trace, authority, domain, and subject mismatches
  // fail admission. A live candidate without its exact fetch trace also fails.
  const successTrace = discoveryResults.get(sample.authority).trace;
  const successfulIssue = successfulRuns.get(sample.authority).workstreams
    .find(item => item.authority === sample.authority).issues[0];
  const candidateFromSuccess = successfulIssue.sources.find(record => successTrace.selectedRecordIds.includes(record.id)) ||
    successfulIssue.sources[0];
  if (sample.authority === 'CPF' || sample.authority === 'MOM') {
    const partialQuote = sample.authority === 'CPF'
      ? cpfCompleteDefinitionParagraph.split(' They are payable')[0]
      : momCompleteCoverageParagraph.split(' Non-workmen')[0];
    const partialQuoteOnly = await runWorkstreams([sample], {
      query: routeQuery,
      providers: { [sample.authority]: {
        authority: sample.authority,
        async retrieve() {
          return {
            candidates: [candidateFromSuccess],
            claims: [{ text: partialQuote, quote: partialQuote, recordId: candidateFromSuccess.id }],
            evidenceQualityTrace: successTrace
          };
        }
      } }
    });
    const partialIssue = partialQuoteOnly.workstreams.find(item => item.authority === sample.authority).issues[0];
    assert.equal(partialIssue.lifecycle.admitted, true,
      `${sample.authority} full source body can pass admission even when the supplied quote is partial.`);
    assert.deepEqual(partialIssue.verifiedClaims, [],
      `${sample.authority} a partial exact quote cannot bypass the per-quote substantive-support guard.`);
    assert.equal(partialIssue.evidenceStatus, 'INSUFFICIENT');
    assert.equal(partialIssue.lifecycle.covered, false);
  }
  const runInjectedCandidate = candidate => runWorkstreams([sample], {
    query: routeQuery,
    providers: { [sample.authority]: {
      authority: sample.authority,
      async retrieve() { return { candidates: [candidate], ...(successTrace ? { evidenceQualityTrace: successTrace } : {}) }; }
    } }
  });
  const missingTrace = await runWorkstreams([sample], {
    query: routeQuery,
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

// A validated PLUS_RULES interpretation may supplement mapped discovery. Missing
// semantic context keeps the registered-topic fallback but cannot add the new
// transient issue scope or attach it to the returned evidence.
const masGateSample = cases.find(sample => sample.authority === 'MAS');
const masGateQuery = masGateSample.runtimeQuery;
const masGateOracle = oracleUnderstandingFor([masGateSample]);
assert.ok(validateSemanticQuestionInterpretation(masGateOracle.interpretation, masGateQuery));
const masGateReconciliation = reconcileQuestionUnderstanding(masGateQuery, classifyQuestion(masGateQuery), masGateOracle);
assert.equal(masGateReconciliation.understanding.mode, 'SEMANTIC_PLUS_RULES');
const observeMasTargets = async questionUnderstanding => {
  const topicIds = [];
  await runWorkstreams([masGateSample], {
    query: masGateQuery,
    issuePlan: masGateReconciliation.issuePlan,
    questionUnderstanding,
    discoveryAdapter: {
      async discoverOfficialSourceCandidates(request) { topicIds.push(request.topicId); return []; },
      getLastFetchTrace() { return []; }
    },
    officialDomainSearchAdapter: {
      async searchOfficialDomainCandidates() { return []; },
      getLastSearchTrace() { return []; }
    }
  });
  return topicIds;
};
const semanticMasTargets = await observeMasTargets(masGateReconciliation.understanding);
const unvalidatedMasTargets = await observeMasTargets(undefined);
assert.ok(semanticMasTargets.includes('mas-cms-licence'), 'Validated supplementary discovery retains the existing mapped MAS pass.');
assert.ok(semanticMasTargets.some(topicId => topicId.startsWith('iras-authority-query-issue-mas-')),
  'A strict same-request SEMANTIC_PLUS_RULES child enables supplementary issue discovery.');
assert.ok(unvalidatedMasTargets.includes('mas-cms-licence'), 'Missing semantic context retains existing mapped source fallback.');
assert.equal(unvalidatedMasTargets.some(topicId => topicId.startsWith('iras-authority-query-issue-mas-')), false,
  'Missing semantic context cannot create or attach the transient issue target.');
// The captured salary/overtime comparison admits Paying salary under its
// validated transient topic and carries exact quotations into the workstream.
const capturedMomSample = capturedSeedSamples.find(sample => sample.authority === 'MOM');
const capturedMomUnderstanding = oracleUnderstandingFor([capturedMomSample]);
const capturedMomReconciliation = reconcileQuestionUnderstanding(capturedMomSample.query,
  classifyQuestion(capturedMomSample.query), capturedMomUnderstanding);
const capturedMomResult = await runWorkstreams([{
  key: 'captured-salary-overtime-comparison', authority: 'MOM', topicId: 'mom-salary-payment',
  query: capturedMomSample.query, runtimeQuery: capturedMomSample.query,
  subject: capturedMomSample.scope.context.primarySubject, domain: 'MOM_EMPLOYMENT', population: 'EMPLOYEE',
  url: capturedMomSample.url, title: capturedMomSample.title, pageHtml: capturedMomSample.pageHtml,
  sourcePublisher: 'Ministry of Manpower (MOM)'
}], {
  query: capturedMomSample.query, issuePlan: capturedMomReconciliation.issuePlan,
  questionUnderstanding: capturedMomReconciliation.understanding,
  pageOverrides: { MOM: capturedMomSample.pageHtml }
});
const capturedMomStream = capturedMomResult.workstreams.find(stream => stream.authority === 'MOM');
const capturedMomIssue = capturedMomStream?.issues.find(issue => issue.sources.some(record => record.canonicalSourceUrl === salaryPageUrl));
assert.ok(capturedMomResult.calls.includes(salaryPageUrl), 'The captured salary/overtime case fetches Paying salary.');
assert.ok(capturedMomIssue, 'The captured Paying salary candidate passes workstream source admission.');
const capturedMomAdmittedSource = capturedMomIssue.sources.find(record => record.canonicalSourceUrl === salaryPageUrl);
assert.equal(capturedMomAdmittedSource.provenance, 'LIVE_EXTERNAL');
const capturedMomOrdinaryDeadline = capturedMomIssue.verifiedClaims.find(claim =>
  /within 7 days after the end of the salary period/i.test(claim.quote));
const capturedMomOvertimeDeadline = capturedMomIssue.verifiedClaims.find(claim =>
  /for overtime work, within 14 days after the end of the salary period/i.test(claim.quote));
assert.ok(capturedMomOrdinaryDeadline && capturedMomOvertimeDeadline &&
  capturedMomAdmittedSource.sourceText.includes(capturedMomOrdinaryDeadline.quote) &&
  capturedMomAdmittedSource.sourceText.includes(capturedMomOvertimeDeadline.quote),
  'Exact ordinary-salary and overtime deadline quotes reach the workstream bound to the admitted Paying salary source.');
assert.equal(capturedMomIssue.evidenceStatus, 'INSUFFICIENT',
  'The admitted salary page does not by itself satisfy the separately registered mom_overtime topic.');

// New MOM salary explanations run through the same semantic reconciliation,
// official discovery, page fetch, source admission, exact-quote verification,
// and rendering path as the four established authority fixtures.
for (const sample of salaryPaymentSamples) {
  const routeQuery = sample.runtimeQuery;
  const classification = classifyQuestion(routeQuery);
  const oracle = oracleUnderstandingFor([sample]);
  assert.ok(validateSemanticQuestionInterpretation(oracle.interpretation, routeQuery));
  const reconciled = reconcileQuestionUnderstanding(routeQuery, classification, oracle);
  const mappedIssue = reconciled.issuePlan.issues.find(issue => issue.governingAuthorities.includes('MOM'));
  assert.ok(mappedIssue);
  assert.equal(mappedIssue.status, 'MAPPED');
  assert.ok(mappedIssue.mappedTopicIds.includes(sample.topicId));

  const result = await runWorkstreams([sample], {
    query: routeQuery,
    issuePlan: reconciled.issuePlan,
    ...(sample.key === 'regular-salary' ? { referenceDate: TargetDateResolver.CURRENT_SYSTEM_DATE } : {}),
    ...(sample.key === 'regular-salary'
      ? { pageOverrides: { [sample.url]: salaryPaymentHtmlWithHiddenQualification } }
      : {})
  });
  assert.ok(result.calls.includes(sample.url), `The current MOM article is fetched after official sitemap discovery; calls=${JSON.stringify(result.calls)}, trace=${JSON.stringify(result.workstreams.find(stream => stream.authority === 'MOM')?.issues[0]?.retrievalTrace)}`);
  assert.ok(result.workstreams.some(stream => stream.authority === 'MOM'));
  const workstream = result.workstreams.find(stream => stream.authority === 'MOM');
  const evidenceIssue = workstream.issues[0];
  assert.equal(evidenceIssue.evidenceStatus, 'VERIFIED',
    JSON.stringify({ issue: { subject: evidenceIssue.subject, gaps: evidenceIssue.gaps, diagnostics: evidenceIssue.admissionDiagnostics },
      concepts: getRequestedQuestionConcepts(routeQuery, oracle),
      claims: evidenceIssue.verifiedClaims.map(claim => claim.quote), sources: evidenceIssue.sources.map(source => source.sourceText) }, null, 2));
  assert.ok(evidenceIssue.verifiedClaims.some(claim => {
    const source = evidenceIssue.sources.find(record => record.id === claim.recordId);
    return source?.officialSourceUrl === sample.url && source.sourcePublisher === sample.sourcePublisher &&
      source.provenance === 'LIVE_EXTERNAL' && source.sourceText.includes(claim.quote);
  }), 'Every rule explanation has an exact verified quote bound to the fetched current MOM source.');
  if (sample.key === 'regular-salary') {
    const admittedSource = evidenceIssue.sources.find(record => record.canonicalSourceUrl === sample.url);
    const admittedContext = evidenceIssue.admittedDocumentContexts?.find(context => context.recordId === admittedSource?.id);
    assert.ok(admittedSource && admittedContext, JSON.stringify({
      source: admittedSource && { id: admittedSource.id, documentHash: admittedSource.documentHash,
        canonicalSourceUrl: admittedSource.canonicalSourceUrl, officialSourceUrl: admittedSource.officialSourceUrl },
      issueTargetDate: evidenceIssue.admittedDocumentTargetDate,
      contexts: (evidenceIssue.admittedDocumentContexts || []).map(context => ({
        recordId: context.recordId, documentHash: context.documentHash, canonicalUrl: context.canonicalUrl,
        targetDate: context.targetDate, completeness: context.completeness, sourceLength: context.sourceText.length
      }))
    }));
    assert.equal(admittedContext.documentHash, admittedSource.documentHash);
    assert.equal(admittedContext.canonicalUrl, admittedSource.canonicalSourceUrl);
    assert.equal(admittedContext.targetDate, TargetDateResolver.CURRENT_SYSTEM_DATE);
    assert.equal(admittedContext.completeness, 'COMPLETE');
    assert.ok(admittedContext.sourceText.includes('Paying salary'), 'The complete context preserves the page heading.');
    assert.ok(admittedContext.sourceText.includes('Additional qualification outside selected excerpt'));
    assert.ok(admittedContext.sourceText.includes('There are exceptions for overtime, resignation without notice and other situations.'));
    assert.equal(admittedSource.sourceText.includes('Additional qualification outside selected excerpt'), false,
      'The complete context preserves qualification text without widening the existing positive source excerpt.');

    const rejectedPage = html(sample.title,
      'General navigation for employers and business services. This page contains no salary-payment rule or timing information.');
    const rejected = await runWorkstreams([sample], {
      query: routeQuery,
      issuePlan: reconciled.issuePlan,
      referenceDate: TargetDateResolver.CURRENT_SYSTEM_DATE,
      pageOverrides: { [sample.url]: rejectedPage }
    });
    const rejectedIssue = rejected.workstreams.find(stream => stream.authority === 'MOM')?.issues[0];
    assert.equal(rejectedIssue?.sources.some(record => record.canonicalSourceUrl === sample.url), false,
      'A rejected fetched source does not enter issue-scoped admitted records.');
    assert.equal(rejectedIssue?.admittedDocumentContexts?.length || 0, 0,
      'A rejected source context does not propagate to the workstream.');
  }

  if (sample.key === 'overtime-salary') {
    assert.ok(evidenceIssue.verifiedClaims.some(claim => claim.quote.includes('Salary must be paid:') &&
      /Within 7 days after the end of the salary period/i.test(claim.quote) &&
      /For overtime work, within 14 days after the end of the salary period/i.test(claim.quote)),
      'The 14-day deadline is verified as part of its complete contiguous salary-payment list.');
  }

  const presentation = createAuthorityEvidencePresentation(result);
  const presentedStream = presentation.workstreams.find(stream => stream.authority === 'MOM');
  const presentedIssue = presentedStream.issues[0];
  const presentedSource = presentedStream.sources.find(source => source.officialUrl === sample.url);
  assert.ok(presentedSource);
  const sourceRecord = evidenceIssue.sources.find(source => source.officialSourceUrl === sample.url);
  assert.ok(sourceRecord);
  const fetchedClaim = presentedSource.claims.find(claim => claim.supportKind === 'EXACT_SOURCE_QUOTE');
  assert.ok(fetchedClaim?.fetchedSourceBinding,
    'A real verified LIVE_EXTERNAL quote receives a separate fetched-source binding.');
  const expectedSourceHash = sourceRecord.documentHash || sourceRecord.contentHash;
  assert.match(expectedSourceHash, /^[a-f0-9]{64}$/i);
  assert.deepEqual(fetchedClaim.fetchedSourceBinding, {
    recordId: sourceRecord.id,
    documentHash: expectedSourceHash.toLowerCase(),
    canonicalUrl: sourceRecord.canonicalSourceUrl,
    retrievedAt: sourceRecord.retrievedAt
  }, 'The fetched binding carries the actual admitted record identity, hash, canonical URL and retrieval revision.');
  assert.ok(groupExactIssueClaimsByDocument(presentedSource, presentedIssue.id).length > 0,
    'Pipeline-created exact claims group by their actual fetched source revision.');
  const rendered = renderAuthorityEvidenceResponseText(presentation, false);
  assert.match(rendered, sample.expectedExplanation);
  if (sample.key === 'regular-salary') {
    const caveatOnlyPage = `<html><head><title>${sample.title}</title></head><body><main>
      <h1>Paying salary</h1><p>${sample.paragraph}</p>
      <p>Your final salary payment could vary depending on the reason employment ends.</p>
    </main></body></html>`;
    const caveatOnlyResult = await runWorkstreams([sample], {
      query: routeQuery,
      issuePlan: reconciled.issuePlan,
      pageOverrides: { [sample.url]: caveatOnlyPage }
    });
    const caveatOnlyIssue = caveatOnlyResult.workstreams.find(stream => stream.authority === 'MOM').issues[0];
    assert.notEqual(caveatOnlyIssue.evidenceStatus, 'VERIFIED',
      'Monthly pay and a final-salary caveat do not establish the ordinary salary due date.');
    assert.deepEqual(caveatOnlyIssue.verifiedClaims, [],
      'The final-salary caveat cannot become a verified claim for the regular salary timing issue.');
    assert.doesNotMatch(renderAuthorityEvidenceResponseText(createAuthorityEvidencePresentation(caveatOnlyResult), false),
      /MOM rule explanation:/, 'A caveat-only salary page cannot render a regular-salary rule explanation.');

    const equivalentLabel = structuredClone(presentation);
    equivalentLabel.workstreams.find(stream => stream.authority === 'MOM').issues[0].subject =
      'salary payment frequency and due dates';
    assert.match(renderAuthorityEvidenceResponseText(equivalentLabel, false), sample.expectedExplanation,
      'A validated regular-salary query can explain the same verified rule under the equivalent semantic issue label.');
  }
  if (sample.key === 'overtime-salary') {
    assert.ok(getMomSalaryPaymentRuleEvidence(routeQuery, presentedStream, presentedIssue),
      'Overtime salary explanation still passes with grouped claims from the actual fetched source revision.');
    const splitClaimBinding = (changeOvertimeBinding) => {
      const mutated = structuredClone(presentation);
      const source = mutated.workstreams.find(stream => stream.authority === 'MOM').sources.find(item => item.officialUrl === sample.url);
      const monthlyClaim = source.claims.find(claim => /(?:if you are covered by|in accordance with) the employment act/i.test(claim.text) &&
        /at least once a month/i.test(claim.text) && !/for overtime work.{0,100}within 14 days/i.test(claim.text));
      const overtimeClaim = source.claims.find(claim => /for overtime work.{0,100}within 14 days after the end of the salary period/i.test(claim.text) &&
        !/(?:if you are covered by|in accordance with) the employment act/i.test(claim.text));
      assert.ok(monthlyClaim && overtimeClaim, 'The live pipeline keeps the monthly premise and overtime deadline as separate exact claims.');
      changeOvertimeBinding(overtimeClaim.fetchedSourceBinding);
      const stream = mutated.workstreams.find(item => item.authority === 'MOM');
      return getMomSalaryPaymentRuleEvidence(routeQuery, stream, stream.issues[0]);
    };
    assert.equal(splitClaimBinding(binding => { binding.documentHash = 'a'.repeat(64); }), undefined,
      'Same-URL claims fetched with different hashes cannot combine their rule premises.');
    assert.equal(splitClaimBinding(binding => { binding.recordId = 'different-live-record'; }), undefined,
      'Claims from different live records cannot combine their rule premises.');
    assert.equal(splitClaimBinding(binding => { binding.canonicalUrl = 'https://www.mom.gov.sg/employment-practices/salary/other'; }), undefined,
      'Claims with a mismatched canonical URL cannot combine their rule premises.');
    assert.equal(splitClaimBinding(binding => { binding.documentHash = undefined; }), undefined,
      'A claim without a valid fetched-source hash cannot complete the rule proof.');
    const noBinding = structuredClone(presentation);
    const noBindingStream = noBinding.workstreams.find(stream => stream.authority === 'MOM');
    noBindingStream.sources.find(item => item.officialUrl === sample.url).claims.forEach(claim => { delete claim.fetchedSourceBinding; });
    assert.equal(getMomSalaryPaymentRuleEvidence(routeQuery, noBindingStream, noBindingStream.issues[0]), undefined,
      'Exact live quotes with no formal or fetched binding cannot be combined.');
  }
  assert.match(rendered, /full request coverage unconfirmed|resolved material issues have verified evidence|Source coverage is verified|Evidence is incomplete for one or more material issues/i,
    'The explanatory answer retains the existing qualified completeness status.');

  const mustSuppress = (mutate, query = routeQuery) => {
    const candidate = structuredClone(presentation);
    candidate.query = query;
    mutate(candidate.workstreams.find(stream => stream.authority === 'MOM'));
    assert.doesNotMatch(renderAuthorityEvidenceResponseText(candidate, false), /MOM rule explanation:/,
      'Rule explanations require complete, current, issue-bound MOM evidence.');
  };
  mustSuppress(stream => { stream.authority = 'CPF'; });
  mustSuppress(stream => { stream.domain = 'CPF_PAYROLL'; });
  mustSuppress(stream => { stream.applicationStatus = 'UNRESOLVED'; });
  mustSuppress(stream => { stream.issues[0].applicationStatus = 'UNRESOLVED'; });
  mustSuppress(stream => { stream.issues[0].operation = 'CALCULATE'; });
  mustSuppress(stream => { stream.issues.push({ ...stream.issues[0], id: `${stream.issues[0].id}-other` }); });
  const selectedSource = stream => stream.sources.find(source => source.officialUrl === sample.url);
  mustSuppress(stream => { selectedSource(stream).officialUrl = 'https://www.cpf.gov.sg/member/'; });
  mustSuppress(stream => { selectedSource(stream).validTo = '2024-12-31'; });
  mustSuppress(stream => { selectedSource(stream).provenance = 'LOCAL_CURATED'; });
  const mutateIssueClaims = (stream, mutate) => {
    const source = selectedSource(stream);
    const issueId = stream.issues[0].id;
    const claims = source.claims.filter(claim => claim.issueIds.includes(issueId));
    assert.ok(claims.length > 0, 'The source retains exact claims bound to the current salary issue.');
    for (const claim of claims) mutate(claim);
  };
  mustSuppress(stream => mutateIssueClaims(stream, claim => { claim.provenance = 'LOCAL_CURATED'; }));
  mustSuppress(stream => mutateIssueClaims(stream, claim => { claim.issueIds = ['another-issue']; }));
  mustSuppress(stream => {
    mutateIssueClaims(stream, claim => { claim.text = 'Salary must be paid within 7 days after the salary period ends.'; });
  });
  mustSuppress(stream => {
    const source = selectedSource(stream);
    const monthlyClaims = source.claims.filter(claim => claim.issueIds.includes(stream.issues[0].id) &&
      /(?:if you are covered by|in accordance with) the employment act/i.test(claim.text));
    assert.ok(monthlyClaims.length > 0);
    for (const monthlyClaim of monthlyClaims) {
      monthlyClaim.text = monthlyClaim.text.replace(/employer must pay/i, 'employer must not pay');
    }
  });
  if (sample.key === 'overtime-salary') {
    mustSuppress(stream => {
      const source = selectedSource(stream);
      const deadlineClaim = source.claims.find(claim => /for overtime work, within 14 days/i.test(claim.text));
      deadlineClaim.text = deadlineClaim.text.replace('within 14 days', 'within 7 days');
    });
    mustSuppress(stream => {
      const source = selectedSource(stream);
      const deadlineClaim = source.claims.find(claim => /for overtime work, within 14 days/i.test(claim.text));
      deadlineClaim.text += ' For overtime work, payment must not be made within 14 days after the end of the salary period.';
    });
    mustSuppress(stream => {
      const source = selectedSource(stream);
      const deadlineClaim = source.claims.find(claim => /for overtime work, within 14 days/i.test(claim.text));
      deadlineClaim.text = `Salary must not be paid:\n${deadlineClaim.text}`;
    });
  } else {
    mustSuppress(stream => {
      const source = selectedSource(stream);
      const deadlineClaims = source.claims.filter(claim => claim.issueIds.includes(stream.issues[0].id) &&
        /within 7 days after the end of the salary period/i.test(claim.text) && !/for overtime work/i.test(claim.text));
      assert.ok(deadlineClaims.length > 0);
      for (const deadlineClaim of deadlineClaims) deadlineClaim.text = `Salary must not be paid:\n${deadlineClaim.text}`;
    });
  }
  mustSuppress(stream => { stream.issues[0].subject = 'final salary payment deadline'; });
  mustSuppress(stream => { stream.issues[0].subject = sample.key === 'regular-salary'
    ? 'overtime salary payment deadline' : 'regular salary payment deadline'; });
  mustSuppress(() => {}, `${routeQuery} in 2023`);
  mustSuppress(() => {}, `${routeQuery} when is my final salary due?`);
  if (sample.key === 'regular-salary') {
    const unqualifiedAlias = structuredClone(presentation);
    unqualifiedAlias.query = routeQuery.replace('regular salary', 'salary');
    unqualifiedAlias.workstreams.find(stream => stream.authority === 'MOM').issues[0].subject =
      'salary payment frequency and due dates';
    assert.doesNotMatch(renderAuthorityEvidenceResponseText(unqualifiedAlias, false), /MOM rule explanation:/,
      'The equivalent issue label alone does not turn a generic salary query into a regular-salary explanation.');
  }
  mustSuppress(() => {}, sample.key === 'regular-salary'
    ? `${routeQuery} and when is overtime pay due after the salary period?`
    : `${routeQuery} and how often is regular salary paid and when is it due?`);

  const sourceText = sample.pageHtml;
  const mutatedPages = sample.key === 'regular-salary' ? [
    { key: 'negated-monthly-duty', html: sourceText.replace('must pay your salary at least once a month', 'must not pay your salary at least once a month') },
    { key: 'wrong-regular-deadline', html: sourceText.replaceAll('within 7 days after the end of the salary period', 'within 14 days after the end of the salary period') },
    { key: 'overtime-owned-regular-deadline', html: sourceText.replaceAll('within 7 days after the end of the salary period.', 'within 14 days after the end of the salary period.')
      .replace('<li>Within 7 days after the end of the salary period.</li>',
        '<li>For overtime work, within 7 days after the end of the salary period.</li>') },
    { key: 'contradictory-monthly-premise', html: sourceText.replace('</main>', '<p>In accordance with the Employment Act, your employer must not pay your salary at least once a month.</p></main>') },
    { key: 'negated-regular-deadline', html: sourceText.replace('</main>', '<p>Regular salary must not be paid within 7 days after the end of the salary period.</p></main>') }
  ] : [
    { key: 'wrong-overtime-deadline', html: sourceText.replace('For overtime work, within 14 days', 'For overtime work, within 7 days') },
    { key: 'contradictory-overtime-deadline', html: sourceText.replace('</main>', '<p>For overtime work, payment must not be made within 14 days after the end of the salary period.</p></main>') }
  ];
  for (const [mutationIndex, mutation] of mutatedPages.entries()) {
    const invalid = await runWorkstreams([sample], {
      query: routeQuery, issuePlan: reconciled.issuePlan, pageOverrides: { [sample.url]: mutation.html }
    });
    const fetchedBody = invalid.fetchedPages.get(sample.url);
    assert.equal(fetchedBody, mutation.html, 'The invalid page body is the one returned to the controlled fetcher.');
    const invalidPresentation = createAuthorityEvidencePresentation(invalid);
    const invalidIssue = invalid.workstreams.find(stream => stream.authority === 'MOM')?.issues[0];
    const diagnostic = {
      mutationIndex,
      mutationKey: mutation.key,
      fetchedBodyLead: fetchedBody?.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 480),
      admittedSourceText: invalidIssue?.sources.find(source => source.officialSourceUrl === sample.url)?.sourceText,
      verifiedQuoteText: invalidIssue?.verifiedClaims.map(claim => claim.quote)
    };
    assert.doesNotMatch(renderAuthorityEvidenceResponseText(invalidPresentation, false), /MOM rule explanation:/,
      `MOM_RAW_PAGE_NEGATIVE_DIAGNOSTIC ${JSON.stringify(diagnostic)}`);
  }
}

const naturalWagesDeadlineQuery = 'For someone covered by the Employment Act, can the company pay normal monthly wages two weeks after the pay period closes?';
const naturalWagesDeadlineSubject = 'Employment Act regular salary frequency and payment deadline';
const retainedPayingSalaryPage = STATUTORY_COVERAGE_OFFICIAL_PAGE_FIXTURES.find(page => page.id === 'mom-salary');
assert.ok(retainedPayingSalaryPage, 'The retained native MOM Paying Salary page is available for the full retrieval-path regression.');
const naturalWagesSample = {
  ...salaryPaymentSamples[0], subject: naturalWagesDeadlineSubject, population: 'EMPLOYEE'
};
const naturalWagesIssue = { ...makeIssue(naturalWagesSample), id: 'natural-wages-deadline-issue' };
const longSalaryPageHtml = retainedPayingSalaryPage.html.replace('</main>',
  `<p>${Array.from({ length: 260 }, (_, index) => `Supplementary employment information item ${index + 1}.`).join(' ')}</p></main>`);
assert.ok(longSalaryPageHtml.length > 5_000, 'The source excerpt regression exercises the bounded long-page selection path.');
const naturalWagesResult = await runWorkstreams([naturalWagesSample], {
  query: naturalWagesDeadlineQuery,
  issuePlan: makeIssuePlan([naturalWagesIssue]),
  pageOverrides: { [salaryPageUrl]: longSalaryPageHtml }
});
const naturalWagesStream = naturalWagesResult.workstreams.find(stream => stream.authority === 'MOM');
const naturalWagesIssueEvidence = naturalWagesStream?.issues[0];
assert.equal(naturalWagesIssueEvidence?.evidenceStatus, 'VERIFIED', JSON.stringify({
  issue: naturalWagesIssueEvidence,
  trace: naturalWagesIssueEvidence?.retrievalTrace
}));
const naturalWagesSource = naturalWagesIssueEvidence.sources.find(source => source.officialSourceUrl === salaryPageUrl);
assert.ok(naturalWagesSource, 'The natural wages answer remains bound to the fetched MOM Paying Salary page.');
const naturalWagesClaim = naturalWagesIssueEvidence.verifiedClaims.find(claim =>
  /If you are covered by the Employment Act[\s\S]*?at least once a month/i.test(claim.quote) &&
  /Salary must be paid:[\s\S]*?Within 7 days after the end of the salary period/i.test(claim.quote));
assert.ok(naturalWagesClaim, 'The same verified quote contains the Employment Act monthly rule and ordinary seven-day deadline.');
assert.ok(naturalWagesSource.sourceText.includes(naturalWagesClaim.quote),
  'The combined salary-timing quote remains a literal substring of its fetched source record.');
const naturalWagesPresentation = createAuthorityEvidencePresentation(naturalWagesResult);
const naturalWagesAnswer = renderAuthorityEvidenceResponseText(naturalWagesPresentation, false);
assert.match(naturalWagesAnswer,
  /regular salary must be paid at least once a month and within 7 days after the salary period ends/i,
'The natural wages paraphrase receives the verified general rule through the production workstream path.');
assert.doesNotMatch(naturalWagesAnswer, /two weeks is (?:allowed|permitted|acceptable)/i,
  'The proposed two-week interval is not rendered as an accepted statutory deadline.');

// Mixed non-IRAS questions retain separate source ownership. A gap in one
// authority keeps the whole question insufficient without borrowing the other source.
const acraSample = cases.find(sample => sample.authority === 'ACRA');
const momSample = cases.find(sample => sample.authority === 'MOM');
// The raw user query must reach substantive-support recognition even when
// semantic interpretation leaves only a short issue subject.
const shortMomIssue = { ...makeIssue(momSample), subject: 'Part IV' };
const shortSubjectComplete = await runWorkstreams([momSample], {
  query: momSample.runtimeQuery,
  issuePlan: makeIssuePlan([shortMomIssue])
});
assert.equal(shortSubjectComplete.workstreams.find(item => item.authority === 'MOM').issues[0].evidenceStatus, 'VERIFIED',
  'The complete MOM employee-coverage source supports a short subject when the raw query carries the full ask.');
const shortSubjectIntroOnly = await runWorkstreams([momSample], {
  query: momSample.runtimeQuery,
  issuePlan: makeIssuePlan([shortMomIssue]),
  pageOverrides: { MOM: html(momSample.title, momIntroOnlyParagraph) }
});
assert.equal(shortSubjectIntroOnly.workstreams.find(item => item.authority === 'MOM').issues[0].evidenceStatus, 'INSUFFICIENT',
  'A short subject cannot conceal the raw query’s full coverage ask from the substantive-support guard.');
assert.deepEqual(shortSubjectIntroOnly.workstreams.find(item => item.authority === 'MOM').issues[0].verifiedClaims, []);

const mixedQuery = 'What annual return filing requirements apply to Singapore companies, and what are Part IV overtime eligibility requirements?';
const mixedClassification = classifyQuestion(mixedQuery);
const mixedUnderstanding = oracleUnderstandingFor([acraSample, momSample]);
assert.ok(validateSemanticQuestionInterpretation(mixedUnderstanding.interpretation, mixedQuery),
  'The mixed ACRA/MOM oracle interpretation satisfies the semantic contract.');
const mixedReconciliation = reconcileQuestionUnderstanding(mixedQuery, mixedClassification, mixedUnderstanding);
for (const sample of [acraSample, momSample]) {
  const issue = mixedReconciliation.issuePlan.issues.find(item => item.governingAuthorities.includes(sample.authority));
  assert.ok(issue, `${sample.authority} issue survives mixed-authority reconciliation.`);
  assert.equal(issue.status, 'MAPPED');
  assert.ok(issue.mappedTopicIds.includes(sample.topicId));
}
assert.equal(shouldUseAuthorityEvidenceRuntime({
  issuePlan: mixedReconciliation.issuePlan,
  classification: mixedReconciliation.classification,
  explicitIrasEvidenceRequest: false,
  hasImages: false
}), true, 'The reconciled mixed-authority question selects the shared runtime.');
const mixed = await runWorkstreams([acraSample, momSample], {
  query: mixedQuery,
  issuePlan: mixedReconciliation.issuePlan,
  pageOverrides: { MOM: html(momSample.title, momIntroOnlyParagraph) }
});
const mixedAcra = mixed.workstreams.find(item => item.authority === 'ACRA');
const mixedMom = mixed.workstreams.find(item => item.authority === 'MOM');
assert.equal(mixedAcra.issues[0].evidenceStatus, 'VERIFIED');
assert.ok(mixedAcra.issues[0].sources.every(record => record.authority === 'ACRA' && record.sourceAuthority === 'ACRA'));
assert.notEqual(mixedMom.issues[0].evidenceStatus, 'VERIFIED');
assert.equal(mixedMom.issues[0].sources.length, 0);
assert.ok(mixed.gaps.some(gap => gap.issueId === mixedMom.issues[0].issueId && gap.authority === 'MOM'));
assert.equal(mixed.status, 'INSUFFICIENT', 'One uncovered authority issue keeps the whole question from being verified.');
const mixedPresentation = createAuthorityEvidencePresentation(mixed);
const mixedResponse = renderAuthorityEvidenceResponseText(mixedPresentation, false);
assert.equal(mixedPresentation.status, 'INSUFFICIENT');
assert.ok(mixedPresentation.workstreams.some(stream => stream.authority === 'ACRA' && stream.evidenceStatus === 'VERIFIED'));
const presentedMom = mixedPresentation.workstreams.find(stream => stream.authority === 'MOM');
assert.ok(presentedMom && presentedMom.evidenceStatus === 'INSUFFICIENT');
assert.ok(presentedMom.issues.some(issue => issue.subject.includes('Part IV overtime eligibility')),
  'The uncovered MOM issue remains present in the shared projection.');
assert.match(mixedResponse, /Whole-question status:\*\* Evidence is incomplete/);
assert.ok(mixedResponse.includes(acraSample.url), 'The supported authority retains its own official link.');
assert.ok(mixedResponse.includes('Part IV overtime eligibility'), 'The uncovered MOM issue remains visible in the rendered response.');
assert.doesNotMatch(mixedResponse, /\bjournal\b/i);

assert.deepEqual(metadataOnlyAdmissionFailures, [],
  `Metadata-only fetched pages must be rejected at workstream admission: ${JSON.stringify(metadataOnlyAdmissionFailures)}`);
// Replay the first incorrect result in the live payroll-steps capture: the
// current fetch validated Paying salary, but a second lexical gate demanded
// that the source repeat the user's workflow label verbatim.
const payrollStepsReplay = JSON.parse(await readFile(new URL('../fixtures/statutory-answer-payroll-steps-20261113.json', import.meta.url), 'utf8'));
async function replayPayrollStepAdmission(mutate = () => {}, replay = payrollStepsReplay) {
  const retained = structuredClone(replay);
  mutate(retained);
  const result = await buildAuthorityWorkstreams(retained.query, retained.issuePlan, {
    referenceDate: retained.referenceDate,
    questionUnderstanding: retained.understanding,
    providers: { [retained.record.authority]: { authority: retained.record.authority, async retrieve(request) {
      if (request.issue.id !== retained.targetIssueId) return { candidates: [] };
      return { candidates: [retained.record], evidenceQualityTrace: retained.trace,
        documentContexts: [retained.documentContext] };
    } } }
  });
  return result.workstreams.flatMap(stream => stream.issues).find(issue => issue.issueId === retained.targetIssueId);
}
const payrollStepsAdmitted = await replayPayrollStepAdmission();
assert.ok(payrollStepsAdmitted.admittedDocumentSources.some(record => record.id === payrollStepsReplay.record.id),
  'A same-topic current official fetch retains the substantive payroll document even when it does not repeat practical payroll steps.');
assert.ok(payrollStepsAdmitted.admittedDocumentContexts.some(context => context.sourceText === payrollStepsReplay.documentContext.sourceText),
  'The complete same-fetch document and its qualifications stay attached to the issue.');
assert.equal(payrollStepsAdmitted.admittedDocumentSources[0].lifecycleState, 'CANDIDATE', 'Admission does not activate a source.');
assert.notEqual(payrollStepsAdmitted.evidenceStatus, 'VERIFIED', 'Document admission alone does not establish requested-issue completeness.');
for (const mutate of [
  retained => { retained.trace.attempts[0].contentMatched = false; },
  retained => { retained.trace.attempts[0].topicId = 'unrelated-transient-topic'; },
  retained => { retained.trace.selectedRecordIds = []; },
  retained => { retained.record.sourceAuthority = 'CPF'; },
  retained => { retained.record.domain = 'CPF_BOARD'; }
]) {
  const rejected = await replayPayrollStepAdmission(mutate);
  assert.deepEqual(rejected.admittedDocumentSources || [], [],
    'The relevance correction cannot bypass current-fetch, topic, authority or domain admission.');
}
const cpfFactCollectionReplay = JSON.parse(await readFile(new URL('../fixtures/statutory-answer-cpf-facts-20261113.json', import.meta.url), 'utf8'));
const cpfFactCollectionPlan = reconcileQuestionUnderstanding(cpfFactCollectionReplay.query,
  classifyQuestion(cpfFactCollectionReplay.query), cpfFactCollectionReplay.understanding).issuePlan;
assert.ok(!cpfFactCollectionPlan.issues.some(issue => issue.mappedTopicIds.includes('cpf-contribution-due-dates')),
  'Asking which pay details to collect does not request a CPF payment deadline.');
for (const timingQuestion of ['What is the CPF payment deadline?', 'When to pay CPF contributions?',
  'By which date must employers pay monthly CPF?', 'CPF contributions: what is the last day to pay?']) {
  const timingPlan = reconcileQuestionUnderstanding(timingQuestion, classifyQuestion(timingQuestion),
    { mode: 'DETERMINISTIC_FALLBACK', failure: 'NO_PROVIDER' }).issuePlan;
  assert.ok(timingPlan.issues.some(issue => issue.mappedTopicIds.includes('cpf-contribution-due-dates')),
    'An actual payment-timing request retains its deadline evidence route.');
}
const cpfFactCollectionAdmitted = await replayPayrollStepAdmission(() => {}, cpfFactCollectionReplay);
assert.ok(cpfFactCollectionAdmitted.admittedDocumentSources.some(record => record.id === cpfFactCollectionReplay.record.id),
  'The fact-collection issue independently admits its own current CPF employer-obligations document rather than borrowing a responsibility-issue citation.');
assert.ok(cpfFactCollectionAdmitted.admittedDocumentContexts.some(context => /age, and total wages/.test(context.sourceText)),
  'The own-issue source retains the substantive factors needed for a payroll checklist.');
const cpfSiblingFetchFirst = await replayPayrollStepAdmission(retained => {
  const exactAttempt = retained.trace.attempts.find(attempt => attempt.topicId.startsWith('iras-authority-query-issue-cpf-'));
  retained.trace.attempts.unshift({ ...exactAttempt, topicId: 'cpf_contribution_rates' });
}, cpfFactCollectionReplay);
assert.ok(cpfSiblingFetchFirst.admittedDocumentSources.some(record => record.id === cpfFactCollectionReplay.record.id),
  'A prior successful sibling-topic fetch for the same URL cannot hide the exact transient-topic validation.');
console.log('ACRA/CPF/MOM/MAS official discovery, workstream provenance, exact quotes and negative evidence guards: passed.');
