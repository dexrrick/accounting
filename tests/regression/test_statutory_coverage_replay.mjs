import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  getAcraAnnualReturnDeadlineMonths,
  getAcraAnnualReturnDeadlineTablePassage,
  supportsAcraAnnualReturnDeadlineEvidence,
  supportsAcraAnnualReturnFilingRule
} from '../../src/retrieval/acraAnnualReturnFilingRule.ts';
import { getCoverageTopicById } from '../../src/standards/coverageRegistry.ts';
import { provesMomSalaryPaymentSource, supportMomSalaryPaymentIssue } from '../../src/retrieval/momSalaryPaymentRule.ts';
import { supportMomAcraMasCoverageRule } from '../../src/retrieval/momAcraMasCoverageRules.ts';
import { defaultExternalSourceValidator } from '../../src/retrieval/externalSourceValidator.ts';
import { STATUTORY_COVERAGE_OFFICIAL_PAGE_FIXTURES } from '../fixtures/statutoryCoverageOfficialPages.mjs';
import { replayStatutoryCoverageCase } from '../../scripts/replay_statutory_coverage.mjs';

const corpus = JSON.parse(await readFile(new URL('../evaluation/statutory_coverage_wave_2026-10-25.json', import.meta.url), 'utf8'));
assert.equal(corpus.cases.length, 100);
assert.deepEqual(corpus.authorityCounts, { IRAS: 20, CPF: 20, MOM: 20, ACRA: 20, MAS: 20 });

const wordCount = html => html.replace(/<[^>]*>/g, ' ').trim().split(/\s+/).filter(Boolean).length;
const fixtureText = id => {
  const fixture = STATUTORY_COVERAGE_OFFICIAL_PAGE_FIXTURES.find(page => page.id === id);
  assert.ok(fixture, `fixture ${id} exists`);
  return fixture.html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
};
const fullNoticeSalaryQuestion = 'When is final salary due if an employee serves the full notice period?';
const finalNoticeQuote = 'If an employee resigns after serving required notice, final salary is due on the last employment day.';
const nativeFinalSalaryRequest = {
  authority: 'MOM', topicId: 'mom-salary-payment', query: fullNoticeSalaryQuestion,
  subject: 'Final salary deadline when an employee resigns with required notice'
};
assert.equal(supportMomAcraMasCoverageRule({ ...nativeFinalSalaryRequest, sourceText: fixtureText('mom-salary') }), true,
  'The paying-salary page proves the exact full-notice final-salary question and retains its tax-clearance caveat.');
assert.equal(supportMomAcraMasCoverageRule({ ...nativeFinalSalaryRequest, sourceText: fixtureText('mom-salary-deductions') }), false,
  'The actual salary-deductions page cannot prove a final-salary payment deadline.');
assert.equal(supportMomSalaryPaymentIssue(fullNoticeSalaryQuestion,
  'Final salary deadline when an employee resigns with required notice', finalNoticeQuote), true,
  'An exact issue-bound full-notice deadline quote supports the requested scenario.');
assert.equal(supportMomSalaryPaymentIssue(fullNoticeSalaryQuestion,
  'Final salary deadline when an employee resigns with required notice', fixtureText('mom-salary-deductions')), false,
  'Deduction caps and final-payment deductions do not support the timing issue.');
const regularSingleDeadlineQuestion = 'When must regular salary be paid after the salary period ends?';
const regularMonthlyDeadlineProof = 'In accordance with the Employment Act, your employer must pay your salary at least once a month and within 7 days after the end of the salary period.';
assert.equal(provesMomSalaryPaymentSource(regularSingleDeadlineQuestion, regularMonthlyDeadlineProof), true,
  'A single current regular-salary deadline question can reuse complete monthly-and-seven-day proof.');
assert.equal(provesMomSalaryPaymentSource('How often must salary be paid under the Employment Act?', regularMonthlyDeadlineProof), true,
  'How-often wording can reuse the same complete regular-salary proof.');

const fixtureTopics = new Set();
for (const fixture of STATUTORY_COVERAGE_OFFICIAL_PAGE_FIXTURES) {
  const source = new URL(fixture.sourceUrl);
  assert.equal(source.protocol, 'https:');
  assert.ok(source.hostname.endsWith('.gov.sg'));
  assert.equal(fixture.researched, '2026-10-25');
  assert.ok(fixture.authorityPublisher);
  assert.ok(fixture.fixtureHtmlTitle.includes(fixture.authorityPublisher));
  assert.match(fixture.fixtureHtmlTitle, /\(offline fixture title\)$/);
  assert.ok(wordCount(fixture.html) < (fixture.fixtureKind.startsWith('VERIFIED_OFFICIAL_') ? 850 : 150),
    `${fixture.id} stays a bounded qualified offline excerpt or paraphrase`);
  assert.match(fixture.provenanceNote, /not a full captured page|not a downloaded or complete official page|not a complete (?:page|raw capture)/i,
    'Fixture provenance clearly says the text is a bounded synthetic body or selected excerpt.');
  assert.doesNotMatch(fixture.html, /validFrom|validTo|effectiveFrom|effectiveTo/i,
    'No unverified effective-date range is attached to a source fixture.');
  for (const topicId of fixture.topicIds) {
    assert.ok(getCoverageTopicById(topicId), `${fixture.id} points to a registered topic ${topicId}`);
    fixtureTopics.add(topicId);
  }
}
assert.ok(STATUTORY_COVERAGE_OFFICIAL_PAGE_FIXTURES.some(fixture => fixture.fixtureKind === 'RETAINED_REGRESSION_EXCERPT'));
assert.ok(STATUTORY_COVERAGE_OFFICIAL_PAGE_FIXTURES.some(fixture => fixture.fixtureKind === 'PURPOSE_WRITTEN_PARAPHRASE'));

