import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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
import { buildGroundedReasoningContext, completeScopedIrasConceptPassage, selectRelevantFetchedText } from '../../src/services/groundingContextBuilder.ts';
import { renderIrasEvidenceResponse } from '../../src/services/irasEvidencePolicy.ts';
import { getRequestedQuestionConcepts, reconcileQuestionUnderstanding, validateSemanticQuestionInterpretation } from '../../src/services/semanticQuestionUnderstanding.ts';
import { verifyEvidenceClaims } from '../../src/verification/claimEvidenceVerifier.ts';
import { completeVisibleEvidenceListSpan, splitEvidenceTextBlocks } from '../../src/utils/evidenceTextBoundaries.ts';
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

const residencyTopicIds = ['iras-corporate-tax-residency'];
const residencyRuleConcept = {
  id: 'company_tax_residency_rule', label: 'Company tax residency rule',
  terms: ['control and management', 'Singapore tax resident'], topicIds: residencyTopicIds
};
const residencyIncorporationConcept = {
  id: 'company_tax_residency_incorporation', label: 'Company tax residency and incorporation',
  terms: ['place of incorporation', 'tax residency'], topicIds: residencyTopicIds
};
assert.equal(check({
  sourceText: 'Your company is a tax resident of Singapore when its control and management is exercised in Singapore.',
  domainId: 'IRAS_CORPORATE_TAX', topicIds: residencyTopicIds,
  subject: 'Singapore company tax residency rule', concepts: [residencyRuleConcept]
}), true, 'The official control-and-management criterion supports the company tax-residency rule.');
assert.equal(check({
  sourceText: 'The board meets in Singapore and manages the business from Singapore.',
  domainId: 'IRAS_CORPORATE_TAX', topicIds: residencyTopicIds,
  subject: 'Singapore company tax residency rule', concepts: [residencyRuleConcept]
}), false, 'Company location and governance wording without a tax-residency criterion is not a residency rule.');
assert.equal(check({
  sourceText: 'The place of incorporation of a company is not necessarily indicative of the tax residency of a company.',
  domainId: 'IRAS_CORPORATE_TAX', topicIds: residencyTopicIds,
  subject: 'Singapore company tax residency rule', concepts: [residencyIncorporationConcept]
}), true, 'The incorporation proposition requires the official qualification that incorporation alone is not indicative.');
assert.equal(check({
  sourceText: 'A company is incorporated in Singapore.',
  domainId: 'IRAS_CORPORATE_TAX', topicIds: residencyTopicIds,
  subject: 'Singapore company tax residency rule', concepts: [residencyIncorporationConcept]
}), false, 'Incorporation location alone does not establish the requested tax-residency qualification.');
assert.equal(check({
  sourceText: 'Your company is a tax resident of Singapore when its control and management is exercised in Singapore.',
  domainId: 'IRAS_CORPORATE_TAX', topicIds: residencyTopicIds,
  subject: 'Singapore company tax residency rule', concepts: [residencyRuleConcept], population: 'UNKNOWN'
}), undefined, 'General IRAS residency support remains population-scoped and does not open for UNKNOWN.');
assert.equal(check({
  sourceText: 'Your company is a tax resident of Singapore when its control and management is exercised in Singapore.',
  domainId: 'IRAS_CORPORATE_TAX', topicIds: residencyTopicIds,
  subject: 'Singapore company tax residency rule',
  concepts: [asConcept('Singapore company tax residency rule', ['control and management test'], residencyTopicIds)]
}), undefined, 'An unknown residency concept cannot inherit the canonical control-and-management proof.');
assert.equal(check({
  sourceText: 'Your company is a tax resident of Singapore when its control and management is exercised in Singapore.',
  domainId: 'IRAS_CORPORATE_TAX', topicIds: residencyTopicIds,
  subject: 'Singapore company tax residency rule'
}), undefined, 'Conceptless residency selection remains in the bounded legacy subject path.');

