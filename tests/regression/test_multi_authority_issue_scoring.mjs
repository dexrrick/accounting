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

console.log('Multi-authority issue-scoring regressions passed.');
