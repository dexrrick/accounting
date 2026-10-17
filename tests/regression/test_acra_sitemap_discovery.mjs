import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { ControlledWebRetriever } from '../../src/retrieval/controlledWebRetriever.ts';
import { SourceCache } from '../../src/retrieval/sourceCache.ts';
import { OfficialSitemapDiscoveryAdapter, OFFICIAL_SOURCE_DISCOVERY_PROVIDERS } from '../../src/retrieval/officialSitemapDiscovery.ts';
import { defaultSourceRetriever } from '../../src/retrieval/sourceRetriever.ts';
import { resolveMappedOfficialSourceFallback, selectRelevantFetchedText } from '../../src/services/groundingContextBuilder.ts';
import { buildAuthorityWorkstreams } from '../../src/services/authorityWorkstreams.ts';
import { defaultExternalSourceValidator } from '../../src/retrieval/externalSourceValidator.ts';
import {
  getAcraAnnualReturnDeadlineTablePassage,
  supportsAcraAnnualReturnDeadlineEvidence,
  supportsAcraAnnualReturnDeadlineTable
} from '../../src/retrieval/acraAnnualReturnFilingRule.ts';

// Captured article text/markup, omitting presentation attributes while retaining
// semantic roles and aria labels. SHA256 identifies each full original capture.
const pages = JSON.parse(await readFile(new URL('../fixtures/acra-company-guidance-2026-10-10.json', import.meta.url), 'utf8'));
const deadlineCaptureProvenance = JSON.parse(await readFile(
  new URL('../fixtures/acra-annual-return-deadline-2026-10-17.provenance.json', import.meta.url), 'utf8'
));
const deadlineCaptureBytes = gunzipSync(await readFile(
  new URL('../fixtures/acra-annual-return-deadline-2026-10-17.html.gz', import.meta.url)
));
assert.equal(deadlineCaptureBytes.length, deadlineCaptureProvenance.upstreamBytes,
  'The test-only retained evidence matches its captured upstream byte length.');
assert.equal(createHash('sha256').update(deadlineCaptureBytes).digest('hex'), deadlineCaptureProvenance.upstreamSha256,
  'The test-only retained evidence matches its captured upstream SHA-256.');
assert.equal(deadlineCaptureProvenance.kind, 'SAVED_OFFICIAL_SOURCE_TRANSPORT_CAPTURE');
assert.equal(deadlineCaptureProvenance.httpStatus, 200);
assert.equal(deadlineCaptureProvenance.contentType, 'text/html');
assert.equal(deadlineCaptureProvenance.officialUrl,
  'https://www.acra.gov.sg/manage/companies/legal-requirements-common-offences/filing-annual-returns-companies/deadline-requirements/');
const capturedDeadlineHtml = deadlineCaptureBytes.toString('utf8');
const bannerExpectation = { standardIdentifiers: ['Accounting and Corporate Regulatory Authority'],
  expectedTitles: ['annual returns'], topicTerms: ['annual return'] };
assert.equal(defaultExternalSourceValidator.validateTopicContent(pages.find(page => page.name === 'annual').html, bannerExpectation).isValid, true,
  'The main article is selected before an unrelated banner article that appears earlier in the document.');
const navigationOnly = `<html><head><title>Annual returns | Accounting and Corporate Regulatory Authority</title></head><body><main>
  <div aria-label="Breadcrumb" role="navigation"><p>All Singapore companies must submit an annual return each year and provide the required financial statements to the Accounting and Corporate Regulatory Authority.</p></div>
</main></body></html>`;
assert.equal(defaultExternalSourceValidator.validateTopicContent(navigationOnly, bannerExpectation).isValid, true,
  'The generic validator retains existing behavior for page content without an ACRA-specific extraction option.');
assert.equal(defaultExternalSourceValidator.validateTopicContent(navigationOnly,
  { ...bannerExpectation, preferMainContent: true }).isValid, false,
  'ACRA-specific extraction removes Isomer breadcrumb/navigation markup before checking the main body.');

