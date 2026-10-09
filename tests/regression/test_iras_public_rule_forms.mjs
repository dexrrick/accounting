import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { supportGeneralIrasRuleConcept } from '../../src/retrieval/irasRuleConceptSupport.ts';
import { irasResolverCases } from '../fixtures/irasResolverCases.mjs';

const reportUrl = new URL('../../docs/evaluation/multi-authority-workstreams/iras-public-excerpts-2026-10-03-v1/iras-public-rule-excerpts-report-v1.json', import.meta.url);
const report = JSON.parse(await readFile(reportUrl, 'utf8'));
assert.equal(report.profileVersion, 'iras-public-rule-excerpts-v1');
assert.equal(report.interpretation, 'PRESENCE_ONLY_NOT_ENTAILMENT_OR_LIVE_ACCEPTANCE');

const excerpt = (mapId, blockIndex) => {
  const page = report.results.find(item => item.mapId === mapId);
  const value = page?.excerpts.find(item => item.blockIndex === blockIndex);
  assert.ok(value, `Expected source-derived block ${mapId}:${blockIndex}`);
  assert.equal(value.truncated, false);
  return value.text;
};
const frozen = id => {
  const item = irasResolverCases.find(candidate => candidate.id === id);
  assert.ok(item, `Frozen IRAS case ${id} exists.`);
  return item;
};
const privateCase = frozen('private-holiday-expense');
const privateSubject = privateCase.issues[0].subject;
const privateText = excerpt('IRAS_CIT_EXPENSES_SOURCE_MAP', 26);
const whtCase = frozen('wht-royalty-general-rule');
const whtSubject = whtCase.issues[0].subject;
const whtText = excerpt('IRAS_WHT_OVERVIEW_SOURCE_MAP', 10);
const privateConcept = { label: privateSubject, terms: ['personal expenses'] };
const whtConcept = { label: whtSubject, terms: ['royalty withholding tax', 'payment to non-resident company'] };
const privateSupport = (sourceText, concept = privateConcept, subject = privateSubject) => supportGeneralIrasRuleConcept({
  sourceText,
  domainId: 'IRAS_CORPORATE_TAX',
  topicIds: privateCase.requiredTopicIds,
  subject,
  concepts: [concept],
  population: 'COMPANY'
});
const whtSupport = (sourceText, concept = whtConcept, subject = whtSubject) => supportGeneralIrasRuleConcept({
  sourceText,
  domainId: 'IRAS_CORPORATE_TAX',
  topicIds: whtCase.requiredTopicIds,
  subject,
  concepts: [concept],
  population: 'COMPANY'
});

const actualPrivate = privateSupport(privateText);
const actualWht = whtSupport(whtText);
process.stdout.write(`${JSON.stringify({
  sourceBlocks: ['IRAS_CIT_EXPENSES_SOURCE_MAP:26', 'IRAS_WHT_OVERVIEW_SOURCE_MAP:10'],
  actualPrivateSupport: actualPrivate,
  actualWhtSupport: actualWht
})}\n`);

assert.equal(actualPrivate, true, 'The reported private-expense category definition and immediate inclusion qualify the named expense category.');
assert.equal(actualWht, true, 'The reported payer/payee/royalty parenthetical rule carries its mandatory withholding obligation.');

assert.equal(privateSupport('Non-deductible business expenses are costs that fail to meet the applicable conditions. These include private expenses.'), true,
  'An equivalent adjacent definition and direct inclusion supports private expenses.');
assert.equal(privateSupport('Non-deductible business expenses are expenses that do not satisfy the applicable conditions. These include personal expenses, which are deductible.'), false,
  'A deduction exclusion following the named expense cannot support nondeductibility.');
assert.equal(privateSupport('Non-deductible business expenses are expenses that do not satisfy the applicable conditions. Reports describe employee benefits. These include personal expenses.'), false,
  'A non-adjacent inclusion cannot borrow an earlier category antecedent.');
assert.equal(privateSupport('Non-deductible business expenses are expenses that do not satisfy the applicable conditions.\n\nThese include personal expenses.'), false,
  'An inclusion in a separate paragraph cannot borrow the prior paragraph category.');
assert.equal(privateSupport('Deductible business expenses are expenses that meet the applicable conditions. These include personal expenses.'), false,
  'A deductible category definition cannot support personal-expense disallowance.');
assert.equal(privateSupport('Non-deductible business expenses are expenses that do not satisfy the applicable conditions. These do not include personal expenses.'), false,
  'A negated category inclusion cannot support personal-expense disallowance.');
assert.equal(privateSupport('Non-deductible business expenses are expenses that do not satisfy the applicable conditions. These include no personal expenses.'), false,
  'A negative inclusion cannot support personal-expense disallowance.');
assert.equal(privateSupport('Non-deductible business expenses are expenses that do not satisfy the applicable conditions. These include personal expenses not included in that category.'), false,
  'The exact reviewer counterexample excludes personal expenses after naming them in the inclusion.');
assert.equal(privateSupport('Non-deductible business expenses are not costs that fail to meet the applicable conditions. These include personal expenses.'), false,
  'A negated category definition cannot support private-expense disallowance.');
assert.equal(privateSupport('Non-deductible business expenses are expenses that do not fulfil the conditions above, and deductible business expenses meet them. These include personal expenses.'), false,
  'A deductible category appended to the antecedent invalidates the category relationship.');
