import assert from 'node:assert/strict';
import { classifyQuestion } from '../../src/classification/questionClassifier.ts';
import { buildAuthorityWorkstreams } from '../../src/services/authorityWorkstreams.ts';
import {
  getRequestedQuestionConcepts,
  reconcileQuestionUnderstanding,
  validateSemanticQuestionInterpretation
} from '../../src/services/semanticQuestionUnderstanding.ts';
import { isExpectedIssueV2 } from '../evaluation/singapore/multi-authority-issue-scoring-v2.mjs';
import { readV4Contract, scoreSemanticV4 } from '../evaluation/singapore/iras-first-targeted-acceptance-v4.mjs';

const contract = await readV4Contract();

function interpretationFor(caseContract, subject, population = caseContract.semantic.expectedIssues[0].population[0],
  concepts = [{ concept: subject, role: 'PRIMARY' }], question = caseContract.question) {
  const expected = caseContract.semantic.expectedIssues[0];
  const raw = {
    schemaVersion: 2,
    jurisdiction: ['Singapore'],
    authorityCandidates: expected.governingAuthorities,
    contextualAuthorities: expected.contextualAuthoritiesAnyOf[0],
    domain: expected.domain[0],
    population,
    primarySubject: subject,
    concepts,
    requestedOperation: expected.operation[0],
    factsExplicitlyProvided: [],
    confidence: 0.96,
    issues: [{
      subject,
      population,
      domain: expected.domain[0],
      governingAuthorities: expected.governingAuthorities,
      contextualAuthorities: expected.contextualAuthoritiesAnyOf[0],
      operation: expected.operation[0],
      mappedTopicIds: [],
      evidenceRequirement: 'AUTHORITATIVE_SOURCE',
      confidence: 0.96
    }]
  };
  const interpretation = validateSemanticQuestionInterpretation(raw, question);
  assert.ok(interpretation, `${caseContract.caseId} fixture interpretation validates`);
  const issuePlan = reconcileQuestionUnderstanding(question, classifyQuestion(question), {
    mode: 'SEMANTIC_INTERPRETATION', interpretation
  }).issuePlan;
  return { interpretation, issuePlan };
}

function score(caseContract, subject, population, concepts, question = caseContract.question) {
  const { interpretation, issuePlan } = interpretationFor(caseContract, subject, population, concepts, question);
  return scoreSemanticV4(caseContract, interpretation, issuePlan);
}

const foreign = contract.cases.find(item => item.caseId === 'foreign-dividend-receipt-treatment');
const abbreviatedForeign = { subject: 'foreign dividend tax treatment' };
assert.equal(isExpectedIssueV2(abbreviatedForeign, foreign.semantic.expectedIssues[0]), false,
  'The V2 subject-only matcher remains unchanged and still rejects the abbreviated subject.');
assert.equal(score(foreign, abbreviatedForeign.subject).stages.SEMANTIC_ISSUE_IDENTITY, true,
  'V4 binds the abbreviated issue to the frozen company receipt facts and validated COMPANY population.');
for (const subject of [
  'foreign dividend paid tax treatment',
  'company pays foreign dividends to its subsidiary for tax treatment',
  'foreign dividend tax treatment and company residency'
]) {
  assert.equal(score(foreign, subject).stages.SEMANTIC_ISSUE_IDENTITY, false, subject);
}
assert.equal(score(foreign, abbreviatedForeign.subject, 'INDIVIDUAL').stages.SEMANTIC_ISSUE_IDENTITY, false,
  'A query-level company fact cannot make an individual-population issue match.');
const foreignSourcedSubject = 'Singapore corporate income-tax treatment of foreign-sourced dividend';
const foreignSourcedFixture = interpretationFor(foreign, foreignSourcedSubject);
assert.ok(getRequestedQuestionConcepts(foreign.question, foreignSourcedFixture.interpretation)
  .some(concept => concept.id === 'foreign_dividend_receipt_tax_treatment'),
'A sole Singapore-company receipt from a foreign subsidiary requests the canonical foreign-dividend concept when the subject says foreign-sourced.');
for (const question of [
  'Our Singapore company’s receipt of a foreign-sourced dividend is being assessed. Explain the company income-tax treatment.',
  'Our Singapore company is receiving an overseas dividend. Explain the corporate income-tax treatment.'
]) {
  const fixture = interpretationFor({ ...foreign, question }, foreignSourcedSubject);
  assert.ok(getRequestedQuestionConcepts(question, fixture.interpretation)
    .some(concept => concept.id === 'foreign_dividend_receipt_tax_treatment'),
  `Foreign dividend receipt wording keeps its bounded canonical concept: ${question}`);
}
for (const question of [
  'Our Singapore company received a dividend from its Singapore subsidiary. Explain the corporate income-tax treatment.',
  'Our Singapore company received a dividend from its Local subsidiary. Explain the corporate income-tax treatment.',
  'Our Singapore company paid a dividend to its Thai subsidiary. Explain the corporate income-tax treatment.',
  'Our Singapore company received a dividend from its Thai subsidiary. Explain the exemption for this foreign-sourced dividend.',
  'Our Singapore company received a dividend from its Thai subsidiary. Explain the corporate income-tax treatment and what is the director’s personal income-tax treatment?'
]) {
  const fixture = interpretationFor({ ...foreign, question }, foreignSourcedSubject);
  assert.equal(getRequestedQuestionConcepts(question, fixture.interpretation)
    .some(concept => concept.id === 'foreign_dividend_receipt_tax_treatment'), false,
  `The ordinary foreign-dividend receipt concept is not inferred for domestic, payment, exemption-specific, or mixed requests: ${question}`);
}
const individualForeignFixture = interpretationFor(foreign, foreignSourcedSubject, 'INDIVIDUAL');
assert.equal(getRequestedQuestionConcepts(foreign.question, individualForeignFixture.interpretation)
  .some(concept => concept.id === 'foreign_dividend_receipt_tax_treatment'), false,
'The canonical company foreign-dividend receipt concept is not added to an individual issue.');
const oppositeDirection = {
  ...foreign,
  question: 'Our Singapore company paid a dividend to its Thai subsidiary. Explain the corporate income-tax treatment for that payment.'
};
const oppositeInterpretation = interpretationFor(oppositeDirection, abbreviatedForeign.subject).interpretation;
const oppositePlan = reconcileQuestionUnderstanding(oppositeDirection.question, classifyQuestion(oppositeDirection.question), {
  mode: 'SEMANTIC_INTERPRETATION', interpretation: oppositeInterpretation
}).issuePlan;
assert.equal(scoreSemanticV4(oppositeDirection, oppositeInterpretation, oppositePlan).stages.SEMANTIC_ISSUE_IDENTITY, false,
  'A payment-direction question cannot use the receipt-only V4 fallback.');