const cpfReliefTopicIds = ['iras-individual-cpf-cash-top-up-relief'];
const cpfReliefIntroConcept = {
  id: 'cpf_cash_top_up_relief', label: 'CPF cash top-up tax relief', terms: ['CPF cash top-up relief'], topicIds: cpfReliefTopicIds
};
const cpfReliefEligibilityConcept = {
  id: 'cpf_cash_top_up_relief_eligibility', label: 'Eligibility for CPF cash top-up tax relief',
  terms: ['Singapore Citizen Permanent Resident', 'cash top-ups', 'RSTU', 'MRSS', 'MMSS'], topicIds: cpfReliefTopicIds
};
const cpfReliefLimitsConcept = {
  id: 'cpf_cash_top_up_relief_limits', label: 'Limits on CPF cash top-up tax relief',
  terms: ['annual relief cap', 'Full Retirement Sum', 'Special Account', 'Retirement Account'], topicIds: cpfReliefTopicIds
};
const cpfReliefIntro = 'CPF Cash Top-up Relief is given to encourage Singaporeans and Permanent Residents to set aside money for retirement needs either in their own CPF accounts or those of family members.';
const cpfEligibilitySource = [
  cpfReliefIntro,
  'To qualify for the tax relief for Year of Assessment (YA) 2026, you must:',
  '1. be a Singapore Citizen/Permanent Resident; and',
  '2. have made cash top-ups in 2025 under the CPF Retirement Sum Topping-Up Scheme ("RSTU").',
  'CPF cash top-ups that attract matching grants under the Matched Retirement Savings Scheme (MRSS) will not be eligible for CPF Cash Top-up Relief from YA 2026 (i.e. CPF cash top-ups received from 1 Jan 2025).',
  'CPF cash top-ups to eligible members’ MediSave Accounts that attract the Matched MediSave Scheme (MMSS) matching grant will not qualify for CPF Cash Top-up Relief from YA 2027, for cash top-ups made from 1 Jan 2026.'
].join('\n\n');
assert.equal(check({
  sourceText: cpfReliefIntro, domainId: 'IRAS_INDIVIDUAL_TAX', topicIds: cpfReliefTopicIds,
  subject: 'Individual CPF cash top-up relief', concepts: [cpfReliefIntroConcept], population: 'INDIVIDUAL'
}), true, 'The bounded introduction supports only the general CPF cash-top-up relief concept.');
assert.equal(check({
  sourceText: cpfReliefIntro, domainId: 'IRAS_INDIVIDUAL_TAX', topicIds: cpfReliefTopicIds,
  subject: 'CPF cash top-up tax relief interaction with foreign pension offsets',
  concepts: [asConcept('Foreign pension offsets', ['CPF cash top-up relief'], cpfReliefTopicIds)], population: 'INDIVIDUAL'
}), undefined, 'An unknown CPF qualifier cannot inherit the canonical relief-introduction proof.');
assert.equal(check({
  sourceText: cpfReliefIntro, domainId: 'IRAS_INDIVIDUAL_TAX', topicIds: cpfReliefTopicIds,
  subject: 'Individual CPF cash top-up relief', population: 'INDIVIDUAL'
}), undefined, 'Conceptless CPF topic selection does not invoke the canonical concept proof helper.');
assert.equal(check({
  sourceText: cpfReliefIntro, domainId: 'IRAS_INDIVIDUAL_TAX', topicIds: cpfReliefTopicIds,
  subject: 'Individual CPF cash top-up relief eligibility', concepts: [cpfReliefEligibilityConcept], population: 'INDIVIDUAL'
}), false, 'The introduction alone cannot satisfy the requested eligibility proposition.');
assert.equal(check({
  sourceText: cpfEligibilitySource, domainId: 'IRAS_INDIVIDUAL_TAX', topicIds: cpfReliefTopicIds,
  subject: 'Individual CPF cash top-up relief eligibility', concepts: [cpfReliefEligibilityConcept], population: 'INDIVIDUAL'
}), true, 'Eligibility requires both numbered qualifying conditions and the MRSS/MMSS exclusions.');
assert.equal(check({
  sourceText: cpfEligibilitySource.replace(/\n\nCPF cash top-ups to eligible members[\s\S]*$/, ''),
  domainId: 'IRAS_INDIVIDUAL_TAX', topicIds: cpfReliefTopicIds,
  subject: 'Individual CPF cash top-up relief eligibility', concepts: [cpfReliefEligibilityConcept], population: 'INDIVIDUAL'
}), false, 'MRSS text without the separate MMSS matching-grant exclusion is incomplete eligibility evidence.');
const cpfLimitSource = [
  'Individuals may continue to enjoy tax relief of up to $16,000 (maximum $8,000 for self and maximum $8,000 for family members) a year for eligible CPF cash top-ups that do not attract MRSS and/or MMSS grants.',
  'For each YA, a personal income tax relief cap of $80,000 applies to the total amount of all tax reliefs claimed (including any relief on cash top-ups made).',
  'For recipients below age 55 | Top-up to Special Account (SA) under RSTU scheme is capped at the current year’s Full Retirement Sum (FRS). Maximum allowed cash top-up: FRS – SA savings – amount withdrawn from SA for investments.',
  'For recipients aged 55 years and above | Top-up to Retirement Account (RA) under RSTU scheme is capped at the current year’s Full Retirement Sum (FRS). Maximum allowed cash top-up: FRS – RA savings.'
].join('\n\n');
assert.equal(check({
  sourceText: cpfReliefIntro, domainId: 'IRAS_INDIVIDUAL_TAX', topicIds: cpfReliefTopicIds,
  subject: 'Individual CPF cash top-up relief limits', concepts: [cpfReliefLimitsConcept], population: 'INDIVIDUAL'
}), false, 'The relief introduction cannot cover annual or recipient-account limits.');
assert.equal(check({
  sourceText: cpfLimitSource, domainId: 'IRAS_INDIVIDUAL_TAX', topicIds: cpfReliefTopicIds,
  subject: 'Individual CPF cash top-up relief limits', concepts: [cpfReliefLimitsConcept], population: 'INDIVIDUAL'
}), true, 'Limits require both annual caps and the own-SA/own-RA FRS-based conditions.');
const cpfLimitSplitExclusions = cpfLimitSource.replace(
  'do not attract MRSS and/or MMSS grants.',
  'do not attract MRSS matching grants. Eligible top-ups must not attract MMSS matching grants.'
);
assert.equal(check({
  sourceText: cpfLimitSplitExclusions, domainId: 'IRAS_INDIVIDUAL_TAX', topicIds: cpfReliefTopicIds,
  subject: 'Individual CPF cash top-up relief limits', concepts: [cpfReliefLimitsConcept], population: 'INDIVIDUAL'
}), true, 'Separate MRSS and MMSS exclusion wording is sufficient only when both are present.');
for (const [scheme, omittedScheme] of [['MRSS', 'MMSS'], ['MMSS', 'MRSS']]) {
  const missingGrantExclusion = cpfLimitSplitExclusions.replace(
    new RegExp(`(?:Eligible top-ups must not attract\\s+)?${omittedScheme} matching grants?\\.?`, 'gi'), ''
  );
  assert.equal(check({
    sourceText: missingGrantExclusion, domainId: 'IRAS_INDIVIDUAL_TAX', topicIds: cpfReliefTopicIds,
    subject: 'Individual CPF cash top-up relief limits', concepts: [cpfReliefLimitsConcept], population: 'INDIVIDUAL'
  }), false, `The ${scheme} exclusion alone cannot substitute for the separate ${omittedScheme} exclusion.`);
}
assert.equal(check({
  sourceText: cpfLimitSource.replace(/\n\nFor recipients aged 55 years and above[\s\S]*$/, ''),
  domainId: 'IRAS_INDIVIDUAL_TAX', topicIds: cpfReliefTopicIds,
  subject: 'Individual CPF cash top-up relief limits', concepts: [cpfReliefLimitsConcept], population: 'INDIVIDUAL'
}), false, 'The under-55 SA limit alone cannot cover the separate age-55-and-above RA limit.');

for (const population of ['INDIVIDUAL', 'EMPLOYEE']) {
  const scope = {
    domainId: 'IRAS_INDIVIDUAL_TAX', topicIds: cpfReliefTopicIds,
    subject: 'CPF cash top-up relief eligibility and limits', population
  };
  for (const [concept, sourceText] of [
    [cpfReliefEligibilityConcept, 'CPF cash top-up relief eligibility conditions apply.'],
    [cpfReliefEligibilityConcept, cpfReliefIntro],
    [cpfReliefEligibilityConcept, cpfEligibilitySource.split('\n\n').slice(0, -1).join('\n\n')],
    [cpfReliefLimitsConcept, cpfReliefIntro]
  ]) {
    assert.equal(matchesRequestedQuestionConcept(sourceText, concept, scope), false,
      `${population} scope requires substantive support instead of a generic keyword fallback.`);
  }
  assert.equal(check({ ...scope, sourceText: cpfEligibilitySource, concepts: [cpfReliefEligibilityConcept] }), true,
    `${population} scope accepts the complete eligibility provision without changing the population.`);
  assert.equal(check({ ...scope, sourceText: cpfLimitSource, concepts: [cpfReliefLimitsConcept] }), true,
    `${population} scope accepts the same complete limits provision.`);
}
for (const population of ['UNKNOWN', 'COMPANY', 'EMPLOYER']) {
  assert.equal(matchesRequestedQuestionConcept('CPF cash top-up relief eligibility conditions apply.',
    cpfReliefEligibilityConcept, { domainId: 'IRAS_INDIVIDUAL_TAX', topicIds: cpfReliefTopicIds,
      subject: 'CPF cash top-up relief eligibility', population }), false,
  `${population} cannot bypass recognized personal-relief scope through keyword matching.`);
}