assert.equal(privateSupport('Non-deductible business expenses are expenses that do not satisfy the applicable conditions:\n• Personal expenses.'), false,
  'An unrelated heading or list item cannot substitute for the source sentence relationship.');
assert.equal(privateSupport(privateText, { label: privateSubject, terms: ['personal expenses', 'treaty exemption'] }), undefined,
  'The source-derived category rule does not satisfy an additional treaty or exemption requirement.');

const equivalentWht = 'A payer makes specified payments, including royalties, to a non-resident company and is required to withhold tax.';
assert.equal(whtSupport(equivalentWht), true, 'The bounded payer/payment/example/payee/obligation form supports the same generic rule.');
assert.equal(whtSupport('A non-resident payer makes specified payments (e.g. royalties) to a resident company and must withhold tax.'), false,
  'A non-resident payer with a resident payee does not establish the requested recipient scope.');
assert.equal(whtSupport('A payer makes payments of a specified nature (e.g. interest) to a non-resident company and must withhold tax. Royalty payments are described separately.'), false,
  'A royalty in a neighboring sentence cannot borrow another payment category withholding obligation.');
assert.equal(whtSupport('A person makes payments of a specified nature (e.g. royalty) to a non-resident company and must not withhold tax.'), false,
  'A negated withholding obligation cannot support the requested rule.');
assert.equal(whtSupport('A person does not make specified payments (e.g. royalty) to a non-resident company and must withhold tax.'), false,
  'A negated payer/payment premise cannot support the requested rule even when an obligation follows.');
assert.equal(whtSupport('A person makes payments of a specified nature (e.g. royalty) to a non-resident company and must withhold documents.'), false,
  'A recordkeeping obligation to withhold documents is not a withholding-tax obligation.');
assert.equal(whtSupport('A person makes specified payments (e.g. royalty) to a non-resident company and must withhold tax documents.'), false,
  'A tax noun prefix followed by documents is not a complete tax object.');
assert.equal(whtSupport('A person makes specified payments (e.g. royalty) to a non-resident company and must withhold tax records.'), false,
  'A tax noun prefix followed by records is not a complete tax object.');
assert.equal(whtSupport('A person makes payments of a specified nature (e.g. royalty) to a non-resident company and must withhold a percentage of evidence for review.'), false,
  'A percentage/evidence statement without a tax or WHT link is not a withholding-tax obligation.');
assert.equal(whtSupport('A person makes payments of a specified nature (e.g. interest, but not royalty) to a non-resident company and must withhold tax.'), false,
  'A royalty explicitly excluded from the examples cannot support the requested rule.');
assert.equal(whtSupport('A person makes payments of a specified nature (e.g. excluding royalty) to a non-resident company and must withhold tax.'), false,
  'An excluded royalty example cannot support the requested rule.');
assert.equal(whtSupport('A person makes payments of a specified nature (e.g. royalty excluded) to a non-resident company and must withhold tax.'), false,
  'A royalty marked excluded after the example cannot support the requested rule.');
assert.equal(whtSupport('A person makes specified payments (e.g. royalty) to a resident company and payments for interest to a non-resident company and must withhold tax.'), false,
  'A later interest recipient and obligation cannot be borrowed for the earlier royalty payment.');
assert.equal(whtSupport('A person makes payments of a specified nature (e.g. royalty) to a non-resident company, but another payer must withhold tax on interest.'), false,
  'A different payer’s withholding obligation cannot complete the original payer chain.');
assert.equal(whtSupport('A person makes payments of a specified nature (e.g. royalty) to a non-resident company and a bank must withhold tax on interest.'), false,
  'The exact reviewer counterexample cannot borrow a bank’s interest withholding obligation for the payer’s royalty.');
assert.equal(whtSupport('A person makes payments of a specified nature (e.g. royalty) to a non-resident company and must withhold a percentage of evidence for review as WHT.'), false,
  'A WHT label elsewhere in the clause cannot turn an unrelated percentage object into the royalty tax withheld.');
assert.equal(whtSupport('A person makes payments of a specified nature (e.g. royalty) to a non-resident company and must withhold a percentage of personal data; withholding tax applies to interest.'), false,
  'The exact reviewer counterexample cannot link personal data or interest tax to the royalty payment percentage.');
assert.equal(whtSupport('A person makes payments of a specified nature (e.g. royalty) to a non-resident company and must withhold tax on interest.'), false,
  'A tax object explicitly attached to interest cannot complete the royalty rule.');
assert.equal(whtSupport('A person makes payments of a specified nature (e.g. royalty) to a non-resident company and must withhold a percentage of the payment for interest and pay the amount withheld to IRAS as WHT.'), false,
  'A later WHT remittance cannot relabel an amount calculated for a separate interest payment.');
assert.equal(whtSupport('A non-resident payer makes payments of a specified nature (e.g. royalty) to a resident company and must withhold tax.'), false,
  'The payer residency cannot be borrowed as non-resident payee evidence.');
assert.equal(whtSupport(whtText, { label: whtSubject, terms: ['royalty withholding tax', 'payment to non-resident company', 'treaty rate'] }), undefined,
  'The generic withholding rule does not satisfy a treaty-rate requirement.');