const wrongExpectedId = structuredClone(foreign);
wrongExpectedId.semantic.expectedIssues[0].id = 'unrelated-company-tax-issue';
assert.equal(score(wrongExpectedId, abbreviatedForeign.subject).stages.SEMANTIC_ISSUE_IDENTITY, false,
  'The bounded V4 fallback is tied to its exact expected issue identity.');

const gst = contract.cases.find(item => item.caseId === 'gst-input-tax-general-rule');
const abbreviatedGst = 'general GST input tax claim rules for business purchases';
const shortenedGstTitle = 'general GST input tax claim rules';
const truncatedGst = 'general conditions for claiming input tax on business purchases';
const gstConcepts = [
  { concept: 'input tax', role: 'PRIMARY' },
  { concept: 'business purchases', role: 'RELATED' },
  { concept: 'GST registration', role: 'RELATED' }
];
assert.equal(isExpectedIssueV2({ subject: abbreviatedGst }, gst.semantic.expectedIssues[0]), false,
  'The V2 subject-only matcher still rejects the abbreviated GST label without registration markers.');
assert.equal(score(gst, abbreviatedGst).stages.SEMANTIC_ISSUE_IDENTITY, true,
  'V4 uses the explicit frozen registered-company question facts for the bounded GST label.');
const shortenedGstFixture = interpretationFor(gst, shortenedGstTitle, 'COMPANY', gstConcepts);
assert.deepEqual(shortenedGstFixture.issuePlan.issues[0].mappedTopicIds, ['iras-gst-input-tax'],
  'The query supplies the purchase scope omitted from the valid shortened GST subject.');
const shortenedGstScore = scoreSemanticV4(gst, shortenedGstFixture.interpretation, shortenedGstFixture.issuePlan);
assert.equal(shortenedGstScore.stages.SEMANTIC_ISSUE_IDENTITY, true,
  'The recognized registered-company query and RELATED business-purchases concept bind the exact shortened GST title.');
assert.equal(shortenedGstScore.stages.SEMANTIC_DIMENSIONS, true,
  'The shortened GST title still requires the frozen COMPANY/IRAS_GST/IRAS/EXPLAIN_RULE dimensions.');
assert.equal(shortenedGstScore.stages.TOPIC_OWNERSHIP, true,
  'The shortened title keeps the independently recognized input-tax topic ownership requirement.');
const truncatedGstFixture = interpretationFor(gst, truncatedGst, 'COMPANY', gstConcepts);
assert.equal(truncatedGstFixture.issuePlan.issues.length, 1);
assert.deepEqual(truncatedGstFixture.issuePlan.issues[0].mappedTopicIds, ['iras-gst-input-tax'],
  'The original query may bind its independently recognized input-tax topic to the sole matching GST issue.');
assert.equal(truncatedGstFixture.issuePlan.coverageEstablished, true);
const truncatedGstScore = scoreSemanticV4(gst, truncatedGstFixture.interpretation, truncatedGstFixture.issuePlan);
assert.equal(truncatedGstScore.stages.SEMANTIC_ISSUE_IDENTITY, true,
  'V4 accepts the shortened title using the registered-company question and structured COMPANY/IRAS_GST/IRAS/EXPLAIN_RULE dimensions.');
assert.equal(truncatedGstScore.stages.SEMANTIC_DIMENSIONS, true,
  'The bound subject does not relax separately scored semantic dimensions.');
assert.equal(truncatedGstScore.stages.TOPIC_OWNERSHIP, true,
  'The independently recognized GST input-tax topic is owned by the bound issue.');
