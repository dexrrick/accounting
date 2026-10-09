import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { classifyQuestion } from '../../src/classification/questionClassifier.ts';
import { ControlledWebRetriever } from '../../src/retrieval/controlledWebRetriever.ts';
import { SourceCache } from '../../src/retrieval/sourceCache.ts';
import { defaultAdvancedSourceRetriever } from '../../src/retrieval/advancedSourceRetriever.ts';
import { defaultQueryTopicResolver } from '../../src/retrieval/queryTopicResolver.ts';
import { supportGeneralIrasRuleConcept } from '../../src/retrieval/irasRuleConceptSupport.ts';
import { matchesRequestedQuestionConcept } from '../../src/retrieval/evidenceQualityGate.ts';
import { IRAS_SOURCE_MAP_DEFINITIONS, getCoverageTopicsByIds } from '../../src/standards/coverageRegistry.ts';
import { UNIFIED_SOURCE_REGISTRY } from '../../src/standards/unifiedSourceModel.ts';
import { buildAuthorityWorkstreams } from '../../src/services/authorityWorkstreams.ts';
import { buildGroundedReasoningContext } from '../../src/services/groundingContextBuilder.ts';
import { renderIrasEvidenceResponse } from '../../src/services/irasEvidencePolicy.ts';
import { getRequestedQuestionConcepts, reconcileQuestionUnderstanding, validateSemanticQuestionInterpretation } from '../../src/services/semanticQuestionUnderstanding.ts';
import { verifyEvidenceClaims } from '../../src/verification/claimEvidenceVerifier.ts';
import { irasResolverCases } from '../fixtures/irasResolverCases.mjs';

const frozen = id => {
  const item = irasResolverCases.find(candidate => candidate.id === id);
  assert.ok(item, `Frozen IRAS case ${id} exists.`);
  return item;
};
const issueOf = item => item.issues[0];
const asConcept = (label, terms, topicIds) => ({ id: 'arbitrary-concept-id', label, terms, topicIds });
const check = ({ sourceText, domainId, topicIds, subject, concepts = [], population = 'COMPANY' }) =>
  supportGeneralIrasRuleConcept({ sourceText, domainId, topicIds, subject, concepts, population });

const foreignCase = frozen('foreign-dividend-treatment');
const foreignSubject = issueOf(foreignCase).subject;
const foreignConcept = asConcept(foreignSubject, ['foreign dividend tax treatment', 'receipt rule'], foreignCase.requiredTopicIds);
const foreignRule = 'Foreign-sourced dividends are taxable when received in Singapore.';
assert.equal(check({
  sourceText: foreignRule,
  domainId: 'IRAS_CORPORATE_TAX',
  topicIds: foreignCase.requiredTopicIds,
  subject: foreignSubject,
  concepts: [foreignConcept]
}), true, 'A source can support the frozen foreign-dividend rule without repeating subsidiary framing.');
assert.equal(matchesRequestedQuestionConcept(foreignRule, foreignConcept, {
  domainId: 'IRAS_CORPORATE_TAX', topicIds: foreignCase.requiredTopicIds, subject: foreignSubject
}), true, 'The evidence-quality matcher invokes the bounded rule helper before its generic concept fallback.');

assert.equal(check({
  sourceText: 'Foreign income is taxable when received in Singapore.',
  domainId: 'IRAS_CORPORATE_TAX', topicIds: foreignCase.requiredTopicIds,
  subject: foreignSubject, concepts: [foreignConcept]
}), false, 'Foreign income without dividend wording cannot support the foreign-dividend concept.');
assert.equal(matchesRequestedQuestionConcept('Foreign income is taxable when received in Singapore.', foreignConcept, {
  domainId: 'IRAS_CORPORATE_TAX', topicIds: foreignCase.requiredTopicIds, subject: foreignSubject
}), false, 'Recognized but unsupported dividend scope cannot fall through to a broad generic concept match.');
assert.equal(check({
  sourceText: 'Domestic dividends paid by a foreign company are taxable when received in Singapore.',
  domainId: 'IRAS_CORPORATE_TAX', topicIds: foreignCase.requiredTopicIds,
  subject: foreignSubject, concepts: [foreignConcept]
}), false, 'A domestic dividend paid by a foreign company is not foreign-sourced dividend support.');
assert.equal(check({
  sourceText: 'Foreign-sourced dividends are discussed separately. Interest is taxable when received in Singapore.',
  domainId: 'IRAS_CORPORATE_TAX', topicIds: foreignCase.requiredTopicIds,
  subject: foreignSubject, concepts: [foreignConcept]
}), false, 'A later interest-tax sentence cannot complete an earlier dividend mention.');
assert.equal(check({
  sourceText: 'Foreign-sourced dividends are discussed while interest received in Singapore is taxable.',
  domainId: 'IRAS_CORPORATE_TAX', topicIds: foreignCase.requiredTopicIds,
  subject: foreignSubject, concepts: [foreignConcept]
}), false, 'A contrasting interest clause cannot supply the dividend tax predicate.');
assert.equal(check({
  sourceText: 'Foreign dividends are taxable only when interest is received in Singapore.',
  domainId: 'IRAS_CORPORATE_TAX', topicIds: foreignCase.requiredTopicIds,
  subject: foreignSubject, concepts: [foreignConcept]
}), false, 'Singapore receipt of a separate interest item cannot qualify the dividend rule.');
assert.equal(check({
  sourceText: 'Foreign dividends are taxable when received in Singapore.',
  domainId: 'IRAS_CORPORATE_TAX', topicIds: foreignCase.requiredTopicIds,
  subject: foreignSubject, concepts: [foreignConcept]
}), true, 'A Singapore-receipt condition directly attached to the dividend rule remains supported.');
assert.equal(check({
  sourceText: 'Foreign dividends are taxable when they are received in Singapore.',
  domainId: 'IRAS_CORPORATE_TAX', topicIds: foreignCase.requiredTopicIds,
  subject: foreignSubject, concepts: [foreignConcept]
}), true, 'A pronoun-linked Singapore-receipt condition remains directly attached to the dividend rule.');
for (const sourceText of [
  'Foreign dividends are taxable, and interest is taxable when received in Singapore.',
  'Foreign dividends are taxable and interest is taxable when received in Singapore.',
  'Foreign dividends received in Singapore are discussed, and interest is taxable.',
  'Foreign dividends received in Singapore are discussed and interest is taxable.'
]) {
  assert.equal(check({
    sourceText,
    domainId: 'IRAS_CORPORATE_TAX', topicIds: foreignCase.requiredTopicIds,
    subject: foreignSubject, concepts: [foreignConcept]
  }), false, `A separate interest predicate cannot complete a dividend rule: ${sourceText}`);
}
assert.equal(check({
  sourceText: 'Foreign-sourced dividends are taxable when received in Singapore.',
  domainId: 'IRAS_GST', topicIds: foreignCase.requiredTopicIds,
  subject: foreignSubject, concepts: [foreignConcept]
}), undefined, 'The foreign-dividend path is inactive outside the corporate-income-tax domain.');
assert.equal(check({
  sourceText: 'Foreign-sourced dividends are taxable when received in Singapore.',
  domainId: 'IRAS_CORPORATE_TAX', topicIds: foreignCase.requiredTopicIds,
  subject: foreignSubject, concepts: [foreignConcept], population: 'INDIVIDUAL'
}), undefined, 'The company-only helper does not activate for another population.');
assert.equal(check({
  sourceText: 'https://www.iras.gov.sg/taxes/corporate-income-tax/foreign-income',
  domainId: 'IRAS_CORPORATE_TAX', topicIds: foreignCase.requiredTopicIds,
  subject: foreignSubject, concepts: [foreignConcept]
}), false, 'An official URL without substantive source text does not support the rule.');

