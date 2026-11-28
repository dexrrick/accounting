import assert from 'node:assert/strict';
import { classifyQuestion } from '../../src/classification/questionClassifier.ts';
import {
  reconcileQuestionUnderstanding,
  validateSemanticQuestionInterpretation
} from '../../src/services/semanticQuestionUnderstanding.ts';

function semanticIssue({ subject, population, domain, authority, operation }) {
  return {
    subject, population, domain, governingAuthorities: [authority], contextualAuthorities: [], operation,
    mappedTopicIds: [], evidenceRequirement: 'AUTHORITATIVE_SOURCE', confidence: 0.98
  };
}

function reconcile(query, issueSpecs) {
  const issues = issueSpecs;
  const singleIssue = issues.length === 1;
  const interpretation = validateSemanticQuestionInterpretation({
    jurisdiction: ['Singapore'],
    authorityCandidates: singleIssue ? issues[0].governingAuthorities : ['UNKNOWN'],
    contextualAuthorities: [],
    domain: singleIssue ? issues[0].domain : 'UNKNOWN',
    population: singleIssue ? issues[0].population : 'UNKNOWN',
    primarySubject: singleIssue ? issues[0].subject : 'Multiple statutory outcomes',
    concepts: [{ concept: singleIssue ? issues[0].subject : 'multiple statutory outcomes', role: 'PRIMARY' }],
    requestedOperation: singleIssue ? issues[0].operation : 'OTHER',
    requiresUserSpecificFacts: false,
    calculationRequested: singleIssue && issues[0].operation === 'CALCULATE',
    factsExplicitlyProvided: [], confidence: 0.98,
    issues
  }, query);
  assert.ok(interpretation, `Fixture semantic interpretation passes production validation: ${JSON.stringify({
    domain: singleIssue ? issues[0].domain : 'UNKNOWN', population: singleIssue ? issues[0].population : 'UNKNOWN',
    operation: singleIssue ? issues[0].operation : 'OTHER', authority: singleIssue ? issues[0].governingAuthorities : ['UNKNOWN'],
    issue: issues[0]
  })}`);
  return reconcileQuestionUnderstanding(query, classifyQuestion(query), {
    mode: 'SEMANTIC_INTERPRETATION', assessmentStatus: 'PASSED', interpretation
  }).issuePlan;
}

const gstSubject = 'GST return filing deadline, nil-return duty, and extension procedure';
const gstQuery = 'When is a Singapore GST return due after each quarter?';
const gstPlan = reconcile(gstQuery, [semanticIssue({
  subject: gstSubject, population: 'COMPANY', domain: 'IRAS_GST', authority: 'IRAS', operation: 'FILING_REQUIREMENT'
})]);
const gstIssue = gstPlan.issues.find(issue => issue.subject === gstSubject);
assert.ok(gstIssue?.mappedTopicIds.includes('iras-gst-filing-deadlines'),
  'The exact GST filing issue subject binds to its independently recognized existing topic.');
assert.equal(gstIssue.status, 'MAPPED');

const gstCompoundQuery = 'When is a Singapore GST return due after each quarter, and can the filing deadline be extended?';
const gstCompoundPlan = reconcile(gstCompoundQuery, [semanticIssue({
  subject: gstSubject, population: 'COMPANY', domain: 'IRAS_GST', authority: 'IRAS', operation: 'FILING_REQUIREMENT'
})]);
assert.ok(gstCompoundPlan.issues.find(issue => issue.subject === gstSubject)?.mappedTopicIds.includes('iras-gst-filing-deadlines'),
  'Nil-return and extension clauses remain within the existing GST filing topic.');
const gstDeadlineWithoutReturn = 'What is the normal GST filing deadline and can a business seek an extension?';
const gstDeadlineWithoutReturnPlan = reconcile(gstDeadlineWithoutReturn, [semanticIssue({
  subject: gstSubject, population: 'COMPANY', domain: 'IRAS_GST', authority: 'IRAS', operation: 'FILING_REQUIREMENT'
})]);
assert.ok(gstDeadlineWithoutReturnPlan.issues.find(issue => issue.subject === gstSubject)?.mappedTopicIds.includes('iras-gst-filing-deadlines'),
  'The deadline-and-extension query maps to the existing GST filing topic even when it omits the word “return”.');