const canonicalGstSubject = gst.semantic.expectedIssues[0].subject;
const compoundGstQuestion = `${gst.question} And what is the company tax residency rule?`;
const compoundGstRaw = structuredClone(truncatedGstFixture.interpretation);
compoundGstRaw.primarySubject = 'GST input tax recovery and company tax residency';
compoundGstRaw.issues = [
  { ...compoundGstRaw.issues[0], subject: canonicalGstSubject },
  {
    subject: 'company tax residency rule', population: 'COMPANY', domain: 'IRAS_INCOME_TAX',
    governingAuthorities: ['IRAS'], contextualAuthorities: [], operation: 'DETERMINE_TREATMENT',
    mappedTopicIds: [], evidenceRequirement: 'AUTHORITATIVE_SOURCE', confidence: 0.96
  }
];
const compoundGstInterpretation = validateSemanticQuestionInterpretation(compoundGstRaw, compoundGstQuestion);
assert.ok(compoundGstInterpretation, 'The canonical compound GST and company-tax fixture remains schema-valid.');
const compoundGstPlan = reconcileQuestionUnderstanding(compoundGstQuestion, classifyQuestion(compoundGstQuestion), {
  mode: 'SEMANTIC_INTERPRETATION', interpretation: compoundGstInterpretation
}).issuePlan;
assert.ok(compoundGstPlan.issues.find(issue => issue.subject === canonicalGstSubject)
  ?.mappedTopicIds.includes('iras-gst-input-tax'),
  'Canonical GST subjects keep their existing topic mapping in a compound question.');
for (const question of [
  'What are the general Singapore GST rules for claiming input tax on business purchases by a company?',
  'What are the general Singapore GST rules for claiming input tax on business purchases by an unregistered company?',
  'What are the general Singapore GST rules for claiming input tax on business purchases by a company that is not a GST-registered company?',
  'If it becomes a GST-registered company, what are the general Singapore GST rules for claiming input tax on business purchases?',
  'What are the general Singapore GST rules for claiming input tax on business purchases by a company that will become a GST-registered company next year?',
  'What are the general Singapore GST rules for claiming input tax on business purchases by a company that plans to become a GST-registered company?',
  'What are the general Singapore GST rules for claiming input tax on business purchases by a GST-registered company? And what GST registration requirements apply?',
  'What are the general Singapore GST rules for claiming input tax on business purchases by a GST-registered company? And what journal entries should be recorded?'
]) {
  const fixture = interpretationFor({ ...gst, question }, truncatedGst, 'COMPANY', gstConcepts, question);
  const semanticIssue = fixture.issuePlan.issues.find(issue => issue.subject === truncatedGst);
  assert.equal(semanticIssue?.mappedTopicIds.includes('iras-gst-input-tax'), false,
    `The GST topic binding fails closed when registration is absent or an independent outcome is requested: ${question}`);
}
const willClaimQuestion = `${gst.question} The company will claim input tax on those business purchases.`;
const willClaimFixture = interpretationFor({ ...gst, question: willClaimQuestion }, truncatedGst, 'COMPANY', gstConcepts, willClaimQuestion);
assert.ok(willClaimFixture.issuePlan.issues.find(issue => issue.subject === truncatedGst)
  ?.mappedTopicIds.includes('iras-gst-input-tax'),
  'Future claim intent remains compatible with a present, explicit GST registration fact.');
for (const subject of [
  'general conditions for claiming input and output tax on business purchases',
  'general conditions for claiming input tax on private business purchases'
]) {
  const fixture = interpretationFor(gst, subject, 'COMPANY', gstConcepts);
  const semanticIssue = fixture.issuePlan.issues.find(issue => issue.subject === subject);
  assert.equal(semanticIssue?.mappedTopicIds.includes('iras-gst-input-tax'), false,
    `A contradictory or mixed subject cannot claim the independently recognized topic: ${subject}`);
}
for (const subject of [
  'general GST input tax treatment',
  'general GST input tax claim rules for private purchases',
  'general GST input tax claim and output tax rules',
  'general GST input tax claim rules for unknown reimbursements'
]) {
  assert.equal(score(gst, subject).stages.SEMANTIC_ISSUE_IDENTITY, false,
    `A narrowed, mixed, incomplete, or unknown short GST subject fails the bounded semantic identity check: ${subject}`);
}
for (const [name, rootPatch, issuePatch] of [
  ['domain', { domain: 'IRAS_INCOME_TAX' }, { domain: 'IRAS_INCOME_TAX' }],
  ['population', { population: 'INDIVIDUAL' }, { population: 'INDIVIDUAL' }],
  ['authority', { authorityCandidates: ['CPF'] }, { governingAuthorities: ['CPF'] }],
  ['operation', { requestedOperation: 'CHECK_ELIGIBILITY' }, { operation: 'CHECK_ELIGIBILITY' }]
]) {
  const wrong = structuredClone(truncatedGstFixture.interpretation);
  Object.assign(wrong, rootPatch);
  wrong.issues = wrong.issues.map(issue => ({ ...issue, ...issuePatch }));
  const wrongPlan = reconcileQuestionUnderstanding(gst.question, classifyQuestion(gst.question), {
    mode: 'SEMANTIC_INTERPRETATION', interpretation: wrong
  }).issuePlan;
  const semanticIssue = wrongPlan.issues.find(issue => issue.subject === truncatedGst);
  assert.equal(semanticIssue?.mappedTopicIds.includes('iras-gst-input-tax') === true, false,
    `The GST issue binding rejects a wrong ${name} even when the query text matches.`);
  const wrongScore = scoreSemanticV4(gst, wrong, wrongPlan);
  assert.equal(wrongScore.stages.SEMANTIC_ISSUE_IDENTITY, false,
    `V4 does not use the bounded subject match with a wrong ${name}.`);
  assert.equal(wrongScore.stages.SEMANTIC_DIMENSIONS, false,
    `V4 keeps the wrong ${name} visible in dimension scoring.`);
}
const unregisteredQuestion = {
  ...gst,
  question: 'What are the general Singapore GST rules for claiming input tax on business purchases by an unregistered company?'
};
const unregisteredInterpretation = interpretationFor(unregisteredQuestion, abbreviatedGst).interpretation;
const unregisteredPlan = reconcileQuestionUnderstanding(unregisteredQuestion.question, classifyQuestion(unregisteredQuestion.question), {
  mode: 'SEMANTIC_INTERPRETATION', interpretation: unregisteredInterpretation
}).issuePlan;
assert.equal(scoreSemanticV4(unregisteredQuestion, unregisteredInterpretation, unregisteredPlan).stages.SEMANTIC_ISSUE_IDENTITY, false,
  'The GST fallback rejects an unregistered company even when the issue label is abbreviated.');