for (const extra of ['treaty relief', 'foreign tax credit', 'Section 13 exemption conditions', 'tax outcome', 'filing requirement', 'applicable tax rate']) {
  const broaderConcept = asConcept(foreignSubject, [extra], foreignCase.requiredTopicIds);
  assert.equal(check({
    sourceText: foreignRule,
    domainId: 'IRAS_CORPORATE_TAX', topicIds: foreignCase.requiredTopicIds,
    subject: foreignSubject, concepts: [broaderConcept]
  }), undefined, `Specific foreign-income scope stays outside the new equivalence path: ${extra}`);
  assert.equal(matchesRequestedQuestionConcept(foreignRule, broaderConcept, {
    domainId: 'IRAS_CORPORATE_TAX', topicIds: foreignCase.requiredTopicIds, subject: foreignSubject
  }), matchesRequestedQuestionConcept(foreignRule, broaderConcept),
  `Broader foreign-income scope preserves legacy matching: ${extra}`);
}
assert.equal(check({
  sourceText: 'A dividend received from a non-resident payer may be subject to withholding tax.',
  domainId: 'IRAS_CORPORATE_TAX', topicIds: ['iras-withholding-tax-interest-royalties'],
  subject: 'withholding tax on dividend from non-resident payer'
}), undefined, 'An unrelated domestic/WHT dividend does not select the foreign-dividend family.');
assert.equal(check({
  sourceText: 'The company charges output tax on standard-rated supplies.',
  domainId: 'IRAS_GST', topicIds: ['iras-gst-standard-rated-supplies'],
  subject: 'general Singapore GST output tax charging rules'
}), undefined, 'GST output tax remains outside the input-tax family.');

const gstCase = frozen('gst-input-tax-general-rule');
const gstSubject = issueOf(gstCase).subject;
const gstConcept = asConcept(gstSubject, ['GST input tax claim and recovery'], gstCase.requiredTopicIds);
const gstRule = 'A GST-registered business may claim input tax on costs used to make taxable supplies, subject to the applicable conditions and a valid tax invoice.';
assert.equal(check({
  sourceText: gstRule, domainId: 'IRAS_GST', topicIds: gstCase.requiredTopicIds,
  subject: gstSubject, concepts: [gstConcept]
}), true, 'General GST rule support does not require source wording to repeat business-purchase framing.');
const gstHistoricalPhraseMatched = 'A GST-registered business may make an input tax claim for business purchases used to make taxable supplies when the prescribed conditions are met.';
assert.equal(check({
  sourceText: gstHistoricalPhraseMatched, domainId: 'IRAS_GST', topicIds: gstCase.requiredTopicIds,
  subject: gstSubject, concepts: [gstConcept]
}), true, 'The explicit make-an-input-tax-claim wording supports the general claim rule when linked to business and taxable-supply scope.');
assert.equal(check({
  sourceText: 'It is not true that a GST-registered business may make an input tax claim for business purchases used to make taxable supplies when the prescribed conditions are met.',
  domainId: 'IRAS_GST', topicIds: gstCase.requiredTopicIds,
  subject: gstSubject, concepts: [gstConcept]
}), false, 'Negated make-an-input-tax-claim wording remains unsupported.');
assert.equal(check({
  sourceText: 'A GST-registered business may make an input tax claim for entertainment purchases only under a special exception.',
  domainId: 'IRAS_GST', topicIds: gstCase.requiredTopicIds,
  subject: gstSubject, concepts: [gstConcept]
}), false, 'Make-an-input-tax-claim wording tied only to a special exception does not establish general support.');
assert.equal(check({
  sourceText: 'Input tax may be claimed.', domainId: 'IRAS_GST', topicIds: gstCase.requiredTopicIds,
  subject: gstSubject, concepts: [gstConcept]
}), false, 'Input-tax claim wording alone lacks meaningful business, condition, document, or taxable-scope support.');
assert.equal(check({
  sourceText: 'A business may claim input tax on motor car purchases only under this specific exception.',
  domainId: 'IRAS_GST', topicIds: gstCase.requiredTopicIds,
  subject: gstSubject, concepts: [gstConcept]
}), false, 'A specific motor-car exception cannot establish the general input-tax claim rule.');
assert.equal(check({
  sourceText: 'It is not true that a business may claim input tax on these purchases.',
  domainId: 'IRAS_GST', topicIds: gstCase.requiredTopicIds,
  subject: gstSubject, concepts: [gstConcept]
}), false, 'A negated input-tax claim statement cannot establish an affirmative entitlement.');
assert.equal(check({
  sourceText: 'A business may claim input tax on entertainment purchases subject to a special exception.',
  domainId: 'IRAS_GST', topicIds: gstCase.requiredTopicIds,
  subject: gstSubject, concepts: [gstConcept]
}), false, 'A special exception is not general input-tax claim support.');
const gstListRule = 'To claim input tax:\n\n• You must use the purchase for taxable supplies.';
assert.equal(check({
  sourceText: gstListRule, domainId: 'IRAS_GST', topicIds: gstCase.requiredTopicIds,
  subject: gstSubject, concepts: [gstConcept]
}), true, 'A complete claim heading and its attached marked condition form one rule unit.');
assert.equal(check({
  sourceText: 'Input tax claim requirements:\n\n• See the applicable guidance.',
  domainId: 'IRAS_GST', topicIds: gstCase.requiredTopicIds,
  subject: gstSubject, concepts: [gstConcept]
}), false, 'A headed but substantively orphaned input-tax label does not establish a rule.');
assert.equal(check({
  sourceText: gstRule, domainId: 'IRAS_GST', topicIds: gstCase.requiredTopicIds,
  subject: gstSubject, concepts: [asConcept(gstSubject, ['blocked motor-vehicle input tax eligibility'], gstCase.requiredTopicIds)]
}), undefined, 'Blocked and specific eligibility scopes stay outside general input-tax equivalence.');