const motorCarTopicIds = ['iras-gst-blocked-input-tax', 'iras-gst-motor-vehicles'];
const motorCarRestrictionConcept = {
  id: 'gst_blocked_motor_car_input_tax', label: 'Blocked motor-car input tax',
  terms: ['motor car', 'GST input tax restriction'], topicIds: motorCarTopicIds
};
const motorCarExceptionsConcept = {
  id: 'gst_motor_car_input_tax_exceptions', label: 'GST motor-car input-tax exceptions',
  terms: ['third party', 'connected person'], topicIds: motorCarTopicIds
};
const thirdPartyMotorCar = 'Expenses on motor car used by a third party | Yes, from 1 Jan 2023, where you incur expenses on a motor car that is used by a third party, you will be allowed input tax claims on the cost and running expenses of the motor car incurred, if the conditions for claiming input tax are met.';
const connectedPersonMotorCar = [
  'Expenses on motor car used by a connected person | No, from 1 Jan 2023, where you incur expenses on a motor car used by a person connected to you (e.g. your subsidiary), you cannot claim input tax on the cost and running expenses of the motor car, unless you satisfy both of the following conditions (in addition to the conditions for claiming input tax):',
  '1. You recover the motor car expenses from the connected person. Where you recover only a portion of the motor car expenses incurred, you can only claim input tax to the extent of the portion recovered; and.',
  '2. The recovery is not ancillary to any primary supply made by you to the connected person.'
].join('\n\n');
assert.equal(check({
  sourceText: 'You generally cannot claim the GST incurred on the purchase and running expenses of motor cars, such as petrol and parking charges.',
  domainId: 'IRAS_GST', topicIds: motorCarTopicIds,
  subject: 'GST input tax claimability on private passenger motor car purchase', concepts: [motorCarRestrictionConcept]
}), true, 'Motor-car restriction matching takes precedence over generic GST claim/recovery wording.');
assert.equal(check({
  sourceText: 'You generally cannot claim the GST incurred on the purchase and running expenses of motor cars, such as petrol and parking charges.',
  domainId: 'IRAS_GST', topicIds: motorCarTopicIds,
  subject: 'GST input tax claimability on private passenger motor car purchase',
  concepts: [asConcept('GST motor-car input-tax interaction with foreign pension offsets', ['blocked motor-car input tax'], motorCarTopicIds)]
}), undefined, 'An unknown motor-car qualifier cannot inherit the canonical restriction proof.');
assert.equal(check({
  sourceText: 'You generally cannot claim the GST incurred on the purchase and running expenses of motor cars, such as petrol and parking charges.',
  domainId: 'IRAS_GST', topicIds: ['iras-gst-motor-vehicles'],
  subject: 'GST input tax claimability on private passenger motor car purchase'
}), undefined, 'Conceptless motor-car topic selection does not invoke the canonical concept proof helper.');
assert.equal(check({
  sourceText: `${thirdPartyMotorCar}\n\n${connectedPersonMotorCar}`,
  domainId: 'IRAS_GST', topicIds: motorCarTopicIds,
  subject: 'GST input tax claimability on private passenger motor car purchase', concepts: [motorCarExceptionsConcept]
}), true, 'The exceptions concept requires both the third-party provision and complete connected-person conditions.');
for (const incompleteMotorCarExceptions of [
  'The motor-car exception is cross-referenced in Regulation 25(1).',
  thirdPartyMotorCar,
  connectedPersonMotorCar.replace('Where you recover only a portion of the motor car expenses incurred, you can only claim input tax to the extent of the portion recovered; and.', ''),
  connectedPersonMotorCar.replace('2. The recovery is not ancillary to any primary supply made by you to the connected person.', '')
]) {
  assert.equal(check({
    sourceText: incompleteMotorCarExceptions, domainId: 'IRAS_GST', topicIds: motorCarTopicIds,
    subject: 'GST input tax claimability on private passenger motor car purchase', concepts: [motorCarExceptionsConcept]
  }), false, 'A cross-reference, one exception, or a connected-person omission cannot cover all requested motor-car exceptions.');
}
assert.equal(check({
  sourceText: `${thirdPartyMotorCar}\n\n${connectedPersonMotorCar}`,
  domainId: 'IRAS_GST', topicIds: motorCarTopicIds,
  subject: 'GST input tax claimability on private passenger motor car purchase', concepts: [motorCarExceptionsConcept], population: 'UNKNOWN'
}), undefined, 'IRAS motor-car general-rule matching remains scoped to company questions.');

const currentThirdPartyMotorCar = 'From 1 Jan 2023, you can claim input tax on the cost and running expenses of a motor car used by a third party, if you meet the conditions for claiming input tax. A third party does not include you or your employees, or a connected person (as determined in Para 3 of the Third Schedule of the GST Act).';
const currentConnectedPersonMotorCar = [
  'Motor car used by a connected person',
  'From 1 Jan 2023, where a motor car is used by a connected person (e.g. a subsidiary), GST incurred on the motor car expenses is generally not claimable. An exception applies only if you satisfy both of the following conditions, in addition to the conditions for claiming input tax:',
  '• You recover the motor car expenses from the connected person. Where you recover only a portion of the motor car expenses incurred, you can only claim input tax to the extent of the portion recovered; and',
  '• The recovery is not ancillary to any primary supply you make to them. To determine whether the recovery is considered as ancillary to a supply, refer to the IRAS guide.',
  'Where the connected person is GST-registered, the input tax claim on the motor car expenses recovered by you is disallowed under Regulation 27.'
].join('\n\n');
const currentMotorCarSource = [
  'You generally cannot claim the GST incurred on the purchase and running expenses of motor cars, such as petrol and parking charges.',
  currentThirdPartyMotorCar,
  currentConnectedPersonMotorCar
].join('\n\n');
assert.equal(check({
  sourceText: currentMotorCarSource, domainId: 'IRAS_GST', topicIds: motorCarTopicIds,
  subject: 'GST input tax claimability on private passenger motor car purchase', concepts: [motorCarExceptionsConcept]
}), true, 'Current IRAS wording establishes the third-party exception and both connected-person conditions with the attached GST-registration restriction.');
for (const incompleteCurrentMotorCar of [
  currentMotorCarSource.replace('A third party does not include you or your employees, or a connected person (as determined in Para 3 of the Third Schedule of the GST Act).', ''),
  currentMotorCarSource.replace('Where you recover only a portion of the motor car expenses incurred, you can only claim input tax to the extent of the portion recovered; and', ''),
  currentMotorCarSource.replace('• The recovery is not ancillary to any primary supply you make to them. To determine whether the recovery is considered as ancillary to a supply, refer to the IRAS guide.', ''),
  currentMotorCarSource.replace('Where the connected person is GST-registered, the input tax claim on the motor car expenses recovered by you is disallowed under Regulation 27.', '')
]) {
  assert.equal(check({ sourceText: incompleteCurrentMotorCar, domainId: 'IRAS_GST', topicIds: motorCarTopicIds,
    subject: 'GST input tax claimability on private passenger motor car purchase', concepts: [motorCarExceptionsConcept] }), false,
  'Current connected-person conditions and the third-party/recipient qualifications remain required.');
}

const knownCpfTopic = getCoverageTopicsByIds(cpfReliefTopicIds)[0];
const cpfSourceExcerpt = JSON.parse(await readFile(new URL('../fixtures/iras_cpf_cash_top_up_current_excerpt.json', import.meta.url), 'utf8'));
const completeCpfReliefSource = cpfSourceExcerpt.sourceLines.join('\n\n');
const longCpfPage = `${'CPF relief navigation and unrelated tax headings.\n'.repeat(700)}\n\n${completeCpfReliefSource}\n\n${'Other tax guidance.\n'.repeat(700)}`;
const completeCpfPassage = completeScopedIrasConceptPassage(longCpfPage, knownCpfTopic,
  'Individual CPF cash top-up relief', 'INDIVIDUAL', [cpfReliefIntroConcept, cpfReliefEligibilityConcept, cpfReliefLimitsConcept]);
assert.ok(completeCpfPassage, 'The known CPF relief profile selects a contiguous passage covering introduction, eligibility and limits.');
assert.ok(completeCpfPassage.length <= 12_000, 'The CPF relief passage stays within its explicit bounded excerpt limit.');
assert.ok(longCpfPage.includes(completeCpfPassage), 'The CPF excerpt is an exact contiguous substring of the validated page.');
assert.ok(completeCpfPassage.includes('1. be a Singapore Citizen/Permanent Resident; and'));
assert.ok(completeCpfPassage.includes('2. have made cash top-ups in 2025 under the CPF Retirement Sum Topping-Up Scheme'));
assert.ok(completeCpfPassage.includes('personal income tax relief cap of $80,000'));
assert.ok(completeCpfPassage.includes('For recipients aged 55 years and above'));
assert.equal(completeCpfPassage.includes('CPF relief navigation'), false,
  'The selected passage excludes unrelated page content outside the supported source envelope.');