const sfrsi6 = contract.cases.find(item => item.caseId === 'unsupported-sfrsi-6-exploration-evaluation');
for (const subject of [
  'exploration and evaluation accounting rules under SFRS(I) 6',
  'exploration and evaluation of mineral resources',
  'general SFRS(I) 6 accounting rules for exploration and evaluation expenditure',
  'SFRSI 6 exploration evaluation accounting standards',
  'SFRSI6 exploration and evaluation accounting rules',
  'SFRSI6 exploration and evaluation accounting rules of mineral resources'
]) {
  assert.equal(score(sfrsi6, subject).stages.SEMANTIC_ISSUE_IDENTITY, true,
    `V4 recognizes bounded SFRS(I) 6 acronym and word-form equivalence: ${subject}`);
}
for (const subject of [
  'exploration and evaluation accounting rules under SFRS(I) 16',
  'exploration and evaluation accounting rules under SFRS(I) 9',
  'exploration and evaluation of mineral resources under SFRS(I) 9',
  'SFRSI6 exploration and evaluation of mineral resources SFRSI6',
  'exploration and evaluation of mineral resources under SFRS(I) 16',
  'exploration accounting rules under SFRS(I) 6',
  'evaluation accounting rules under SFRS(I) 6',
  'SFRS(I) 6 exploration and evaluation plus deferred tax and depreciation rules',
  'SFRS(I) 6 exploration only and evaluation is excluded'
]) {
  assert.equal(score(sfrsi6, subject).stages.SEMANTIC_ISSUE_IDENTITY, false,
    `V4 rejects wrong-number, narrowed, contradicted, or mixed SFRS(I) subjects: ${subject}`);
}
const subjectOnlySfrsi6 = interpretationFor(sfrsi6, 'exploration and evaluation accounting rules under SFRS(I) 6').interpretation;
const wrongDimensionSfrsi6 = { ...subjectOnlySfrsi6, domain: 'IRAS_INCOME_TAX',
  issues: subjectOnlySfrsi6.issues.map(issue => ({ ...issue, domain: 'IRAS_INCOME_TAX' })) };
const wrongDimensionPlan = reconcileQuestionUnderstanding(sfrsi6.question, classifyQuestion(sfrsi6.question), {
  mode: 'SEMANTIC_INTERPRETATION', interpretation: wrongDimensionSfrsi6
}).issuePlan;
const wrongDimensionScore = scoreSemanticV4(sfrsi6, wrongDimensionSfrsi6, wrongDimensionPlan);
assert.equal(wrongDimensionScore.stages.SEMANTIC_ISSUE_IDENTITY, true,
  'The bounded SFRS(I) subject match does not absorb the separately scored domain dimension.');
assert.equal(wrongDimensionScore.stages.SEMANTIC_DIMENSIONS, false,
  'The wrong domain remains independently visible in dimension scoring.');

async function runWorkstream(caseContract, question = caseContract.question,
  concepts = [{ concept: caseContract.semantic.expectedIssues[0].subject, role: 'PRIMARY' }],
  population = caseContract.semantic.expectedIssues[0].population[0], onRetrieve,
  subject = caseContract.semantic.expectedIssues[0].subject, planTransform = plan => plan) {
  const { interpretation } = interpretationFor(caseContract, subject,
    population, concepts, question);
  const reconciledPlan = reconcileQuestionUnderstanding(question, classifyQuestion(question), {
    mode: 'SEMANTIC_INTERPRETATION', interpretation
  }).issuePlan;
  const issuePlan = planTransform(reconciledPlan);
  return buildAuthorityWorkstreams(question, issuePlan, {
    questionUnderstanding: { mode: 'SEMANTIC_INTERPRETATION', interpretation },
    referenceDate: '2026-10-08',
    providers: { IRAS: { authority: 'IRAS', async retrieve(request) {
      onRetrieve?.(request);
      return { candidates: [], trace: { stages: [], attempts: [] } };
    } } }
  });
}