// Minimized from D:/Accounting/artifacts/canonical-acceptance-2026-10-17/captures/acra-index-gap-38f97e8/upstream.bin
// (SHA-256 0ef964686101c8ac10cdf80b6e9a46b18d76c72a1e945a0957e5d2ddbba41325): the captured main has an h1,
// a hero paragraph identical to its page description, then a grid of linked heading/summary cards.
const indexDescription = 'Check AR compliance requirements for local companies. This includes deadlines and extensions, penalties, and steps to file annual returns.';
const capturedIndexHtml = `<html><head>
  <title>Filing annual returns (ARs) for companies | Accounting and Corporate Regulatory Authority</title>
  <meta name="description" content="${indexDescription}">
  <meta property="og:description" content="${indexDescription}">
</head><body><main id="main-content">
  <div><h1>Filing annual returns (ARs) for companies</h1><div><p class="prose-title-lg-regular mt-5">${indexDescription}</p></div></div>
  <div class="grid grid-cols-1 md:grid-cols-2">
    <a href="/deadline-requirements/"><div><h2>Deadline &amp; requirements for annual returns</h2><p>All companies in Singapore must file annual returns with ACRA on time.</p></div></a>
    <a href="/steps-to-file/"><div><h2>Steps to file an annual return</h2><p>Learn how to file your company's annual return through Bizfile.</p></div></a>
    <a href="/applying-for-an-extension-of-time/"><div><h2>Applying for an extension of time</h2><p>Apply for an extension to file an annual return.</p></div></a>
    <a href="/penalties-enforcement/"><div><h2>Penalties &amp; enforcement action</h2><p>Companies may face fines for late annual returns.</p></div></a>
    <a href="/filing-reminders/"><div><h2>Filing reminders and notifications</h2><p>ACRA provides annual return deadline reminders.</p></div></a>
  </div>
</main></body></html>`;
const indexValidation = defaultExternalSourceValidator.validateTopicContent(capturedIndexHtml, {
  ...bannerExpectation,
  expectedTitles: ['filing annual returns'],
  topicTerms: ['annual returns'],
  preferMainContent: true,
  requireSubstantiveBody: true
});
assert.equal(indexValidation.isValid, false,
  'A page-description hero followed by a navigational card collection is not annual-return rule evidence.');
assert.equal(indexValidation.substantiveText?.includes(indexDescription), false,
  'The duplicated hero summary and block-wrapped card summaries are excluded from substantive evidence.');

const repeatedDescriptionRule = 'All Singapore companies must file an annual return with ACRA each year, even when dormant, and submit annual returns by the applicable deadline.';
const standaloneRuleValidation = defaultExternalSourceValidator.validateTopicContent(`<html><head>
  <title>Annual returns | Accounting and Corporate Regulatory Authority</title>
  <meta name="description" content="${repeatedDescriptionRule}">
</head><body><main><h1>Annual returns</h1><p>${repeatedDescriptionRule}</p></main></body></html>`, {
  ...bannerExpectation,
  requireSubstantiveBody: true
});
assert.equal(standaloneRuleValidation.isValid, true,
  'A genuine rule paragraph remains eligible when it repeats metadata and is not part of a navigational card collection.');

const standaloneRuleWithRelatedCards = defaultExternalSourceValidator.validateTopicContent(`<html><head>
  <title>Annual returns | Accounting and Corporate Regulatory Authority</title>
  <meta name="description" content="${repeatedDescriptionRule}">
</head><body><main>
  <div><h1>Annual returns</h1><p>${repeatedDescriptionRule}</p></div>
  <section class="related-content"><a href="/one/"><div><h2>Other annual return guidance</h2><p>Read the related filing guidance.</p></div></a>
    <a href="/two/"><div><h2>Company filing details</h2><p>Review related company filing information.</p></div></a>
    <a href="/three/"><div><h2>Annual filing overview</h2><p>See the related annual filing overview.</p></div></a></section>
</main></body></html>`, {
  ...bannerExpectation,
  requireSubstantiveBody: true
});
assert.equal(standaloneRuleWithRelatedCards.isValid, true,
  'A genuine rule paragraph remains eligible when related cards live in a separate container.');