const embeddedMarkerCpfSourceBlocks = completeCpfReliefSource.split('\n\n');
const cpfTableHeaderIndex = embeddedMarkerCpfSourceBlocks.indexOf('Age of recipients | Limit on cash top-up amount for computing tax relief');
assert.ok(cpfTableHeaderIndex >= 0, 'The current CPF fixture includes the expected limits table header.');
const embeddedMarkerCpfSource = [
  ...embeddedMarkerCpfSourceBlocks.slice(0, cpfTableHeaderIndex),
  embeddedMarkerCpfSourceBlocks.slice(cpfTableHeaderIndex).join(' ')
].join('\n\n');
const embeddedCpfTableText = embeddedMarkerCpfSourceBlocks.slice(cpfTableHeaderIndex).join(' ');
const cpfTableEndMarker = cpfSourceExcerpt.sourceLines.at(-1);
const embeddedCpfTableWithoutEndMarker = embeddedCpfTableText.replace(` ${cpfTableEndMarker}`, '');
const embeddedMarkerPassage = completeScopedIrasConceptPassage(embeddedMarkerCpfSource, knownCpfTopic,
  'Individual CPF cash top-up relief', 'INDIVIDUAL', [cpfReliefIntroConcept, cpfReliefEligibilityConcept, cpfReliefLimitsConcept]);
assert.ok(embeddedMarkerPassage && embeddedMarkerCpfSource.includes(embeddedMarkerPassage),
  'A uniquely embedded end marker in the final table block preserves the complete original source span.');
const embeddedMarkerBeforeRows = [
  ...embeddedMarkerCpfSourceBlocks.slice(0, cpfTableHeaderIndex),
  embeddedCpfTableWithoutEndMarker.replace(
    'Age of recipients | Limit on cash top-up amount for computing tax relief',
    `Age of recipients | Limit on cash top-up amount for computing tax relief ${cpfTableEndMarker}`
  )
].join('\n\n');
assert.equal(completeScopedIrasConceptPassage(embeddedMarkerBeforeRows, knownCpfTopic,
  'Individual CPF cash top-up relief', 'INDIVIDUAL', [cpfReliefIntroConcept, cpfReliefEligibilityConcept, cpfReliefLimitsConcept]), undefined,
'An embedded marker before the table rows does not establish a complete limits passage.');
const embeddedMarkerBeforeRetirementRow = [
  ...embeddedMarkerCpfSourceBlocks.slice(0, cpfTableHeaderIndex),
  embeddedCpfTableWithoutEndMarker.replace(
    'For recipients aged 55 years and above',
    `${cpfTableEndMarker} For recipients aged 55 years and above`
  )
].join('\n\n');
assert.equal(completeScopedIrasConceptPassage(embeddedMarkerBeforeRetirementRow, knownCpfTopic,
  'Individual CPF cash top-up relief', 'INDIVIDUAL', [cpfReliefIntroConcept, cpfReliefEligibilityConcept, cpfReliefLimitsConcept]), undefined,
'An embedded marker before the retirement-account row does not establish a complete limits passage.');
const embeddedMarkerWithoutRetirementFootnote = embeddedMarkerCpfSource.replace(
  '^{**}^{**}RA savings refers to the cash set aside in the RA (excluding amounts such as interest earned, any government grants received) plus amounts withdrawn',
  ''
);
assert.equal(completeScopedIrasConceptPassage(embeddedMarkerWithoutRetirementFootnote, knownCpfTopic,
  'Individual CPF cash top-up relief', 'INDIVIDUAL', [cpfReliefIntroConcept, cpfReliefEligibilityConcept, cpfReliefLimitsConcept]), undefined,
'An embedded marker cannot exclude the retirement-account savings qualification.');
const duplicateMarkerCpfSource = `${completeCpfReliefSource}\n\n${cpfSourceExcerpt.sourceLines.at(-1)}`;
assert.equal(completeScopedIrasConceptPassage(duplicateMarkerCpfSource, knownCpfTopic,
  'Individual CPF cash top-up relief', 'INDIVIDUAL', [cpfReliefIntroConcept, cpfReliefEligibilityConcept, cpfReliefLimitsConcept]), undefined,
'Duplicate table end markers make the source boundary ambiguous and are rejected.');
const missingMarkerCpfSource = completeCpfReliefSource.replace(`\n\n${cpfSourceExcerpt.sourceLines.at(-1)}`, '');
assert.equal(completeScopedIrasConceptPassage(missingMarkerCpfSource, knownCpfTopic,
  'Individual CPF cash top-up relief', 'INDIVIDUAL', [cpfReliefIntroConcept, cpfReliefEligibilityConcept, cpfReliefLimitsConcept]), undefined,
'A complete-looking table without its verifiable end marker is rejected.');
const missingCpfTableQualification = completeCpfReliefSource.replace(
  '^{**}^{**}RA savings refers to the cash set aside in the RA (excluding amounts such as interest earned, any government grants received) plus amounts withdrawn',
  ''
);
assert.equal(completeScopedIrasConceptPassage(missingCpfTableQualification, knownCpfTopic,
  'Individual CPF cash top-up relief', 'INDIVIDUAL', [cpfReliefIntroConcept, cpfReliefEligibilityConcept, cpfReliefLimitsConcept]), undefined,
'A table with a missing account-row footnote remains incomplete.');
const misplacedRaFormulaAndQualification = '(ii) Maximum allowed cash top-up: FRS – RA^{**}^{**}RA savings refers to the cash set aside in the RA (excluding amounts such as interest earned, any government grants received) plus amounts withdrawn';
const misplacedRaQualificationSeparateMarkerSource = completeCpfReliefSource
  .replace(misplacedRaFormulaAndQualification, '')
  .replace('For recipients aged 55 years and above', `${misplacedRaFormulaAndQualification} For recipients aged 55 years and above`);
assert.equal(completeScopedIrasConceptPassage(misplacedRaQualificationSeparateMarkerSource, knownCpfTopic,
  'Individual CPF cash top-up relief', 'INDIVIDUAL', [cpfReliefIntroConcept, cpfReliefEligibilityConcept, cpfReliefLimitsConcept]), undefined,
'The separate-marker passage rejects the RA formula and savings qualification when they are moved into the below-55 row.');
const misplacedRaQualificationEmbeddedMarkerSource = embeddedMarkerCpfSource
  .replace(misplacedRaFormulaAndQualification, '')
  .replace('For recipients aged 55 years and above', `${misplacedRaFormulaAndQualification} For recipients aged 55 years and above`);
assert.equal(completeScopedIrasConceptPassage(misplacedRaQualificationEmbeddedMarkerSource, knownCpfTopic,
  'Individual CPF cash top-up relief', 'INDIVIDUAL', [cpfReliefIntroConcept, cpfReliefEligibilityConcept, cpfReliefLimitsConcept]), undefined,
'The embedded-marker passage rejects the RA formula and savings qualification when they are moved into the below-55 row.');
const selectedCpfExcerpt = selectRelevantFetchedText(longCpfPage, ['CPF cash top-up relief', 'tax relief'], 12_000,
  'CPF cash top-up relief eligibility and limits', [completeCpfPassage]);
