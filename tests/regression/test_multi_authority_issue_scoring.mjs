import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { matchIssues, scoreIssueDimensions } from '../evaluation/singapore/multi-authority-issue-scoring.mjs';

const corporateDeduction = {
  id: 'corporate-benefit-deduction',
  subject: 'corporate income-tax deductibility of employee benefit expense',
  matchAny: [['company', 'benefit', 'deduct']],
  aliases: [['cost', 'claimability'], ['claim', 'cost'], ['deductible', 'expense'], ['corporate', 'tax', 'benefit', 'deduction']],
  domain: ['IRAS_INCOME_TAX'],
  population: ['COMPANY'],
  governingAuthorities: ['IRAS'],
  contextualAuthoritiesAnyOf: [[]],
  operation: ['CHECK_ELIGIBILITY', 'DETERMINE_TREATMENT']
};
const wrongDomainButMatchingSubject = {
  subject: 'Can the company claim the cost of an employee benefit against taxable income?',
  domain: 'ACCOUNTING', population: 'UNKNOWN', governingAuthorities: ['ACCOUNTING_STANDARDS'],
  contextualAuthorities: [], operation: 'EXPLAIN_RULE'
};
const result = matchIssues([corporateDeduction], [wrongDomainButMatchingSubject]);
assert.equal(result.expectedByActual.size, 1,
  'Cost and claimability aliases match on subject even when provider dimensions are wrong.');
const dimensions = scoreIssueDimensions(wrongDomainButMatchingSubject, corporateDeduction);
assert.equal(dimensions.governingAuthority, false);
assert.equal(dimensions.domain, false, 'A subject match must retain a wrong-domain dimension error.');
assert.equal(dimensions.population, false);

const costRecognition = {
  id: 'expense-accounting', matchAny: [['expense', 'accounting']],
  aliases: [['cost', 'recognis'], ['cost', 'recogniz'], ['cost', 'financial', 'report']]
};
assert.equal(matchIssues([costRecognition], [{ subject: 'How should a cost be recognised for financial reporting?' }]).expectedByActual.size, 1,
  'Cost and recognition variants match the accounting issue subject without dimension prerequisites.');

const cpfExpected = [
  { id: 'cpf-applicability', matchAny: [['cpf', 'contribution']], aliases: [['cpf', 'position'], ['whether', 'contributions', 'are', 'due'], ['cpf', 'applicability']] },
  { id: 'employment-authorization', matchAny: [['work', 'pass']], aliases: [['employment', 'authorization'], ['foreign', 'worker', 'permit']] },
  { id: 'employer-reporting', matchAny: [['employer', 'tax', 'report']], aliases: [['employment', 'income', 'reporting', 'duties'], ['employer', 'filing', 'responsibility']] }
];
for (const [text, expectedIndex] of [
  ['What is the CPF position for a foreign employee?', 0],
  ['What employment authorization is required for a foreign worker?', 1],
  ['What are the employment income reporting duties?', 2]
]) {
  assert.equal(matchIssues([cpfExpected[expectedIndex]], [{ subject: text }]).expectedByActual.size, 1, text);
}

const mergedPartyIssue = { subject: 'employer and employee CPF contribution amounts and requirements' };
const partyMatches = matchIssues([
  { matchAny: [['employer', 'cpf', 'contribution']] },
  { matchAny: [['employee', 'cpf', 'contribution']] }
], [mergedPartyIssue]);
assert.equal(partyMatches.expectedByActual.size, 1,
  'A merged employer and employee issue receives at most one issue credit.');

const correctedFixture = JSON.parse(await readFile(new URL('../evaluation/singapore/multi-authority-workstreams-corrected.json', import.meta.url), 'utf8'));
const residencyFixture = JSON.parse(await readFile(new URL('../evaluation/singapore/semantic-residency-diagnostic-v3-config.json', import.meta.url), 'utf8'));
const expectedSubject = (contract, id) => correctedFixture.issueContracts[contract].find(issue => issue.id === id);
for (const [contract, id, subject] of [
  ['B', 'employer-tax-reporting', 'company tax reporting obligations'],
  ['B', 'foreign-employee-cpf-applicability', 'whether CPF applies to payroll'],
  ['B', 'foreign-employment-and-work-pass', 'employment authorization for an overseas worker'],
  ['B', 'employer-tax-reporting', 'employer reporting duties'],
  ['D-journal', 'sfrsi-expense-journal', 'SFRS(I) journal treatment for this cost']
]) {
  assert.equal(matchIssues([expectedSubject(contract, id)], [{ subject }]).expectedByActual.size, 1,
    `The corrected fixture recognizes the scoped subject alias: ${subject}`);
}

const frozenCompanyResidenceExpected = residencyFixture.questions[0].expected.issues[0];
for (const subject of [
  'corporate tax residence',
  'business entity taxation residence',
  'corporation tax resident'
]) {
  assert.equal(matchIssues([frozenCompanyResidenceExpected], [{ subject }]).expectedByActual.size, 1,
    `Generic company tax-residence equivalence accepts the complete canonical concept set: ${subject}`);
}
for (const subject of [
  'foreign individual tax resident in Singapore',
  'tax residency in Singapore',
  'directors strategic decisions'
]) {
  assert.equal(matchIssues([frozenCompanyResidenceExpected], [{ subject }]).expectedByActual.size, 0,
    `The frozen residency anchors cannot bypass the required company-tax-residence core: ${subject}`);
}
assert.equal(matchIssues([frozenCompanyResidenceExpected], [{
  subject: 'corporate tax residence certificate in Singapore'
}]).expectedByActual.size, 0,
'A material certificate qualifier cannot be dropped even when a frozen anchor would otherwise match.');

