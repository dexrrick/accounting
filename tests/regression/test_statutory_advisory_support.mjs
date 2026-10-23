import assert from 'node:assert/strict';
import {
  isBoundedStatutoryAdvisoryRequest,
  selectBoundedStatutoryAdvisoryPassage,
  supportBoundedStatutoryAdvisory
} from '../../src/retrieval/statutoryAdvisorySupport.ts';
import { selectRelevantFetchedText } from '../../src/services/groundingContextBuilder.ts';

// Source context: https://www.cpf.gov.sg/employer/employer-obligations/what-constitutes-wages-for-cpf-contributions
const cpfCompleteDefinition = `For wages to be classified as Ordinary Wages for the month, they must meet both of the following conditions: They are given to an employee for their employment in that month, and They are payable by the 14th of the following month.`;
const cpfRequest = {
  authority: 'CPF Board',
  topicId: 'cpf-ordinary-wages',
  subject: 'ordinary wages',
  originalQuery: 'What makes wages ordinary wages for CPF contributions?',
  sourceText: cpfCompleteDefinition
};
const cpfRuntimeQuery = 'Under CPF Board guidance, what makes a payment ordinary wages for CPF contributions? Explain the general definition using official CPF Board guidance. Do not calculate contribution rates or amounts and do not create journal entries.';

assert.equal(supportBoundedStatutoryAdvisory(cpfRequest), true);
assert.equal(isBoundedStatutoryAdvisoryRequest(cpfRequest), true);
assert.equal(supportBoundedStatutoryAdvisory({ ...cpfRequest, originalQuery: cpfRuntimeQuery }), true,
  'the full runtime wording still activates and satisfies the bounded definition request');
assert.equal(supportBoundedStatutoryAdvisory({
  ...cpfRequest,
  sourceText: `For wages to be classified as Ordinary Wages for the month, they must meet both of the following criteria: They are given for an employee's employment in that month. They are payable by the 14th of the following month.`
}), true, 'the previously accepted criteria wording remains supported alongside the official conditions wording');
assert.equal(supportBoundedStatutoryAdvisory({
  ...cpfRequest,
  originalQuery: 'Define ordinary wages',
  sourceText: `For wages to be classified as Ordinary Wages for the month, they must meet both of the following criteria: They are given for an employee's employment in that month. They are payable by the 14th of the following month.`
}), true);
assert.equal(supportBoundedStatutoryAdvisory({
  ...cpfRequest,
  sourceText: `Ordinary Wages does not mean wages given for an employee's employment in that month. Ordinary Wages means bonus income instead. They are given for an employee's employment in that month. They are payable by the 14th of the following month.`
}), false, 'a contradictory definition cannot be combined with conditions to support the request');
assert.equal(supportBoundedStatutoryAdvisory({
  ...cpfRequest,
  sourceText: `Ordinary Wages means wages given for an employee's employment in that month.`
}), false, 'a definition without the following-month payment condition is insufficient');
assert.equal(supportBoundedStatutoryAdvisory({
  ...cpfRequest,
  sourceText: `Definition of Ordinary Wages. They are given for an employee's employment in that month. An unrelated invoice is payable by the 14th of the following month.`
}), false, 'a heading and an unrelated payment deadline do not form a substantive definition passage');
assert.equal(supportBoundedStatutoryAdvisory({
  ...cpfRequest,
  sourceText: `For wages to be classified as Ordinary Wages for the month, they must meet both criteria. They are given for an employee's employment in that month. They are payable by the following month.`
}), false, 'a payment deadline without a source-stated date is insufficient');
assert.equal(supportBoundedStatutoryAdvisory({
  ...cpfRequest,
  sourceText: `For wages to be classified as Ordinary Wages for the month, they must meet both criteria. They are not given for an employee's employment in that month. They are payable by the 14th of the following month.`
}), false, 'a negated month-of-employment condition is insufficient');
assert.equal(supportBoundedStatutoryAdvisory({
  ...cpfRequest,
  sourceText: `For wages to be classified as Ordinary Wages for the month, they must meet both criteria. They are given for an employee's employment in that month. They are not payable by the 14th of the following month.`
}), false, 'a negated payment condition is insufficient');
assert.equal(supportBoundedStatutoryAdvisory({
  ...cpfRequest,
  sourceText: `Ordinary Wages. For more information about payroll, visit the employers page.`
}), false, 'a heading or navigation text does not support the definition');