for (const concept of [cpfReliefIntroConcept, cpfReliefEligibilityConcept, cpfReliefLimitsConcept]) {
  assert.equal(check({ sourceText: selectedCpfExcerpt, domainId: 'IRAS_INDIVIDUAL_TAX', topicIds: cpfReliefTopicIds,
    subject: 'Individual CPF cash top-up relief', concepts: [concept], population: 'INDIVIDUAL' }), true,
  `The bounded fetched excerpt retains independently supported CPF concept ${concept.id}.`);
}
assert.equal(completeScopedIrasConceptPassage(longCpfPage, knownCpfTopic, 'Individual CPF cash top-up relief',
  'INDIVIDUAL', [cpfReliefIntroConcept, cpfReliefEligibilityConcept, cpfReliefLimitsConcept], 1_000), undefined,
'A requested known-profile passage that exceeds the explicit bound remains incomplete.');
const completeCpfBlocks = completeCpfReliefSource.split(/\r?\n[\t ]*\r?\n+/).filter(block => block.trim()).length;
const exactly256ParagraphCpfPage = [
  ...Array.from({ length: 256 - completeCpfBlocks }, (_, index) => `Unrelated CPF navigation item ${index}.`),
  completeCpfReliefSource
].join('\n\n');
assert.ok(completeScopedIrasConceptPassage(exactly256ParagraphCpfPage, knownCpfTopic, 'Individual CPF cash top-up relief',
  'INDIVIDUAL', [cpfReliefIntroConcept, cpfReliefEligibilityConcept, cpfReliefLimitsConcept]),
'A complete CPF page at the 256 paragraph boundary remains eligible.');
const cpfPage257Paragraphs = `Unrelated CPF navigation item.\n\n${exactly256ParagraphCpfPage}`;
assert.equal(completeScopedIrasConceptPassage(cpfPage257Paragraphs, knownCpfTopic, 'Individual CPF cash top-up relief',
  'INDIVIDUAL', [cpfReliefIntroConcept, cpfReliefEligibilityConcept, cpfReliefLimitsConcept]), undefined,
'The CPF preferred-passage path rejects pages above the shared 256 paragraph boundary.');
assert.equal(completeScopedIrasConceptPassage(completeCpfReliefSource.replace('1. be a Singapore Citizen/Permanent Resident; and\n\n', ''),
  knownCpfTopic, 'Individual CPF cash top-up relief', 'INDIVIDUAL',
  [cpfReliefIntroConcept, cpfReliefEligibilityConcept, cpfReliefLimitsConcept]), undefined,
'The full-profile excerpt is not promoted when a numbered eligibility condition is missing.');
const manyParagraphCpfPage = [completeCpfReliefSource, ...Array.from({ length: 300 }, (_, index) => `Item ${index}.`)].join('\n\n');
assert.ok(manyParagraphCpfPage.length < 12_000, 'The paragraph-cap control stays inside the content-byte limit.');
assert.equal(completeScopedIrasConceptPassage(manyParagraphCpfPage, knownCpfTopic, 'Individual CPF cash top-up relief',
  'INDIVIDUAL', [cpfReliefIntroConcept, cpfReliefEligibilityConcept, cpfReliefLimitsConcept]), undefined,
'A relevant but overly fragmented page fails closed at the explicit paragraph cap.');
const manyParagraphUnsupportedCpfPage = Array.from({ length: 300 }, (_, index) => `Unrelated CPF navigation item ${index}.`).join('\n\n');
assert.equal(completeScopedIrasConceptPassage(manyParagraphUnsupportedCpfPage, knownCpfTopic, 'Individual CPF cash top-up relief',
  'INDIVIDUAL', [cpfReliefIntroConcept, cpfReliefEligibilityConcept, cpfReliefLimitsConcept]), undefined,
'Many short unsupported paragraphs fail closed at the whole-source concept check.');

const residencyTopic = getCoverageTopicsByIds(residencyTopicIds)[0];
const residencySource = [
  'Your company is a tax resident of Singapore when its control and management is exercised in Singapore.',
  'The place of incorporation of a company is not necessarily indicative of the tax residency of a company.'
].join('\n\n');
const residencyPassage = completeScopedIrasConceptPassage(`Navigation text.\n\n${residencySource}\n\nUnrelated tax card.`,
  residencyTopic, 'Singapore company tax residency rule', 'COMPANY', [residencyRuleConcept, residencyIncorporationConcept]);
assert.equal(residencyPassage, residencySource,
  'The company-residency envelope retains both the control-and-management rule and its incorporation qualification.');

const knownMotorCarTopic = getCoverageTopicsByIds(motorCarTopicIds)[0];
const completeMotorCarSource = [
  'You generally cannot claim the GST incurred on the purchase and running expenses of motor cars, such as petrol and parking charges.',
  thirdPartyMotorCar,
  connectedPersonMotorCar
].join('\n\n');
const motorCarPassage = completeScopedIrasConceptPassage(`Navigation.\n\n${completeMotorCarSource}\n\nOther GST topics.`,
  knownMotorCarTopic, 'GST input tax claimability on private passenger motor car purchase', 'COMPANY',
  [motorCarRestrictionConcept, motorCarExceptionsConcept]);
assert.equal(motorCarPassage, completeMotorCarSource,
  'The motor-car envelope retains the general restriction and both complete exception provisions in their source order.');
const currentMotorCarPassage = completeScopedIrasConceptPassage(`Navigation.\n\n${currentMotorCarSource}\n\nOther GST topics.`,
  knownMotorCarTopic, 'GST input tax claimability on private passenger motor car purchase', 'COMPANY',
  [motorCarRestrictionConcept, motorCarExceptionsConcept]);
assert.equal(currentMotorCarPassage, currentMotorCarSource,
  'The bounded current-source excerpt retains the exact restriction and both qualified exception spans contiguously.');
assert.equal(completeScopedIrasConceptPassage(completeMotorCarSource.replace('2. The recovery is not ancillary to any primary supply made by you to the connected person.', ''),
  knownMotorCarTopic, 'GST input tax claimability on private passenger motor car purchase', 'COMPANY',
  [motorCarRestrictionConcept, motorCarExceptionsConcept]), undefined,
'A missing connected-person exception qualification keeps the profile incomplete.');

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