const blockedInputTaxSource = UNIFIED_SOURCE_REGISTRY.GST_REG26_BLOCKED_INPUT_TAX;
assert.ok(blockedInputTaxSource?.sourceText, 'The approved blocked-input-tax source is present in the unified registry.');
assert.equal(check({
  sourceText: blockedInputTaxSource.sourceText, domainId: 'IRAS_GST', topicIds: gstCase.requiredTopicIds,
  subject: gstSubject, concepts: [gstConcept]
}), false, 'An isolated rule restricting specified blocked claims does not establish general input-tax recovery conditions.');

for (const extra of ['treaty', 'foreign tax credit', 'exemption conditions', 'tax outcome', 'filing', 'tax rates', 'blocked claim', 'specific eligibility']) {
  const broaderConcept = asConcept(gstSubject, [extra], gstCase.requiredTopicIds);
  assert.equal(check({
    sourceText: gstRule, domainId: 'IRAS_GST', topicIds: gstCase.requiredTopicIds,
    subject: gstSubject, concepts: [broaderConcept]
  }), undefined, `Specific GST scope stays outside the new equivalence path: ${extra}`);
  assert.equal(matchesRequestedQuestionConcept(gstRule, broaderConcept, {
    domainId: 'IRAS_GST', topicIds: gstCase.requiredTopicIds, subject: gstSubject
  }), matchesRequestedQuestionConcept(gstRule, broaderConcept),
  `Broader GST scope preserves legacy matching: ${extra}`);
}
const invoiceConcept = asConcept(gstSubject, ['input tax invoice and document requirements'], gstCase.requiredTopicIds);
assert.equal(check({ sourceText: gstRule, domainId: 'IRAS_GST', topicIds: gstCase.requiredTopicIds, subject: gstSubject, concepts: [invoiceConcept] }), undefined,
  'Explicit invoice/document requirements are outside the general GST equivalence path.');
assert.equal(matchesRequestedQuestionConcept(gstRule, invoiceConcept, {
  domainId: 'IRAS_GST', topicIds: gstCase.requiredTopicIds, subject: gstSubject
}), matchesRequestedQuestionConcept(gstRule, invoiceConcept), 'Invoice-specific GST scope preserves legacy matching.');

const privateCase = frozen('private-holiday-expense');
const privateSubject = issueOf(privateCase).subject;
const privateConcept = asConcept(privateSubject, ['private expense tax deductibility'], privateCase.requiredTopicIds);
assert.equal(check({
  sourceText: 'Domestic or private expenses are disallowed under the general income-tax rule.',
  domainId: 'IRAS_CORPORATE_TAX', topicIds: privateCase.requiredTopicIds,
  subject: privateSubject, concepts: [privateConcept]
}), true, 'Plural private expenses with explicit disallowance support the bounded deductibility rule.');
assert.equal(check({
  sourceText: 'Expenses wholly and exclusively incurred in producing income are deductible.',
  domainId: 'IRAS_CORPORATE_TAX', topicIds: privateCase.requiredTopicIds,
  subject: privateSubject, concepts: [privateConcept]
}), false, 'General business-cost wording without explicit private-expense disallowance is insufficient.');
assert.equal(check({
  sourceText: 'Private expenses are discussed separately. Interest costs are disallowed.',
  domainId: 'IRAS_CORPORATE_TAX', topicIds: privateCase.requiredTopicIds,
  subject: privateSubject, concepts: [privateConcept]
}), false, 'An unrelated interest-cost rule cannot borrow a private-expense subject from another sentence.');
assert.equal(check({
  sourceText: 'Private expenses are not disallowed under this rule.',
  domainId: 'IRAS_CORPORATE_TAX', topicIds: privateCase.requiredTopicIds,
  subject: privateSubject, concepts: [privateConcept]
}), false, 'Negating disallowance cannot support the private-expense deduction rule.');
assert.equal(check({
  sourceText: 'Private expenses are discussed while interest costs are disallowed.',
  domainId: 'IRAS_CORPORATE_TAX', topicIds: privateCase.requiredTopicIds,
  subject: privateSubject, concepts: [privateConcept]
}), false, 'A contrasting interest clause cannot supply the private-expense disallowance predicate.');
assert.equal(check({
  sourceText: 'A private expense is not tax deductible under the general rule.',
  domainId: 'IRAS_CORPORATE_TAX', topicIds: privateCase.requiredTopicIds,
  subject: privateSubject, concepts: [privateConcept]
}), true, 'The positive non-deductibility phrasing remains supported.');
for (const extra of ['Section 15 motor-car exception', 'tax rate', 'filing outcome', 'eligibility determination']) {
  assert.equal(check({
    sourceText: 'Domestic or private expenses are disallowed under the general income-tax rule.',
    domainId: 'IRAS_CORPORATE_TAX', topicIds: privateCase.requiredTopicIds,
    subject: privateSubject, concepts: [asConcept(privateSubject, [extra], privateCase.requiredTopicIds)]
  }), undefined, `Specific expense or outcome scope stays outside the new equivalence path: ${extra}`);
}
for (const qualifier of ['not private expense', 'non-deductible private expenses']) {
  assert.equal(check({
    sourceText: 'Domestic or private expenses are disallowed under the general income-tax rule.',
    domainId: 'IRAS_CORPORATE_TAX', topicIds: privateCase.requiredTopicIds,
    subject: privateSubject, concepts: [asConcept(privateSubject, [qualifier], privateCase.requiredTopicIds)]
  }), undefined, `A negated or materially qualified private-expense concept is outside the bounded general scope: ${qualifier}`);
}
assert.equal(check({
  sourceText: 'Domestic or private expenses are disallowed under the general income-tax rule.',
  domainId: 'IRAS_CORPORATE_TAX', topicIds: privateCase.requiredTopicIds,
  subject: privateSubject, concepts: [asConcept(privateSubject, ['not a private expense'], privateCase.requiredTopicIds)]
}), undefined, 'A negated private-expense semantic concept cannot enter the positive private-expense rule family.');