const foreignReceiptIssueSubject = 'Singapore corporate income-tax treatment of foreign dividend receipt';
const foreignReceiptConcepts = [
  { concept: 'foreign-sourced dividend', role: 'PRIMARY' },
  { concept: 'corporate income tax', role: 'PRIMARY' },
  { concept: 'subsidiary', role: 'RELATED' }
];
let foreignRequestedConcepts = [];
const foreignReceiptRuntime = await runWorkstream(foreign, foreign.question, foreignReceiptConcepts, 'COMPANY', request => {
  foreignRequestedConcepts = request.retrievalIntent.requestedConcepts;
}, foreignReceiptIssueSubject);
assert.equal(foreignReceiptRuntime.gaps.some(gap => gap.code === 'UNROUTED_MATERIAL_CONCEPT' && gap.subject === 'subsidiary'), false,
  'The explicit Singapore-company receipt from its Thai subsidiary owns the RELATED subsidiary descriptor on the sole validated foreign-income issue.');
assert.deepEqual(foreignReceiptRuntime.issuePlan.issues[0].mappedTopicIds, ['iras-foreign-sourced-income'],
  'Foreign-dividend and corporate-income-tax evidence remains scoped to the validated foreign-income topic.');
assert.ok(foreignRequestedConcepts.some(concept => concept.id === 'foreign_dividend_receipt_tax_treatment'),
  'The PRIMARY foreign-dividend source requirement remains in the governed evidence scope.');
assert.equal(foreignRequestedConcepts.some(concept => concept.label === 'subsidiary'), false,
  'The owned RELATED subsidiary facet does not become an independent source requirement.');

for (const [description, question, subject, planTransform] of [
  ['opposite direction', 'Our Singapore company paid a dividend to its Thai subsidiary. Explain the company income-tax treatment.', foreignReceiptIssueSubject, undefined],
  ['missing original subsidiary fact', 'Our Singapore company received a foreign dividend in the current year. Explain the company income-tax treatment.', foreignReceiptIssueSubject, undefined],
  ['unrelated tax topic', foreign.question, foreignReceiptIssueSubject, plan => ({
    ...plan,
    issues: plan.issues.map(issue => ({ ...issue, mappedTopicIds: ['iras-cit-deductibility'] }))
  })],
  ['separate subsidiary tax outcome', `${foreign.question} And the subsidiary tax treatment?`, foreignReceiptIssueSubject, undefined],
  ['separate subsidiary journal outcome', `${foreign.question} And prepare journal entries for the parent and subsidiary.`, foreignReceiptIssueSubject, undefined]
]) {
  const runtime = await runWorkstream(foreign, question, foreignReceiptConcepts, 'COMPANY', undefined, subject, planTransform);
  assert.ok(runtime.gaps.some(gap => gap.code === 'UNROUTED_MATERIAL_CONCEPT' && gap.subject === 'subsidiary'),
    `The RELATED subsidiary descriptor remains material for ${description}.`);
}

let gstRequestedConcepts = [];
const gstRuntime = await runWorkstream(gst, gst.question, gstConcepts, 'COMPANY', request => {
  gstRequestedConcepts = request.retrievalIntent.requestedConcepts;
});
assert.equal(gstRuntime.gaps.some(gap => gap.code === 'UNROUTED_MATERIAL_CONCEPT' && gap.subject === 'business purchases'), false,
  'Business purchases is owned by the sole mapped GST input-tax issue when the query explicitly establishes registered-company scope.');
assert.equal(gstRuntime.gaps.some(gap => gap.code === 'UNROUTED_MATERIAL_CONCEPT' && gap.subject === 'input tax'), false,
  'The PRIMARY input-tax concept is assigned to the sole mapped GST issue.');
assert.ok(gstRequestedConcepts.some(concept => concept.label === 'input tax' && concept.role === 'PRIMARY'),
  `The PRIMARY input-tax concept remains in the governed source scope for actual evidence coverage: ${JSON.stringify(gstRequestedConcepts)}`);
const gstPrimaryAliasConcepts = [
  { concept: 'GST input tax', role: 'PRIMARY' },
  { concept: 'business purchases', role: 'RELATED' },
  { concept: 'GST-registered company', role: 'CONTEXT_ONLY' }
];
let gstAliasRequestedConcepts = [];
const gstPrimaryAliasRuntime = await runWorkstream(gst, gst.question, gstPrimaryAliasConcepts, 'COMPANY', request => {
  gstAliasRequestedConcepts = request.retrievalIntent.requestedConcepts;
});
assert.equal(gstPrimaryAliasRuntime.gaps.some(gap => gap.code === 'UNROUTED_MATERIAL_CONCEPT' && gap.subject === 'GST input tax'), false,
  'The PRIMARY GST input-tax alias binds to the sole validated registered-company recovery issue.');
assert.ok(gstAliasRequestedConcepts.some(concept => concept.label === 'GST input tax' && concept.role === 'PRIMARY'),
  `The PRIMARY GST input-tax alias remains an explicit governed source requirement: ${JSON.stringify(gstAliasRequestedConcepts)}`);