assert.ok(standaloneRuleWithRelatedCards.substantiveText?.includes(repeatedDescriptionRule));

const articleLead = 'All Singapore companies must file an annual return with ACRA each year, even when dormant, and submit annual returns by the applicable deadline.';
const articleWithRelatedCards = defaultExternalSourceValidator.validateTopicContent(`<html><head>
  <title>Annual returns | Accounting and Corporate Regulatory Authority</title>
  <meta name="description" content="${articleLead}">
</head><body><main>
  <div><h1>Annual returns</h1><p class="prose-title-lg-regular">${articleLead}</p></div>
  <section><p>Companies must file an annual return by the due date that applies to their financial year end.</p></section>
  <section class="related-content"><a href="/one/"><div><h2>Other annual return guidance</h2><p>Read the related filing guidance.</p></div></a>
    <a href="/two/"><div><h2>Company filing details</h2><p>Review related company filing information.</p></div></a>
    <a href="/three/"><div><h2>Annual filing overview</h2><p>See the related annual filing overview.</p></div></a></section>
</main></body></html>`, {
  ...bannerExpectation,
  requireSubstantiveBody: true
});
assert.equal(articleWithRelatedCards.isValid, true,
  'An article lead remains eligible when real article body appears before a separate related-card collection.');
assert.ok(articleWithRelatedCards.substantiveText?.includes(articleLead));
assert.ok(articleWithRelatedCards.substantiveText?.includes('Companies must file an annual return by the due date'));

const retainedAnnualArticle = pages.find(page => page.name === 'annual');
const retainedAnnualValidation = defaultExternalSourceValidator.validateTopicContent(retainedAnnualArticle.html, {
  ...bannerExpectation,
  preferMainContent: true,
  requireSubstantiveBody: true
});
assert.equal(retainedAnnualValidation.isValid, true,
  'The retained annual-return deep article remains valid under strict substantive-body extraction.');
assert.ok(retainedAnnualValidation.substantiveText?.includes('enforcement action'),
  'Inline legal references remain in genuine article prose.');
assert.ok(retainedAnnualValidation.substantiveText?.includes('Company name and registration number'),
  'Substantive annual-return list items remain eligible evidence.');
assert.ok(retainedAnnualValidation.substantiveText?.includes('Annual return filing with ACRA'),
  'Substantive annual-return table cells remain eligible evidence.');

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

const reminderPageUrl = 'https://www.acra.gov.sg/manage/companies/legal-requirements-common-offences/filing-annual-returns-companies/filing-reminders-and-notifications/';
const reminderPageTitle = 'Filing reminders and notifications for annual returns & declarations | Accounting and Corporate Regulatory Authority';
// Minimal visible-body excerpt from the saved ACRA reminders capture
// (upstream SHA-256 7c572e3fcfd2e614cd057f27e403dd48b78af998be955b4fe04758cd117f2fd6).
const remindersHtml = `<html><head><title>${reminderPageTitle}</title>
  <meta name="description" content="ACRA provides reminder notifications to help you comply with annual return (AR) and annual declaration (AD) deadlines."></head><body><main>
  <h1>Filing reminders and notifications for annual returns &amp; declarations</h1>
  <p>ACRA provides reminder notifications to help you comply with annual return (AR) and annual declaration (AD) deadlines.</p>
  <p>ACRA only sends notifications (pop-up alerts and emails) for annual returns and declarations.</p>
</main></body></html>`;
const annualReturnsPage = pages.find(page => page.name === 'annual');
const discoveryByUrl = new Map([
  [reminderPageUrl, { html: remindersHtml, title: reminderPageTitle }],
  [annualReturnsPage.url, { html: annualReturnsPage.html, title: 'Deadline & requirements for annual returns | Accounting and Corporate Regulatory Authority' }]
]);
assert.equal(annualReturnsPage.url, deadlineCaptureProvenance.officialUrl,
  'The retained official capture is replayed only for its recorded canonical ACRA page.');
