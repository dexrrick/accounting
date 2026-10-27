import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  ACRA_AGM_DUE_DATES_URL,
  ACRA_ANNUAL_RETURN_DUE_DATES_URL,
  ACRA_MOM_PRACTICAL_RULES_20261027,
  MOM_OVERTIME_URL,
  getAcraMomPracticalEvidence,
  hasAcraMomPracticalContradiction,
  selectAcraMomPracticalQuotes,
  supportAcraMomPracticalRule
} from '../../src/retrieval/acraMomPracticalRules20261027.ts';
import { getMomSalaryPaymentRuleEvidence, provesMomSalaryPaymentSource, selectMomSalaryPaymentRuleQuote, supportMomSalaryPaymentIssue } from '../../src/retrieval/momSalaryPaymentRule.ts';
import { selectMomAcraMasCoverageQuotes } from '../../src/retrieval/momAcraMasCoverageRules.ts';
import { verifyEvidenceClaims } from '../../src/verification/claimEvidenceVerifier.ts';
import { renderAuthorityEvidenceResponseText } from '../../src/services/authorityEvidenceResponse.ts';
import { STATUTORY_COVERAGE_OFFICIAL_PAGE_FIXTURES } from '../fixtures/statutoryCoverageOfficialPages.mjs';
import { cleanHtmlText } from '../../src/retrieval/sourceAdapters.ts';