// These source blocks are the exact Motor Vehicles Expenses passage retained
// in the 08 November 2026 private-car capture. Keep the introductory rule,
// every visibly marked use case and the following qualification together.
const capturedMotorCarRule = [
  'Input tax claims on motor car expenses for cars used by you or your employees are disallowed under Regulation 27 of the GST (General) Regulations. Use of the motor car includes both:',
  '• Physical use, such as when the motor car is driven by your staff or chauffeur to transport your company directors or business associates; and',
  '• Economic use, where the motor car is used to generate income or make supplies (e.g. a consultancy firm uses its motor car to transport its preferred clients for a fee).',
  'This input tax restriction applies regardless of whether the motor car is used wholly or partly for business purposes, unless the car is excluded from the definition of a ‘motor car’ under Regulation 25(1).'
].join('\n\n');
const capturedMotorCarQuery = 'Our GST-registered Singapore company bought a private motor car for business use. We are not a motor dealer or driving school. Can we recover the input GST, and what restrictions or exceptions should we check? I only need advice, not a journal.';
const capturedMotorCarRecord = {
  ...UNIFIED_SOURCE_REGISTRY.IRAS_GST_MOTOR_VEHICLES_SOURCE_MAP,
  id: 'captured-iras-motor-car-rule',
  documentTitle: 'Motor Vehicles Expenses',
  sourceText: capturedMotorCarRule,
  sourceStatus: 'VERIFIED',
  sourceType: 'OFFICIAL_GUIDANCE',
  evidenceTier: 'OFFICIAL_GUIDANCE',
  isVerbatimText: true,
  provenance: 'LOCAL_STATIC',
  lifecycleState: 'ACTIVE',
  recordRole: 'EVIDENCE',
  groundingEligible: true,
  verificationMethod: 'CURATED_EDITORIAL_REVIEW',
  reviewAuditCycleDays: 90,
  lastVerifiedDate: '2026-11-08',
  tags: motorCarTopicIds,
  relatedTopicIds: motorCarTopicIds
};
const capturedRegulation25Exclusions = [
  'A “motor car” is defined as a motor car which is constructed or adapted for the carriage of not more than 7 passengers exclusive of the driver and the weight of which unladen does not exceed 3,000 kilograms but does not include —',
  '(a) a motor car registered before 1st April 1998 as a business service passenger vehicle for the purposes of the Road Traffic Act (Cap. 276);',
  '(b) a taxi;',
  '(c) a motor car registered as a private car (school transport);',
  '(d) an unused motor car which has not been previously registered under the Road Traffic Act supplied or imported for the purpose of being let on hire or sold;',
  '(e) a motor car supplied to a financial institution for the purposes of making a supply of that motor car by the financial institution under a hire purchase contract;',
  '(f) a motor car supplied to or imported by a taxable person for the purposes of being let on hire or sold by that taxable person who is a dealer of motor cars;',
  '(g) a used motor car supplied or imported for the purpose of being let on hire; and',
  '(h) a motor car used for instructional purposes for reward and registered under paragraph 9(1) of the Second Schedule to the Road Traffic (Motor Vehicles, Registration and Licensing) Rules (R 5) by a person who holds a driving school licence issued under the Road Traffic Act.'
].join('\n\n');
const capturedRegulation25SourceText = [
  'Motor cars excluded from restrictions',
  capturedRegulation25Exclusions,
  'Exceptions where input tax on motor car expenses may be claimed',
  'Purchase of private hire car transportation services',
  'Your purchases must be supported by valid tax invoices or simplified tax invoices with GST charged to you.'
].join('\n\n');
const capturedRegulation25Url = 'https://www.iras.gov.sg/taxes/goods-services-tax-(gst)/claiming-gst-(input-tax)/common-scenarios---do-i-claim-gst/Motor-Vehicles-Expenses';
const capturedRegulation25Hash = createHash('sha256').update(capturedRegulation25SourceText).digest('hex');
const capturedRegulation25Record = {
  ...UNIFIED_SOURCE_REGISTRY.IRAS_GST_MOTOR_VEHICLES_SOURCE_MAP,
// Portable excerpt fixture retaining the captured source identity and verification
// provenance; its content hash is recomputed from the embedded passage.
  id: 'LIVE_TOPIC_iras-gst-motor-vehicles_75ada356c6e8',
  authority: 'IRAS',
  sourceAuthority: 'IRAS',
  domain: 'IRAS_GST',
  documentTitle: 'Motor Vehicles Expenses',
  sourceText: capturedRegulation25SourceText,
  officialSourceUrl: capturedRegulation25Url,
  canonicalSourceUrl: capturedRegulation25Url,
  sourceStatus: 'NEEDS_REVIEW',
  sourceType: 'OFFICIAL_GUIDANCE',
  evidenceTier: 'OFFICIAL_GUIDANCE',
  isVerbatimText: false,
  provenance: 'LIVE_EXTERNAL',
  lifecycleState: 'CANDIDATE',
  recordRole: 'DISCOVERED_EVIDENCE',
  groundingEligible: true,
  verificationMethod: 'LIVE_OFFICIAL_TOPIC_VERIFIED',
  urlVerificationStatus: 'VERIFIED',
  urlVerifiedDate: '2026-11-09',
  retrievedAt: '2026-11-09T12:49:15.909Z',
  extractionStatus: 'PARTIAL',
  documentHash: capturedRegulation25Hash,
  contentHash: capturedRegulation25Hash,
  lastVerifiedDate: '2026-11-09',
  tags: ['iras-gst-motor-vehicles'],
  relatedTopicIds: ['iras-gst-motor-vehicles']
};
const verifyCapturedRegulation25 = (sourceText = capturedRegulation25SourceText,
  quote = capturedRegulation25Exclusions, completeListScope = {
    authority: 'IRAS', domain: 'IRAS_GST'
  }) => {
  const record = {
    ...capturedRegulation25Record,
    sourceText,
    documentHash: createHash('sha256').update(sourceText).digest('hex'),
    contentHash: createHash('sha256').update(sourceText).digest('hex')
  };
  return verifyEvidenceClaims([{
    kind: 'RULE', text: quote, quote, recordId: record.id
  }], [record], {
    targetDate: '2026-11-09',
    expectedAuthority: 'IRAS',
    expectedDomain: 'IRAS_GST',
    completeListScope
  });
};
const capturedRegulation25Accepted = verifyCapturedRegulation25();
assert.equal(capturedRegulation25Accepted.accepted.length, 1,
  'The complete captured Regulation 25(1) alphabetic exclusion list is accepted at the production quote-verification boundary.');
assert.equal(capturedRegulation25Accepted.accepted[0].quote, capturedRegulation25Exclusions,
  'The complete ordered-list quote remains text-identical to the source passage.');
assert.equal(capturedRegulation25Accepted.accepted[0].recordId, 'LIVE_TOPIC_iras-gst-motor-vehicles_75ada356c6e8',
  'The accepted quote retains the captured IRAS source record identity.');
assert.equal(capturedRegulation25Accepted.accepted[0].canonicalUrl, capturedRegulation25Url,
  'The accepted quote retains independently verified canonical IRAS URL provenance.');

const capturedRegulation25Blocks = capturedRegulation25Exclusions.split('\n\n');
const missingRegulation25MiddleItem = capturedRegulation25Blocks.filter((_, index) => index !== 4).join('\n\n');
assert.equal(verifyCapturedRegulation25(undefined, missingRegulation25MiddleItem).accepted.length, 0,
  'A quote that omits one ordered exclusion is rejected.');
const missingRegulation25Source = capturedRegulation25SourceText.replace(
  capturedRegulation25Exclusions, missingRegulation25MiddleItem
);
assert.equal(verifyCapturedRegulation25(missingRegulation25Source, missingRegulation25MiddleItem).accepted.length, 0,
  'A source list with a missing marker in its sequence is not complete.');
const reorderedRegulation25Blocks = [...capturedRegulation25Blocks];
[reorderedRegulation25Blocks[2], reorderedRegulation25Blocks[3]] = [reorderedRegulation25Blocks[3], reorderedRegulation25Blocks[2]];
const reorderedRegulation25 = reorderedRegulation25Blocks.join('\n\n');
assert.equal(verifyCapturedRegulation25(
  capturedRegulation25SourceText.replace(capturedRegulation25Exclusions, reorderedRegulation25),
  reorderedRegulation25
).accepted.length, 0, 'A source list with reordered alphabetic markers is not complete.');
const regulation25WithoutFinalItem = capturedRegulation25Blocks.slice(0, -1).join('\n\n');
assert.equal(verifyCapturedRegulation25(
  capturedRegulation25SourceText.replace(capturedRegulation25Exclusions, regulation25WithoutFinalItem),
  regulation25WithoutFinalItem
).accepted.length, 0,
  'A list ending with the prior item’s continuation marker is not complete without its final item.');
assert.equal(verifyCapturedRegulation25(undefined, capturedRegulation25Blocks.slice(1).join('\n\n')).accepted.length, 0,
  'List items without their source introduction are rejected as a whole-list quote.');
assert.equal(verifyCapturedRegulation25(undefined,
  capturedRegulation25Exclusions.replace('3,000 kilograms', '30,000 kilograms')).accepted.length, 0,
  'An altered numeric fact cannot pass literal source quotation checks.');
const regulation25PartialLastItem = capturedRegulation25Exclusions.replace(
  /\n\n\(h\)[\s\S]*$/,
  '\n\n(h) a motor car used for instructional purposes for reward'
);
assert.equal(verifyCapturedRegulation25(undefined, regulation25PartialLastItem).accepted.length, 0,
  'A clipped final ordered item is rejected.');
const wrongRegulation25Scope = verifyCapturedRegulation25(undefined, capturedRegulation25Exclusions,
  { authority: 'IRAS', domain: 'IRAS_TAX' });
assert.equal(wrongRegulation25Scope.accepted.length, 0,
  'A complete ordered list cannot bypass mismatched requested source scope.');