const capturedDeadlineTitle = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(capturedDeadlineHtml)?.[1]
  .replace(/&amp;/gi, '&').trim();
assert.ok(capturedDeadlineTitle, 'The retained official capture includes its page title.');
discoveryByUrl.set(deadlineCaptureProvenance.officialUrl, { html: capturedDeadlineHtml, title: capturedDeadlineTitle });
const queryForDeadline = 'Under current ACRA rules, how many months after financial year end must a non-listed Singapore company without an overseas branch register file its annual return? Cite the official rule.';
async function runDiscoveredPages(candidateUrls, query = queryForDeadline, pagesByUrl = discoveryByUrl) {
  return run('annual', 'acra_annual-returns', query, 'sitemap', { options: {
    discoveryAdapter: { async discoverOfficialSourceCandidates() { return candidateUrls; } },
    officialDomainSearchAdapter: { async searchOfficialDomainCandidates() { return []; } },
    webRetriever: { async fetchOfficialSource(url) {
      const page = pagesByUrl.get(url);
      if (!page) return { status: 'NOT_FOUND', finalUrl: url };
      return { status: 'SUCCESS', content: page.html, finalUrl: url, topicMatched: true,
        titleMatched: true, contentMatched: true, pageTitle: page.title,
        contentHash: createHash('sha256').update(page.html).digest('hex'), retrievedAt: '2026-10-17T13:36:39.783Z' };
    } }
  } });
}
const reminderThenDeadline = await runDiscoveredPages([reminderPageUrl, annualReturnsPage.url]);
assert.equal(reminderThenDeadline.trace.attempts.find(attempt => attempt.candidateUrl === reminderPageUrl)?.fetchStatus, 'TOPIC_MISMATCH',
  'A topical ACRA reminders page without an operative annual-return filing rule cannot satisfy discovery coverage.');
assert.equal(reminderThenDeadline.trace.attempts.find(attempt => attempt.candidateUrl === annualReturnsPage.url)?.fetchStatus, 'SUCCESS',
  'Bounded discovery continues to the later official page that states the annual-return filing duty.');
assert.equal(reminderThenDeadline.records.length, 1);
assert.equal(reminderThenDeadline.records[0].officialSourceUrl, annualReturnsPage.url);
assert.ok(reminderThenDeadline.records[0].sourceText.includes('Within seven months after FYE'));
const allReminders = await runDiscoveredPages([reminderPageUrl]);
assert.equal(allReminders.records.length, 0, 'Reminder-only discovery remains insufficient when no operative rule page is found.');
assert.equal(allReminders.trace.attempts.find(attempt => attempt.candidateUrl === reminderPageUrl)?.fetchStatus, 'TOPIC_MISMATCH');
const deadlineIssue = { id: 'acra-filing-deadline', subject: 'annual return filing deadline for non-listed company',
  population: 'COMPANY', domain: 'ACRA_CORPORATE', governingAuthorities: ['ACRA'], contextualAuthorities: [],
  operation: 'EXPLAIN_RULE', mappedTopicIds: ['acra_annual-returns'], evidenceRequirement: 'AUTHORITATIVE_SOURCE',
  confidence: 0.98, status: 'MAPPED' };