const royaltyCase = frozen('wht-royalty-general-rule');
const royaltySubject = issueOf(royaltyCase).subject;
const royaltyConcept = asConcept(royaltySubject, ['royalty withholding tax for non-resident company'], royaltyCase.requiredTopicIds);
assert.equal(check({
  sourceText: 'Withholding tax applies to royalty payments to a non-resident company.',
  domainId: 'IRAS_CORPORATE_TAX', topicIds: royaltyCase.requiredTopicIds,
  subject: royaltySubject, concepts: [royaltyConcept]
}), true, 'The WHT rule requires royalty, withholding tax, and the requested non-resident recipient scope.');
assert.equal(check({
  sourceText: 'Withholding tax applies to royalties, and interest is paid to a non-resident company.',
  domainId: 'IRAS_CORPORATE_TAX', topicIds: royaltyCase.requiredTopicIds,
  subject: royaltySubject, concepts: [royaltyConcept]
}), false, 'A non-resident recipient of interest cannot complete the royalty withholding rule.');
assert.equal(check({
  sourceText: 'Royalties are paid to non-resident companies and are subject to withholding tax.',
  domainId: 'IRAS_CORPORATE_TAX', topicIds: royaltyCase.requiredTopicIds,
  subject: royaltySubject, concepts: [royaltyConcept]
}), true, 'A direct royalty payment and recipient phrase with its withholding predicate remains supported.');
assert.equal(check({
  sourceText: 'Royalties paid to non-residents are discussed, and interest is subject to withholding tax.',
  domainId: 'IRAS_CORPORATE_TAX', topicIds: royaltyCase.requiredTopicIds,
  subject: royaltySubject, concepts: [royaltyConcept]
}), false, 'A separate interest withholding predicate cannot complete a royalty recipient phrase.');
assert.equal(check({
  sourceText: 'Withholding tax applies to royalty payments to a foreign recipient.',
  domainId: 'IRAS_CORPORATE_TAX', topicIds: royaltyCase.requiredTopicIds,
  subject: royaltySubject, concepts: [royaltyConcept]
}), false, 'A foreign recipient reference does not replace explicit non-resident recipient scope.');
assert.equal(check({
  sourceText: 'Withholding tax applies to interest payments to non-resident companies.',
  domainId: 'IRAS_CORPORATE_TAX', topicIds: royaltyCase.requiredTopicIds,
  subject: royaltySubject, concepts: [royaltyConcept]
}), false, 'Interest-only support cannot cover a requested royalty rule.');
assert.equal(check({
  sourceText: 'Withholding tax applies to service fees paid to non-resident companies.',
  domainId: 'IRAS_CORPORATE_TAX', topicIds: royaltyCase.requiredTopicIds,
  subject: royaltySubject, concepts: [royaltyConcept]
}), false, 'Service-fee-only support cannot cover a requested royalty rule.');
assert.equal(check({
  sourceText: 'Withholding tax applies when a non-resident company pays royalties to a resident company.',
  domainId: 'IRAS_CORPORATE_TAX', topicIds: royaltyCase.requiredTopicIds,
  subject: royaltySubject, concepts: [royaltyConcept]
}), false, 'A non-resident payer does not establish non-resident royalty-recipient scope.');
assert.equal(check({
  sourceText: 'Withholding tax applies to interest, and royalties are paid to non-resident companies.',
  domainId: 'IRAS_CORPORATE_TAX', topicIds: royaltyCase.requiredTopicIds,
  subject: royaltySubject, concepts: [royaltyConcept]
}), false, 'An interest-payment rule cannot be borrowed by a separate royalty clause.');
assert.equal(check({
  sourceText: 'Withholding tax never applies to royalty payments to non-resident companies.',
  domainId: 'IRAS_CORPORATE_TAX', topicIds: royaltyCase.requiredTopicIds,
  subject: royaltySubject, concepts: [royaltyConcept]
}), false, 'A negated WHT rule cannot establish the requested royalty support.');
assert.equal(check({
  sourceText: 'Withholding tax applies to royalty payments to a non-resident company.',
  domainId: 'IRAS_CORPORATE_TAX', topicIds: royaltyCase.requiredTopicIds,
  subject: royaltySubject, concepts: [royaltyConcept]
}), true, 'A WHT predicate directly attached to royalty payments supports the general rule.');
assert.equal(check({
  sourceText: 'Royalty withholding tax for non-resident companies.',
  domainId: 'IRAS_CORPORATE_TAX', topicIds: royaltyCase.requiredTopicIds,
  subject: royaltySubject, concepts: [royaltyConcept]
}), false, 'A WHT label without a substantive rule does not establish support.');
for (const extra of ['treaty rate', 'withholding tax filing', 'tax calculation', 'eligibility outcome']) {
  assert.equal(check({
    sourceText: 'Withholding tax applies to royalty payments to a non-resident company.',
    domainId: 'IRAS_CORPORATE_TAX', topicIds: royaltyCase.requiredTopicIds,
    subject: royaltySubject, concepts: [asConcept(royaltySubject, [extra], royaltyCase.requiredTopicIds)]
  }), undefined, `Specific WHT scope stays outside the new equivalence path: ${extra}`);
}
assert.equal(check({
  sourceText: 'Withholding tax applies to royalty payments to a non-resident company.',
  domainId: 'IRAS_CORPORATE_TAX', topicIds: royaltyCase.requiredTopicIds,
  subject: royaltySubject, concepts: [asConcept(royaltySubject, ['royalty payments to a resident company'], royaltyCase.requiredTopicIds)]
}), undefined, 'An explicitly resident recipient cannot be treated as a requested non-resident recipient.');

