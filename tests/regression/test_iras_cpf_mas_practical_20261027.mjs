import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { cleanHtmlText } from '../../src/retrieval/sourceAdapters.ts';
import { ControlledWebRetriever } from '../../src/retrieval/controlledWebRetriever.ts';
import { SourceCache } from '../../src/retrieval/sourceCache.ts';
import { defaultSourceRetriever } from '../../src/retrieval/sourceRetriever.ts';
import { resolveMappedOfficialSourceFallback } from '../../src/services/groundingContextBuilder.ts';
import { TargetDateResolver } from '../../src/retrieval/targetDateResolver.ts';
import { supportGeneralIrasRuleConcept } from '../../src/retrieval/irasRuleConceptSupport.ts';
import {
  IRAS_CPF_MAS_PRACTICAL_RULES_20261027,
  IRAS_CPF_MAS_PRACTICAL_SOURCE_CATALOG,
  getIrasCpfMasPracticalEvidence,
  hasIrasCpfMasPracticalContradiction,
  selectIrasCpfMasPracticalQuotes,
  supportIrasCpfMasPracticalRule
} from '../../src/retrieval/irasCpfMasPracticalRules20261027.ts';

const fixtureRoot = new URL('../fixtures/statutoryDevelopment20261027/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('iras-cpf-mas-source-manifest.json', fixtureRoot), 'utf8'));
const manifestByFile = new Map(manifest.sources.map(entry => [entry.fixture, entry]));
const readFixture = file => readFileSync(new URL(file, fixtureRoot), 'utf8');
const cases = [
  {
    id: 'IRAS_GST_STANDARD_RATED', authority: 'IRAS', topicId: 'iras-gst-standard-rated-supplies',
    query: 'What GST must a registered business charge on local sales?', subject: 'GST standard-rated local supplies',
    file: 'iras-gst-standard-rated.html', url: 'https://www.iras.gov.sg/taxes/goods-services-tax-(gst)/charging-gst-(output-tax)/when-to-charge-goods-and-services-tax-(gst)',
    expected: /prevailing 9% GST on sales.*exceptions/i
  },
  {
    id: 'IRAS_GST_ZERO_RATED', authority: 'IRAS', topicId: 'iras-gst-zero-rating',
    query: 'Does an overseas customer automatically make a service zero-rated for GST?', subject: 'GST zero-rating of international services',
    file: 'iras-gst-zero-rated.html', url: 'https://www.iras.gov.sg/taxes/goods-services-tax-(gst)/filing-gst/completing-gst-returns',
    expected: /overseas customer alone does not make a service zero-rated/i
  },
  {
    id: 'IRAS_GST_EXEMPT', authority: 'IRAS', topicId: 'iras-gst-exempt-supplies',
    query: 'Which supplies are exempt from GST?', subject: 'GST exempt supplies',
    file: 'iras-gst-basics-native.html', url: 'https://www.iras.gov.sg/taxes/goods-services-tax-(gst)/basics-of-gst/goods-and-services-tax-(gst)-what-it-is-and-how-it-works',
    expected: /specifically exempted under the GST Act/i
  },
  {
    id: 'IRAS_GST_OUT_OF_SCOPE', authority: 'IRAS', topicId: 'iras-gst-out-of-scope-supplies',
    query: 'When is a sale outside the scope of GST?', subject: 'GST out-of-scope supplies',
    file: 'iras-gst-out-of-scope.html', url: 'https://www.iras.gov.sg/taxes/goods-services-tax-(gst)/charging-gst-(output-tax)/when-is-gst-not-charged/out-of-scope-supplies',
    expected: /not charged GST and are not reported/i
  },
  {
    id: 'CPF_EMPLOYEE_COVERAGE', authority: 'CPF', topicId: 'cpf-employee-coverage',
    query: 'Who should receive CPF contributions?', subject: 'CPF employee coverage and exemptions',
    file: 'cpf-employee-coverage.html', url: 'https://www.cpf.gov.sg/employer/employer-obligations/who-should-receive-cpf-contributions',
    expected: /contract of service.*more than S\$50/i
  },
  {
    id: 'CPF_CONTRIBUTION_COMPUTATION', authority: 'CPF', topicId: 'cpf-contribution-computation',
    query: 'How are CPF contributions computed for low monthly wages?', subject: 'CPF contribution factors and employee share',
    file: 'cpf-contribution-computation.html', url: 'https://www.cpf.gov.sg/employer/employer-obligations/how-much-cpf-contributions-to-pay',
    expected: /above S\$50 but not more than S\$500.*employee share is nil.*employer share remains due/i
  },
  {
    id: 'MAS_LFMC_FINANCIAL_RETURNS', authority: 'MAS', topicId: 'mas-regulatory-reporting',
    query: 'When are LFMC quarterly financial returns due?', subject: 'LFMC quarterly and annual financial returns',
    file: 'mas-lfmc-native-extract.txt', url: 'https://www.mas.gov.sg/-/media/mas-media-library/regulation/guidance/cmi/compliance-toolkits-for-fund-management-companies/sfa-compliance-toolkit-lfmcs29-may-2026-clean.pdf',
    expected: /quarterly Forms 1 and 2 within 14 days.*annual audited Forms 1 to 6.*five months/i
  },
  {
    id: 'MAS_LFMC_CHANGE_NOTIFICATION', authority: 'MAS', topicId: 'mas-regulatory-reporting',
    query: 'How soon must an LFMC notify MAS of a change to its principal place of business?', subject: 'LFMC change of name or principal place of business notification',
    file: 'mas-lfmc-native-extract.txt', url: 'https://www.mas.gov.sg/-/media/mas-media-library/regulation/guidance/cmi/compliance-toolkits-for-fund-management-companies/sfa-compliance-toolkit-lfmcs29-may-2026-clean.pdf',
    expected: /within 14 days.*Notice for Change in Particulars/i
  }
].map(sample => ({ ...sample, sourceText: readFixture(sample.file) }));

function normalize(value) {
  return cleanHtmlText(value).replace(/\s+/g, ' ').replace(/\s+([,.;:!?])/g, '$1').trim().toLowerCase();
}

function requestFor(sample, overrides = {}) {
  return {
    authority: sample.authority, topicId: sample.topicId, query: sample.query, subject: sample.subject,
    sourceText: sample.sourceText, officialUrl: sample.url, ...overrides
  };
}

function presentedEvidence(sample, { appStatus = 'UNRESOLVED', sourceUrl = sample.url, domain, population, operation,
  hashesByQuote, appendContradiction = false, includeOnly } = {}) {
  const quotes = selectIrasCpfMasPracticalQuotes(requestFor(sample));
  const selected = includeOnly === undefined ? quotes : quotes.slice(0, includeOnly);
  const issueId = `issue-${sample.id}`;
  const claims = selected.map((text, index) => ({
    text: appendContradiction && index === 0 ? `${text}\nIt is false that this rule applies.` : text,
    supportKind: 'EXACT_SOURCE_QUOTE', issueIds: [issueId], provenance: 'LIVE_EXTERNAL',
    fetchedSourceBinding: {
      recordId: `record-${sample.id}`,
      documentHash: hashesByQuote?.[index] || createHash('sha256').update(sample.sourceText).digest('hex'),
      canonicalUrl: sample.url, retrievedAt: '2026-10-26T23:24:41Z', claimIndex: index
    }
  }));
  const issue = {
    id: issueId, subject: sample.subject,
    population: population || (sample.authority === 'CPF' ? 'Employer' : 'Company'),
    operation: operation || 'EXPLAIN_RULE', evidenceStatus: 'VERIFIED', applicationStatus: appStatus, claims, gaps: []
  };
  const stream = {
    id: `stream-${sample.id}`, authority: sample.authority,
    domain: domain || (sample.authority === 'IRAS' ? 'IRAS_GST' : sample.authority === 'CPF' ? 'CPF_PAYROLL' : 'MAS_FUNDS'),
    evidenceStatus: 'VERIFIED', applicationStatus: appStatus, issues: [issue], gaps: [],
    sources: [{ key: `source-${sample.id}`, title: manifestByFile.get(sample.file).pageTitle,
      publisher: sample.authority, documentTitle: manifestByFile.get(sample.file).pageTitle,
      officialUrl: sourceUrl, provenance: 'LIVE_EXTERNAL', claims }]
  };
  return { issue, stream };
}

assert.equal(IRAS_CPF_MAS_PRACTICAL_RULES_20261027.length, 8);
assert.equal(IRAS_CPF_MAS_PRACTICAL_SOURCE_CATALOG.length, 8);
assert.equal(manifest.sources.length, 7, 'The eight rule families use seven distinct official source documents.');
for (const sample of cases) {
  const entry = manifestByFile.get(sample.file);
  assert.ok(entry, `${sample.file}: source manifest entry exists`);
  assert.equal(entry.authority, sample.authority);
  assert.equal(entry.url, sample.url, `${sample.file}: source URL matches the rule source exactly`);
  assert.equal(entry.fixtureKind, IRAS_CPF_MAS_PRACTICAL_RULES_20261027.find(rule => rule.id === sample.id).fixtureKind);
  const fixtureBytes = readFileSync(new URL(sample.file, fixtureRoot));
  if (entry.fixtureSha256) assert.equal(createHash('sha256').update(fixtureBytes).digest('hex'), entry.fixtureSha256,
    `${sample.file}: fixture bytes match their manifest hash`);
  if (entry.capturedContentSha256) {
    assert.equal(createHash('sha256').update(fixtureBytes).digest('hex'), entry.capturedContentSha256,
      `${sample.file}: native response bytes match the capture manifest`);
    assert.equal(fixtureBytes.length, entry.byteLength, `${sample.file}: native response byte length matches the capture manifest`);
  }

  const request = requestFor(sample);
  assert.equal(supportIrasCpfMasPracticalRule(request), true, `${sample.id}: full selected source supports the family`);
  const selected = selectIrasCpfMasPracticalQuotes(request);
  assert.ok(selected.length >= 3, `${sample.id}: the complete family requires multiple source premises`);
  const normalizedSource = normalize(sample.sourceText);
  for (const quote of selected) assert.ok(normalizedSource.includes(normalize(quote)), `${sample.id}: selector returns a verbatim visible source span`);
  assert.equal(supportIrasCpfMasPracticalRule({ ...request, sourceText: selected.join('\n\n') }), true,
    `${sample.id}: exact selected passages alone still prove the full family`);
  assert.equal(supportIrasCpfMasPracticalRule({ ...request, officialUrl: undefined }), true,
    `${sample.id}: text proof can be used when the issue checker omits its separate source URL`);
  assert.deepEqual(selectIrasCpfMasPracticalQuotes({ ...request, officialUrl: undefined }), [],
    `${sample.id}: quote selection still requires the exact official source URL`);
  assert.equal(supportIrasCpfMasPracticalRule({ ...request, officialUrl: 'https://example.org/wrong-source' }), false,
    `${sample.id}: a wrong URL cannot support the rule`);
  assert.equal(supportIrasCpfMasPracticalRule({ ...request, sourceText: '' }), false,
    `${sample.id}: incomplete source text fails closed`);
  assert.equal(supportIrasCpfMasPracticalRule({ ...request, topicId: 'unrelated-topic' }), undefined,
    `${sample.id}: an unrelated topic remains outside this rule family`);
  assert.equal(supportIrasCpfMasPracticalRule({ ...request, query: `${sample.query} in 2025` }), false,
    `${sample.id}: a historical application date is not inferred from the current source`);
  assert.equal(supportIrasCpfMasPracticalRule({ ...request, query: `${sample.query} next year` }), false,
    `${sample.id}: future periods remain out of scope`);
  assert.equal(supportIrasCpfMasPracticalRule({ ...request, query: `${sample.query} after October ${TargetDateResolver.CURRENT_SYSTEM_DATE.slice(0, 4)}` }), false,
    `${sample.id}: a current-year cutoff date does not establish post-cutoff requirements`);

  const { issue, stream } = presentedEvidence(sample);
  const evidence = getIrasCpfMasPracticalEvidence(sample.query, stream, issue);
  assert.ok(evidence, `${sample.id}: verified general guidance can be rendered while case application is unresolved`);
  assert.equal(evidence.authority, sample.authority);
  assert.equal(evidence.officialUrl, sample.url);
  assert.match(evidence.text, sample.expected, `${sample.id}: general answer states its substantive rule`);
  assert.match(evidence.text, /\b(?:depends|needed|needs|requires|confirm|must be known|need|cannot be established)\b/i,
    `${sample.id}: answer identifies facts or scope needed for a case-specific conclusion`);
  assert.equal(issue.applicationStatus, 'UNRESOLVED', `${sample.id}: explanation does not promote case application`);

  const contradictory = { ...request, sourceText: `${sample.sourceText}\nIt is false that the stated rule applies.` };
  assert.equal(hasIrasCpfMasPracticalContradiction(contradictory), true, `${sample.id}: source contradiction is detected`);
  assert.equal(supportIrasCpfMasPracticalRule(contradictory), false, `${sample.id}: contradictory source cannot pass proof`);
  assert.equal(getIrasCpfMasPracticalEvidence(sample.query,
    presentedEvidence(sample, { appendContradiction: true }).stream,
    presentedEvidence(sample, { appendContradiction: true }).issue), undefined,
  `${sample.id}: a contradictory issue-bound quote set cannot render`);

  const incomplete = presentedEvidence(sample, { includeOnly: selected.length - 1 });
  assert.equal(getIrasCpfMasPracticalEvidence(sample.query, incomplete.stream, incomplete.issue), undefined,
    `${sample.id}: incomplete issue-bound claims cannot render`);
  const splitHashes = selected.map((_, index) => index === 0 ? 'b'.repeat(64) : 'c'.repeat(64));
  const split = presentedEvidence(sample, { hashesByQuote: splitHashes });
  assert.equal(getIrasCpfMasPracticalEvidence(sample.query, split.stream, split.issue), undefined,
    `${sample.id}: claims split across document revisions cannot prove one family`);
  const wrongUrl = presentedEvidence(sample, { sourceUrl: 'https://example.org/wrong-source' });
  assert.equal(getIrasCpfMasPracticalEvidence(sample.query, wrongUrl.stream, wrongUrl.issue), undefined,
    `${sample.id}: a wrong source URL cannot render`);
  const promoted = presentedEvidence(sample, { appStatus: 'VERIFIED' });
  assert.equal(getIrasCpfMasPracticalEvidence(sample.query, promoted.stream, promoted.issue), undefined,
    `${sample.id}: a verified case application is outside this general-rule path`);
}

const currentYear = Number(TargetDateResolver.CURRENT_SYSTEM_DATE.slice(0, 4));
for (const sample of cases) {
  assert.equal(supportIrasCpfMasPracticalRule(requestFor(sample, { query: `As of ${currentYear}, ${sample.query}` })), true,
    `${sample.id}: current-year query remains answerable`);
  assert.equal(supportIrasCpfMasPracticalRule(requestFor(sample, { query: `What applied before ${currentYear}? ${sample.query}` })), false,
    `${sample.id}: current-year cutoff language does not establish the earlier period`);
}

const cpfLowWage = cases.find(sample => sample.id === 'CPF_CONTRIBUTION_COMPUTATION');
assert.equal(supportIrasCpfMasPracticalRule(requestFor(cpfLowWage, { query: 'Does the employee pay CPF when wages are above S$50 but below S$500?' })), true,
  'A low-wage contribution-share question routes to computation rather than the employee coverage rule.');
const cpfCoverage = cases.find(sample => sample.id === 'CPF_EMPLOYEE_COVERAGE');
assert.equal(supportIrasCpfMasPracticalRule(requestFor(cpfCoverage, { query: 'Who is covered?' })), true,
  'The mapped CPF coverage subject can anchor a natural question without repeating its exact phrase.');
const irasStandard = cases.find(sample => sample.id === 'IRAS_GST_STANDARD_RATED');
assert.equal(supportIrasCpfMasPracticalRule(requestFor(irasStandard, { query: 'What rate applies?' })), true,
  'The mapped standard-rated subject can anchor a concise natural question.');
const masFinancial = cases.find(sample => sample.id === 'MAS_LFMC_FINANCIAL_RETURNS');
assert.equal(supportIrasCpfMasPracticalRule(requestFor(masFinancial, { query: 'When are these returns due?' })), true,
  'The mapped LFMC financial-return subject can anchor a concise deadline question.');
const naturalZeroRating = {
  ...cases.find(sample => sample.id === 'IRAS_GST_ZERO_RATED'),
  query: 'A customer has an overseas billing address. Is our sale automatically zero-rated for GST?',
  subject: 'GST zero-rating of sales to overseas customers'
};
assert.equal(supportIrasCpfMasPracticalRule(requestFor(naturalZeroRating)), true,
  'A plural overseas-customer issue subject and zero-rating phrasing select the verified zero-rating rule.');
const naturalZeroQuotes = selectIrasCpfMasPracticalQuotes(requestFor(naturalZeroRating));
assert.equal(supportGeneralIrasRuleConcept({ sourceText: naturalZeroQuotes.join('\n\n'), domainId: 'IRAS_GST',
  topicIds: ['iras-gst-zero-rating'], subject: naturalZeroRating.subject, population: 'COMPANY' }), true,
'The bounded general-concept adapter accepts the full exact rule proof for a company GST issue.');
const naturalZeroPresentation = presentedEvidence(naturalZeroRating);
assert.ok(getIrasCpfMasPracticalEvidence(naturalZeroRating.query, naturalZeroPresentation.stream, naturalZeroPresentation.issue),
  'The natural overseas-address question can render the general rule from its issue-bound source proof.');
const masChange = cases.find(sample => sample.id === 'MAS_LFMC_CHANGE_NOTIFICATION');
const masChangeQuotes = selectIrasCpfMasPracticalQuotes(requestFor(masChange));
assert.ok(masChangeQuotes.some(quote => /^13\s+To notify MAS/i.test(quote) && /Notice for Change in/i.test(quote) && /Particulars/i.test(quote)),
  'MAS change notice proof names the current toolkit submission instead of inventing Form 10.');
assert.match(IRAS_CPF_MAS_PRACTICAL_RULES_20261027.find(rule => rule.id === 'MAS_LFMC_CHANGE_NOTIFICATION').limitations.join(' '),
  /director|representative|shareholder|controller/i, 'MAS notification limitation remains narrow to the sourced entity changes.');

const gstBasicsRule = IRAS_CPF_MAS_PRACTICAL_RULES_20261027.find(rule => rule.id === 'IRAS_GST_EXEMPT');
const gstBasicsHtml = readFixture(gstBasicsRule.fixtureFile);
const gstBasicsHash = createHash('sha256').update(gstBasicsHtml).digest('hex');
const gstComparisonQuery = 'For GST, how do exempt supplies differ from zero-rated sales?';
const gstComparisonTopicIds = ['iras-gst-exempt-supplies', 'iras-gst-zero-rating'];
const gstHtmlResponse = body => new Response(body, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });

async function fetchGstComparisonBasics({ html = gstBasicsHtml, redirectedUrl } = {}) {
  return resolveMappedOfficialSourceFallback(gstComparisonTopicIds, gstComparisonQuery, defaultSourceRetriever, {
    discoveryAdapter: { discoverOfficialSourceCandidates: async () => [] },
    webRetriever: new ControlledWebRetriever(undefined, new SourceCache()),
    fetchOptions: {
      useCache: false,
      customFetch: async url => {
        if (url === gstBasicsRule.officialUrl && redirectedUrl) {
          return new Response(null, { status: 302, headers: { location: redirectedUrl } });
        }
        if (url === gstBasicsRule.officialUrl || url === redirectedUrl) return gstHtmlResponse(html);
        return new Response('not found', { status: 404 });
      }
    }
  });
}

const nativeGstComparison = await fetchGstComparisonBasics();
const nativeGstRecords = nativeGstComparison.records.filter(record => record.canonicalSourceUrl === gstBasicsRule.officialUrl);
assert.ok(nativeGstRecords.length > 0, 'The exact IRAS GST basics page with native link-only category cells is admitted as a candidate.');
for (const record of nativeGstRecords) {
  assert.equal(record.provenance, 'LIVE_EXTERNAL', 'The selected visible passages retain live-source provenance.');
  assert.equal(record.documentHash, gstBasicsHash, 'The source record retains the hash of the full raw official response.');
  assert.equal(record.officialSourceUrl, gstBasicsRule.officialUrl, 'The source record retains the exact official page URL.');
  const topicId = record.tags.find(tag => gstComparisonTopicIds.includes(tag));
  const selected = selectIrasCpfMasPracticalQuotes({ authority: 'IRAS', topicId, query: gstComparisonQuery,
    subject: 'GST distinction between exempt and zero-rated supplies', sourceText: record.sourceText,
    officialUrl: gstBasicsRule.officialUrl });
  assert.equal(selected.length, 8, 'The native table extraction supports all eight bounded category-rule components.');
  assert.ok(selected.every(quote => record.sourceText.includes(quote)), 'Every admitted component is an exact visible quote in the candidate source text.');
  assert.match(record.sourceText, /Sale and rental of unfurnished residential property/i, 'Link-only goods-category text survives extraction.');
  assert.match(record.sourceText, /Importation and local supply of investment precious metals/i, 'The second link-only goods category survives extraction.');
  assert.match(record.sourceText, /Financial services/i, 'The link-only financial-services category survives extraction.');
  assert.match(record.sourceText, /Digital payment tokens/i, 'The link-only digital-payment category survives extraction.');
}