async function assessDiscoveredPages(result, query = queryForDeadline, issue = deadlineIssue) {
  const issues = Array.isArray(issue) ? issue : [issue];
  const governedResult = await buildAuthorityWorkstreams(query, {
    source: 'SEMANTIC_ISSUES', coverageEstablished: true, hasUnmappedResidual: false, issues
  }, {
    referenceDate: '2026-10-17', providers: { ACRA: { authority: 'ACRA', retrieve: async () => ({
      candidates: result.records,
      trace: { stages: [], attempts: result.trace.attempts },
      evidenceQualityTrace: result.trace
    }) } }
  });
  return governedResult.workstreams.flatMap(stream => stream.issues);
}
const [admittedDeadline] = await assessDiscoveredPages(reminderThenDeadline);
assert.equal(admittedDeadline.evidenceStatus, 'VERIFIED');
assert.equal(admittedDeadline.lifecycle.admitted, true);
assert.equal(admittedDeadline.sources[0].officialSourceUrl, annualReturnsPage.url);
assert.equal(admittedDeadline.verifiedClaims.length, 1,
  'A deadline-specific issue retains only its complete deadline-table quote.');
assert.equal(supportsAcraAnnualReturnDeadlineTable(admittedDeadline.verifiedClaims[0].quote), true);
assert.equal(supportsAcraAnnualReturnDeadlineEvidence(admittedDeadline.sources[0].sourceText), true,
  'The complete table and operative annual-return duty remain in the same admitted source.');
const [dueDateSubjectDeadline] = await assessDiscoveredPages(reminderThenDeadline, queryForDeadline, {
  ...deadlineIssue, id: 'acra-annual-return-due-date', subject: 'annual return due date'
});
assert.equal(dueDateSubjectDeadline.evidenceStatus, 'VERIFIED');
assert.equal(dueDateSubjectDeadline.verifiedClaims.length, 1,
  'A scoped complete table quote remains verifiable when the issue uses a due-date subject label.');
const caseSpecificDeadlineCalculation = await assessDiscoveredPages(reminderThenDeadline,
  'Calculate when my annual return is due using FYE ending 31 March 2025.', {
    ...deadlineIssue, id: 'acra-case-specific-deadline-calculation', operation: 'CALCULATE',
    evidenceRequirement: 'AUTHORITATIVE_SOURCE_AND_CASE_FACTS'
  });
assert.equal(caseSpecificDeadlineCalculation[0].applicationStatus, 'UNRESOLVED',
  'A company-specific calendar calculation remains unresolved even when the official deadline rule is verified.');
const capturedTablePassage = getAcraAnnualReturnDeadlineTablePassage(admittedDeadline.sources[0].sourceText);
assert.ok(capturedTablePassage, 'The exact official capture preserves the table as one quote block.');
assert.equal(supportsAcraAnnualReturnDeadlineTable(
  capturedTablePassage.replace(/^Listed companies \|/m, 'Other companies |')
), false, 'A table missing a required company category cannot support the deadline relation.');
assert.equal(supportsAcraAnnualReturnDeadlineTable(
  capturedTablePassage.replace(/^Non-listed companies \|/m, 'Listed companies |')
), false, 'A deadline moved to the wrong company-category row leaves the table incomplete.');
assert.equal(supportsAcraAnnualReturnDeadlineTable(capturedTablePassage.split('\n')[1].split('|')[1].trim()), false,
  'An isolated deadline cell cannot support a company-category relation.');
assert.equal(supportsAcraAnnualReturnDeadlineTable(
  capturedTablePassage.replace('Within five months', 'Within several months')
), false, 'A vague quantifier is not a numerically expressed month count.');
assert.equal(supportsAcraAnnualReturnDeadlineTable(
  capturedTablePassage.replace('Within five months', 'Within banana months')
), false, 'Arbitrary words cannot stand in for a numeric deadline.');
assert.equal(supportsAcraAnnualReturnDeadlineTable(
  capturedTablePassage.replace('Company type | Filing deadline', 'Company type | Filing requirements')
), false, 'An unrelated table header cannot satisfy deadline evidence.');
assert.equal(supportsAcraAnnualReturnDeadlineTable(`${capturedTablePassage}\n\n${capturedTablePassage}`), true,
  'Harmless identical repeated source text preserves the same complete table relation.');