let gstRelatedAliasRequestedConcepts = [];
const gstRelatedAliasRuntime = await runWorkstream(gst, gst.question, [
  { concept: 'GST input tax', role: 'RELATED' },
  ...gstPrimaryAliasConcepts.slice(1)
], 'COMPANY', request => {
  gstRelatedAliasRequestedConcepts = request.retrievalIntent.requestedConcepts;
});
assert.equal(gstRelatedAliasRuntime.gaps.some(gap => gap.code === 'UNROUTED_MATERIAL_CONCEPT' && gap.subject === 'GST input tax'), false,
  'The same tightly bounded GST input-tax alias may be PRIMARY or RELATED.');
assert.ok(gstRelatedAliasRequestedConcepts.some(concept => concept.label === 'GST input tax' && concept.role === 'RELATED'),
  'A RELATED GST input-tax alias remains in the governed source scope.');
const unregisteredInputTax = await runWorkstream(unregisteredQuestion, unregisteredQuestion.question, gstConcepts, 'COMPANY');
assert.ok(unregisteredInputTax.gaps.some(gap => gap.code === 'UNROUTED_MATERIAL_CONCEPT' && gap.subject === 'input tax'),
  'An unregistered-company query cannot attach the topicless input-tax concept to the ordinary registered-company issue.');
const unregisteredGstAlias = await runWorkstream(unregisteredQuestion, unregisteredQuestion.question,
  gstPrimaryAliasConcepts, 'COMPANY');
assert.ok(unregisteredGstAlias.gaps.some(gap => gap.code === 'UNROUTED_MATERIAL_CONCEPT' && gap.subject === 'GST input tax'),
  'The topicless PRIMARY GST input-tax alias remains unrouted when the query says the company is unregistered.');
let truncatedGstRequestedConcepts = [];
const truncatedGstRuntime = await runWorkstream(gst, gst.question, gstConcepts, 'COMPANY', request => {
  truncatedGstRequestedConcepts = request.retrievalIntent.requestedConcepts;
}, truncatedGst);
assert.equal(truncatedGstRuntime.gaps.some(gap => gap.code === 'UNROUTED_MATERIAL_CONCEPT'), false,
  'The sole bounded GST claim issue owns its topicless input-tax, business-purchase, and RELATED registration descriptors.');
assert.ok(truncatedGstRequestedConcepts.some(concept => concept.label === 'input tax' && concept.role === 'PRIMARY'),
  'The PRIMARY input-tax requirement remains in the governed retrieval scope after query-to-issue binding.');
assert.equal(truncatedGstRequestedConcepts.some(concept => concept.label === 'GST registration'), false,
  'A RELATED registration descriptor binds to the GST issue without adding a separate registration-rule evidence requirement.');
const gstWithOmittedPersonalTax = await runWorkstream(gst,
  `${gst.question} And what is the director's personal income-tax treatment?`);
assert.ok(gstWithOmittedPersonalTax.gaps.some(gap => gap.code === 'ISSUE_PLAN_HAS_UNMAPPED_RESIDUAL'),
  'A model that omits a separate personal-tax request cannot let the business-purchase descriptor close the compound query.');

const privateExpense = contract.cases.find(item => item.caseId === 'private-expense-treatment');
const privateExpenseRuntime = await runWorkstream(privateExpense);
assert.equal(privateExpenseRuntime.gaps.some(gap => gap.code === 'UNROUTED_MATERIAL_CONCEPT'), false,
  'The single mapped director-benefit and corporate-tax request remains owned.');
const privateExpenseWithOmittedPersonalTax = await runWorkstream(privateExpense,
  `${privateExpense.question} And how is the director's personal income-tax position treated?`);
assert.ok(privateExpenseWithOmittedPersonalTax.gaps.some(gap => gap.code === 'ISSUE_PLAN_HAS_UNMAPPED_RESIDUAL'),
  'A separate director-personal-tax ask remains visible when the model supplies only the company-expense issue.');

const privateExpenseSubjectWithoutDirector = 'corporate income-tax treatment of private holiday expense';
const omittedDirectorRuntime = await runWorkstream(privateExpense, privateExpense.question, [
  { concept: privateExpenseSubjectWithoutDirector, role: 'PRIMARY' },
  { concept: 'director benefits', role: 'RELATED' }
]);
assert.equal(omittedDirectorRuntime.gaps.some(gap => gap.code === 'UNROUTED_MATERIAL_CONCEPT' && gap.subject === 'director benefits'), false,
  'Explicit director/private-holiday facts in the question and the sole mapped company deductibility issue bind the descriptor when the issue subject omits director.');