const gstOtherOutcome = reconcile(gstQuery, [semanticIssue({
  subject: `${gstSubject} and input tax recovery`, population: 'COMPANY', domain: 'IRAS_GST', authority: 'IRAS', operation: 'FILING_REQUIREMENT'
})]);
assert.equal(gstOtherOutcome.issues.find(issue => issue.subject.includes('input tax'))?.mappedTopicIds.includes('iras-gst-filing-deadlines'), false,
  'A subject that includes a distinct GST outcome does not inherit the narrow filing binding.');
const unrelatedGstQuery = 'How does a Singapore company register for GST?';
const unrelatedGstPlan = reconcile(unrelatedGstQuery, [semanticIssue({
  subject: gstSubject, population: 'COMPANY', domain: 'IRAS_GST', authority: 'IRAS', operation: 'FILING_REQUIREMENT'
})]);
assert.equal(unrelatedGstPlan.issues.some(issue => issue.mappedTopicIds.includes('iras-gst-filing-deadlines')), false,
  'A filing-like subject cannot create a topic absent from original-query recognition.');
for (const overrides of [
  { domain: 'IRAS_INCOME_TAX' }, { population: 'INDIVIDUAL' }, { domain: 'MAS_FUNDS', authority: 'MAS' }, { operation: 'CALCULATE' }
]) {
  const wrongScope = reconcile(gstQuery, [semanticIssue({
    subject: gstSubject, population: 'COMPANY', domain: 'IRAS_GST', authority: 'IRAS', operation: 'FILING_REQUIREMENT', ...overrides
  })]);
  assert.equal(wrongScope.issues.some(issue => issue.subject === gstSubject && issue.mappedTopicIds.includes('iras-gst-filing-deadlines')), false,
    `GST filing binding rejects mismatched scope ${JSON.stringify(overrides)}.`);
}

const masExemptionQuery = 'Are there class exemptions from the fund management licensing requirement?';
const masExemptionSubject = 'Conditional class exemptions from fund-management licensing';
const masPlan = reconcile(masExemptionQuery, [semanticIssue({
  subject: masExemptionSubject, population: 'COMPANY', domain: 'MAS_FUNDS', authority: 'MAS', operation: 'CHECK_ELIGIBILITY'
})]);
const masExemptionIssue = masPlan.issues.find(issue => issue.subject === masExemptionSubject);
assert.ok(masExemptionIssue?.mappedTopicIds.includes('mas-fund-management-exemptions'),
  'The bounded class-exemption issue binds to the independently recognized exemption topic.');
assert.ok(masExemptionIssue.contextualTopicIds?.includes('mas-lfmc'),
  'The broad LFMC inventory remains contextual for a single exemption-only issue.');
assert.equal(masExemptionIssue.mappedTopicIds.includes('mas-lfmc'), false,
  'Contextual LFMC scope is not promoted into the requested exemption issue.');
assert.equal(masPlan.issues.some(issue => issue.status === 'UNRESOLVED' && issue.mappedTopicIds.includes('mas-lfmc')), false,
  'The contextual LFMC inventory does not become a false residual issue.');

const practicalMasExemptionCases = [
  {
    query: 'When can a fund manager operate without an MAS licence?',
    subject: masExemptionSubject
  },
  {
    query: 'Does managing money for a related corporation automatically exempt a firm?',
    subject: 'Whether related-corporation fund management is automatically exempt'
  },
  {
    query: 'What are examples of fund management activities that may be class exempt?',
    subject: masExemptionSubject
  }
];
for (const { query, subject } of practicalMasExemptionCases) {
  const plan = reconcile(query, [semanticIssue({
    subject, population: 'COMPANY', domain: 'MAS_FUNDS', authority: 'MAS', operation: 'CHECK_ELIGIBILITY'
  })]);
  const issue = plan.issues.find(candidate => candidate.subject === subject);
  assert.ok(issue?.mappedTopicIds.includes('mas-fund-management-exemptions'),
    `The existing exemption topic maps for: ${query}`);
  assert.equal(issue?.mappedTopicIds.includes('mas-lfmc'), false,
    `A narrow exemption question does not become a general LFMC licensing request: ${query}`);
}