const removedCategoryHtml = gstBasicsHtml.replace(/digital payment tokens/gi, 'digital asset category');
assert.notEqual(removedCategoryHtml, gstBasicsHtml, 'The negative fixture mutation removes the required category from the source.');
const missingCategory = await fetchGstComparisonBasics({ html: removedCategoryHtml });
assert.equal(missingCategory.records.some(record => record.canonicalSourceUrl === gstBasicsRule.officialUrl), false,
  'A native page missing one of the eight required categories is not admitted as a complete comparison source.');
assert.ok(missingCategory.trace.attempts.some(attempt => attempt.candidateUrl === gstBasicsRule.officialUrl &&
  attempt.fetchStatus === 'TOPIC_MISMATCH'), 'The missing category is rejected at the fetched-source proof boundary.');

const redirectedGstUrl = gstBasicsRule.officialUrl.replace(/goods-and-services-tax-\(gst\)-what-it-is-and-how-it-works$/, 'different-gst-page');
const wrongUrl = await fetchGstComparisonBasics({ redirectedUrl: redirectedGstUrl });
assert.equal(wrongUrl.records.some(record => record.canonicalSourceUrl === redirectedGstUrl ||
  record.canonicalSourceUrl === gstBasicsRule.officialUrl), false, 'A redirected or wrong-URL copy cannot support this exact-source path.');
