import assert from 'node:assert/strict';
import { supportGeneralIrasRuleConcept } from '../../src/retrieval/irasRuleConceptSupport.ts';

const companyConcept = (label, topicId, terms = []) => ({ label, terms, topicIds: [topicId] });
const foreignTopic = 'iras-foreign-sourced-income';
const foreignSubject = 'company foreign-sourced dividend income tax treatment';
const foreignConcept = companyConcept('foreign dividend income tax treatment', foreignTopic, ['foreign dividend tax treatment']);
const foreignInput = {
  domainId: 'IRAS_CORPORATE_TAX', topicIds: [foreignTopic], subject: foreignSubject,
  population: 'COMPANY', concepts: [foreignConcept]
};

assert.equal(supportGeneralIrasRuleConcept({
  ...foreignInput, sourceText: 'Foreign-sourced dividends received in Singapore are taxable in Singapore.'
}), true, 'A source that states the scoped foreign dividend receipt rule is recognized.');
assert.equal(supportGeneralIrasRuleConcept({
  ...foreignInput, sourceText: 'Foreign-sourced dividends received in Singapore are not taxable.'
}), false, 'A negated foreign dividend rule cannot count as affirmative support.');
assert.equal(supportGeneralIrasRuleConcept({
  ...foreignInput, domainId: 'IRAS_GST', sourceText: 'Foreign-sourced dividends received in Singapore are taxable.'
}), undefined, 'A topic in the wrong authority domain is outside this rule family.');

const privateTopic = 'iras-cit-deductibility';
const privateInput = {
  domainId: 'IRAS_CORPORATE_TAX', topicIds: [privateTopic],
  subject: 'company private expense tax deductibility', population: 'COMPANY',
  concepts: [companyConcept('private expense tax deduction', privateTopic)]
};
assert.equal(supportGeneralIrasRuleConcept({
  ...privateInput, sourceText: 'Private expenses are generally disallowed as a tax deduction.'
}), true, 'A direct private-expense disallowance supports the scoped rule.');
assert.equal(supportGeneralIrasRuleConcept({
  ...privateInput, sourceText: 'Private expenses are not disallowed for tax purposes.'
}), false, 'A reversed disallowance does not support the scoped rule.');

const royaltyTopic = 'iras-withholding-tax-interest-royalties';
const royaltyConcept = companyConcept('royalty withholding tax for payments to non-residents', royaltyTopic, ['royalty payments']);
const royaltyInput = {
  domainId: 'IRAS_CORPORATE_TAX', topicIds: [royaltyTopic],
  subject: 'company withholding tax on royalty payments to non-residents',
  population: 'COMPANY', concepts: [royaltyConcept]
};
assert.equal(supportGeneralIrasRuleConcept({
  ...royaltyInput, sourceText: 'Withholding tax applies to royalty payments to a non-resident company.'
}), true, 'A scoped non-resident royalty withholding rule is recognized.');
assert.equal(supportGeneralIrasRuleConcept({
  ...royaltyInput, sourceText: 'Withholding tax does not apply to royalty payments to a non-resident company.'
}), false, 'A negated royalty withholding statement cannot support the rule.');
assert.equal(supportGeneralIrasRuleConcept({
  ...royaltyInput, subject: 'company withholding tax on royalty payments to residents',
  sourceText: 'Withholding tax applies to royalty payments to a non-resident company.'
}), undefined, 'A resident request does not inherit non-resident royalty guidance.');

process.stdout.write('IRAS scoped rule concept support regressions passed.\n');