const expectedWithoutAnchors = subject => ({ subject, matchAny: [], aliases: [] });
const companyTaxResidence = expectedWithoutAnchors('company tax residency');
const companyTaxResidenceMatches = subject =>
  matchIssues([companyTaxResidence], [{ subject }]).expectedByActual.size === 1;
for (const subject of [
  'foreign individual tax resident',
  'corporate residence',
  'corporate taxation in Singapore',
  'business entity tax certificate',
  'business regulation and entity tax residence'
]) {
  assert.equal(companyTaxResidenceMatches(subject), false,
    `A missing company, tax, or residence concept cannot use the generic fallback: ${subject}`);
}

for (const [expected, actual] of [
  ['company tax residency certificate', 'corporate tax residence'],
  ['company tax treaty residency', 'corporate tax residence'],
  ['company tax residency exemption', 'corporate tax residence'],
  ['non-resident company tax residency', 'corporate tax residence'],
  ['company tax residency', 'corporate tax residence certificate'],
  ['company tax residency', 'corporate tax residence treaty'],
  ['company tax residency', 'corporate tax residence exemption'],
  ['company tax residency', 'non-resident corporate tax residence'],
  ['company tax residency', 'nonresident corporate tax residence'],
  ['company tax residency', 'non-tax-resident corporation tax'],
  ['company tax residency', 'not-tax-resident corporation tax'],
  ['company tax residency', 'not tax resident corporation']
]) {
  assert.equal(matchIssues([expectedWithoutAnchors(expected)], [{ subject: actual }]).expectedByActual.size, 0,
    `The generic fallback must preserve material residency qualifiers: ${expected} / ${actual}`);
}

const reportingExpected = 'corporate tax reporting obligations of a resident company';
assert.equal(matchIssues([expectedWithoutAnchors(reportingExpected)], [{
  subject: 'business entity taxation reporting obligations for a resident'
}]).expectedByActual.size, 0,
'A broad reporting subject with no legacy anchors stays outside generic equivalence.');
assert.equal(matchIssues([{
  ...expectedWithoutAnchors(reportingExpected),
  matchAny: [['company', 'tax', 'reporting']]
}], [{ subject: reportingExpected }]).expectedByActual.size, 1,
'A non-generic reporting subject still matches through its explicit legacy anchor.');
assert.equal(matchIssues([expectedWithoutAnchors('company tax residence and foreign dividend treatment')], [{
  subject: 'corporation tax residency and foreign dividend treatment'
}]).expectedByActual.size, 0,
'A broad dividend subject with no legacy anchors stays outside generic equivalence.');
assert.equal(companyTaxResidenceMatches('corporate tax residence and foreign dividend treatment'), false,
  'An actual subject cannot add a dividend scope to a generic expected residency subject.');

assert.equal(matchIssues([
  expectedWithoutAnchors('company tax residency certificate')
], [{ subject: 'corporation tax resident certificate' }]).expectedByActual.size, 1,
'Equivalent wording may preserve a certificate qualifier when both subjects include it.');

const genericResidencyScopes = [
  expectedWithoutAnchors('company tax residency'),
  expectedWithoutAnchors('corporation tax residence')
];
const oneGenericResidencyIssue = matchIssues(genericResidencyScopes, [{ subject: 'business entity taxation resident' }]);
assert.equal(oneGenericResidencyIssue.expectedByActual.size, 1,
  'One paraphrased issue cannot receive credit for multiple expected company tax-residency issues.');

assert.equal(matchIssues([
  expectedWithoutAnchors('Singapore GST input tax recovery')
], [{ subject: 'corporate tax residence' }]).expectedByActual.size, 0,
'The company tax-residence fallback does not match unrelated expected subjects.');

const appliedResidencyExpected = residencyFixture.questions[2].expected.issues[0];
const genericAppliedResidency = {
  subject: 'corporate tax residence',
  domain: 'ACCOUNTING', population: 'UNKNOWN', governingAuthorities: ['ACCOUNTING_STANDARDS'],
  contextualAuthorities: [], operation: 'EXPLAIN_RULE'
};
assert.equal(matchIssues([appliedResidencyExpected], [genericAppliedResidency]).expectedByActual.size, 1,
  'The applied subject may omit strategic-fact wording because facts and operation are scored separately.');
const appliedResidencyDimensions = scoreIssueDimensions(genericAppliedResidency, appliedResidencyExpected);
assert.equal(appliedResidencyDimensions.domain, false);
assert.equal(appliedResidencyDimensions.governingAuthority, false);
assert.equal(appliedResidencyDimensions.population, false);
assert.equal(appliedResidencyDimensions.operation, false);

console.log('Multi-authority issue-scoring regressions passed.');