// Source context: https://www.mom.gov.sg/employment-practices/hours-of-work-overtime-and-rest-days
const momCompleteCoverage = `Part IV of the Employment Act applies to hours of work and overtime. You can claim overtime if you are:\nWorkmen who earn a basic monthly salary of $4,500 or less.\nNon-workmen who earn a basic monthly salary of $2,600 or less.\nManagers and executives are not covered under Part IV.`;
const momRequest = {
  authority: 'Ministry of Manpower',
  topicId: 'mom-part-iv-overtime',
  subject: 'Part IV overtime',
  originalQuery: 'Which employees are eligible for Part IV overtime coverage?',
  sourceText: momCompleteCoverage
};

assert.equal(supportBoundedStatutoryAdvisory(momRequest), true);
assert.equal(isBoundedStatutoryAdvisoryRequest(momRequest), true);
assert.equal(supportBoundedStatutoryAdvisory({
  ...momRequest,
  subject: 'Part IV overtime',
  originalQuery: 'Which employees are eligible?',
  sourceText: momCompleteCoverage
}), true, 'the raw query and topic subject may jointly identify the bounded coverage ask');
assert.equal(supportBoundedStatutoryAdvisory({
  ...momRequest,
  subject: 'Part IV overtime eligibility',
  originalQuery: 'What annual return filing requirements apply to Singapore companies, and what are Part IV overtime eligibility requirements?',
  sourceText: 'Employees covered by Part IV of the Employment Act are subject to working hours and overtime eligibility rules. Overtime pay is calculated from the hourly basic rate, subject to applicable overtime eligibility requirements.'
}), false, 'an explicit Part IV overtime eligibility ask still needs substantive employee coverage criteria');
assert.equal(supportBoundedStatutoryAdvisory({
  ...momRequest,
  sourceText: `Part IV of the Employment Act applies to overtime. Workmen who earn a basic monthly salary of $4,500 or less are covered under Part IV for overtime. Managers and executives are not covered under Part IV.`
}), false, 'both workman and non-workman categories are required');
assert.equal(supportBoundedStatutoryAdvisory({
  ...momRequest,
  sourceText: `Part IV of the Employment Act applies to overtime. Workmen are covered under Part IV for overtime. Non-workmen who earn a basic monthly salary of $2,600 or less are covered under Part IV for overtime. Managers and executives are not covered under Part IV.`
}), false, 'a workman category without its monthly basic salary threshold is insufficient');
assert.equal(supportBoundedStatutoryAdvisory({
  ...momRequest,
  sourceText: `Part IV of the Employment Act applies to overtime. Non-workmen who earn a basic monthly salary of $2,600 or less are covered under Part IV for overtime. Managers and executives are not covered under Part IV.`
}), false, 'a non-workman category cannot satisfy the separate workman category');
assert.equal(supportBoundedStatutoryAdvisory({
  ...momRequest,
  sourceText: `Part IV of the Employment Act applies to overtime. Workmen who earn a basic monthly salary of more than $4,500 are covered under Part IV for overtime. Non-workmen who earn a basic monthly salary of $2,600 or less are covered under Part IV for overtime. Managers and executives are not covered under Part IV.`
}), false, 'a threshold without the source-stated upper eligibility qualifier is insufficient');
assert.equal(supportBoundedStatutoryAdvisory({
  ...momRequest,
  sourceText: `Part IV of the Employment Act applies to overtime. Workmen who earn a basic monthly salary of $4,500 or less are covered under Part IV for overtime. Non-workmen who earn a basic monthly salary of $2,600 or less are covered under Part IV for overtime.`
}), false, 'the managers and executives exclusion is required');
assert.equal(supportBoundedStatutoryAdvisory({
  ...momRequest,
  sourceText: `Part IV of the Employment Act applies to overtime. Workmen who earn a basic monthly salary of $4,500 or less are covered under Part IV for overtime. Non-workmen who earn a basic monthly salary of $2,600 or less are covered under Part IV for overtime. Managers and executives are covered under Part IV.`
}), false, 'positive coverage of managers and executives cannot support their required exclusion');
assert.equal(supportBoundedStatutoryAdvisory({
  ...momRequest,
  sourceText: `Part IV of the Employment Act applies to overtime. Workmen who earn a basic monthly salary of $4,500 or less are covered under Part IV for overtime. Non-workmen who earn a basic monthly salary of $2,600 or less are covered under Part IV for overtime. Managers and executives are not excluded from Part IV.`
}), false, 'a negated exclusion does not establish the managers and executives carve-out');
assert.equal(supportBoundedStatutoryAdvisory({
  ...momRequest,
  sourceText: `Part IV of the Employment Act applies to overtime. Workmen who earn a basic monthly salary of $4,500 or less are not covered under Part IV for overtime. Non-workmen who earn a basic monthly salary of $2,600 or less are not eligible for overtime. Managers and executives are not covered under Part IV.`
}), false, 'negated category eligibility cannot support either covered employee group');
assert.equal(supportBoundedStatutoryAdvisory({
  ...momRequest,
  sourceText: `Part IV of the Employment Act regulates hours of work and overtime if covered. Workmen with basic monthly salary of $4,500 or less receive transport allowances. Non-workmen with basic monthly salary of $2,600 or less receive meal vouchers. Managers and executives are not covered under Part IV.`
}), false, 'unrelated salary-qualified allowance and voucher text does not establish overtime eligibility');
assert.equal(supportBoundedStatutoryAdvisory({
  ...momRequest,
  sourceText: `Part IV of the Employment Act regulates hours and overtime if an employee is covered.`
}), false, 'generic overtime guidance without coverage categories is insufficient');
assert.equal(supportBoundedStatutoryAdvisory({
  ...momRequest,
  sourceText: `Part IV. Workmen. Non-workmen. Managers and executives.`
}), false, 'headings and navigation labels alone are insufficient');