const annualReturnFixture = STATUTORY_COVERAGE_OFFICIAL_PAGE_FIXTURES.find(fixture => fixture.id === 'acra-annual-returns');
const annualReturnText = annualReturnFixture.html
  .replace(/<br\s*\/?>/gi, '\n')
  .replace(/<\/?(?:h1|p|main|body|html|head|title)\b[^>]*>/gi, '\n')
  .replace(/<[^>]*>/g, ' ');
assert.equal(supportsAcraAnnualReturnFilingRule(annualReturnText), true, 'The annual-return fixture contains an operative filing duty.');
assert.ok(getAcraAnnualReturnDeadlineTablePassage(annualReturnText), `The deadline table is structurally complete: ${annualReturnText}`);
assert.equal(supportsAcraAnnualReturnDeadlineEvidence(annualReturnText), true,
  `The offline annual-return body preserves both the operative filing duty and the linked official deadline table structure. Text: ${annualReturnText}`);
for (const [facts, months] of [
  [{ listingStatus: 'LISTED', hasOverseasBranchRegister: false }, 5],
  [{ listingStatus: 'LISTED', hasOverseasBranchRegister: true, hasShareCapital: true }, 6],
  [{ listingStatus: 'NON_LISTED', hasOverseasBranchRegister: false }, 7],
  [{ listingStatus: 'NON_LISTED', hasOverseasBranchRegister: true, hasShareCapital: true }, 8]
]) {
  assert.equal(getAcraAnnualReturnDeadlineMonths(annualReturnText, facts), months,
    'The retained table carries the appropriate standard or branch-register timeline for both listing categories.');
}

const representedFamilies = new Set();
const representatives = [];
for (const testCase of corpus.cases) {
  const familyKey = `${testCase.authority}/${testCase.family}`;
  if (representedFamilies.has(familyKey)) continue;
  if (!testCase.requiredTopicIds.some(topicId => fixtureTopics.has(topicId))) continue;
  representedFamilies.add(familyKey);
  representatives.push(testCase);
}
assert.ok(representatives.length >= 15, `Expected broad fixture coverage, got ${representatives.length} families`);