assert.ok(wrongUrl.trace.attempts.some(attempt => attempt.candidateUrl === gstBasicsRule.officialUrl &&
  attempt.fetchStatus !== 'SUCCESS'), 'A same-host redirect away from the exact IRAS basics URL is rejected.');

const navOnlyGstHtml = `<html><head><title>${gstBasicsRule.title}</title></head><body>
  <nav><p>GST is only chargeable on taxable supplies, of which there are 2 types</p>
  <a>Standard-rated supplies that are charged at the prevailing rate of GST (i.e. 9%); and</a>
  <a>Zero-rated supplies that are charged at the rate of 0%</a>
  <a>Exempt supplies: These are supplies specifically exempted from GST, under the GST Act</a>
  <a>Out-of-scope supplies: These are supplies that fall outside the scope of the GST Act</a>
  <a>Sale and rental of unfurnished residential property</a>
  <a>Importation and local supply of investment precious metals</a>
  <a>Financial services</a><a>Digital payment tokens</a></nav>
  <main><h1>${gstBasicsRule.title}</h1><p>GST overview navigation page only.</p></main></body></html>`;
const navOnlyGst = await fetchGstComparisonBasics({ html: navOnlyGstHtml });
assert.equal(navOnlyGst.records.some(record => record.canonicalSourceUrl === gstBasicsRule.officialUrl), false,
  'A navigation-only page containing category labels does not establish the native classification table.');
assert.ok(navOnlyGst.trace.attempts.some(attempt => attempt.candidateUrl === gstBasicsRule.officialUrl &&
  attempt.fetchStatus === 'TOPIC_MISMATCH'), 'Navigation-only category labels fail the complete native rule proof.');

console.log('IRAS GST, CPF coverage/computation, and MAS LFMC reporting practical-rule regressions passed (native captures, visible excerpts, full-family proof, binding, dates, and unresolved applications).');