// An attached heading/list rule remains one complete bounded source unit. The
// quote verifier remains literal and must accept the whole quoted unit before
// the general-rule helper can support it.
const foreignListRule = 'Tax on Foreign-Sourced Income Received in Singapore:\n• Foreign-sourced dividends received in Singapore are taxable upon receipt, subject to the applicable exemption conditions.';
const mapRecord = UNIFIED_SOURCE_REGISTRY.IRAS_CIT_FOREIGN_INCOME_SOURCE_MAP;
const literalRecord = {
  ...UNIFIED_SOURCE_REGISTRY.ITA_SEC14_GENERAL_DEDUCTION,
  sourceText: foreignListRule
};
const wholeListQuote = verifyEvidenceClaims([{
  kind: 'RULE', text: foreignListRule, quote: foreignListRule, recordId: literalRecord.id
}], [literalRecord], { targetDate: '2026-10-02' });
assert.equal(wholeListQuote.accepted.length, 1, 'The literal verifier accepts the complete headed/list source span.');
assert.equal(check({
  sourceText: wholeListQuote.accepted[0].quote, domainId: 'IRAS_CORPORATE_TAX',
  topicIds: foreignCase.requiredTopicIds, subject: foreignSubject, concepts: [foreignConcept]
}), true, 'A complete headed/list qualification supports the bounded foreign-dividend rule.');
const foreignExemptionListRule = 'Foreign-sourced income received in Singapore may be exempt from tax if the statutory conditions are met:\n\n• Foreign-sourced dividends.';
assert.equal(check({
  sourceText: foreignExemptionListRule, domainId: 'IRAS_CORPORATE_TAX',
  topicIds: foreignCase.requiredTopicIds, subject: foreignSubject, concepts: [foreignConcept]
}), true, 'A complete Singapore-receipt tax heading applies to its attached foreign-dividend category.');
const orphanDividendLabel = 'Foreign-sourced dividends.';
const orphanQuote = verifyEvidenceClaims([{
  kind: 'RULE', text: orphanDividendLabel, quote: orphanDividendLabel, recordId: literalRecord.id
}], [{ ...literalRecord, sourceText: orphanDividendLabel }], { targetDate: '2026-10-02' });
assert.equal(orphanQuote.accepted.length, 1, 'The verifier confirms the orphan phrase is literally present.');
assert.equal(check({
  sourceText: orphanQuote.accepted[0].quote, domainId: 'IRAS_CORPORATE_TAX',
  topicIds: foreignCase.requiredTopicIds, subject: foreignSubject, concepts: [foreignConcept]
}), false, 'A verified orphan dividend label does not establish the rule.');

assert.ok(mapRecord, 'The approved foreign-income source-map fixture is present.');

const localFixtures = JSON.parse(await readFile(new URL(
  '../../docs/evaluation/multi-authority-workstreams/iras-first-local-2026-10-02-v4/local-evidence-fixtures.json', import.meta.url), 'utf8'));