const strictDeadlineExpectation = {
  ...bannerExpectation,
  preferMainContent: true,
  requireSubstantiveBody: true,
  requireAcraAnnualReturnDeadlineTable: true
};
assert.equal(defaultExternalSourceValidator.validateTopicContent(capturedDeadlineHtml, strictDeadlineExpectation).isValid, true,
  'The exact saved ACRA deadline page passes opt-in simple-table preservation.');
const deadlineTableMarkup = [...capturedDeadlineHtml.matchAll(/<table\b[^>]*>[\s\S]*?<\/table\s*>/gi)]
  .map(match => match[0]).find(table => {
    const header = /<tr\b[^>]*>([\s\S]*?)<\/tr\s*>/i.exec(table)?.[1] || '';
    const cells = [...header.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th\s*>/gi)]
      .map(cell => cell[1].replace(/<[^>]+>/g, ' ').toLowerCase().replace(/\s+/g, ' ').trim());
    return cells.length === 2 && cells[0] === 'company type' && cells[1] === 'filing deadline';
  });
assert.ok(deadlineTableMarkup, 'The exact source table can be selected by its two header cells.');
assert.equal(defaultExternalSourceValidator.validateTopicContent(
  capturedDeadlineHtml.replace(deadlineTableMarkup, `${deadlineTableMarkup}${deadlineTableMarkup}`), strictDeadlineExpectation
).isValid, true, 'An identical repeated source table does not create conflicting deadline evidence.');
const invalidDeadlineTables = [
  ['stray closing row tag', deadlineTableMarkup.replace('</tbody>', '</tr></tbody>')],
  ['mismatched table section close', deadlineTableMarkup.replace('</tbody>', '</thead>')],
  ['duplicate row-span attributes', deadlineTableMarkup.replace(/<td\b([^>]*)>/i, '<td$1 rowspan="2">')],
  ['nested table', deadlineTableMarkup.replace(/<td\b([^>]*)>/i, '<td$1><table><tr><td>Nested</td></tr></table>')],
  ['caption qualification lost by cleanup', deadlineTableMarkup.replace(/<table\b([^>]*)>/i,
    '<table$1><caption>Applicable only to financial years ending before 1 January 2020.</caption>')],
  ['nonnumeric deadline', deadlineTableMarkup.replace('Within <b>five months</b>', 'Within <b>several months</b>')],
  ['conflicting repeated table', `${deadlineTableMarkup}${deadlineTableMarkup.replace('Within <b>five months</b>', 'Within <b>thirty months</b>')}`]
];
for (const [description, invalidTable] of invalidDeadlineTables) {
  const mutatedHtml = capturedDeadlineHtml.replace(deadlineTableMarkup, invalidTable);
  assert.equal(defaultExternalSourceValidator.validateTopicContent(mutatedHtml, strictDeadlineExpectation).isValid, false,
    `${description} is rejected by the bounded ACRA deadline-table path.`);
}
const longPage = `${'Unrelated company services and organisation information. '.repeat(150)}\n\n` +
  `All Singapore companies must file annual returns with ACRA each year.\n\n${capturedTablePassage}`;
const longExcerpt = selectRelevantFetchedText(longPage, ['annual return', 'filing deadline'], 1_000,
  queryForDeadline, [capturedTablePassage]);
assert.equal(getAcraAnnualReturnDeadlineTablePassage(longExcerpt), capturedTablePassage,
  'Long-page relevance selection retains the entire qualified table atomically.');
