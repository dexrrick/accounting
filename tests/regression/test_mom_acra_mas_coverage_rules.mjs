import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { TargetDateResolver } from '../../src/retrieval/targetDateResolver.ts';
import {
  getMomAcraMasCoverageEvidence,
  selectMomAcraMasCoverageQuotes,
  supportMomAcraMasCoverageRule
} from '../../src/retrieval/momAcraMasCoverageRules.ts';

const MOM_URL = 'https://www.mom.gov.sg/employment-practices/salary/paying-salary';
const ACRA_URL = 'https://www.acra.gov.sg/manage/companies/legal-requirements-common-offences/preparing-financial-statements/audit-exemptions/';
const MAS_URL = 'https://www.mas.gov.sg/regulation/capital-markets/apply-for-licensing-or-registration-of-capital-market-entities/fund-management-licensing';

function visibleFixtureText(value) {
  return value
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|nav|header|footer|aside)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<\/(?:p|li|tr|table|div|section|article|h[1-6]|ul|ol|main|dt|dd|th|td)\s*>/gi, '\n\n')
    .replace(/<br\b[^>]*>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;|&#160;|&#x0*a0;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&rsquo;/gi, '’')
    .replace(/&lsquo;/gi, '‘')
    .replace(/&rdquo;/gi, '”')
    .replace(/&ldquo;/gi, '“')
    .replace(/&ndash;/gi, '–')
    .replace(/&mdash;/gi, '—')
    .replace(/&hellip;/gi, '…')
    .replace(/\u00a0/g, ' ')
    .replace(/[\t\f\v ]+/g, ' ')
    .replace(/ +([,.;:!?])/g, '$1')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const [momHtml, acraSource, masHtml] = await Promise.all([
  '../fixtures/statutoryCoverageSources/mom-final-salary.html',
  '../fixtures/statutoryCoverageSources/acra-audit-exemption.txt',
  '../fixtures/statutoryCoverageSources/mas-fund-management.html'
].map(file => readFile(new URL(file, import.meta.url), 'utf8')));
const momSource = visibleFixtureText(momHtml);
const masSource = visibleFixtureText(masHtml);

function replaceInLastSection(source, sectionStart, sectionEnd, before, after) {
  const start = source.lastIndexOf(sectionStart);
  const end = source.indexOf(sectionEnd, start);
  assert.ok(start >= 0 && end > start, `fixture section exists: ${sectionStart}`);
  const section = source.slice(start, end);
  assert.ok(section.includes(before), `fixture mutation premise exists: ${before}`);
  return source.slice(0, start) + section.replace(before, after) + source.slice(end);
}

const requests = [
  {
    authority: 'MOM', topicId: 'mom-salary-payment',
    query: 'When is final salary due after resignation or dismissal, and can tax clearance delay payment?',
    subject: 'Final salary deadline and payment timing', sourceText: momHtml,
    referenceDate: '2026-10-26',
    url: MOM_URL, domain: 'MOM_EMPLOYMENT', population: 'Employee',
    expected: ['required notice is served', 'within 7 days', 'without notice', '3 working days',
      'commission timing follows', 'foreign employee', '30 days']
  },
  {
    authority: 'ACRA', topicId: 'acra_small_company',
    query: 'What tests make a private company a small company for audit exemption?',
    subject: 'Small company audit exemption criteria', sourceText: acraSource,
    url: ACRA_URL, domain: 'ACRA_CORPORATE', population: 'Company',
    expected: ['private in the financial year', 'at least 2 of 3 size criteria', 'S$10 million', 'full-time employees',
      'current-financial-year route', 'foreign entities', 'remains qualified', '01/07/2015', 'financial-statement filing duties']
  },
  {
    authority: 'MAS', topicId: 'mas-vcfm',
    query: 'How does a manager solely managing venture capital funds apply under the VCFM regime, and what admission factors matter?',
    subject: 'Venture capital fund manager admission route', sourceText: masSource,
    url: MAS_URL, domain: 'MAS_FUNDS', population: 'Company',
    expected: ['may apply', 'simplified VCFM regime', 'not automatic eligibility', 'track record', 'Appendix 4']
  },
  {
    authority: 'MAS', topicId: 'mas-fund-management-exemptions',
    query: 'Are there class exemptions from the fund management licensing requirement?',
    subject: 'Conditional class exemptions from fund-management licensing', sourceText: masSource,
    url: MAS_URL, domain: 'MAS_FUNDS', population: 'Company',
    expected: ['does not become exempt merely', 'existing class exemption', 'may be eligible', 'section 99', 'paragraph 5']
  },
  {
    authority: 'MOM', topicId: 'mom-salary-payment',
    query: 'How soon must salary be paid after a resignation without notice?',
    subject: 'Final salary deadline when an employee resigns without notice', sourceText: momHtml,
    url: MOM_URL, domain: 'MOM_EMPLOYMENT', population: 'Employee',
    expected: ['within 7 days', 'last employment day', 'foreign employee', '30 days']
  },
  {
    authority: 'MOM', topicId: 'mom-salary-payment',
    query: 'What timing applies to final salary after dismissal for misconduct?',
    subject: 'Final salary deadline after dismissal for misconduct', sourceText: momHtml,
    url: MOM_URL, domain: 'MOM_EMPLOYMENT', population: 'Employee',
    expected: ['after misconduct dismissal', 'last day or', '3 working days', 'foreign employee']
  },
  {
    authority: 'MAS', topicId: 'mas-vcfm',
    query: 'How does an MAS venture capital fund manager differ from an LFMC?',
    subject: 'Simplified VCFM licensing path and admission eligibility', sourceText: masSource,
    url: MAS_URL, domain: 'MAS_FUNDS', population: 'Company',
    expected: ['at a high level', 'a vcfm as an lfmc', 'simplified VCFM regime', 'not automatic eligibility',
      'does not give a full side-by-side comparison', 'Appendix 4']
  },
  {
    authority: 'MAS', topicId: 'mas-fund-management-exemptions',
    query: 'When can a fund manager operate without an MAS licence?',
    subject: 'Conditional class exemptions from fund-management licensing', sourceText: masSource,
    url: MAS_URL, domain: 'MAS_FUNDS', population: 'Company',
    expected: ['does not become exempt merely', 'existing class exemption', 'may be eligible', 'section 99']
  },
  {
    authority: 'MAS', topicId: 'mas-fund-management-exemptions',
    query: 'Does managing money for a related corporation automatically exempt a firm?',
    subject: 'Whether related-corporation fund management is automatically exempt', sourceText: masSource,
    url: MAS_URL, domain: 'MAS_FUNDS', population: 'Company',
    expected: ['does not become exempt merely', 'related corporation', 'may be eligible', 'paragraph 5']
  },
  {
    authority: 'MAS', topicId: 'mas-fund-management-exemptions',
    query: 'What are examples of fund management activities that may be class exempt?',
    subject: 'Conditional class exemptions from fund-management licensing', sourceText: masSource,
    url: MAS_URL, domain: 'MAS_FUNDS', population: 'Company',
    expected: ['does not become exempt merely', 'immovable-asset pools', 'non-capital-markets-product pools', 'section 99']
  }
];

function sourceFor(request, claims) {
  return {
    key: 'official', title: 'Official guidance', publisher: request.authority,
    documentTitle: 'Official guidance', officialUrl: request.url, provenance: 'LIVE_EXTERNAL',
  claims: claims.map(text => ({
      text, supportKind: 'EXACT_SOURCE_QUOTE', issueIds: ['issue-1'], provenance: 'LIVE_EXTERNAL',
      fetchedSourceBinding: {
        recordId: 'record-1', documentHash: 'a'.repeat(64), canonicalUrl: request.url,
        retrievedAt: '2026-10-25T00:00:00Z'
      }
    }))
  };
}

for (const request of requests) {
  const { authority, topicId, query, subject, sourceText } = request;
  assert.equal(supportMomAcraMasCoverageRule(request), true, `${authority}/${topicId} accepts the complete official wording`);
  const quotes = selectMomAcraMasCoverageQuotes(request);
  assert.equal(quotes.length, 1, `${authority}/${topicId} selects one complete contiguous source passage`);
  assert.equal(supportMomAcraMasCoverageRule({ ...request, sourceText: quotes[0] }), true,
    `${authority}/${topicId} passage independently carries all proof premises`);
  for (const quote of quotes) {
    assert.ok(quote.length <= 3_200, 'Each selected passage stays within the quote bound');
    assert.ok(visibleFixtureText(sourceText).includes(quote), 'Every selected passage is an exact contiguous visible-text source span');
  }

  const issue = {
    id: 'issue-1', subject, population: request.population, operation: topicId.includes('audit') || topicId.includes('small_company') || topicId.includes('exemption') ? 'CHECK_ELIGIBILITY' : 'EXPLAIN_RULE',
    evidenceStatus: 'VERIFIED', applicationStatus: 'UNRESOLVED', claims: [], gaps: []
  };
  const stream = {
    id: 'stream-1', authority, authorityLabel: authority, domain: request.domain, domainLabel: request.domain,
    evidenceStatus: 'VERIFIED', applicationStatus: 'UNRESOLVED', issues: [issue],
    sources: [sourceFor(request, quotes)], gaps: []
  };
  const evidence = getMomAcraMasCoverageEvidence(query, stream, issue);
  assert.ok(evidence, `${authority} answer is rendered from exact issue-bound verified claims`);
  assert.equal(evidence.officialUrl, request.url);
  assert.equal(evidence.authority, authority);
  for (const phrase of request.expected) assert.ok(evidence.text.toLowerCase().includes(phrase.toLowerCase()),
    `${authority} rendered explanation includes the supported qualification: ${phrase}`);
  if (authority === 'MOM') {
    const unknownPopulationIssue = { ...issue, population: 'UNKNOWN' };
    assert.equal(getMomAcraMasCoverageEvidence(query, { ...stream, issues: [unknownPopulationIssue] }, unknownPopulationIssue), undefined,
      'A salary question with unknown population does not receive a personally applied answer.');
  }

  const wrongPopulation = issue.population === 'Company' ? 'Employee' : 'Company';
  const wrongPopulationIssue = { ...issue, population: wrongPopulation };
  assert.equal(getMomAcraMasCoverageEvidence(query, { ...stream, issues: [wrongPopulationIssue] }, wrongPopulationIssue), undefined,
    `${authority} does not render the answer for the wrong population`);
}

const incorrectMomSource = momSource.replace('Within 7 days of the last day of employment.',
  'Within 6 days of the last day of employment.');
assert.equal(supportMomAcraMasCoverageRule({ ...requests[0], sourceText: incorrectMomSource }), false,
  'The MOM rule proof rejects an incorrect no-notice deadline.');
const explicitlyNegatedMomSource = `${momSource}\n\nIt is false that an Employment Act-covered employer must pay salary at least once a month.`;
assert.equal(supportMomAcraMasCoverageRule({ ...requests[0], sourceText: explicitlyNegatedMomSource }), false,
  'MOM positive wording cannot override an explicit statement that the premise is false.');
assert.deepEqual(selectMomAcraMasCoverageQuotes({ ...requests[0], sourceText: explicitlyNegatedMomSource }), [],
  'An explicitly negated MOM premise yields no selected answer quote.');
const negatedMonthlyDuty = momHtml.replace('your employer must pay your salary <strong>at least once a month',
  'your employer must not pay your salary <strong>at least once a month');
assert.equal(supportMomAcraMasCoverageRule({ ...requests[0], sourceText: negatedMonthlyDuty }), false,
  'A negated monthly salary duty cannot pass the MOM proof.');
const negatedCommissionDuty = momHtml.replace('how and when the commission is paid depends on what is',
  'how and when the commission is paid does not depend on what is');
assert.equal(supportMomAcraMasCoverageRule({ ...requests[0], sourceText: negatedCommissionDuty }), false,
  'A negated commission-timing qualification cannot pass the MOM proof.');
assert.deepEqual(selectMomAcraMasCoverageQuotes({ ...requests[0], sourceText: negatedCommissionDuty }), [],
  'A negated commission-timing qualification yields no selected MOM answer quote.');
const negatedTaxClearanceDuty = momHtml.replace('your employer is required to withhold all your monies due to you for',
  'your employer is not required to withhold all your monies due to you for');
assert.equal(supportMomAcraMasCoverageRule({ ...requests[0], sourceText: negatedTaxClearanceDuty }), false,
  'A negated tax-clearance withholding duty cannot pass the MOM proof.');
assert.deepEqual(selectMomAcraMasCoverageQuotes({ ...requests[0], sourceText: negatedTaxClearanceDuty }), [],
  'A negated tax-clearance duty yields no selected MOM answer quote.');
const changedTaxClearanceDuration = momHtml.replace('for up to 30 days upon giving notice', 'for up to 90 days upon giving notice');
assert.equal(supportMomAcraMasCoverageRule({ ...requests[0], sourceText: changedTaxClearanceDuration }), false,
  'The MOM proof rejects an altered tax-clearance withholding duration.');
const negatedMomScenarioSources = [
  replaceInLastSection(momSource, 'Employee resigns and serves the required notice period',
    'Employee resigns and does not serve the notice period', 'On the last day of employment.', 'Not on the last day of employment.'),
  replaceInLastSection(momSource, 'Employee resigns and does not serve the notice period',
    'Dismissal on grounds of misconduct', 'Within 7 days of the last day of employment.', 'Not within 7 days of the last day of employment.'),
  replaceInLastSection(momSource, 'Dismissal on grounds of misconduct', 'Employer terminates the contract',
    'On the last day of employment.', 'Not on the last day of employment.'),
  replaceInLastSection(momSource, 'Dismissal on grounds of misconduct', 'Employer terminates the contract',
    'within 3 working days from date of dismissal.', 'not within 3 working days from date of dismissal.'),
  replaceInLastSection(momSource, 'Employer terminates the contract', 'If your contract involves commission',
    'On the last day of employment.', 'Not on the last day of employment.'),
  replaceInLastSection(momSource, 'Employer terminates the contract', 'If your contract involves commission',
    'within 3 working days from date of termination.', 'not within 3 working days from date of termination.')
];
for (const [index, sourceText] of negatedMomScenarioSources.entries()) {
  assert.equal(supportMomAcraMasCoverageRule({ ...requests[0], sourceText }), false,
    `A negated MOM final-salary scenario deadline ${index + 1} cannot pass the proof.`);
  assert.deepEqual(selectMomAcraMasCoverageQuotes({ ...requests[0], sourceText }), [],
    `A negated MOM final-salary scenario deadline ${index + 1} yields no answer quote.`);
}
assert.equal(supportMomAcraMasCoverageRule({ ...requests[0], query: 'What was the final salary deadline in 2018?' }), false,
  'Historical MOM requests fail closed against the current source proof.');
assert.equal(supportMomAcraMasCoverageRule({ ...requests[0], query: 'When is final salary due before an employee leaves?' }), true,
  'Event-relative wording does not make a current final-salary question historical.');
assert.equal(supportMomAcraMasCoverageRule({ ...requests[0], query: 'What is the final salary rule for 2026?' }), true,
  'An explicit current-year general question remains eligible for the current rule.');
assert.equal(supportMomAcraMasCoverageRule({ ...requests[0], query: 'What is the final salary rule for 2027?' }), false,
  'A future-year request fails closed against the current rule.');
assert.equal(supportMomAcraMasCoverageRule({ ...requests[0], query: 'When is final salary due before 1 January 2026?' }), false,
  'A specific past date fails closed even when it is in the current calendar year.');
assert.equal(supportMomAcraMasCoverageRule({ ...requests[0], query: 'What is the final salary rule as of 1 January 2026?' }), false,
  'An as-of date earlier in the current calendar year fails closed.');
assert.equal(supportMomAcraMasCoverageRule({ ...requests[0], query: 'What is the final salary rule as of 27 October 2026?' }), false,
  'A specific future date fails closed even when it is in the current calendar year.');
const historicalDateQueries = [
  'What were the final salary payment deadlines before 26 October 2026?',
  'What was the final salary rule as of last month?',
  'What was the final salary rule during the previous quarter?'
];
for (const query of historicalDateQueries) {
  assert.equal(supportMomAcraMasCoverageRule({ ...requests[0], query }), false,
    `A relative historical time scope cannot use the current rule: ${query}`);
  assert.deepEqual(selectMomAcraMasCoverageQuotes({ ...requests[0], query }), [],
    `A relative historical time scope yields no current-rule quote: ${query}`);
}
const currentDateQuery = 'What is the final salary rule as of 26 October 2026?';
assert.equal(supportMomAcraMasCoverageRule({ ...requests[0], query: currentDateQuery }), true,
  'An as-of query on the supplied reference date remains eligible.');
assert.equal(selectMomAcraMasCoverageQuotes({ ...requests[0], query: currentDateQuery }).length, 1,
  'The exact current reference date retains its complete source quote.');
const currentDateIssue = { id: 'issue-1', subject: requests[0].subject, population: 'Employee', operation: 'EXPLAIN_RULE',
  evidenceStatus: 'VERIFIED', applicationStatus: 'UNRESOLVED', claims: [], gaps: [] };
const currentDateStream = { id: 'stream-1', authority: 'MOM', authorityLabel: 'MOM', domain: 'MOM_EMPLOYMENT',
  domainLabel: 'MOM', evidenceStatus: 'VERIFIED', applicationStatus: 'UNRESOLVED', issues: [currentDateIssue],
  sources: [sourceFor({ ...requests[0], query: currentDateQuery },
    selectMomAcraMasCoverageQuotes({ ...requests[0], query: currentDateQuery }))], gaps: [] };
const currentRendererDateQuery = `What is the final salary rule as of ${TargetDateResolver.CURRENT_SYSTEM_DATE}?`;
assert.ok(getMomAcraMasCoverageEvidence(currentRendererDateQuery, currentDateStream, currentDateIssue),
  'An exact current as-of date can render the supported salary explanation.');
assert.equal(getMomAcraMasCoverageEvidence('What is the final salary rule before 1 January 2026?',
  currentDateStream, currentDateIssue), undefined,
  'An exact past date cannot render a current salary explanation from present-day evidence.');
const futureRendererDate = new Date(Date.parse(TargetDateResolver.CURRENT_SYSTEM_DATE) + 86_400_000).toISOString().slice(0, 10);
assert.equal(getMomAcraMasCoverageEvidence(`What is the final salary rule as of ${futureRendererDate}?`,
  currentDateStream, currentDateIssue), undefined,
  'An exact future date cannot render a current salary explanation.');
for (const query of historicalDateQueries) {
  assert.equal(getMomAcraMasCoverageEvidence(query, currentDateStream, currentDateIssue), undefined,
    `A relative historical time scope cannot render a current salary explanation: ${query}`);
}
assert.equal(getMomAcraMasCoverageEvidence(historicalDateQueries[0], currentDateStream, currentDateIssue), undefined,
  'A before-date cutoff cannot render current salary guidance even when the cutoff equals the reference date.');
assert.equal(getMomAcraMasCoverageEvidence('What was the final salary rule as of last month?',
  currentDateStream, currentDateIssue), undefined,
  'A relative historical month cannot render current salary guidance.');
assert.equal(supportMomAcraMasCoverageRule({ ...requests[0], query: 'Calculate my final salary payment deadline.' }), false,
  'A calculation request cannot use the general rule answer path.');
assert.equal(supportMomAcraMasCoverageRule({ ...requests[0], topicId: 'mom-salary-deductions' }), undefined,
  'A salary-deductions topic cannot be used to prove final-salary timing.');
const mixedIssue = { id: 'issue-1', subject: 'Final salary and salary deductions', population: 'Employee', operation: 'EXPLAIN_RULE',
  evidenceStatus: 'VERIFIED', applicationStatus: 'UNRESOLVED', claims: [], gaps: [] };
assert.equal(getMomAcraMasCoverageEvidence(requests[0].query,
  { id: 'stream-1', authority: 'MOM', authorityLabel: 'MOM', domain: 'MOM_EMPLOYMENT', domainLabel: 'MOM',
    evidenceStatus: 'VERIFIED', applicationStatus: 'UNRESOLVED', issues: [mixedIssue],
    sources: [sourceFor(requests[0], selectMomAcraMasCoverageQuotes(requests[0]))], gaps: [] },
  mixedIssue), undefined,
'An issue mixing final salary and deductions does not receive the narrow timing answer.');

assert.equal(supportMomAcraMasCoverageRule({ ...requests[1], sourceText: acraSource.replace(/at least two of these quantitative criteria/g, 'one of these quantitative criteria') }), false,
  'ACRA proof rejects an incomplete small-company threshold.');
const wrongCompanyRevenue = acraSource.replace('Total annual revenue of $10 million or less', 'Total annual revenue of $20 million or less');
assert.equal(supportMomAcraMasCoverageRule({ ...requests[1], sourceText: wrongCompanyRevenue }), false,
  'A correct group limit cannot cover an incorrect company revenue limit.');
assert.deepEqual(selectMomAcraMasCoverageQuotes({ ...requests[1], sourceText: wrongCompanyRevenue }), [],
  'A wrong company revenue threshold yields no selected ACRA answer quote.');
const financialCriteria = [
  {
    label: 'company revenue', start: 'Your company meets at least two of these quantitative criteria for the immediate past two consecutive financial years',
    end: 'Detailed exemption criteria', text: 'Total annual revenue of $10 million or less'
  },
  {
    label: 'company assets', start: 'Your company meets at least two of these quantitative criteria for the immediate past two consecutive financial years',
    end: 'Detailed exemption criteria', text: 'Total assets of $10 million or less'
  },
  {
    label: 'group revenue', start: 'Your entire group (including foreign entities)', end: 'Note: The audit exemption applies',
    text: 'Total annual revenue of $10 million or less'
  },
  {
    label: 'group assets', start: 'Your entire group (including foreign entities)', end: 'Note: The audit exemption applies',
    text: 'Total assets of $10 million or less'
  }
];
const financialDenials = [
  { label: 'negation before the threshold', prefix: 'Not ', suffix: '' },
  { label: 'denied qualification after the threshold', prefix: '', suffix: ' does not qualify' },
  { label: 'no longer accepted after the threshold', prefix: '', suffix: ' is no longer accepted' },
  { label: 'false criterion after the threshold', prefix: '', suffix: ' is false' }
];
for (const criterion of financialCriteria) {
  for (const denial of financialDenials) {
    const mutatedCriterion = replaceInLastSection(acraSource, criterion.start, criterion.end,
      criterion.text, `${denial.prefix}${criterion.text}${denial.suffix}`);
    const request = { ...requests[1], sourceText: mutatedCriterion };
    assert.equal(supportMomAcraMasCoverageRule(request), false,
      `A ${criterion.label} threshold with ${denial.label} cannot support the positive ACRA answer.`);
    assert.deepEqual(selectMomAcraMasCoverageQuotes(request), [],
      `A ${criterion.label} threshold with ${denial.label} yields no ACRA answer quote.`);
    const issue = { id: 'issue-1', subject: request.subject, population: 'Company', operation: 'CHECK_ELIGIBILITY',
      evidenceStatus: 'VERIFIED', applicationStatus: 'UNRESOLVED', claims: [], gaps: [] };
    const stream = { id: 'stream-1', authority: 'ACRA', authorityLabel: 'ACRA', domain: 'ACRA_CORPORATE',
      domainLabel: 'ACRA', evidenceStatus: 'VERIFIED', applicationStatus: 'UNRESOLVED', issues: [issue],
      sources: [sourceFor(request, [visibleFixtureText(mutatedCriterion)])], gaps: [] };
    assert.equal(getMomAcraMasCoverageEvidence(request.query, stream, issue), undefined,
      `A ${criterion.label} source with ${denial.label} cannot render the positive audit-exemption explanation.`);
  }
}
const contradictoryCompanyRevenue = replaceInLastSection(acraSource,
  'Your company meets at least two of these quantitative criteria for the immediate past two consecutive financial years',
  'Detailed exemption criteria', 'Total annual revenue of $10 million or less',
  'Total annual revenue of $10 million or less; total annual revenue of $20 million or less');
assert.equal(supportMomAcraMasCoverageRule({ ...requests[1], sourceText: contradictoryCompanyRevenue }), false,
  'Two conflicting company revenue thresholds cannot support a single ACRA criterion.');
const contradictoryGroupAssets = replaceInLastSection(acraSource,
  'Your entire group (including foreign entities)', 'Note: The audit exemption applies',
  'Total assets of $10 million or less', 'Total assets of $10 million or less; total assets of $20 million or less');
assert.equal(supportMomAcraMasCoverageRule({ ...requests[1], sourceText: contradictoryGroupAssets }), false,
  'Two conflicting group asset thresholds cannot support a single ACRA criterion.');
const wrongGroupRevenue = replaceInLastSection(acraSource, 'Your entire group (including foreign entities)', 'Note: The audit exemption applies',
  'Total annual revenue of $10 million or less', 'Total annual revenue of $20 million or less');
assert.equal(supportMomAcraMasCoverageRule({ ...requests[1], sourceText: wrongGroupRevenue }), false,
  'A correct company limit cannot cover an incorrect consolidated group revenue limit.');
const wrongCompanyEmployees = replaceInLastSection(acraSource,
  'Your company meets at least two of these quantitative criteria for the immediate past two consecutive financial years',
  'Detailed exemption criteria', '50 employees or fewer', '150 employees or fewer');
assert.equal(supportMomAcraMasCoverageRule({ ...requests[1], sourceText: wrongCompanyEmployees }), false,
  'The company headcount threshold is parsed as an integer, so 150 cannot satisfy 50.');
const wrongGroupEmployees = replaceInLastSection(acraSource,
  'Your entire group (including foreign entities)', 'Note: The audit exemption applies',
  '50 employees or fewer', '150 employees or fewer');
assert.equal(supportMomAcraMasCoverageRule({ ...requests[1], sourceText: wrongGroupEmployees }), false,
  'The consolidated group headcount threshold independently rejects 150 instead of 50.');
const negatedCompanyEmployees = replaceInLastSection(acraSource,
  'Your company meets at least two of these quantitative criteria for the immediate past two consecutive financial years',
  'Detailed exemption criteria', '50 employees or fewer', 'Not 50 employees or fewer');
assert.equal(supportMomAcraMasCoverageRule({ ...requests[1], sourceText: negatedCompanyEmployees }), false,
  'A negated company headcount premise cannot support the affirmative size criterion.');
const negatedGroupEmployees = replaceInLastSection(acraSource,
  'Your entire group (including foreign entities)', 'Note: The audit exemption applies',
  '50 employees or fewer', 'Not 50 employees or fewer');
assert.equal(supportMomAcraMasCoverageRule({ ...requests[1], sourceText: negatedGroupEmployees }), false,
  'A negated group headcount premise cannot support the affirmative size criterion.');
const withoutMaintenance = replaceInLastSection(acraSource, 'Once your company qualifies as a small company', 'Frequently asked questions',
  'Once your company qualifies as a small company', '');
assert.equal(supportMomAcraMasCoverageRule({ ...requests[1], sourceText: withoutMaintenance }), false,
  'The ACRA proof requires the complete maintaining-exemption section asserted in the answer.');
assert.deepEqual(selectMomAcraMasCoverageQuotes({ ...requests[1], sourceText: withoutMaintenance }), [],
  'Omitting the maintaining-exemption section yields no selected ACRA answer quote.');
assert.equal(supportMomAcraMasCoverageRule({ ...requests[1], sourceText: acraSource.replace(
  'Your company is a private company in the financial year', 'Your company is not a private company in the financial year') }), false,
  'A negated private-company criterion cannot pass the ACRA proof.');
assert.equal(supportMomAcraMasCoverageRule({ ...requests[1], sourceText: acraSource.replace(
  'You qualify for audit exemption if you meet the criteria in the current financial year.',
  'You do not qualify for audit exemption if you meet the criteria in the current financial year.') }), false,
  'A negated newly-incorporated current-year route cannot pass the ACRA proof.');
assert.equal(supportMomAcraMasCoverageRule({ ...requests[1], sourceText: acraSource.replace(
  'Your Singapore company or subsidiary qualifies as a small company',
  'Your Singapore company or subsidiary does not qualify as a small company') }), false,
  'A negated group-company qualification premise cannot pass the ACRA proof.');
const negatedCompanyMaintenance = replaceInLastSection(acraSource, 'Once your company qualifies as a small company', 'Frequently asked questions',
  'you remain qualified in subsequent financial years unless', 'you do not remain qualified in subsequent financial years unless');
assert.equal(supportMomAcraMasCoverageRule({ ...requests[1], sourceText: negatedCompanyMaintenance }), false,
  'A negated company-maintenance premise cannot pass the ACRA proof.');
const negatedGroupMaintenance = replaceInLastSection(acraSource, 'Once your group qualifies as a small group', 'Frequently asked questions',
  'it remains qualified for subsequent financial years', 'it does not remain qualified for subsequent financial years');
assert.equal(supportMomAcraMasCoverageRule({ ...requests[1], sourceText: negatedGroupMaintenance }), false,
  'A negated group-maintenance premise cannot pass the ACRA proof.');
assert.equal(supportMomAcraMasCoverageRule({ ...requests[1], sourceText: `${acraSource}\n\nAll three thresholds must be met.` }), false,
  'ACRA proof rejects a contradictory all-three-criteria claim.');
assert.equal(supportMomAcraMasCoverageRule({ ...requests[1], query: 'Did this company qualify for audit exemption for its 2014 financial year?' }), false,
  'The current ACRA page fails closed for pre-2015 historical eligibility.');
assert.equal(supportMomAcraMasCoverageRule({ ...requests[1], authority: 'MAS' }), undefined,
  'A source from the wrong authority cannot own the ACRA rule.');

assert.equal(supportMomAcraMasCoverageRule({ ...requests[2], sourceText: `${masSource}\n\nA company solely managing VC funds cannot apply to use the VCFM route.` }), false,
  'MAS proof rejects a contradictory VCFM application statement.');
const explicitlyNegatedMasSource = `${masSource}\n\nIt is false that a company solely managing venture capital funds may apply to use the VCFM route.`;
assert.equal(supportMomAcraMasCoverageRule({ ...requests[2], sourceText: explicitlyNegatedMasSource }), false,
  'MAS positive wording cannot override an explicit statement that the premise is false.');
assert.deepEqual(selectMomAcraMasCoverageQuotes({ ...requests[2], sourceText: explicitlyNegatedMasSource }), [],
  'An explicitly negated MAS premise yields no selected answer quote.');
assert.equal(supportMomAcraMasCoverageRule({ ...requests[2], query: 'What detailed VCFM portfolio percentage and quantitative criteria apply?' }), undefined,
  'The high-level licensing page cannot answer detailed VCFM quantitative eligibility.');
assert.equal(supportMomAcraMasCoverageRule({ ...requests[2], query: 'What VCFM admission criteria applied in 2020?' }), false,
  'A current MAS page cannot prove the historical VCFM criteria.');
assert.equal(supportMomAcraMasCoverageRule({ ...requests[2], sourceText: masSource.replace('Appendix 4', 'Appendix 3') }), false,
  'MAS VCFM proof requires the sourced Appendix 4 reference.');
assert.equal(supportMomAcraMasCoverageRule({ ...requests[3], sourceText: `${masSource}\n\nRelated corporation assets are automatically exempt from fund management licensing.` }), false,
  'MAS proof rejects a claim that a related-party example is automatically exempt.');
const negatedRelatedCorporationExample = replaceInLastSection(masSource,
  'Examples of companies that may be eligible for exemption include those that:',
  'You can find more information on exemptions under section 99',
  'Manage assets for related corporations or related family members',
  'Do not manage assets for related corporations or related family members');
assert.equal(supportMomAcraMasCoverageRule({ ...requests[3], sourceText: negatedRelatedCorporationExample }), false,
  'A negated related-corporation list item cannot support an affirmative MAS example.');
assert.deepEqual(selectMomAcraMasCoverageQuotes({ ...requests[3], sourceText: negatedRelatedCorporationExample }), [],
  'A negated related-corporation list item yields no MAS answer quote.');
const nonAccreditedImmovableExample = replaceInLastSection(masSource,
  'Examples of companies that may be eligible for exemption include those that:',
  'You can find more information on exemptions under section 99',
  'Manage a pool of immovable assets for accredited and institutional investors',
  'Manage a pool of immovable assets for non-accredited and institutional investors');
assert.equal(supportMomAcraMasCoverageRule({ ...requests[3], sourceText: nonAccreditedImmovableExample }), false,
  'A non-accredited investor condition cannot support the affirmative immovable-asset example.');
const nonInstitutionalImmovableExample = replaceInLastSection(masSource,
  'Examples of companies that may be eligible for exemption include those that:',
  'You can find more information on exemptions under section 99',
  'Manage a pool of immovable assets for accredited and institutional investors',
  'Manage a pool of immovable assets for accredited and non-institutional investors');
assert.equal(supportMomAcraMasCoverageRule({ ...requests[3], sourceText: nonInstitutionalImmovableExample }), false,
  'A non-institutional investor condition cannot support the affirmative immovable-asset example.');
const nonAccreditedNonCapitalExample = replaceInLastSection(masSource,
  'Examples of companies that may be eligible for exemption include those that:',
  'You can find more information on exemptions under section 99',
  'Manage a pool of non-capital markets products for accredited and institutional investors',
  'Manage a pool of non-capital markets products for non-accredited and institutional investors');
assert.equal(supportMomAcraMasCoverageRule({ ...requests[3], sourceText: nonAccreditedNonCapitalExample }), false,
  'A non-accredited investor condition cannot support the affirmative non-capital-markets example.');

const mixedVcfmClassRequest = { ...requests[3], subject: 'VCFM class exemptions from fund-management licensing' };
assert.equal(supportMomAcraMasCoverageRule(mixedVcfmClassRequest), true,
  'Complete MAS source evidence can support the class-exemption rule independently of a mixed subject label.');
const mixedVcfmClassIssue = { id: 'issue-1', subject: mixedVcfmClassRequest.subject, population: 'Company', operation: 'CHECK_ELIGIBILITY',
  evidenceStatus: 'VERIFIED', applicationStatus: 'UNRESOLVED', claims: [], gaps: [] };
const mixedVcfmClassStream = {
  id: 'stream-1', authority: 'MAS', authorityLabel: 'MAS', domain: 'MAS_FUNDS', domainLabel: 'MAS',
  evidenceStatus: 'VERIFIED', applicationStatus: 'UNRESOLVED', issues: [mixedVcfmClassIssue],
  sources: [sourceFor(mixedVcfmClassRequest, selectMomAcraMasCoverageQuotes(mixedVcfmClassRequest))], gaps: []
};
assert.equal(getMomAcraMasCoverageEvidence(mixedVcfmClassRequest.query, mixedVcfmClassStream, mixedVcfmClassIssue), undefined,
  'A mixed VCFM/class-exemption issue label cannot receive the class-only rendered answer.');

const vcfmDifferenceRequest = requests.find(request => request.query === 'How does an MAS venture capital fund manager differ from an LFMC?');
assert.ok(vcfmDifferenceRequest, 'The direct VCFM/LFMC overview case exists.');
const vcfmVerifiedIssue = { id: 'issue-1', subject: vcfmDifferenceRequest.subject, population: 'Company', operation: 'CHECK_ELIGIBILITY',
  evidenceStatus: 'VERIFIED', applicationStatus: 'UNRESOLVED', claims: [], gaps: [] };
const lfmcUnresolvedIssue = { id: 'lfmc-issue', subject: 'Licensed Fund Management Company', population: 'UNKNOWN', operation: 'OTHER',
  evidenceStatus: 'INSUFFICIENT', applicationStatus: 'UNRESOLVED', claims: [], gaps: ['The full LFMC comparison is not established.'] };
const streamWithResidualGap = {
  id: 'stream-1', authority: 'MAS', authorityLabel: 'MAS', domain: 'MAS_FUNDS', domainLabel: 'MAS',
  evidenceStatus: 'INSUFFICIENT', applicationStatus: 'UNRESOLVED', issues: [vcfmVerifiedIssue, lfmcUnresolvedIssue],
  sources: [sourceFor(vcfmDifferenceRequest, selectMomAcraMasCoverageQuotes(vcfmDifferenceRequest))],
  gaps: ['The separate LFMC comparison remains unresolved.']
};
const scopedVcfmEvidence = getMomAcraMasCoverageEvidence(vcfmDifferenceRequest.query, streamWithResidualGap, vcfmVerifiedIssue);
assert.ok(scopedVcfmEvidence?.text.includes('At a high level'),
  'A complete answer for the verified VCFM issue renders despite an insufficient sibling issue.');
assert.equal(streamWithResidualGap.evidenceStatus, 'INSUFFICIENT',
  'Rendering one verified issue does not promote the overall workstream status.');
assert.deepEqual(streamWithResidualGap.gaps, ['The separate LFMC comparison remains unresolved.'],
  'Rendering one verified issue preserves the separate LFMC comparison gap.');
const insufficientVcfmIssue = { ...vcfmVerifiedIssue, evidenceStatus: 'INSUFFICIENT' };
assert.equal(getMomAcraMasCoverageEvidence(vcfmDifferenceRequest.query,
  { ...streamWithResidualGap, issues: [insufficientVcfmIssue, lfmcUnresolvedIssue] }, insufficientVcfmIssue), undefined,
  'An insufficient target issue cannot render even when exact source claims are present.');

const wrongIssue = { ...requests[3] };
const wrongIssueRecord = { id: 'different-issue', subject: requests[3].subject, population: 'Company', operation: 'CHECK_ELIGIBILITY',
  evidenceStatus: 'VERIFIED', applicationStatus: 'UNRESOLVED', claims: [], gaps: [] };
const wrongIssuePresentation = {
  id: 'stream-1', authority: 'MAS', authorityLabel: 'MAS', domain: 'MAS_FUNDS', domainLabel: 'MAS',
  evidenceStatus: 'VERIFIED', applicationStatus: 'UNRESOLVED', issues: [wrongIssueRecord],
  sources: [sourceFor(requests[3], selectMomAcraMasCoverageQuotes(requests[3]))], gaps: []
};
assert.equal(getMomAcraMasCoverageEvidence(requests[3].query, wrongIssuePresentation,
  { ...wrongIssue, id: 'different-issue' }), undefined,
'Claims bound to another issue cannot support the displayed rule.');

const completeAcraQuote = selectMomAcraMasCoverageQuotes(requests[1])[0];
const splitRevisionClaims = [completeAcraQuote.slice(0, Math.floor(completeAcraQuote.length / 2)),
  completeAcraQuote.slice(Math.floor(completeAcraQuote.length / 2))].map((text, index) => ({
  text, supportKind: 'EXACT_SOURCE_QUOTE', issueIds: ['issue-1'], provenance: 'LIVE_EXTERNAL',
  fetchedSourceBinding: {
    recordId: 'record-1', documentHash: (index % 2 ? 'b' : 'a').repeat(64), canonicalUrl: ACRA_URL,
    retrievedAt: `2026-10-25T01:00:0${index}Z`
  }
}));
const splitRevisionStream = {
  id: 'stream-1', authority: 'ACRA', authorityLabel: 'ACRA', domain: 'ACRA_CORPORATE', domainLabel: 'ACRA',
  evidenceStatus: 'VERIFIED', applicationStatus: 'UNRESOLVED', issues: [{ id: 'issue-1', subject: requests[1].subject,
    population: 'Company', operation: 'CHECK_ELIGIBILITY', evidenceStatus: 'VERIFIED', applicationStatus: 'UNRESOLVED', claims: [], gaps: [] }],
  sources: [{ ...sourceFor(requests[1], []), claims: splitRevisionClaims }], gaps: []
};
assert.equal(getMomAcraMasCoverageEvidence(requests[1].query, splitRevisionStream,
  { id: 'issue-1', subject: requests[1].subject, population: 'Company', operation: 'CHECK_ELIGIBILITY',
    evidenceStatus: 'VERIFIED', applicationStatus: 'UNRESOLVED', claims: [], gaps: [] }), undefined,
'Eligibility premises from different document revisions cannot be combined into one answer.');

const staleStream = {
  ...wrongIssuePresentation,
  issues: [{ ...wrongIssueRecord, id: 'issue-1' }],
  sources: [{ ...sourceFor(requests[3], selectMomAcraMasCoverageQuotes(requests[3])), validTo: '2026-10-01' }]
};
assert.equal(getMomAcraMasCoverageEvidence(requests[3].query, staleStream,
  { id: 'issue-1', subject: requests[3].subject, population: 'Company', operation: 'CHECK_ELIGIBILITY',
    evidenceStatus: 'VERIFIED', applicationStatus: 'UNRESOLVED', claims: [], gaps: [] }), undefined,
'A source marked expired cannot support a current answer.');

console.log('MOM, ACRA and MAS practical coverage rule regression passed.');