const endToEndCases = [
  { id: 'foreign-dividend-treatment', fixtureId: 'foreign-dividend-conditional-rule', application: 'UNRESOLVED' },
  { id: 'gst-input-tax-general-rule', fixtureId: 'gst-input-tax-natural', application: 'NOT_REQUIRED' },
  { id: 'private-holiday-expense', fixtureId: 'private-deductibility-general', application: 'UNRESOLVED' },
  { id: 'wht-royalty-general-rule', fixtureId: 'wht-royalty-hyphenated-query', application: 'NOT_REQUIRED' }
];
const mapsByTopic = new Map();
for (const definition of IRAS_SOURCE_MAP_DEFINITIONS) {
  for (const topicId of definition.topicIds) {
    const definitions = mapsByTopic.get(topicId) || [];
    definitions.push(definition);
    mapsByTopic.set(topicId, definitions);
  }
}
const html = (title, passage) => {
  const escape = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  return `<html><head><title>${escape(title)}</title></head><body><main><h1>${escape(title)}</h1><p>${escape(passage)}</p></main></body></html>`;
};
const emptyLocalRetriever = {
  async retrieveSources() { return []; },
  getSourceById: id => defaultAdvancedSourceRetriever.getSourceById(id),
  findSourcesByStandardOrAct: (...args) => defaultAdvancedSourceRetriever.findSourcesByStandardOrAct(...args)
};
const emptyAdapters = {
  discoveryAdapter: {
    async discoverOfficialSourceCandidates() { return []; },
    getLastFetchTrace() { return []; }
  },
  officialDomainSearchAdapter: {
    async searchOfficialDomainCandidates() { return []; },
    getLastSearchTrace() { return []; }
  }
};
const actualFetch = globalThis.fetch;
let ambientFetchCalls = 0;
globalThis.fetch = async (...args) => {
  ambientFetchCalls += 1;
  throw new Error(`AMBIENT_FETCH_DISABLED:${String(args[0] || '')}`);
};
const syntheticFetchLog = [];
const centralResults = [];
try {
  for (const item of endToEndCases) {
    const sourceCase = frozen(item.id);
    const sourceIssue = issueOf(sourceCase);
    const interpretation = {
      schemaVersion: 2,
      jurisdiction: ['Singapore'],
      authorityCandidates: ['IRAS'],
      contextualAuthorities: [],
      domain: sourceIssue.domain,
      population: sourceIssue.population,
      primarySubject: sourceIssue.subject,
      concepts: [{ concept: sourceIssue.subject, role: 'PRIMARY' }],
      requestedOperation: sourceIssue.operation,
      factsExplicitlyProvided: [],
      confidence: 0.96,
      issues: sourceCase.issues.map(issue => ({
        subject: issue.subject,
        population: issue.population,
        domain: issue.domain,
        governingAuthorities: [issue.authority],
        contextualAuthorities: [],
        operation: issue.operation,
        mappedTopicIds: [],
        evidenceRequirement: issue.facts ? 'AUTHORITATIVE_SOURCE_AND_CASE_FACTS' : 'AUTHORITATIVE_SOURCE',
        confidence: 0.96
      }))
    };
    assert.ok(validateSemanticQuestionInterpretation(interpretation, sourceCase.query), `${item.id} uses a valid frozen-subject V2 interpretation.`);
    const understanding = { mode: 'SEMANTIC_INTERPRETATION', interpretation };
    const reconciled = reconcileQuestionUnderstanding(sourceCase.query, classifyQuestion(sourceCase.query), understanding);
    assert.equal(reconciled.issuePlan.source, 'SEMANTIC_ISSUES', `${item.id} uses public classification and reconciliation.`);
    assert.equal(reconciled.issuePlan.issues.length, sourceCase.issues.length, `${item.id} retains every frozen issue.`);
    const issue = reconciled.issuePlan.issues.find(candidate => candidate.governingAuthorities.includes('IRAS') &&
      candidate.unresolvedReason !== 'UNASSIGNED_QUERY_TOPIC');
    assert.ok(issue, `${item.id} has a reconciled IRAS issue.`);
    assert.equal(issue.subject, sourceIssue.subject, `${item.id} retains its frozen issue subject unchanged.`);
    const topicList = getCoverageTopicsByIds(issue.mappedTopicIds).filter(topic => topic.domainId.startsWith('IRAS_') && !topic.routingOnly);
    const topicIds = [...new Set(topicList.map(topic => topic.id))];
    assert.ok(topicIds.length > 0, `${item.id} has real reconciled IRAS topics.`);
    const sourceMapIds = new Set();
    for (const topic of topicList) {
      for (const definition of mapsByTopic.get(topic.id) || []) {
        if (definition.domainId === topic.domainId) sourceMapIds.add(definition.id);
      }
    }
    const definitions = [...sourceMapIds].map(id => IRAS_SOURCE_MAP_DEFINITIONS.find(definition => definition.id === id));
    assert.ok(definitions.length > 0, `${item.id} derives every mapped source definition from reconciled topics.`);
    const localFixture = localFixtures.cases[item.fixtureId];
    assert.ok(localFixture?.passage, `${item.id} uses a complete synthetic source passage.`);
    const requestedConcepts = getRequestedQuestionConcepts(sourceCase.query, understanding);
    const helperChecks = requestedConcepts.map(concept => ({
      id: concept.id,
      label: concept.label,
      topicIds: [...concept.topicIds],
    scopedSupport: topicList.map(topic => supportGeneralIrasRuleConcept({
      sourceText: localFixture.passage,
      domainId: topic.domainId,
      topicIds: [...new Set([topic.id, ...topicIds, ...concept.topicIds])],
      subject: concept.label,
      population: sourceIssue.population,
      concepts: [concept]
    }))
    }));
    if (item.id === 'private-holiday-expense') {
      assert.ok(requestedConcepts.length > 0, 'Private-expense semantic concept survives the frozen subject projection.');
    }
    const allowedByUrl = new Map();
    for (const definition of definitions) {
      const pointer = defaultAdvancedSourceRetriever.getSourceById(definition.id);
      assert.ok(pointer?.officialSourceUrl, `${definition.id} is a resolved registered source-map pointer.`);
      allowedByUrl.set(pointer.officialSourceUrl, pointer.documentTitle);
    }
    const customFetch = async url => {
      const requestedUrl = String(url);
      const title = allowedByUrl.get(requestedUrl);
      assert.ok(title, `${item.id} transport refuses any URL outside all mapped definitions: ${requestedUrl}`);
      syntheticFetchLog.push({ caseId: item.id, url: requestedUrl });
      return new Response(html(title, localFixture.passage), {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' }
      });
    };
    let siblingDocumentChecks = [];
    if (item.id === 'private-holiday-expense' || item.id === 'wht-royalty-general-rule') {
      const sourceDomain = topicList[0].domainId;
      const diagnosticContext = await buildGroundedReasoningContext(sourceCase.query, null, emptyLocalRetriever, undefined, {
        ...emptyAdapters,
        webRetriever: new ControlledWebRetriever(undefined, new SourceCache()),
        fetchOptions: { timeoutMs: 1000, useCache: false, customFetch },
        authorityLevelDiscovery: false,
        localOnly: false,
        referenceDate: '2026-10-02',
        questionUnderstanding: understanding,
        evidenceScope: {
          authority: 'IRAS',
          domain: sourceDomain,
          topicIds,
          requestedConcepts,
          context: {
            domainId: sourceDomain,
            population: issue.population,
            primarySubject: issue.subject,
            concepts: [issue.subject],
            requestedOperation: issue.operation
          }
        }
      });
      const diagnosticRender = renderIrasEvidenceResponse({}, diagnosticContext, sourceCase.query, null, 'SFRS_I', 'LOCAL');
      const eligible = diagnosticContext.evidenceQuality?.eligibleRecords || [];
      for (let topicIndex = 0; topicIndex < topicIds.length; topicIndex += 1) {
        const topicId = topicIds[topicIndex];
        const topic = topicList.find(candidate => candidate.id === topicId);
        if (!topic) continue;
        const siblings = eligible.filter(record => [...(record.tags || []), ...(record.relatedTopicIds || []),
          ...(record.sourceMapTopicIds || []), ...(record.retrievalHints || [])].includes(topicId));
        for (const sibling of siblings) {
          const claim = diagnosticRender.claimVerification.accepted.find(candidate => {
            const selectedRecord = eligible.find(record => record.id === candidate.recordId);
            return selectedRecord?.canonicalSourceUrl === sibling.canonicalSourceUrl &&
              (selectedRecord.contentHash || selectedRecord.documentHash) === (sibling.contentHash || sibling.documentHash);
          });
          const quote = claim?.quote;
          const comparison = eligible.find(candidate => candidate.id !== sibling.id && candidate.canonicalSourceUrl === sibling.canonicalSourceUrl &&
            (candidate.contentHash || candidate.documentHash) === (sibling.contentHash || sibling.documentHash));
          const siblingCapturedDate = sibling.retrievedAt?.slice(0, 10) || '';
          assert.match(siblingCapturedDate, /^\d{4}-\d{2}-\d{2}$/, 'A live sibling record has a captured calendar date.');
          const siblingCapturedTimestamp = Date.parse(`${siblingCapturedDate}T00:00:00.000Z`);
          assert.ok(Number.isFinite(siblingCapturedTimestamp));
          assert.equal(new Date(siblingCapturedTimestamp).toISOString().slice(0, 10), siblingCapturedDate,
            'The live sibling capture date is a valid calendar date.');
          const siblingLiteralCheck = quote ? verifyEvidenceClaims([{
            kind: 'RULE', text: quote, quote, recordId: sibling.id
          }], [sibling], { targetDate: siblingCapturedDate }) : undefined;
          if (quote) {
            const priorDayTargetDate = new Date(siblingCapturedTimestamp - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
            const priorDaySiblingCheck = verifyEvidenceClaims([{
              kind: 'RULE', text: quote, quote, recordId: sibling.id
            }], [sibling], { targetDate: priorDayTargetDate });
            assert.equal(priorDaySiblingCheck.accepted.length, 0);
            assert.equal(priorDaySiblingCheck.rejected[0]?.reason, 'LIVE_HISTORICAL_PAGE_SCOPE_UNVERIFIED',
              'The same captured live page cannot substantiate a prior-day target.');
          }
          siblingDocumentChecks.push({
            topicId,
            recordId: sibling.id,
            canonicalUrlMatchesSibling: Boolean(comparison),
            contentHashMatchesSibling: Boolean(comparison && (comparison.contentHash || comparison.documentHash) ===
              (sibling.contentHash || sibling.documentHash)),
            exactSourceTextMatchesSibling: Boolean(comparison && comparison.sourceText === sibling.sourceText),
            retainedQuotePresentInSiblingText: Boolean(quote && sibling.sourceText.includes(quote)),
            literalQuoteAcceptedAgainstSibling: Boolean(siblingLiteralCheck?.accepted.length)
          });
        }
      }
    }
    const workstreams = await buildAuthorityWorkstreams(sourceCase.query, reconciled.issuePlan, {
      retriever: emptyLocalRetriever,
      referenceDate: '2026-10-02',
      questionUnderstanding: understanding,
      groundingOptions: {
        ...emptyAdapters,
        webRetriever: new ControlledWebRetriever(undefined, new SourceCache()),
        fetchOptions: { timeoutMs: 1000, useCache: false, customFetch },
        authorityLevelDiscovery: false,
        localOnly: false,
        referenceDate: '2026-10-02'
      }
    });
    assert.equal(ambientFetchCalls, 0, 'All mapped-page fetches use the injected custom transport.');
    const runtimeIssue = workstreams.workstreams.flatMap(stream => stream.issues).find(candidate => candidate.issueId === issue.id);
    assert.ok(runtimeIssue, `${item.id} returns the same reconciled issue from the central workstream.`);
    const helperSupport = (text, topic, concept) => supportGeneralIrasRuleConcept({
      sourceText: text,
      domainId: topic.domainId,
      topicIds: [...new Set([...issue.mappedTopicIds, topic.id, ...concept.topicIds])],
      subject: issue.subject,
      population: issue.population,
      concepts: [concept]
    });
    const actualSourceChecks = runtimeIssue.sources.map(record => ({
      recordId: record.id,
      associatedTopicIds: topicIds.filter(topicId => (record.tags || []).includes(topicId) ||
        (record.relatedTopicIds || []).includes(topicId) || (record.sourceMapTopicIds || []).includes(topicId)),
      helperSupport: requestedConcepts.flatMap(concept => topicList.map(topic => helperSupport(record.sourceText || '', topic, concept)))
    }));
    const retainedQuoteChecks = (runtimeIssue.verifiedClaims || []).map((claim, index) => ({
      index,
      recordId: claim.recordId,
      helperSupport: requestedConcepts.flatMap(concept => topicList.map(topic => helperSupport(claim.quote, topic, concept)))
    }));
    centralResults.push({ item, issue: runtimeIssue, workstreams, requestedConcepts, topicIds, mappedUrlCount: allowedByUrl.size,
      helperChecks, actualSourceChecks, retainedQuoteChecks, siblingDocumentChecks,
      issuePlanOrigin: reconciled.issuePlan.source,
      issuePlanCoverageEstablished: reconciled.issuePlan.coverageEstablished,
      issuePlanHasUnmappedResidual: reconciled.issuePlan.hasUnmappedResidual,
      topicInventory: (() => {
        const decomposition = defaultQueryTopicResolver.decomposeQuery(sourceCase.query);
        return {
          hasUnparsedText: decomposition.unresolvedTopics.length > 0,
          topicIds: [...new Set([...decomposition.topics.map(topic => topic.id), ...reconciled.classification.topicIds])]
        };
      })(),
      issuePlanIssues: reconciled.issuePlan.issues.map(plannedIssue => ({
        id: plannedIssue.id,
        status: plannedIssue.status,
        governingAuthorities: [...plannedIssue.governingAuthorities],
        domain: plannedIssue.domain,
        unresolvedReason: plannedIssue.unresolvedReason,
        mappedTopicIds: [...plannedIssue.mappedTopicIds]
      })) });
  }
} finally {
  globalThis.fetch = actualFetch;
}

const observedFinalStatuses = centralResults.map(({ item, issue }) => ({
  id: item.id,
  evidenceStatus: issue.evidenceStatus,
  applicationStatus: issue.applicationStatus,
  lifecycle: issue.lifecycle,
  gapCodes: issue.gaps.map(gap => gap.code),
  gaps: issue.gaps.map(gap => ({ stage: gap.stage, code: gap.code, reason: gap.reason })),
  helperChecks: centralResults.find(result => result.item.id === item.id)?.helperChecks,
  actualSourceChecks: centralResults.find(result => result.item.id === item.id)?.actualSourceChecks,
  retainedQuoteChecks: centralResults.find(result => result.item.id === item.id)?.retainedQuoteChecks,
  siblingDocumentChecks: centralResults.find(result => result.item.id === item.id)?.siblingDocumentChecks,
  issuePlanOrigin: centralResults.find(result => result.item.id === item.id)?.issuePlanOrigin,
  issuePlanCoverageEstablished: centralResults.find(result => result.item.id === item.id)?.issuePlanCoverageEstablished,
  issuePlanHasUnmappedResidual: centralResults.find(result => result.item.id === item.id)?.issuePlanHasUnmappedResidual,
  topicInventory: centralResults.find(result => result.item.id === item.id)?.topicInventory,
  issuePlanIssues: centralResults.find(result => result.item.id === item.id)?.issuePlanIssues,
  workstreamGaps: centralResults.find(result => result.item.id === item.id)?.workstreams.gaps.map(gap => ({
    issueId: gap.issueId, stage: gap.stage, code: gap.code, reason: gap.reason
  })),
  mappedAttempts: (issue.retrievalTrace?.attempts || []).map(attempt => ({ topicId: attempt.topicId, fetchStatus: attempt.fetchStatus }))
}));
const expectedFinalStatuses = endToEndCases.map(item => ({
  id: item.id,
  evidenceStatus: 'VERIFIED',
  applicationStatus: item.application
}));
assert.deepEqual(observedFinalStatuses.map(({ id, evidenceStatus, applicationStatus }) => ({ id, evidenceStatus, applicationStatus })),
  expectedFinalStatuses, `Frozen V2 end-to-end statuses differ at the owning stage: ${JSON.stringify(observedFinalStatuses)}`);

for (const { item, issue, workstreams, requestedConcepts, topicIds, mappedUrlCount } of centralResults) {
  assert.equal(issue.applicationStatus, item.application, `${item.id} retains the expected independently derived application status.`);
  assert.ok(issue.sources.length > 0, `${item.id} has an admitted source record.`);
  assert.equal(issue.gaps.length, 0, `${item.id} has no issue evidence gaps.`);
  const result = centralResults.find(candidate => candidate.item.id === item.id);
  assert.ok(result, `${item.id} retains its scoped diagnostic result.`);
  assert.ok(result.helperChecks.every(check => check.scopedSupport.includes(true)), `${item.id} has bounded helper support in reconciled topics.`);
  if (item.id === 'private-holiday-expense' || item.id === 'wht-royalty-general-rule') {
    for (const topicId of topicIds) {
      assert.ok(result.siblingDocumentChecks.some(check => check.topicId === topicId && check.canonicalUrlMatchesSibling &&
        check.contentHashMatchesSibling && check.exactSourceTextMatchesSibling && check.retainedQuotePresentInSiblingText &&
        check.literalQuoteAcceptedAgainstSibling), `${item.id} preserves an exactly matching sibling quote for ${topicId}.`);
    }
    assert.ok(result.actualSourceChecks.some(check => check.helperSupport.includes(true)), `${item.id} has helper-positive admitted records.`);
    assert.ok(result.retainedQuoteChecks.some(check => check.helperSupport.includes(true)), `${item.id} has helper-positive retained claims.`);
  }
  for (const topicId of topicIds) assert.ok(issue.sources.some(record =>
    (record.tags || []).includes(topicId) || (record.relatedTopicIds || []).includes(topicId) ||
    (record.sourceMapTopicIds || []).includes(topicId)), `${item.id} source association is retained for ${topicId}.`);
  assert.ok(requestedConcepts.length > 0, `${item.id} retains its semantic requested concepts.`);
  assert.ok(mappedUrlCount > 0, `${item.id} had a derived set of approved mapped URLs.`);
  if (item.id === 'private-holiday-expense') {
    assert.equal(result.issuePlanOrigin, 'SEMANTIC_ISSUES');
    assert.equal(result.issuePlanCoverageEstablished, true);
    assert.equal(result.issuePlanHasUnmappedResidual, false);
    assert.equal(result.topicInventory.hasUnparsedText, false);
    assert.deepEqual(result.topicInventory.topicIds.sort(), ['iras-cit-deductibility', 'iras-cit-disallowed-expenses']);
    assert.equal(workstreams.gaps.length, 0);
    assert.equal(result.issuePlanIssues.length, 1);
    assert.equal(result.issuePlanIssues[0].status, 'MAPPED');
  } else {
    assert.equal(result.issuePlanCoverageEstablished, true, `${item.id} has complete reconciled issue-plan coverage.`);
    assert.equal(result.issuePlanHasUnmappedResidual, false, `${item.id} has no unmapped issue-plan residual.`);
    assert.equal(result.topicInventory.hasUnparsedText, false, `${item.id} has no unparsed inventory text.`);
    assert.equal(workstreams.gaps.length, 0, `${item.id} has no global issue-plan or central evidence gaps.`);
  }
}
assert.equal(syntheticFetchLog.length > 0, true, 'The real controlled fetcher requested synthetic HTML through customFetch.');
assert.equal(ambientFetchCalls, 0, 'No ambient network request occurred.');

console.log('IRAS general-rule concept-support regressions passed.');