assert.equal(supportBoundedStatutoryAdvisory({
  ...cpfRequest,
  authority: 'MOM'
}), undefined, 'authority mismatch remains outside the supported scope');
assert.equal(supportBoundedStatutoryAdvisory({
  ...cpfRequest,
  topicId: 'cpf-contributions'
}), undefined, 'an unrelated CPF topic remains outside the supported scope');
assert.equal(supportBoundedStatutoryAdvisory({
  ...cpfRequest,
  originalQuery: 'How are overtime hours calculated?',
  sourceText: 'Hours and overtime are regulated by Part IV of the Employment Act.'
}), undefined, 'generic overtime calculation requests remain outside the coverage profile');
assert.equal(supportBoundedStatutoryAdvisory({
  ...cpfRequest,
  originalQuery: 'Please define a Capital Markets Services Licence under MAS.'
}), undefined, 'an unrelated MAS definition ask does not activate the CPF profile');
assert.equal(supportBoundedStatutoryAdvisory({
  ...cpfRequest,
  subject: 'ordinary wages ceiling',
  originalQuery: 'Explain the ordinary wages ceiling for CPF and define a Capital Markets Services Licence under MAS.'
}), undefined, 'a separate MAS definition clause cannot activate the CPF definition profile');
assert.equal(supportBoundedStatutoryAdvisory({
  ...momRequest,
  originalQuery: 'How are overtime hours calculated, and which entities are eligible for a Capital Markets Services Licence under MAS?'
}), undefined, 'an unrelated MAS eligibility ask does not activate the MOM coverage profile');
assert.equal(supportBoundedStatutoryAdvisory({
  ...momRequest,
  originalQuery: 'I am not asking for employee coverage or eligibility criteria.',
  sourceText: momCompleteCoverage
}), undefined, 'a negated request cue does not enter the bounded coverage profile');

const masRequest = {
  authority: 'MAS',
  topicId: 'mas-cms-licence',
  subject: 'Capital Markets Services Licence',
  originalQuery: 'What is a Capital Markets Services Licence and when is it generally required?',
  sourceText: 'If your company wishes to conduct regulated activities under the SFA, it must hold a CMS licence. Individuals conducting regulated activities on behalf of CMS licensees or exempt CMS entities (such as banks) need to be appointed as representatives.'
};
assert.equal(supportBoundedStatutoryAdvisory(masRequest), true,
  'the bounded MAS CMS licensing request delegates to its specific rule support');