for (const testCase of representatives) {
  const result = await replayStatutoryCoverageCase(testCase);
  assert.equal(result.id, testCase.id);
  assert.notEqual(result.pipelineStatus, 'PIPELINE_ERROR', `${testCase.id}: ${result.error || ''}`);
  assert.equal(result.semanticOracle?.kind, 'EXPLICIT_FIXTURE');
  assert.equal(result.semanticOracle?.interpretationIndependentlyExercised, false,
    'The replay does not claim to test live semantic model interpretation.');
  assert.ok(Array.isArray(result.resolverTopicIds), 'The real query resolver ran on the original query.');
  assert.ok(Array.isArray(result.issueMappedTopicIds), 'Reconciled production topic mapping is recorded.');
  assert.equal(typeof result.expectedTopicIdResolved, 'boolean');
  assert.ok(Array.isArray(result.retrievalTrace?.attempts), 'The detailed production evidence trace is retained.');
  for (const attempt of result.retrievalTrace.attempts) {
    assert.ok(attempt.topicId && attempt.status);
    if (attempt.status === 'TOPIC_MISMATCH') assert.ok(attempt.error, 'Rejected attempts retain the actual validation reason.');
  }
  assert.ok(result.fixtureIds.length > 0, `${testCase.id} has a page fixture for its topic family`);
  assert.equal(typeof result.response, 'string');
  assert.equal(typeof result.pipelineStatus, 'string');
  for (const citation of result.citations) {
    assert.ok(STATUTORY_COVERAGE_OFFICIAL_PAGE_FIXTURES.some(fixture => fixture.sourceUrl === citation.url),
      `${testCase.id} cites only the bounded offline official-page fixture set`);
    assert.ok(result.fetches.includes(citation.url), `${testCase.id} cites a URL actually fetched by its fixture transport`);
    assert.ok(result.response.includes(citation.url), `${testCase.id} rendered response retains the cited URL`);
    const sourceFixture = STATUTORY_COVERAGE_OFFICIAL_PAGE_FIXTURES.find(fixture => fixture.sourceUrl === citation.url);
    // Mirror the production extraction profile for this source. In particular,
    // IRAS retains headings and does not require a substantive-body slice;
    // the latter intentionally omits some exact native IRAS filing headings.
    // Browsers display named apostrophe entities as their visible character;
    // the generic validator helper does not decode this named entity.
    const fixtureHtml = sourceFixture.html.replace(/&rsquo;/gi, '’');
    const fixtureText = (defaultExternalSourceValidator.validateTopicContent(fixtureHtml, {
      standardIdentifiers: [], expectedTitles: [], topicTerms: [],
      preferMainContent: sourceFixture.authority === 'ACRA',
      requireSubstantiveBody: ['CPF', 'ACRA', 'MOM', 'MAS'].includes(sourceFixture.authority)
    }).substantiveText || '').replace(/\s+([,.;:!?])/g, '$1').replace(/\s+/g, ' ').trim();
    for (const claim of citation.claims.filter(item => item.supportKind === 'EXACT_SOURCE_QUOTE')) {
      const exactQuote = (claim.quote || claim.text).replace(/\s+([,.;:!?])/g, '$1').replace(/\s+/g, ' ').trim();
      assert.ok(exactQuote && fixtureText.includes(exactQuote), `${testCase.id} exact quote comes from the fetched fixture body`);
      assert.ok(claim.sourceBinding || claim.fetchedSourceBinding, `${testCase.id} exact quote keeps a document binding`);
      if (claim.fetchedSourceBinding) assert.equal(claim.fetchedSourceBinding.canonicalUrl, citation.url);
    }
  }
  if (testCase.id === 'mom-final-salary-01' && result.pipelineStatus === 'VERIFIED') {
    assert.ok(result.citations.some(citation => citation.url === 'https://www.mom.gov.sg/employment-practices/salary/paying-salary'),
      'A verified full-notice final-salary answer must cite the paying-salary fixture.');
    assert.equal(result.citations.some(citation => citation.url === 'https://www.mom.gov.sg/employment-practices/salary/salary-deductions'), false,
      'Salary deductions cannot be the evidence source for a verified final-salary deadline.');
  }
  assert.ok(result.citationScopeAudit);
  assert.deepEqual(result.citationScopeAudit.citedSourceUrls, result.citations.map(source => source.url));
  for (const url of result.fetches) {
    assert.ok(STATUTORY_COVERAGE_OFFICIAL_PAGE_FIXTURES.some(fixture => fixture.sourceUrl === url) ||
      /\/sitemap(?:\.xml)?$/.test(url) || url.endsWith('/robots.txt') ||
      url.startsWith('https://html.duckduckgo.com/') || url.startsWith('https://r.jina.ai/'),
    `${testCase.id} fetch was intercepted by an offline fixture/negative lookup: ${url}`);
  }
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /humanReview|independentReview|HUMAN_REVIEW_CORRECT/i,
    'No human adjudication is fabricated by a technical replay.');
}

for (const [id, expectedDeadline] of [
  ['mom-final-salary-02', /within 7 days/i],
  ['mom-final-salary-03', /within 3 working days/i]
]) {
  const testCase = corpus.cases.find(candidate => candidate.id === id);
  assert.ok(testCase, `${id} is present in the statutory coverage corpus`);
  const result = await replayStatutoryCoverageCase(testCase);
  assert.equal(result.semanticOracle?.population, 'EMPLOYEE',
    `${id} explicit resignation/dismissal scenario uses the employee population`);
  assert.equal(result.pipelineStatus, 'VERIFIED', `${id} renders a source-backed final-salary answer`);
  assert.match(result.response, expectedDeadline, `${id} rendered answer states the applicable deadline`);
}

for (const [id, expectedAnswer] of [
  ['mas-class-exemptions-03', /does not become exempt merely because it manages assets for a related corporation/i],
  ['mas-class-exemptions-04', /non-capital-markets-product pools/i]
]) {
  const testCase = corpus.cases.find(candidate => candidate.id === id);
  assert.ok(testCase, `${id} is present in the statutory coverage corpus`);
  const result = await replayStatutoryCoverageCase(testCase);
  assert.equal(result.pipelineStatus, 'VERIFIED', `${id} renders a source-backed class-exemption answer`);
  assert.ok(result.citations.some(citation => citation.url === 'https://www.mas.gov.sg/regulation/capital-markets/apply-for-licensing-or-registration-of-capital-market-entities/fund-management-licensing'),
    `${id} cites the MAS fund-management licensing page`);
  assert.match(result.response, expectedAnswer, `${id} rendered answer addresses the requested exemption question`);
}

console.log(`Statutory coverage replay regression passed: ${representatives.length} production-pipeline family cases across ${new Set(representatives.map(row => row.authority)).size} authorities.`);