const privateIssueSubject = privateExpense.semantic.expectedIssues[0].subject;
const travelDescriptorCases = [
  { label: 'travel expense', role: 'RELATED', question: privateExpense.question },
  { label: 'business travel costs', role: 'RELATED', question: privateExpense.question },
  { label: 'travel expenditures', role: 'PRIMARY', question: privateExpense.question }
];
for (const item of travelDescriptorCases) {
  const concepts = [{ concept: privateIssueSubject, role: 'PRIMARY' }, { concept: item.label, role: item.role }];
  const projected = interpretationFor(privateExpense, privateIssueSubject, 'COMPANY', concepts, item.question).interpretation;
  const projectedTravel = getRequestedQuestionConcepts(item.question, projected).find(concept => concept.label === item.label);
  assert.equal(projectedTravel?.role, item.role, `The semantic ${item.role} role is retained for ${item.label}.`);
  assert.equal(projectedTravel?.semanticDomain, 'IRAS_INCOME_TAX');
  const runtime = await runWorkstream(privateExpense, item.question, concepts);
  assert.equal(runtime.gaps.some(gap => gap.code === 'UNROUTED_MATERIAL_CONCEPT' && gap.subject === item.label), false,
    `The bounded ${item.label} descriptor is owned by the sole company private-holiday tax issue.`);
}

const corporateResidency = contract.cases.find(item => item.caseId === 'corporate-residency-general-rule');
const residencyIssueSubject = corporateResidency.semantic.expectedIssues[0].subject;
for (const label of ['corporate tax', 'company tax', 'corporate taxation', 'company income tax']) {
  const concepts = [{ concept: residencyIssueSubject, role: 'PRIMARY' }, { concept: label, role: 'RELATED' }];
  const runtime = await runWorkstream(corporateResidency, corporateResidency.question, concepts);
  assert.equal(runtime.gaps.some(gap => gap.code === 'UNROUTED_MATERIAL_CONCEPT' && gap.subject === label), false,
    `${label} is associated only with the sole mapped company tax-residency rule issue.`);
}

const unrelatedTravelOnResidency = await runWorkstream(corporateResidency, corporateResidency.question, [
  { concept: residencyIssueSubject, role: 'PRIMARY' }, { concept: 'travel expense', role: 'RELATED' }
]);
assert.ok(unrelatedTravelOnResidency.gaps.some(gap => gap.code === 'UNROUTED_MATERIAL_CONCEPT' && gap.subject === 'travel expense'),
  'RELATED does not suppress an unrelated concept merely because the issue plan has one issue.');

const privateWithPersonalTax = await runWorkstream(privateExpense,
  `${privateExpense.question} And how is the director's personal income-tax position treated?`, [
  { concept: privateExpenseSubjectWithoutDirector, role: 'PRIMARY' }, { concept: 'director benefits', role: 'RELATED' }
  ]);
assert.ok(privateWithPersonalTax.gaps.some(gap => gap.code === 'UNROUTED_MATERIAL_CONCEPT' && gap.subject === 'director benefits'),
  'A separately requested director personal-tax outcome prevents descriptor ownership.');
const privateWithJournal = await runWorkstream(privateExpense,
  `${privateExpense.question} And please prepare the journal entry.`, [
    { concept: privateIssueSubject, role: 'PRIMARY' }, { concept: 'travel expense', role: 'RELATED' }
  ]);
assert.ok(privateWithJournal.gaps.some(gap => gap.code === 'UNROUTED_MATERIAL_CONCEPT' && gap.subject === 'travel expense'),
  'A separately requested journal entry prevents tax-issue descriptor ownership.');

const wht = contract.cases.find(item => item.caseId === 'wht-royalty-general-rule');
const whtConcepts = [
  { concept: 'withholding tax', role: 'PRIMARY' },
  { concept: 'royalty payment', role: 'PRIMARY' },
  { concept: 'non-resident company', role: 'CONTEXT_ONLY' }
];
const liveWhtSubject = 'withholding tax rules for royalties paid to non-resident company';
let whtRequestedConcepts = [];
const whtRuntime = await runWorkstream(wht, wht.question, whtConcepts, 'COMPANY', request => {
  whtRequestedConcepts = request.retrievalIntent.requestedConcepts;
}, liveWhtSubject);
assert.equal(whtRuntime.gaps.some(gap => gap.code === 'UNROUTED_MATERIAL_CONCEPT' && gap.subject === 'royalty payment'), false,
  'The PRIMARY royalty-payment alias binds only to the sole mapped company WHT issue for royalties paid to a non-resident company.');
assert.ok(whtRequestedConcepts.some(concept => concept.label === 'royalty payment' && concept.role === 'PRIMARY'),
  `The PRIMARY royalty-payment alias remains an explicit governed source requirement: ${JSON.stringify(whtRequestedConcepts)}`);
let whtRelatedRequestedConcepts = [];
const whtRelatedRuntime = await runWorkstream(wht, wht.question, [
  { concept: 'withholding tax', role: 'PRIMARY' },
  { concept: 'royalty payment', role: 'RELATED' },
  { concept: 'non-resident company', role: 'CONTEXT_ONLY' }
], 'COMPANY', request => {
  whtRelatedRequestedConcepts = request.retrievalIntent.requestedConcepts;
}, liveWhtSubject);
assert.equal(whtRelatedRuntime.gaps.some(gap => gap.code === 'UNROUTED_MATERIAL_CONCEPT' && gap.subject === 'royalty payment'), false,
  'The same tightly bounded royalty-payment alias may be PRIMARY or RELATED.');
assert.ok(whtRelatedRequestedConcepts.some(concept => concept.label === 'royalty payment' && concept.role === 'RELATED'),
  'A RELATED royalty-payment alias remains in the governed source scope.');