assert.equal(supportBoundedStatutoryAdvisory({
  ...masRequest,
  sourceText: 'A Capital Markets Services Licence is generally required by a business that carries on a regulated activity under the Securities and Futures Act.'
}), false, 'a recognized MAS licensing request still requires the operative general rule');
assert.equal(supportBoundedStatutoryAdvisory({
  ...masRequest,
  originalQuery: 'Do I need a CMS licence for my company?'
}), undefined, 'a company-specific licensing request remains outside bounded rule support');

const longMomBody = [
  ...Array.from({ length: 24 }, (_, index) => `General Employment Act information, section ${index + 1}. ${'This unrelated page explanation describes other workplace services and administrative guidance for employees. '.repeat(3)}`),
  'Part IV of the Employment Act applies to hours of work and overtime.',
  'You can claim overtime if you are:',
  'Workmen who earn a basic monthly salary of $4,500 or less.',
  'Non-workmen who earn a basic monthly salary of $2,600 or less.',
  'Managers and executives are not covered under Part IV.',
  'However, workers who are not employed under a contract of service are outside this guidance.'
].join('\n\n');
assert.ok(longMomBody.length > 5_000, 'fixture exceeds the fetched-text selection limit');
assert.equal(supportBoundedStatutoryAdvisory({ ...momRequest, sourceText: longMomBody }), true,
  'the complete long-page body supports the bounded coverage request');
const completeMomPassage = selectBoundedStatutoryAdvisoryPassage({ ...momRequest, sourceText: longMomBody });
assert.ok(completeMomPassage && completeMomPassage.length <= 5_000,
  'a complete coverage passage fitting the excerpt limit is selected');
assert.ok(longMomBody.includes(completeMomPassage), 'the selected passage is an exact contiguous source substring');
for (const requiredCategory of [
  'Workmen who earn a basic monthly salary of $4,500 or less.',
  'Non-workmen who earn a basic monthly salary of $2,600 or less.',
  'Managers and executives are not covered under Part IV.',
  'However, workers who are not employed under a contract of service are outside this guidance.'
]) {
  assert.ok(completeMomPassage.includes(requiredCategory), `selected evidence retains ${requiredCategory}`);
}
const selectedMomExcerpt = selectRelevantFetchedText(longMomBody, ['Part IV overtime eligibility'], 5_000,
  momRequest.originalQuery, [completeMomPassage]);
assert.ok(selectedMomExcerpt.includes(completeMomPassage),
  'the complete supported passage stays in the final topic excerpt');
assert.ok(selectedMomExcerpt.includes('However, workers who are not employed under a contract of service are outside this guidance.'),
  'the final topic excerpt retains qualifications attached to the complete coverage passage');
assert.equal(supportBoundedStatutoryAdvisory({
  ...momRequest,
  sourceText: longMomBody.replace('Managers and executives are not covered under Part IV.', 'Managers and executives are covered under Part IV.')
}), false, 'a long passage with an affirmative exclusion contradiction is rejected');
assert.equal(selectBoundedStatutoryAdvisoryPassage({
  ...momRequest,
  sourceText: longMomBody.replace('Non-workmen who earn a basic monthly salary of $2,600 or less.', 'Non-workmen receive meal vouchers.')
}), undefined, 'a long page without the non-workman eligibility category yields no preferred passage');

const overflowQualifiedMomBody = [
  'Part IV of the Employment Act applies to hours of work and overtime. Managers and executives are not covered under Part IV.',
  'General employment information and administrative guidance. '.repeat(72),
  'You can claim overtime if you are:',
  'Workmen who earn a basic monthly salary of $4,500 or less are eligible for overtime under Part IV.',
  'Non-workmen who earn a basic monthly salary of $2,600 or less are also eligible for overtime under Part IV.',
  `However, ${'some employment arrangements may fall outside the described eligibility categories. '.repeat(13)}`
].join('\n\n');
assert.ok(overflowQualifiedMomBody.length > 5_000, 'the full qualified source is longer than the excerpt limit');
assert.equal(supportBoundedStatutoryAdvisory({ ...momRequest, sourceText: overflowQualifiedMomBody }), true,
  'the full oversized source still substantively supports the bounded coverage request');
assert.equal(selectBoundedStatutoryAdvisoryPassage({ ...momRequest, sourceText: overflowQualifiedMomBody }), undefined,
  'a supported passage whose attached qualification exceeds the excerpt limit fails closed');

console.log('Bounded statutory advisory support regression tests passed.');