const separateLfmcQuery = 'Are there class exemptions from fund management licensing, and separately does an LFMC need a CMS licence?';
const separateLfmcPlan = reconcile(separateLfmcQuery, [semanticIssue({
  subject: masExemptionSubject, population: 'COMPANY', domain: 'MAS_FUNDS', authority: 'MAS', operation: 'CHECK_ELIGIBILITY'
})]);
const separateExemptionIssue = separateLfmcPlan.issues.find(issue => issue.subject === masExemptionSubject);
assert.ok(separateExemptionIssue?.mappedTopicIds.includes('mas-fund-management-exemptions'),
  'The class-exemption issue still maps in a compound query.');
assert.notEqual(separateExemptionIssue.contextualTopicIds?.includes('mas-lfmc'), true,
  'A separately requested LFMC licensing outcome is never demoted to context.');
assert.ok(separateLfmcPlan.issues.some(issue => issue.mappedTopicIds.includes('mas-lfmc') ||
  issue.status === 'UNRESOLVED' && issue.subject.toLowerCase().includes('lfmc')),
'A separate LFMC licensing outcome remains mapped or explicitly unresolved.');

const withoutLicenceCompoundQuery = 'When can a fund manager operate without an MAS licence, and does an LFMC generally need a CMS licence?';
const withoutLicenceCompoundPlan = reconcile(withoutLicenceCompoundQuery, [
  semanticIssue({ subject: masExemptionSubject, population: 'COMPANY', domain: 'MAS_FUNDS', authority: 'MAS', operation: 'CHECK_ELIGIBILITY' }),
  semanticIssue({ subject: 'LFMC CMS licence requirement', population: 'COMPANY', domain: 'MAS_FUNDS', authority: 'MAS', operation: 'EXPLAIN_RULE' })
]);
assert.ok(withoutLicenceCompoundPlan.issues.some(issue => issue.subject === masExemptionSubject &&
  issue.mappedTopicIds.includes('mas-fund-management-exemptions')),
  'The no-licence exemption clause stays mapped to its existing topic in a compound question.');
assert.notEqual(withoutLicenceCompoundPlan.issues.find(issue => issue.subject === masExemptionSubject)?.contextualTopicIds?.includes('mas-lfmc'), true,
  'The separately requested CMS-licence outcome is not demoted to contextual LFMC inventory.');
assert.ok(withoutLicenceCompoundPlan.issues.some(issue => issue.mappedTopicIds.includes('mas-lfmc') ||
  issue.status === 'UNRESOLVED' && issue.subject.toLowerCase().includes('lfmc')),
  'The distinct general LFMC question remains mapped or explicitly unresolved.');

const masCompoundPlan = reconcile(separateLfmcQuery, [
  semanticIssue({ subject: masExemptionSubject, population: 'COMPANY', domain: 'MAS_FUNDS', authority: 'MAS', operation: 'CHECK_ELIGIBILITY' }),
  semanticIssue({ subject: 'LFMC CMS licence requirement', population: 'COMPANY', domain: 'MAS_FUNDS', authority: 'MAS', operation: 'EXPLAIN_RULE' })
]);
assert.ok(masCompoundPlan.issues.some(issue => issue.mappedTopicIds.includes('mas-fund-management-exemptions')));
assert.ok(masCompoundPlan.issues.some(issue => issue.mappedTopicIds.includes('mas-lfmc')),
  'Separate exemption and LFMC issues retain their own requested topic mappings.');
assert.notEqual(masCompoundPlan.issues.find(issue => issue.subject === masExemptionSubject)?.contextualTopicIds?.includes('mas-lfmc'), true);

for (const overrides of [
  { population: 'FUND' }, { domain: 'IRAS_GST', authority: 'IRAS' }, { operation: 'FILING_REQUIREMENT' }
]) {
  const wrongMasScope = reconcile(masExemptionQuery, [semanticIssue({
    subject: masExemptionSubject, population: 'COMPANY', domain: 'MAS_FUNDS', authority: 'MAS', operation: 'CHECK_ELIGIBILITY', ...overrides
  })]);
  assert.equal(wrongMasScope.issues.find(issue => issue.subject === masExemptionSubject)?.mappedTopicIds.includes('mas-fund-management-exemptions'), false,
    `The class-exemption binding rejects mismatched scope ${JSON.stringify(overrides)}.`);
}
const unrelatedMasSubject = reconcile(masExemptionQuery, [semanticIssue({
  subject: 'Conditional class exemptions and AML reporting requirements', population: 'COMPANY',
  domain: 'MAS_FUNDS', authority: 'MAS', operation: 'CHECK_ELIGIBILITY'
})]);
assert.equal(unrelatedMasSubject.issues.some(issue => issue.subject.includes('AML') && issue.mappedTopicIds.includes('mas-fund-management-exemptions')), false,
  'The MAS binding rejects mixed exemption and unrelated reporting subjects.');