const regulation25Prefix = 'Motor cars excluded from restrictions';
assert.equal(verifyCapturedRegulation25(undefined,
  regulation25Prefix + '\n\n' + capturedRegulation25Exclusions
).accepted.length, 0, 'A quote that adds a heading prefix is not the complete ordered-list span.');
const regulation25Suffix = 'Exceptions where input tax on motor car expenses may be claimed';
assert.equal(verifyCapturedRegulation25(undefined,
  capturedRegulation25Exclusions + '\n\n' + regulation25Suffix
).accepted.length, 0, 'A quote that adds a following heading is not the complete ordered-list span.');

const regulation25HoweverQualification = [
  capturedRegulation25Exclusions,
  'However',
  'Only certain employers',
  'The restriction also applies.'
].join('\n\n');
const regulation25HoweverSource = capturedRegulation25SourceText.replace(
  capturedRegulation25Exclusions, regulation25HoweverQualification
);
assert.equal(verifyCapturedRegulation25(regulation25HoweverSource, capturedRegulation25Exclusions).accepted.length, 0,
  'A bare ordered list cannot omit prose introduced by an explicit no-colon qualification marker.');
assert.equal(verifyCapturedRegulation25(regulation25HoweverSource, regulation25HoweverQualification).accepted.length, 1,
  'The complete ordered list retains a no-colon qualification and its following prose.');

const regulation25UnlessQualification = [
  capturedRegulation25Exclusions,
  'Unless',
  'a motor car meets one of the listed exclusions'
].join('\n\n');
const regulation25UnlessSource = capturedRegulation25SourceText.replace(
  capturedRegulation25Exclusions, regulation25UnlessQualification
);
assert.equal(verifyCapturedRegulation25(regulation25UnlessSource, capturedRegulation25Exclusions).accepted.length, 0,
  'An unterminated no-colon Unless fragment cannot be omitted from an ordered-list quotation.');
assert.equal(completeVisibleEvidenceListSpan(
  splitEvidenceTextBlocks(regulation25UnlessSource), 1
), undefined, 'A two-fragment no-colon Unless qualification keeps the source span incomplete.');

const numericEvidenceList = 'The stated conditions are:\n\n1. The first condition applies;\n\n2. The second condition applies.';
const numericEvidenceListSpan = completeVisibleEvidenceListSpan(splitEvidenceTextBlocks(numericEvidenceList), 0);
assert.equal(numericEvidenceListSpan?.itemCount, 2,
  'A complete contiguous numeric list remains recognized by the generic evidence-list helper.');
const numericListWithQualification = [
  'The stated conditions are:',
  '1. The first condition applies;',
  '2. The second condition applies.',
  'However:',
  'The conditions apply to this passage only.'
].join('\n\n');
assert.equal(
  completeVisibleEvidenceListSpan(splitEvidenceTextBlocks(numericListWithQualification), 0)?.quote,
  numericListWithQualification,
  'A qualification label and its following prose remain attached to an ordered list.'
);
const numericListWithUnterminatedQualification = [
  'The stated conditions are:',
  '1. The first condition applies;',
  '2. The second condition applies.',
  'Unless the company satisfies the stated exception'
].join('\n\n');
assert.equal(completeVisibleEvidenceListSpan(
  splitEvidenceTextBlocks(numericListWithUnterminatedQualification), 0
), undefined, 'An unterminated attached qualification keeps the ordered evidence span incomplete.');
const invalidNumericEvidenceList = splitEvidenceTextBlocks(
  'The stated conditions are:\n\n1. The first condition applies;\n\n3. The third condition applies.'
);
assert.equal(completeVisibleEvidenceListSpan(invalidNumericEvidenceList, 0), undefined,
  'A numeric list with a missing marker is not complete.');

const capturedMotorCarClassification = {
  ...classifyQuestion(capturedMotorCarQuery),
  primaryDomain: 'GST', domains: ['IRAS_GST'], topicIds: motorCarTopicIds,
  authorities: ['IRAS'], multiAuthority: false,
  accountingAnalysisRequired: false, taxAnalysisRequired: true,
  regulatoryAnalysisRequired: false, calculationRequired: false,
  journalEntryRequired: false, intent: 'STATUTORY_ADVISORY', missingFacts: [], missingFactDomains: []
};
const capturedMotorCarContext = (sourceText = capturedMotorCarRule) => ({
  classification: capturedMotorCarClassification,
  evidenceQuality: {
    status: 'RETRIEVED_SUFFICIENT',
    eligibleRecords: [{ ...capturedMotorCarRecord, sourceText }],
    rejectedRecords: [], coveredTopicIds: motorCarTopicIds, uncoveredTopicIds: [],
    requestedConcepts: [], coveredConcepts: [], uncoveredConcepts: [],
    missingFacts: [], targetDate: '2026-11-08', targetDateConfidence: 'HIGH'
  },
  userFacts: [], missingFacts: [], assumptions: [],
  primaryEvidence: [], officialGuidance: [], curatedSummaries: [], applicationRules: [],
  currentInformationRequired: false
});
const capturedRegulation25Context = capturedMotorCarContext();
capturedRegulation25Context.evidenceQuality.eligibleRecords = [capturedRegulation25Record];
capturedRegulation25Context.evidenceQuality.targetDate = '2026-11-09';
const capturedRegulation25Answer = renderIrasEvidenceResponse({}, capturedRegulation25Context, capturedMotorCarQuery,
  null, 'SFRS_I', 'LOCAL');
const selectedCapturedRegulation25 = capturedRegulation25Answer.claimVerification.accepted.find(claim =>
  claim.recordId === capturedRegulation25Record.id &&
  claim.quote.replace(/\s+/g, ' ').trim() === capturedRegulation25Exclusions.replace(/\s+/g, ' ').trim());
assert.ok(selectedCapturedRegulation25,
  'The production IRAS selector offers and verifies the complete ordered Regulation 25(1) exclusion passage.');
assert.equal(selectedCapturedRegulation25.canonicalUrl, capturedRegulation25Url,
  'Production selection preserves the ordered-list quote’s verified IRAS source URL.');

const unscopedCapturedMotorCarRule = verifyEvidenceClaims([{
  kind: 'RULE', text: capturedMotorCarRule, quote: capturedMotorCarRule, recordId: capturedMotorCarRecord.id
}], [capturedMotorCarRecord], { targetDate: '2026-11-08' });
assert.equal(unscopedCapturedMotorCarRule.accepted.length, 0,
  'A complete visible list cannot bypass source-scope checks when no request authority and domain are supplied.');
const capturedMotorCarAnswer = renderIrasEvidenceResponse({}, capturedMotorCarContext(), capturedMotorCarQuery,
  null, 'SFRS_I', 'LOCAL');
const acceptedCapturedMotorCarRule = capturedMotorCarAnswer.claimVerification.accepted.find(claim =>
  claim.recordId === capturedMotorCarRecord.id && claim.quote.replace(/\s+/g, ' ').trim() === capturedMotorCarRule.replace(/\s+/g, ' ').trim());
assert.ok(acceptedCapturedMotorCarRule,
  'Source-only IRAS selection includes and verifies the captured car restriction, both visible list items, and attached business-use qualification.');
assert.match(capturedMotorCarAnswer.messageText, /disallowed under Regulation 27[\s\S]*Physical use[\s\S]*Economic use[\s\S]*applies regardless of whether the motor car is used wholly or partly for business purposes/,
  'The rendered answer can present the complete central restriction without importing a connected-person fact.');