const fixtureDir = new URL('../fixtures/statutoryDevelopment20261027/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('acra-mom-source-manifest.json', fixtureDir), 'utf8'));
const fixtures = Object.fromEntries(manifest.sources.map(entry => [
  entry.fixture.replace(/\.txt$/, '').replace(/^acra-/, '').replace(/^mom-/, ''),
  readFileSync(new URL(entry.fixture, fixtureDir), 'utf8')
]));
const normalized = value => value.replace(/&#x0*a0;|&#160;|&nbsp;/gi, ' ').replace(/&#39;|&#x27;|&apos;/gi, "'")
  .replace(/&ndash;/gi, '–').replace(/&times;/gi, '×').replace(/\s+/g, ' ').trim().toLowerCase();
const cases = [
  { id: 'agm', authority: 'ACRA', topicId: 'acra_agm', query: 'How soon after year end must a company hold its annual shareholder meeting?', subject: 'Annual general meeting timing, exemptions and member rights', sourceText: fixtures.agm, officialUrl: ACRA_AGM_DUE_DATES_URL, file: 'acra-agm.txt', expected: 'four months' },
  { id: 'annual-return', authority: 'ACRA', topicId: 'acra_annual-returns', query: 'Does an inactive company still send its yearly filing to ACRA, and when is it due?', subject: 'Company annual return duty and filing deadline', sourceText: fixtures['annual-returns'], officialUrl: ACRA_ANNUAL_RETURN_DUE_DATES_URL, file: 'acra-annual-returns.txt', expected: 'seven months' },
  { id: 'overtime', authority: 'MOM', topicId: 'mom-part-iv-overtime', query: 'What overtime pay and limits apply under Part IV?', subject: 'Part IV employee overtime eligibility and pay', sourceText: fixtures.overtime, officialUrl: MOM_OVERTIME_URL, file: 'mom-overtime.txt', expected: '$4,500' }
];

for (const entry of manifest.sources) {
  const bytes = readFileSync(new URL(entry.fixture, fixtureDir));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.fixtureSha256,
    `${entry.fixture}: exact selected source fixture matches the capture manifest`);
}

for (const sample of cases) {
  const selected = selectAcraMomPracticalQuotes(sample);
  assert.ok(selected.length >= 3, `${sample.id}: complete source supports selected premises`);
  assert.equal(supportAcraMomPracticalRule({ ...sample, sourceText: selected.join('\n\n') }), true,
    `${sample.id}: selected exact source premises still prove the complete rule`);
  const fixtureText = normalized(sample.sourceText);
  assert.ok(selected.every(quote => fixtureText.includes(normalized(quote))),
    `${sample.id}: every selected quote is present in the official cleaned-text fixture`);
  assert.equal(supportAcraMomPracticalRule({ ...sample, sourceText: '' }), false,
    `${sample.id}: missing source premises fail closed`);
  assert.equal(supportAcraMomPracticalRule({ ...sample, officialUrl: 'https://example.com/official' }), false,
    `${sample.id}: wrong source URL cannot support the rule`);
  assert.equal(supportAcraMomPracticalRule({ ...sample, subject: 'Unrelated payroll topic' }), undefined,
    `${sample.id}: another issue remains outside this rule family`);
  assert.equal(supportAcraMomPracticalRule({ ...sample, sourceText: sample.sourceText.replace(sample.expected, 'one month') }), false,
    `${sample.id}: an incorrect deadline or threshold fails full-family proof`);
  assert.ok(selected.every(text => text.length < 5_000), `${sample.id}: every selected excerpt is bounded`);
}

assert.equal(supportAcraMomPracticalRule({ ...cases[0], query: 'What AGM deadline applied for FYE 31 December 2017?' }), false,
  'The AGM table does not establish periods before its stated 31 August 2018 boundary.');
assert.equal(supportAcraMomPracticalRule({ ...cases[0], query: 'What was the AGM deadline for FYE 31 December 2019?' }), false,
  'A historic AGM filing application is not inferred from the current table.');
assert.equal(supportAcraMomPracticalRule({ ...cases[0], query: 'What AGM deadlines apply to FYEs ending on or after 31 August 2018?' }), true,
  'The exact official cutoff can be stated as a general rule without applying it to a particular historic FYE.');
assert.equal(supportAcraMomPracticalRule({ ...cases[0], query: 'What AGM deadline applied in 2018?' }), false,
  'A bare year does not establish that an FYE ended on or after 31 August 2018.');
assert.equal(supportAcraMomPracticalRule({ ...cases[0], query: 'What will the AGM deadline be for FYE 31 December 2027?' }), false,
  'Future application is not inferred from today’s page.');
assert.equal(supportAcraMomPracticalRule({ ...cases[0], query: 'What AGM deadline will apply next year?' }), false,
  'A relative future period is not inferred from today’s page.');
assert.equal(supportAcraMomPracticalRule({ ...cases[0], query: 'We need to plan our next AGM. Can you tell us the last day to hold it?' }), true,
  'A request for the deadline day can receive the verified general rule while company-specific date facts remain unknown.');
assert.equal(supportAcraMomPracticalRule({ ...cases[0], query: 'What AGM deadline applies before 2026?' }), false,
  'A broad historical cutoff does not establish the applicable deadline.');
assert.equal(supportAcraMomPracticalRule({ ...cases[0], query: 'What AGM deadline applies after 2026?' }), false,
  'A broad future cutoff does not establish the applicable deadline.');
assert.equal(supportAcraMomPracticalRule({ ...cases[1], query: 'What was the annual return deadline for FYE 31 December 2025?' }), false,
  'A current annual-return table does not establish a historic filing period.');
assert.equal(supportAcraMomPracticalRule({ ...cases[2], query: 'What overtime threshold applied in 2025?' }), false,
  'A current MOM page does not establish historic salary thresholds.');

for (const [sample, contradiction] of [
  [cases[0], 'Companies do not have to declare AGM details when filing an annual return.'],
  [cases[1], 'Dormant companies do not need to file annual returns.'],
  [cases[2], 'Part IV covers managers and executives.']
]) {
  const contradicted = { ...sample, sourceText: `${sample.sourceText}\n${contradiction}` };
  assert.equal(supportAcraMomPracticalRule(contradicted), false,
    `${sample.id}: a direct contradiction must fail closed`);
  assert.equal(hasAcraMomPracticalContradiction(contradicted), true,
    `${sample.id}: contradiction-only signal is exported for the aggregator`);
}

function evidenceFor(sample) {
  const id = 'rule-issue';
  const digest = createHash('sha256').update(sample.sourceText).digest('hex');
  const retrievedAt = '2026-10-27T00:00:00Z';
  const claim = {
    text: sample.sourceText,
    supportKind: 'EXACT_SOURCE_QUOTE',
    issueIds: [id],
    provenance: 'LIVE_EXTERNAL',
    fetchedSourceBinding: {
      recordId: `record-${sample.id}`,
      documentHash: digest,
      canonicalUrl: sample.officialUrl,
      retrievedAt
    }
  };
  const issue = {
    id, subject: sample.subject, population: sample.authority === 'MOM' ? 'Employee' : 'Company',
    operation: 'EXPLAIN_RULE', evidenceStatus: 'VERIFIED', applicationStatus: 'UNRESOLVED', claims: [claim], gaps: []
  };
  const source = {
    key: `source-${sample.id}`, title: sample.id, publisher: sample.authority, documentTitle: sample.id,
    officialUrl: sample.officialUrl, provenance: 'LIVE_EXTERNAL', claims: [claim]
  };
  return {
    issue,
    stream: {
      id: `workstream-${sample.id}`, authority: sample.authority, authorityLabel: sample.authority,
      domain: sample.authority === 'MOM' ? 'MOM_EMPLOYMENT' : 'ACRA_CORPORATE', domainLabel: 'Statutory rules',
      evidenceStatus: 'VERIFIED', applicationStatus: 'UNRESOLVED', issues: [issue], sources: [source], gaps: []
    }
  };
}

for (const sample of cases) {
  const { issue, stream } = evidenceFor(sample);
  const evidence = getAcraMomPracticalEvidence(sample.query, stream, issue);
  assert.ok(evidence, `${sample.id}: full issue-bound source permits a general rule answer with unresolved case application`);
  assert.match(evidence.text, /depends on|requires|applying|individual conclusion|specific conclusion/i,
    `${sample.id}: answer states which facts remain necessary`);
  if (sample.id === 'agm') {
    assert.match(evidence.text, /14 days before the six-month deadline/i);
    assert.match(evidence.text, /within 14 days of the request/i);
  } else if (sample.id === 'overtime') {
    assert.match(evidence.text, /S\$13\.60 hourly/i);
    assert.match(evidence.text, /1\.5 times/i);
  }

  const split = evidenceFor(sample);
  const quotes = selectAcraMomPracticalQuotes(sample);
  const firstClaim = {
    ...split.stream.sources[0].claims[0], text: quotes.slice(0, 1).join('\n\n'),
    fetchedSourceBinding: { ...split.stream.sources[0].claims[0].fetchedSourceBinding, documentHash: 'b'.repeat(64) }
  };
  const secondClaim = {
    ...split.stream.sources[0].claims[0], text: quotes.slice(1).join('\n\n'),
    fetchedSourceBinding: { ...split.stream.sources[0].claims[0].fetchedSourceBinding, documentHash: 'c'.repeat(64) }
  };
  split.stream.sources[0].claims = [firstClaim, secondClaim];
  split.issue.claims = [firstClaim, secondClaim];
  assert.equal(getAcraMomPracticalEvidence(sample.query, split.stream, split.issue), undefined,
    `${sample.id}: claims split across page revisions cannot establish a complete rule`);

  const caseConclusion = evidenceFor(sample);
  caseConclusion.issue.applicationStatus = 'VERIFIED';
  assert.equal(getAcraMomPracticalEvidence(sample.query, caseConclusion.stream, caseConclusion.issue), undefined,
    `${sample.id}: rule explanation cannot turn a case-specific application into verified`);
}

const naturalAcraCases = [
  { id: 'acra-agm-comparison', authority: 'ACRA', topicId: 'acra_agm', query: 'How many months after closing the accounts does a listed company get for its AGM compared with a non-listed company?', subject: 'AGM deadlines after financial year end by listed status', sourceText: fixtures.agm, officialUrl: ACRA_AGM_DUE_DATES_URL },
  { id: 'acra-agm-member-right', authority: 'ACRA', topicId: 'acra_agm', query: 'If a private company sends its accounts out within five months, can a shareholder still insist on a meeting?', subject: 'Private-company AGM exemption and member meeting-request safeguards', sourceText: fixtures.agm, officialUrl: ACRA_AGM_DUE_DATES_URL },
  { id: 'acra-annual-return-dormant', authority: 'ACRA', topicId: 'acra_annual-returns', query: 'Our company has stopped trading and IRAS waived its tax filing. Must it still lodge anything annually with ACRA?', subject: 'ACRA annual-return duty of dormant companies despite IRAS tax waiver', sourceText: fixtures['annual-returns'], officialUrl: ACRA_ANNUAL_RETURN_DUE_DATES_URL },
  { id: 'acra-annual-return-branch-register', authority: 'ACRA', topicId: 'acra_annual-returns', query: 'Does keeping an overseas branch register change the annual-return timetable for a company with share capital?', subject: 'Annual-return overseas branch-register exception by listed status', sourceText: fixtures['annual-returns'], officialUrl: ACRA_ANNUAL_RETURN_DUE_DATES_URL }
];
for (const sample of naturalAcraCases) {
  assert.equal(supportAcraMomPracticalRule(sample), true,
    `${sample.id}: mapped natural question can use its complete official page without a narrow query-keyword whitelist`);
  const selected = selectAcraMomPracticalQuotes(sample);
  assert.ok(selected.length >= 3, `${sample.id}: selector supplies every rule-family premise`);
  const { issue, stream } = evidenceFor(sample);
  assert.ok(getAcraMomPracticalEvidence(sample.query, stream, issue),
    `${sample.id}: general rule can be rendered while the case-specific application remains unresolved`);
}
const narrowAnnualDutyRequest = {
  authority: 'ACRA', topicId: 'acra_annual-returns',
  query: 'Under ACRA guidance, must Singapore-incorporated companies file annual returns?',
  subject: 'annual return filing duty', sourceText: fixtures['annual-returns'],
  officialUrl: ACRA_ANNUAL_RETURN_DUE_DATES_URL
};
assert.equal(supportAcraMomPracticalRule(narrowAnnualDutyRequest), undefined,
  'A narrow annual-return duty question remains with the established complete-source-block proof.');
assert.deepEqual(selectAcraMomPracticalQuotes(narrowAnnualDutyRequest), [],
  'The new full-family selector does not replace the narrow duty quote contract.');
const narrowAnnualDeadlineRequest = {
  authority: 'ACRA', topicId: 'acra_annual-returns',
  query: 'How many months after FYE must a non-listed company file its annual return?',
  subject: 'annual return filing deadline for a non-listed company', sourceText: fixtures['annual-returns'],
  officialUrl: ACRA_ANNUAL_RETURN_DUE_DATES_URL
};
assert.equal(supportAcraMomPracticalRule(narrowAnnualDeadlineRequest), undefined,
  'A narrow annual-return deadline question remains with the established complete-table proof.');
assert.deepEqual(selectAcraMomPracticalQuotes(narrowAnnualDeadlineRequest), [],
  'The new full-family selector does not split the existing deadline-table claim.');

const employerMOM = evidenceFor(cases[2]);
employerMOM.issue.population = 'Employer';
assert.ok(getAcraMomPracticalEvidence(cases[2].query, employerMOM.stream, employerMOM.issue),
  'The overtime rule can explain obligations for an employer issue as well as an employee issue.');
const wrongPopulation = evidenceFor(cases[2]);
wrongPopulation.issue.population = 'Company';
assert.equal(getAcraMomPracticalEvidence(cases[2].query, wrongPopulation.stream, wrongPopulation.issue), undefined,
  'The MOM explanation is not attached to an unrelated party population.');

const wagesQuery = 'For someone covered by the Employment Act, can the company pay normal monthly wages two weeks after the pay period closes?';
const bareSalaryDeadlineQuery = 'When must salary be paid after the salary period?';
const regularSalarySubject = 'Regular salary payment timing after the pay period';
const regularSalaryProof = 'In accordance with the Employment Act, your employer must pay your salary at least once a month and within 7 days after the end of the salary period.';
const salaryFixtureHtml = STATUTORY_COVERAGE_OFFICIAL_PAGE_FIXTURES.find(page => page.id === 'mom-salary')?.html;
assert.ok(salaryFixtureHtml, 'The retained MOM Paying Salary source fixture is available.');
const nativeSalaryFixtureText = cleanHtmlText(salaryFixtureHtml).trim();
const salaryFixtureText = nativeSalaryFixtureText.replace(/\s+/g, ' ').trim();
assert.equal(provesMomSalaryPaymentSource(wagesQuery, nativeSalaryFixtureText), true,
  'The MOM rule remains complete with the fetched page’s native paragraph and list boundaries.');
assert.equal(provesMomSalaryPaymentSource(wagesQuery, salaryFixtureText), true,
  'The natural wages query is proved by the retained page’s separate monthly-pay and seven-day statements.');
assert.equal(supportMomSalaryPaymentIssue(wagesQuery, regularSalarySubject, salaryFixtureText), true,
  'Full-source issue ownership accepts the same retained MOM page for the wages paraphrase.');
assert.equal(supportMomSalaryPaymentIssue(bareSalaryDeadlineQuery, regularSalarySubject, salaryFixtureText), true,
  'A bare salary deadline question remains owned when it names the salary period and has no final-pay or overtime context.');
assert.ok(selectMomSalaryPaymentRuleQuote(bareSalaryDeadlineQuery, nativeSalaryFixtureText),
  'The bare salary deadline uses the same complete exact-source span.');
assert.equal(supportMomSalaryPaymentIssue('When must wages be paid after the pay period?', regularSalarySubject, salaryFixtureText), undefined,
  'A wage-only alias remains ambiguous without a more specific salary request.');
assert.equal(supportMomSalaryPaymentIssue('When must salary be paid after the salary period if overtime is included?', regularSalarySubject, salaryFixtureText), undefined,
  'A bare salary question with overtime context remains unowned rather than being treated as ordinary salary timing.');
const selectedRegularSalaryQuote = selectMomSalaryPaymentRuleQuote(wagesQuery, nativeSalaryFixtureText);
assert.ok(selectedRegularSalaryQuote,
  'A single exact source span can carry the monthly Employment Act premise and its separate seven-day list item.');
assert.ok(nativeSalaryFixtureText.includes(selectedRegularSalaryQuote),
  'The combined salary-timing quote is a literal contiguous substring of the retained official text.');
assert.match(selectedRegularSalaryQuote, /If you are covered by the Employment Act[\s\S]*?at least once a month/i);
assert.match(selectedRegularSalaryQuote, /Salary must be paid:[\s\S]*?Within 7 days after the end of the salary period/i);
assert.doesNotMatch(selectedRegularSalaryQuote, /final salary payment/i,
  'The ordinary salary timing span does not absorb the separate final-salary section.');
assert.equal(selectMomSalaryPaymentRuleQuote('Were these salary deadlines already in force in 2025?', nativeSalaryFixtureText), undefined,
  'The quote selector does not use current MOM guidance for a historical date.');
assert.equal(selectMomSalaryPaymentRuleQuote('When is final salary due if an employee resigns after serving notice?', nativeSalaryFixtureText), undefined,
  'The regular-salary quote selector cannot capture a final-salary question.');
assert.equal(selectMomSalaryPaymentRuleQuote(wagesQuery,
  nativeSalaryFixtureText.replace('Within 7 days after the end of the salary period', 'Not within 7 days after the end of the salary period')), undefined,
  'A negated regular-salary deadline is never selected.');
assert.equal(selectMomSalaryPaymentRuleQuote(wagesQuery,
  nativeSalaryFixtureText.replace('Within 7 days after the end of the salary period', 'Within 14 days after the end of the salary period')), undefined,
  'An overtime-length ordinary-salary deadline is never selected.');
const reverseOrderSalaryText = `Salary must be paid:\n* Within 7 days after the end of the salary period\n\nIf you are covered by the Employment Act, your employer must pay your salary at least once a month.`;
const reverseOrderSalaryQuote = selectMomSalaryPaymentRuleQuote(wagesQuery, reverseOrderSalaryText);
assert.ok(reverseOrderSalaryQuote && reverseOrderSalaryText.includes(reverseOrderSalaryQuote),
  'The source selector preserves exact contiguous text when the deadline block precedes the monthly-pay premise.');
assert.equal(supportMomSalaryPaymentIssue(wagesQuery, regularSalarySubject, regularSalaryProof), true,
  'Normal monthly wages and a proposed two-week delay are recognized as a regular-salary timing question.');
assert.equal(supportMomSalaryPaymentIssue('Were these salary deadlines already in force in 2025?', regularSalarySubject, regularSalaryProof), undefined,
  'Current salary guidance cannot answer a historical deadline question.');
assert.equal(supportMomSalaryPaymentIssue('When is final salary due if an employee resigns after serving notice?', regularSalarySubject, regularSalaryProof), false,
  'Regular salary evidence does not support a final-salary question.');
assert.equal(supportMomSalaryPaymentIssue('Can the employer pay final wages two weeks after employment ends?', regularSalarySubject, regularSalaryProof), undefined,
  'Final wages are not routed through the regular-salary rule.');

const salaryIssueId = 'salary-rule-issue';
const salaryUrl = 'https://www.mom.gov.sg/employment-practices/salary/paying-salary';
const monthlySalaryQuote = 'If you are covered by the Employment Act, your employer must pay your salary at least once a month.';
const weeklySalaryQuote = 'Salary must be paid: Within 7 days after the end of the salary period';
assert.ok(salaryFixtureText.includes(monthlySalaryQuote) && salaryFixtureText.includes(weeklySalaryQuote),
  'The two admitted rule premises occur verbatim in the retained MOM source fixture.');
const salaryHash = createHash('sha256').update(salaryFixtureText).digest('hex');
const finalSalaryQuery = 'When is final salary due if an employee resigns after serving required notice?';
const finalSalarySubject = 'Final salary payment deadline';
const finalSalarySourceText = `Employee resigns after serving required notice: final salary must be paid on the last day of employment.\n\n${nativeSalaryFixtureText}`;
assert.equal(supportMomSalaryPaymentIssue(finalSalaryQuery, finalSalarySubject, finalSalarySourceText), true,
  'The legacy final-salary proof accepts complete prose that matches the requested notice scenario.');
assert.equal(selectMomSalaryPaymentRuleQuote(finalSalaryQuery, finalSalarySourceText), undefined,
  'The ordinary-salary selector does not own final-salary questions.');
const finalSalaryLegacyQuote = selectMomAcraMasCoverageQuotes({ authority: 'MOM', topicId: 'mom-salary-payment',
  query: finalSalaryQuery, subject: finalSalarySubject, sourceText: finalSalarySourceText, officialUrl: salaryUrl })[0];
assert.ok(finalSalaryLegacyQuote, 'The established final-salary rule selector returns the complete source passage.');
const finalSalaryRecord = {
  id: 'final-salary-record', authority: 'MOM', sourceAuthority: 'MOM', domain: 'MOM_EMPLOYMENT',
  jurisdiction: 'Singapore', sourceText: finalSalarySourceText, officialSourceUrl: salaryUrl, canonicalSourceUrl: salaryUrl,
  provenance: 'LIVE_EXTERNAL', lifecycleState: 'CANDIDATE', sourceStatus: 'NEEDS_REVIEW',
  verificationMethod: 'LIVE_OFFICIAL_TOPIC_VERIFIED', urlVerificationStatus: 'VERIFIED',
  documentHash: createHash('sha256').update(finalSalarySourceText).digest('hex'),
  retrievedAt: '2026-10-27T00:00:00Z', sourceType: 'OFFICIAL_GUIDANCE', evidenceTier: 'OFFICIAL_GUIDANCE',
  recordRole: 'DISCOVERED_EVIDENCE', groundingEligible: true, tags: ['mom-salary-payment']
};
const finalSalaryVerification = verifyEvidenceClaims([{
  kind: 'RULE', text: finalSalaryLegacyQuote, quote: finalSalaryLegacyQuote, recordId: finalSalaryRecord.id
}], [finalSalaryRecord], {
  missingFacts: [], expectedAuthority: 'MOM', expectedDomain: 'MOM_EMPLOYMENT',
  boundedCoverageRequest: { authority: 'MOM', topicId: 'mom-salary-payment',
    query: finalSalaryQuery, subject: finalSalarySubject }
});
assert.equal(finalSalaryVerification.accepted.length, 1,
  `Complete final-salary prose remains on the legacy verification path: ${JSON.stringify(finalSalaryVerification.rejected)}`);
const salaryClaim = quote => ({
  text: quote, supportKind: 'EXACT_SOURCE_QUOTE', issueIds: [salaryIssueId], provenance: 'LIVE_EXTERNAL',
  fetchedSourceBinding: {
    recordId: 'salary-record', documentHash: salaryHash, canonicalUrl: salaryUrl, retrievedAt: '2026-10-27T00:00:00Z'
  }
});
const salaryClaims = [salaryClaim(monthlySalaryQuote), salaryClaim(weeklySalaryQuote)];
const salaryIssue = {
  id: salaryIssueId, subject: regularSalarySubject, population: 'Employee', operation: 'EXPLAIN_RULE',
  evidenceStatus: 'VERIFIED', applicationStatus: 'NOT_REQUIRED', claims: salaryClaims, gaps: []
};
const salaryStream = {
  id: 'mom-salary', authority: 'MOM', authorityLabel: 'Ministry of Manpower', domain: 'MOM_EMPLOYMENT',
  domainLabel: 'Employment requirements', evidenceStatus: 'VERIFIED', applicationStatus: 'NOT_REQUIRED',
  issues: [salaryIssue], gaps: [], sources: [{ key: 'salary-source', title: 'Paying salary', publisher: 'MOM',
    documentTitle: 'Paying salary', officialUrl: salaryUrl, provenance: 'LIVE_EXTERNAL', claims: salaryClaims }]
};
assert.equal(getMomSalaryPaymentRuleEvidence(wagesQuery, salaryStream, salaryIssue)?.kind, 'REGULAR_SALARY',
  'The mapped issue renders the verified general regular-salary rule.');
const renderedSalary = renderAuthorityEvidenceResponseText({
  query: wagesQuery, status: 'CONDITIONAL', evidenceStatus: 'VERIFIED', applicationStatus: 'NOT_REQUIRED',
  workstreams: [salaryStream], gaps: []
}, false);
assert.match(renderedSalary, /regular salary must be paid at least once a month and within 7 days after the salary period ends/i,
  'The rendered explanation gives the verified seven-day statutory deadline.');
assert.doesNotMatch(renderedSalary, /two weeks|within 14 days/i,
  'The user’s proposed two-week delay is not accepted as the statutory regular-salary deadline.');
assert.equal(getMomSalaryPaymentRuleEvidence(bareSalaryDeadlineQuery, salaryStream, salaryIssue)?.kind, 'REGULAR_SALARY',
  'The original bare-salary deadline wording renders the existing general MOM rule summary.');
const renderedBareSalary = renderAuthorityEvidenceResponseText({
  query: bareSalaryDeadlineQuery, status: 'CONDITIONAL', evidenceStatus: 'VERIFIED', applicationStatus: 'NOT_REQUIRED',
  workstreams: [salaryStream], gaps: []
}, false);
assert.match(renderedBareSalary, /regular salary must be paid at least once a month and within 7 days after the salary period ends/i,
  'The bare salary deadline keeps the verified official summary and seven-day rule.');

assert.equal(ACRA_MOM_PRACTICAL_RULES_20261027.length, 3);
assert.equal(manifest.sources.length, 3);
console.log('ACRA AGM/annual-return and MOM overtime practical-rule regressions passed (official cleaned excerpts, safeguards, dates, binding, and unresolved applications).');