const cpfDueQuery = 'When must employers pay the CPF contributions for a month?';
const cpfDueSubject = 'CPF contribution legal due date and late-payment enforcement cut-off';
const cpfDuePlan = reconcile(cpfDueQuery, [semanticIssue({
  subject: cpfDueSubject, population: 'EMPLOYER', domain: 'CPF_PAYROLL', authority: 'CPF', operation: 'FILING_REQUIREMENT'
})]);
const cpfDueIssue = cpfDuePlan.issues.find(issue => issue.subject === cpfDueSubject);
assert.ok(cpfDueIssue?.mappedTopicIds.includes('cpf-contribution-due-dates'),
  'The employer due-date issue maps to the existing due-date topic.');
assert.equal(cpfDueIssue.mappedTopicIds.includes('cpf_contribution_rates'), false,
  'Broad CPF contribution wording does not turn a due-date issue into a rate request.');
assert.ok(cpfDueIssue.contextualTopicIds?.includes('cpf_contribution_rates'),
  'The independently recognized generic rate inventory is preserved as contextual.');

const cpfMixedQuery = 'When must employers pay the CPF contributions for a month, and what CPF contribution rates apply?';
const cpfMixedPlan = reconcile(cpfMixedQuery, [
  semanticIssue({ subject: cpfDueSubject, population: 'EMPLOYER', domain: 'CPF_PAYROLL', authority: 'CPF', operation: 'FILING_REQUIREMENT' }),
  semanticIssue({ subject: 'Employer and employee CPF contribution rate factors', population: 'EMPLOYER', domain: 'CPF_PAYROLL', authority: 'CPF', operation: 'EXPLAIN_RULE' })
]);
const mixedDueIssue = cpfMixedPlan.issues.find(issue => issue.subject === cpfDueSubject);
assert.ok(mixedDueIssue?.mappedTopicIds.includes('cpf-contribution-due-dates'));
assert.notEqual(mixedDueIssue.contextualTopicIds?.includes('cpf_contribution_rates'), true,
  'A distinct rate request is not demoted to due-date context.');
assert.ok(cpfMixedPlan.issues.some(issue => issue.mappedTopicIds.includes('cpf_contribution_rates')),
  'The separate rate outcome retains its topic mapping.');

const cpfOtherAuthorityQuery = `${cpfDueQuery} Also, when is the Singapore GST return due after each quarter?`;
const cpfOtherAuthorityPlan = reconcile(cpfOtherAuthorityQuery, [
  semanticIssue({ subject: cpfDueSubject, population: 'EMPLOYER', domain: 'CPF_PAYROLL', authority: 'CPF', operation: 'FILING_REQUIREMENT' }),
  semanticIssue({ subject: gstSubject, population: 'COMPANY', domain: 'IRAS_GST', authority: 'IRAS', operation: 'FILING_REQUIREMENT' })
]);
assert.ok(cpfOtherAuthorityPlan.issues.some(issue => issue.mappedTopicIds.includes('cpf-contribution-due-dates')));
assert.ok(cpfOtherAuthorityPlan.issues.some(issue => issue.mappedTopicIds.includes('iras-gst-filing-deadlines')),
  'CPF due-date context does not swallow the separate IRAS outcome.');

for (const overrides of [
  { population: 'EMPLOYEE' }, { domain: 'CPF_PAYROLL', operation: 'EXPLAIN_RULE' },
  { subject: 'CPF contribution rate factors and due date' }
]) {
  const wrongScope = reconcile(cpfDueQuery, [semanticIssue({
    subject: cpfDueSubject, population: 'EMPLOYER', domain: 'CPF_PAYROLL', authority: 'CPF', operation: 'FILING_REQUIREMENT', ...overrides
  })]);
  const issue = wrongScope.issues.find(item => item.subject.includes('CPF'));
  assert.notEqual(issue?.contextualTopicIds?.includes('cpf_contribution_rates'), true,
    `CPF rates are not contextual under mismatched due-date scope ${JSON.stringify(overrides)}.`);
}

console.log('Statutory practical semantic issue binding regression passed.');