for (const incompleteQuote of [
  capturedMotorCarRule.replace('• Physical use, such as when the motor car is driven by your staff or chauffeur to transport your company directors or business associates; and\n\n', ''),
  capturedMotorCarRule.replace('• Economic use, where the motor car is used to generate income or make supplies (e.g. a consultancy firm uses its motor car to transport its preferred clients for a fee).\n\n', ''),
  capturedMotorCarRule.replace('\n\n' + capturedMotorCarRule.split('\n\n').at(-1), ''),
  capturedMotorCarRule.split('\n\n').slice(0, 2).join('\n\n'),
  [capturedMotorCarRule.split('\n\n')[0], capturedMotorCarRule.split('\n\n')[1], capturedMotorCarRule.split('\n\n')[3]].join('\n\n')
]) {
  const result = verifyEvidenceClaims([{
    kind: 'RULE', text: incompleteQuote, quote: incompleteQuote, recordId: capturedMotorCarRecord.id
  }], [capturedMotorCarRecord], { targetDate: '2026-11-08' });
  assert.equal(result.accepted.length, 0, 'An isolated, partial, missing-item, or spliced list cannot pass source-span verification.');
}
const sentenceFragmentListRule = [
  'The restriction applies in both cases:',
  '•',
  '• The first condition applies. The connected exception permits recovery.',
  '•',
  '• The second condition applies.',
  'This restriction applies when the stated conditions are met.'
].join('\n\n');
const sentenceFragmentListRecord = {
  ...capturedMotorCarRecord,
  id: 'captured-iras-sentence-fragment-list',
  sourceText: sentenceFragmentListRule
};
const sentenceFragmentListOptions = {
  targetDate: '2026-11-08',
  completeListScope: { authority: 'IRAS', domain: 'IRAS_GST' }
};
const unscopedSentenceFragmentList = verifyEvidenceClaims([{
  kind: 'RULE', text: sentenceFragmentListRule, quote: sentenceFragmentListRule,
  recordId: sentenceFragmentListRecord.id
}], [sentenceFragmentListRecord], { targetDate: '2026-11-08' });
assert.equal(unscopedSentenceFragmentList.accepted.length, 0,
  'A marker-scaffolded complete list still requires explicit matching request scope.');
const completeSentenceFragmentList = verifyEvidenceClaims([{
  kind: 'RULE', text: sentenceFragmentListRule, quote: sentenceFragmentListRule,
  recordId: sentenceFragmentListRecord.id
}], [sentenceFragmentListRecord], sentenceFragmentListOptions);
assert.equal(completeSentenceFragmentList.accepted.length, 1,
  'A complete scoped visible list remains verifiable with its attached qualification.');
for (const fragment of [
  '• The first condition applies.',
  'The connected exception permits recovery.',
  '• The second condition applies.',
  'This restriction applies when the stated conditions are met.'
]) {
  const result = verifyEvidenceClaims([{
    kind: 'RULE', text: fragment, quote: fragment, recordId: sentenceFragmentListRecord.id
  }], [sentenceFragmentListRecord], sentenceFragmentListOptions);
  assert.equal(result.accepted.length, 0, 'A sentence fragment inside a protected list span is rejected: ' + fragment);
  assert.equal(result.rejected[0]?.reason, 'QUOTE_OMITS_ATTACHED_QUALIFICATION');
}
for (const wrongScope of [
  { authority: 'MOM', domain: 'IRAS_GST' },
  { authority: 'IRAS', domain: 'IRAS_TAX' }
]) {
  const result = verifyEvidenceClaims([{
    kind: 'RULE', text: sentenceFragmentListRule, quote: sentenceFragmentListRule,
    recordId: sentenceFragmentListRecord.id
  }], [sentenceFragmentListRecord], { targetDate: '2026-11-08', completeListScope: wrongScope });
  assert.equal(result.accepted.length, 0, 'A complete list cannot pass a mismatched requested authority or domain.');
}
const ellipsisMotorCarQuote = capturedMotorCarRule.replace('Physical use', 'Physical … use');
const ellipsisMotorCarCheck = verifyEvidenceClaims([{
  kind: 'RULE', text: ellipsisMotorCarQuote, quote: ellipsisMotorCarQuote, recordId: capturedMotorCarRecord.id
}], [capturedMotorCarRecord], { targetDate: '2026-11-08' });
assert.equal(ellipsisMotorCarCheck.rejected[0]?.reason, 'ELLIPSIS_NOT_ALLOWED',
  'A visibly complete list cannot be repaired by inserting an ellipsis.');
const unmarkedMotorCarRule = capturedMotorCarRule.replaceAll('• ', '');
const unmarkedMotorCarAnswer = renderIrasEvidenceResponse({}, capturedMotorCarContext(unmarkedMotorCarRule), capturedMotorCarQuery,
  null, 'SFRS_I', 'LOCAL');
assert.equal(unmarkedMotorCarAnswer.claimVerification.accepted.some(claim =>
  claim.quote.replace(/\s+/g, ' ').trim() === unmarkedMotorCarRule.replace(/\s+/g, ' ').trim()), false,
  'An unmarked sequence has no visible list boundary and is not assembled into a complete-list quotation.');

const foreignTaxCreditListRule = [
  'Foreign tax credit is the lower of:',
  '• The actual amount of foreign tax paid; or',
  '• The amount of Singapore tax attributable to the foreign income (net of expenses).'
].join('\n\n');
const foreignTaxCreditTopicIds = ['iras-foreign-tax-credit'];
const foreignTaxCreditQuery = 'Explain the general foreign tax credit rule for a Singapore company.';
const foreignTaxCreditRecord = {
  ...UNIFIED_SOURCE_REGISTRY.IRAS_CIT_FOREIGN_TAX_CREDIT_SOURCE_MAP,
  id: 'captured-iras-foreign-tax-credit-list',
  sourceText: foreignTaxCreditListRule,
  sourceStatus: 'VERIFIED',
  sourceType: 'OFFICIAL_GUIDANCE',
  evidenceTier: 'OFFICIAL_GUIDANCE',
  isVerbatimText: true,
  provenance: 'LOCAL_STATIC',
  lifecycleState: 'ACTIVE',
  recordRole: 'EVIDENCE',
  groundingEligible: true,
  verificationMethod: 'CURATED_EDITORIAL_REVIEW',
  lastVerifiedDate: '2026-11-08',
  tags: foreignTaxCreditTopicIds,
  relatedTopicIds: foreignTaxCreditTopicIds
};
const foreignTaxCreditClassification = {
  ...classifyQuestion(foreignTaxCreditQuery),
  primaryDomain: 'TAX', domains: ['IRAS_CORPORATE_TAX'],
  topicIds: foreignTaxCreditTopicIds, authorities: ['IRAS'], multiAuthority: false,
  accountingAnalysisRequired: false, taxAnalysisRequired: true,
  regulatoryAnalysisRequired: false, calculationRequired: false,
  journalEntryRequired: false, intent: 'STATUTORY_ADVISORY', missingFacts: [], missingFactDomains: []
};
const foreignTaxCreditContext = {
  classification: foreignTaxCreditClassification,
  evidenceQuality: {
    status: 'RETRIEVED_SUFFICIENT', eligibleRecords: [foreignTaxCreditRecord], rejectedRecords: [],
    coveredTopicIds: foreignTaxCreditTopicIds, uncoveredTopicIds: [], requestedConcepts: [], coveredConcepts: [],
    uncoveredConcepts: [], missingFacts: [], targetDate: '2026-11-08', targetDateConfidence: 'HIGH'
  },
  userFacts: [], missingFacts: [], assumptions: [], primaryEvidence: [], officialGuidance: [],
  curatedSummaries: [], applicationRules: [], currentInformationRequired: false
};
const foreignTaxCreditAnswer = renderIrasEvidenceResponse({}, foreignTaxCreditContext, foreignTaxCreditQuery,
  null, 'SFRS_I', 'LOCAL');
assert.ok(foreignTaxCreditAnswer.claimVerification.accepted.some(claim =>
  claim.recordId === foreignTaxCreditRecord.id && claim.quote === foreignTaxCreditListRule),
  'A non-GST IRAS_TAX list uses the coarse legacy domain mapped from IRAS_CORPORATE_TAX.');
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