for (const question of [
  'What are the general Singapore withholding-tax rules when a company receives royalties from a non-resident company?',
  'What are the general Singapore withholding-tax rules when a non-resident company pays royalties to a Singapore company?',
  `${wht.question} And what GST registration requirements apply?`,
  `${wht.question} And please prepare the journal entry.`
]) {
  const runtime = await runWorkstream(wht, question, whtConcepts, 'COMPANY', undefined, liveWhtSubject);
  assert.ok(runtime.gaps.some(gap => gap.code === 'UNROUTED_MATERIAL_CONCEPT' && gap.subject === 'royalty payment'),
    `The WHT primary alias remains material when payment direction is wrong or a separate outcome is requested: ${question}`);
}

for (const [name, patch] of [
  ['domain', { domain: 'IRAS_GST' }],
  ['population', { population: 'INDIVIDUAL' }],
  ['authority', { governingAuthorities: ['CPF'] }],
  ['topic', { mappedTopicIds: ['iras-withholding-tax'] }]
]) {
  const runtime = await runWorkstream(wht, wht.question, whtConcepts, 'COMPANY', undefined, liveWhtSubject, plan => ({
    ...plan,
    issues: plan.issues.map(issue => ({ ...issue, ...patch }))
  }));
  assert.ok(runtime.gaps.some(gap => gap.code === 'UNROUTED_MATERIAL_CONCEPT' && gap.subject === 'royalty payment'),
    `The WHT primary alias remains material with a mismatched issue ${name}.`);
}

const wrongPopulationFixture = interpretationFor(privateExpense, privateIssueSubject, 'COMPANY', [
  { concept: privateIssueSubject, role: 'PRIMARY' }, { concept: 'travel expense', role: 'RELATED' }
]);
const wrongPopulationPlan = { ...wrongPopulationFixture.issuePlan, issues: wrongPopulationFixture.issuePlan.issues.map(issue => ({
  ...issue, population: 'INDIVIDUAL'
})) };
const wrongPopulationRuntime = await buildAuthorityWorkstreams(privateExpense.question, wrongPopulationPlan, {
  questionUnderstanding: { mode: 'SEMANTIC_INTERPRETATION', interpretation: wrongPopulationFixture.interpretation },
  referenceDate: '2026-10-08',
  providers: { IRAS: { authority: 'IRAS', async retrieve() { return { candidates: [], trace: { stages: [], attempts: [] } }; } } }
});
assert.ok(wrongPopulationRuntime.gaps.some(gap => gap.code === 'UNROUTED_MATERIAL_CONCEPT' && gap.subject === 'travel expense'),
  'A company transaction concept cannot be attached to an individual-population issue.');

const unsupportedSfrsiConcepts = [
  { concept: 'exploration and evaluation', role: 'PRIMARY' },
  { concept: 'accounting rules', role: 'RELATED' },
  { concept: 'SFRS(I) 6', role: 'RELATED' }
];
const unsupportedSfrsiRuntime = await runWorkstream(sfrsi6, sfrsi6.question, unsupportedSfrsiConcepts);
assert.equal(unsupportedSfrsiRuntime.workstreams.some(stream => stream.authority === 'IRAS'), false,
  'Unsupported SFRS(I) concepts do not fabricate an IRAS workstream.');
assert.equal(unsupportedSfrsiRuntime.gaps.some(gap => gap.authority === 'IRAS'), false,
  'Unsupported accounting concepts are not reported as IRAS topicless gaps.');
assert.ok(unsupportedSfrsiRuntime.gaps.some(gap => gap.authority === 'ACCOUNTING_STANDARDS' &&
  gap.domain === 'ACCOUNTING' && gap.code === 'NO_COVERAGE_TOPIC'),
  'The actual unsupported accounting issue retains its unresolved accounting-standards coverage gap.');

const populationMismatchFixture = interpretationFor(sfrsi6,
  sfrsi6.semantic.expectedIssues[0].subject, 'COMPANY', [{ concept: 'SFRS(I) 6', role: 'RELATED' }]);
const populationMismatchPlan = { ...populationMismatchFixture.issuePlan, issues: populationMismatchFixture.issuePlan.issues.map(issue => ({
  ...issue, population: 'INDIVIDUAL'
})) };
const populationMismatchRuntime = await buildAuthorityWorkstreams(sfrsi6.question, populationMismatchPlan, {
  questionUnderstanding: { mode: 'SEMANTIC_INTERPRETATION', interpretation: populationMismatchFixture.interpretation },
  referenceDate: '2026-10-08',
  providers: { ACCOUNTING_STANDARDS: { authority: 'ACCOUNTING_STANDARDS', async retrieve() {
    return { candidates: [], trace: { stages: [], attempts: [] } };
  } } }
});
assert.ok(populationMismatchRuntime.gaps.some(gap => gap.code === 'UNROUTED_MATERIAL_CONCEPT' && gap.subject === 'SFRS(I) 6'),
  'A company-scoped concept cannot be attributed to a known individual-population non-IRAS issue.');

process.stdout.write('Gemini downstream V4 semantic and issue-ownership boundary regressions passed.\n');