const genericAnnualRuleQuery = 'What annual return filing duty applies to Singapore companies?';
const dutyOnlyHtml = `<html><head><title>${capturedDeadlineTitle}</title></head><body><main>
  <p>All Singapore companies must file annual returns with ACRA each year.</p>
  <p>Companies may face penalties for late annual returns.</p>
</main></body></html>`;
const dutyOnlyMap = new Map(discoveryByUrl);
dutyOnlyMap.set(annualReturnsPage.url, { html: dutyOnlyHtml, title: capturedDeadlineTitle });
const deadlineDutyOnlyDiscovery = await runDiscoveredPages([annualReturnsPage.url], queryForDeadline, dutyOnlyMap);
assert.equal(deadlineDutyOnlyDiscovery.records.length, 0,
  'A filing-duty-only page cannot stop discovery for an annual-return deadline question.');
const generalDutyOnlyDiscovery = await runDiscoveredPages([annualReturnsPage.url], genericAnnualRuleQuery, dutyOnlyMap);
assert.equal(generalDutyOnlyDiscovery.records.length, 1,
  'A filing-duty-only page remains discoverable for a general annual-return rule question.');
const dutyOnlyForDeadline = await assessDiscoveredPages(generalDutyOnlyDiscovery, queryForDeadline);
assert.equal(dutyOnlyForDeadline[0].evidenceStatus, 'INSUFFICIENT',
  'A duty-only candidate fetched for a general query cannot be admitted to a deadline query.');
assert.equal(dutyOnlyForDeadline[0].sources.length, 0);
const competingAcraDeadlineIssues = [deadlineIssue, {
  ...deadlineIssue, id: 'acra-deadline-secondary', subject: 'annual return deadline and company filing deadline'
}];
const dutyOnlyForCompetingDeadlines = await assessDiscoveredPages(
  generalDutyOnlyDiscovery, queryForDeadline, competingAcraDeadlineIssues
);
assert.equal(dutyOnlyForCompetingDeadlines.length, 2);
assert.ok(dutyOnlyForCompetingDeadlines.every(item => item.evidenceStatus === 'INSUFFICIENT' &&
  item.sources.length === 0 && item.verifiedClaims.length === 0),
'Competing ACRA company issues still require deadline table evidence even when unique concept ownership is unavailable.');
const unknownPopulationDeadline = await assessDiscoveredPages(generalDutyOnlyDiscovery, queryForDeadline, {
  ...deadlineIssue, id: 'acra-deadline-unknown-population', population: 'UNKNOWN'
});
assert.equal(unknownPopulationDeadline[0].evidenceStatus, 'INSUFFICIENT',
  'An unknown-population issue mapped to the annual-return topic still requires deadline evidence.');
const dutyOnlyForGeneralRule = await assessDiscoveredPages(generalDutyOnlyDiscovery, genericAnnualRuleQuery);
assert.equal(dutyOnlyForGeneralRule[0].evidenceStatus, 'VERIFIED',
  'The same duty-only evidence still supports the general annual-return rule.');
const insufficientReminders = await assessDiscoveredPages(allReminders);
assert.equal(insufficientReminders[0].evidenceStatus, 'INSUFFICIENT');
assert.equal(insufficientReminders[0].sources.length, 0);
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

const vccDiscoveryRequests = [];
const vccFallback = await resolveMappedOfficialSourceFallback(['acra_vcc'], 'Explain Variable Capital Company requirements.', {
  async retrieveSources() { return []; },
  getSourceById() { return undefined; }
}, {
  referenceDate: '2026-10-10',
  webRetriever: { async fetchOfficialSource(url) { return { status: 'NOT_FOUND', finalUrl: url }; } },
  discoveryAdapter: { async discoverOfficialSourceCandidates(request) { vccDiscoveryRequests.push(request); return []; } },
  officialDomainSearchAdapter: { async searchOfficialDomainCandidates(request) { vccDiscoveryRequests.push(request); return []; } }
});
assert.equal(vccFallback.records.length, 0);
assert.equal(vccDiscoveryRequests.length, 0,
  'ACRA VCC topics do not enter the company-guidance sitemap or restricted-search route.');

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
