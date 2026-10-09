import assert from 'node:assert/strict';
import { classifyQuestion } from '../../src/classification/questionClassifier.ts';
import { supportGeneralIrasRuleConcept } from '../../src/retrieval/irasRuleConceptSupport.ts';
import { UNIFIED_SOURCE_REGISTRY } from '../../src/standards/unifiedSourceModel.ts';
import {
  reconcileQuestionUnderstanding,
  validateSemanticQuestionInterpretation
} from '../../src/services/semanticQuestionUnderstanding.ts';

const privateInput = sourceText => ({
  sourceText,
  domainId: 'IRAS_CORPORATE_TAX',
  topicIds: ['iras-cit-disallowed-expenses'],
  subject: 'company income tax treatment and deductibility of private domestic expenses',
  population: 'COMPANY'
});
const reviewedSection15 = UNIFIED_SOURCE_REGISTRY.ITA_SEC15_PROHIBITED_DEDUCTIONS.sourceText;
assert.match(reviewedSection15, /subject to statutory exceptions/i);
assert.match(reviewedSection15, /not an exhaustive list/i);
assert.equal(supportGeneralIrasRuleConcept(privateInput(reviewedSection15)), true,
  'The reviewed caveated Section 15 enumerative rule supports the bounded private/domestic disallowance concept.');
assert.equal(supportGeneralIrasRuleConcept(privateInput('Section 14 allows expenses wholly and exclusively incurred in producing income, subject to statutory conditions.')), false,
  'A Section 14 general deduction rule does not establish the explicit private-expense prohibition.');
assert.equal(supportGeneralIrasRuleConcept(privateInput(UNIFIED_SOURCE_REGISTRY.ITA_SEC15_1_K_MOTOR_CAR.sourceText)), false,
  'A motor-car-only rule does not establish the private-expense rule.');
assert.equal(supportGeneralIrasRuleConcept(privateInput('The guide mentions private expenses and discusses tax deductions elsewhere.')), false,
  'Mere mention cannot establish the rule.');
assert.equal(supportGeneralIrasRuleConcept(privateInput('Section 15 does not disallow specified deductions, including domestic or private expenses.')), false,
  'A reversed enumerative rule is rejected.');
assert.equal(supportGeneralIrasRuleConcept(privateInput("It is not true that section 15 disallows deductions, including private expenses.")), false,
  'A not-true-that reversal cannot pass the enumerative form.');
assert.equal(supportGeneralIrasRuleConcept(privateInput("Section 15 doesn't disallow deductions, including private expenses.")), false,
  'A contracted negation cannot pass the enumerative form.');
assert.equal(supportGeneralIrasRuleConcept(privateInput('It is false that Section 15 disallows deductions, including private expenses.')), false,
  'A false-assertion reversal cannot pass the enumerative form.');
assert.equal(supportGeneralIrasRuleConcept(privateInput('Whether section 15 disallows deductions, including private expenses, depends on the Act.')), false,
  'A question or uncertain mention is not an affirmative rule.');
assert.equal(supportGeneralIrasRuleConcept(privateInput('Section 15 may disallow deductions, including private expenses.')), false,
  'A modal possibility is not treated as a reviewed affirmative rule.');
assert.equal(supportGeneralIrasRuleConcept(privateInput('Section 15 disallows specified deductions, including domestic or private expenses, except private expenses.')), false,
  'An explicit same-clause exclusion is rejected.');
assert.equal(supportGeneralIrasRuleConcept(privateInput('Private expenses are not disallowed for income tax.')), false,
  'A direct reversal is rejected.');

const whtInput = subject => ({
  sourceText: 'Royalty withholding tax may apply when a Singapore payer pays royalties to a non-resident.',
  domainId: 'IRAS_CORPORATE_TAX',
  topicIds: ['iras-withholding-tax-interest-royalties'],
  subject,
  population: 'COMPANY'
});
for (const spelling of ['non-resident', 'non resident', 'nonresident']) {
  assert.equal(supportGeneralIrasRuleConcept(whtInput(`withholding tax on royalty payments to ${spelling} recipients`)), true,
    `Matching canonicalizes ${spelling} without changing the source quotation.`);
}
assert.equal(supportGeneralIrasRuleConcept(whtInput('withholding tax rules for royalties paid to non-resident companies')), true,
  'The actual bounded royalty subject accepts the past-tense payment form for a non-resident company recipient.');
assert.equal(supportGeneralIrasRuleConcept(whtInput('withholding tax on royalties paid by a Singapore company to non-resident companies')), true,
  'An explicit Singapore payer followed by a non-resident recipient keeps the payment direction intact.');
assert.notEqual(supportGeneralIrasRuleConcept(whtInput('withholding tax rules for royalties paid by non-resident companies')), true,
  'A non-resident company as payer does not satisfy the bounded recipient direction.');
assert.notEqual(supportGeneralIrasRuleConcept(whtInput('withholding tax rules for royalties received from a non-resident company')), true,
  'A non-resident company as payer/source does not satisfy the bounded recipient direction.');
assert.notEqual(supportGeneralIrasRuleConcept(whtInput('withholding tax rules for royalties paid by a non-resident company to a resident company')), true,
  'Mixed payer and resident-recipient qualifiers remain outside the bounded non-resident-recipient rule.');
assert.notEqual(supportGeneralIrasRuleConcept(whtInput('withholding tax rules for royalties paid to resident companies')), true,
  'A resident company recipient does not satisfy the non-resident request.');
assert.notEqual(supportGeneralIrasRuleConcept({
  ...whtInput('withholding tax rules for royalties paid to non-resident individuals'),
  population: 'INDIVIDUAL'
}), true, 'The company-only royalty rule does not apply to an individual population.');
assert.equal(supportGeneralIrasRuleConcept({
  ...whtInput('withholding tax on royalty payments to non‑resident recipients'),
  sourceText: 'Royalty payments are subject to withholding tax.'
}), false, 'A Unicode nonbreaking-hyphen qualifier cannot erase the required recipient condition.');
assert.equal(supportGeneralIrasRuleConcept({
  ...whtInput('withholding tax on royalty payments to non‑resident recipients'),
  sourceText: 'Royalty payments to non-resident recipients are subject to withholding tax.'
}), true, 'A Unicode spelling variant still matches an equivalent bounded source rule.');

const cpfReliefIssue = overrides => ({
  subject: 'individual personal income tax relief on compulsory CPF contributions',
  population: 'INDIVIDUAL',
  domain: 'IRAS_INCOME_TAX',
  governingAuthorities: ['IRAS'],
  contextualAuthorities: ['CPF'],
  operation: 'CHECK_ELIGIBILITY',
  mappedTopicIds: [],
  evidenceRequirement: 'AUTHORITATIVE_SOURCE_AND_CASE_FACTS',
  confidence: 0.96,
  ...overrides
});
const cpfReliefInterpretation = ({ issue: issueOverrides = {}, ...rootOverrides } = {}) => ({
  schemaVersion: 2,
  jurisdiction: ['Singapore'],
  authorityCandidates: ['IRAS'],
  contextualAuthorities: ['CPF'],
  domain: 'IRAS_INCOME_TAX',
  population: 'INDIVIDUAL',
  primarySubject: 'personal income tax relief on compulsory CPF contributions',
  concepts: [{ concept: 'personal tax relief on compulsory CPF contributions', role: 'PRIMARY' }],
  requestedOperation: 'CHECK_ELIGIBILITY',
  requiresUserSpecificFacts: true,
  factsExplicitlyProvided: [],
  confidence: 0.96,
  issues: [cpfReliefIssue(issueOverrides)],
  ...rootOverrides
});
const reconcile = (query, interpretation) => reconcileQuestionUnderstanding(query, classifyQuestion(query), {
  mode: 'SEMANTIC_INTERPRETATION',
  interpretation: validateSemanticQuestionInterpretation(interpretation, query)
});

const contextualQuery = 'Can I claim personal tax relief on my compulsory CPF contributions?';
const contextualMeaning = validateSemanticQuestionInterpretation(cpfReliefInterpretation(), contextualQuery);
assert.ok(contextualMeaning, 'The V2 fixture passes production semantic validation.');
const contextual = reconcile(contextualQuery, contextualMeaning);
assert.equal(contextual.issuePlan.source, 'SEMANTIC_ISSUES');
const contextualRelief = contextual.issuePlan.issues.find(issue => issue.domain === 'IRAS_INCOME_TAX');
assert.ok(contextualRelief?.mappedTopicIds.includes('iras-individual-cpf-relief'));
assert.deepEqual(contextualRelief?.contextualTopicIds, ['cpf_contribution_rates'],
  'A raw CPF rate topic is contextual only on the mapped IRAS individual-relief issue.');
assert.equal(contextualRelief?.mappedTopicIds.includes('cpf_contribution_rates'), false,
  'Contextual topics never become mapped/governing source scope.');
assert.equal(contextual.issuePlan.issues.some(issue => issue.domain === 'CPF_PAYROLL' ||
  issue.mappedTopicIds.includes('cpf_contribution_rates')), false,
  'The contextual raw CPF mention does not create a spurious payroll issue.');

const fullyMappedRelief = reconcile(contextualQuery, validateSemanticQuestionInterpretation(cpfReliefInterpretation({
  primarySubject: 'individual personal tax reliefs including relief on compulsory CPF contributions',
  issue: {
    subject: 'individual personal tax reliefs including relief for compulsory CPF contributions',
    mappedTopicIds: ['iras-individual-cpf-relief', 'iras-individual-reliefs']
  }
}), contextualQuery));
assert.equal(fullyMappedRelief.issuePlan.coverageEstablished, true,
  'A validated IRAS relief issue that owns both IRAS topics remains complete when CPF rates are contextual.');
assert.equal(fullyMappedRelief.issuePlan.hasUnmappedResidual, false);
assert.deepEqual(fullyMappedRelief.issuePlan.issues.find(issue => issue.domain === 'IRAS_INCOME_TAX')?.contextualTopicIds,
  ['cpf_contribution_rates']);
assert.equal(fullyMappedRelief.issuePlan.issues.some(issue => issue.domain === 'CPF_PAYROLL' ||
  issue.mappedTopicIds.includes('cpf_contribution_rates')), false);

for (const factualPayerQuery of [
  'I am an employee and pay compulsory CPF contributions. Can I claim personal tax relief on these compulsory CPF contributions?',
  'My employer pays CPF contributions for me; can I claim personal tax relief on my compulsory CPF contributions?'
]) {
  const employeeMeaning = validateSemanticQuestionInterpretation(cpfReliefInterpretation({
    population: 'EMPLOYEE',
    issue: { population: 'EMPLOYEE' }
  }), factualPayerQuery);
  assert.ok(employeeMeaning, 'The employee relief mock passes production semantic validation.');
  const factualPayer = reconcile(factualPayerQuery, employeeMeaning);
  const reliefIssue = factualPayer.issuePlan.issues.find(issue => issue.domain === 'IRAS_INCOME_TAX');
  assert.deepEqual(reliefIssue?.contextualTopicIds, ['cpf_contribution_rates'],
    'A payer fact without a requested payroll result stays contextual.');
  assert.equal(factualPayer.issuePlan.issues.some(issue => issue.domain === 'CPF_PAYROLL' ||
    issue.mappedTopicIds.includes('cpf_contribution_rates')), false,
  'An employee or employer payer fact does not invent a payroll workstream.');
}

const representedMixedQuery = 'What CPF contributions must the employer and employee make, and can I claim personal tax relief on my compulsory CPF contributions?';
const representedMixedMeaning = validateSemanticQuestionInterpretation(cpfReliefInterpretation({
  domain: 'UNKNOWN',
  population: 'UNKNOWN',
  authorityCandidates: ['IRAS', 'CPF'],
  contextualAuthorities: [],
  primarySubject: 'employer and employee CPF contribution obligations and individual personal tax relief',
  concepts: [
    { concept: 'employer CPF contributions', role: 'PRIMARY' },
    { concept: 'employee CPF contributions', role: 'RELATED' },
    { concept: 'personal tax relief on compulsory CPF contributions', role: 'RELATED' }
  ],
  requestedOperation: 'OTHER',
  issues: [
    cpfReliefIssue({
      subject: 'employer CPF contribution amount', population: 'EMPLOYER', domain: 'CPF_PAYROLL',
      governingAuthorities: ['CPF'], contextualAuthorities: [], operation: 'CALCULATE'
    }),
    cpfReliefIssue({
      subject: 'employee CPF contribution amount', population: 'EMPLOYEE', domain: 'CPF_PAYROLL',
      governingAuthorities: ['CPF'], contextualAuthorities: [], operation: 'CALCULATE'
    }),
    cpfReliefIssue({ subject: 'individual personal tax relief claim for compulsory CPF contributions' })
  ]
}), representedMixedQuery);
assert.ok(representedMixedMeaning, 'The represented IRAS-plus-two-CPF-issues mock passes validation.');
const representedMixed = reconcile(representedMixedQuery, representedMixedMeaning);
assert.equal(representedMixed.issuePlan.issues.filter(issue => issue.domain === 'CPF_PAYROLL').length, 2);
assert.equal(representedMixed.issuePlan.issues.find(issue => issue.domain === 'IRAS_INCOME_TAX')?.contextualTopicIds, undefined,
  'An existing semantic CPF governing workstream prevents contextual reclassification of a raw CPF topic.');

const omittedMakeQuery = 'What CPF contributions must the employer and employee make, and can I claim personal tax relief on my compulsory CPF contributions?';
const omittedMake = reconcile(omittedMakeQuery, cpfReliefInterpretation());
assert.equal(omittedMake.issuePlan.issues.find(issue => issue.domain === 'IRAS_INCOME_TAX')?.contextualTopicIds, undefined,
  'The direct make-contributions question is recognized even when the semantic issue list omits CPF payroll.');
assert.ok(omittedMake.issuePlan.issues.some(issue => issue.unresolvedReason === 'UNASSIGNED_QUERY_TOPIC' &&
  issue.mappedTopicIds.includes('cpf_contribution_rates')),
'An omitted CPF make-contributions request remains an unresolved independent topic.');

const mixedQuery = 'What can I claim for personal tax relief on compulsory CPF contributions, and what does the employer have to pay into CPF?';
const mixed = reconcile(mixedQuery, cpfReliefInterpretation());
const mixedRelief = mixed.issuePlan.issues.find(issue => issue.domain === 'IRAS_INCOME_TAX');
assert.ok(mixedRelief?.mappedTopicIds.includes('iras-individual-cpf-relief'));
assert.equal(mixedRelief?.contextualTopicIds, undefined,
  'An explicit separate employer contribution request is not folded into the IRAS relief issue.');
assert.ok(mixed.issuePlan.issues.some(issue => issue.unresolvedReason === 'UNASSIGNED_QUERY_TOPIC' &&
  issue.mappedTopicIds.includes('cpf_contribution_rates')),
'When the semantic issue list omits the separately requested payroll result, the independently recognized CPF topic remains unresolved.');
assert.equal(mixed.issuePlan.coverageEstablished, false);

const interactionQuery = 'What is the relationship between CPF contribution rates and the personal tax relief cap?';
const interaction = reconcile(interactionQuery, cpfReliefInterpretation({
  primarySubject: 'relationship between CPF contributions and personal tax relief cap',
  requestedOperation: 'EXPLAIN_INTERACTION',
  issue: { subject: 'individual personal tax relief interaction with CPF contributions and the relief cap', operation: 'EXPLAIN_INTERACTION' }
}));
assert.deepEqual(interaction.issuePlan.issues.find(issue => issue.domain === 'IRAS_INCOME_TAX')?.contextualTopicIds,
  ['cpf_contribution_rates'], 'A conceptual relief-cap interaction remains contextual, not a payroll outcome request.');

const calculatedReliefQuery = 'How much personal tax relief can I claim for my compulsory CPF contributions?';
const calculatedRelief = reconcile(calculatedReliefQuery, cpfReliefInterpretation({
  requestedOperation: 'CALCULATE',
  issue: { operation: 'CALCULATE', subject: 'calculation of individual personal tax relief for compulsory CPF contributions' }
}));
assert.deepEqual(calculatedRelief.issuePlan.issues.find(issue => issue.domain === 'IRAS_INCOME_TAX')?.contextualTopicIds,
  ['cpf_contribution_rates'], 'A requested tax-relief amount remains contextual when no payroll contribution amount is requested.');

const explicitRateInteractionQuery = 'How do current CPF contribution rates interact with the personal tax relief cap?';
const explicitRateInteraction = reconcile(explicitRateInteractionQuery, cpfReliefInterpretation({
  primarySubject: 'relationship between CPF contribution rates and personal tax relief cap',
  requestedOperation: 'EXPLAIN_INTERACTION',
  issue: { subject: 'individual personal tax relief interaction with current CPF contribution rates and the relief cap', operation: 'EXPLAIN_INTERACTION' }
}));
assert.equal(explicitRateInteraction.issuePlan.issues.find(issue => issue.domain === 'IRAS_INCOME_TAX')?.contextualTopicIds, undefined,
  'An explicit current-rate question remains separate even when it mentions a relief-cap interaction.');
assert.ok(explicitRateInteraction.issuePlan.issues.some(issue => issue.unresolvedReason === 'UNASSIGNED_QUERY_TOPIC' &&
  issue.mappedTopicIds.includes('cpf_contribution_rates')));

const calculatedEmployerQuery = 'Calculate employer CPF contributions, and explain how they relate to the personal tax relief cap.';
const calculatedEmployer = reconcile(calculatedEmployerQuery, cpfReliefInterpretation({
  primarySubject: 'relationship between CPF contributions and personal tax relief cap',
  requestedOperation: 'EXPLAIN_INTERACTION',
  issue: { subject: 'individual personal tax relief interaction with CPF contributions and the relief cap', operation: 'EXPLAIN_INTERACTION' }
}));
assert.equal(calculatedEmployer.issuePlan.issues.find(issue => issue.domain === 'IRAS_INCOME_TAX')?.contextualTopicIds, undefined);
assert.ok(calculatedEmployer.issuePlan.issues.some(issue => issue.unresolvedReason === 'UNASSIGNED_QUERY_TOPIC' &&
  issue.mappedTopicIds.includes('cpf_contribution_rates')),
'A calculated employer contribution cannot be swallowed by the conceptual interaction clause.');

const reversedCompoundQuery = 'How much must the employer pay into CPF, and can I claim personal tax relief on my compulsory CPF contributions?';
const reversedCompound = reconcile(reversedCompoundQuery, cpfReliefInterpretation());
assert.equal(reversedCompound.issuePlan.issues.find(issue => issue.domain === 'IRAS_INCOME_TAX')?.contextualTopicIds, undefined);
assert.ok(reversedCompound.issuePlan.issues.some(issue => issue.unresolvedReason === 'UNASSIGNED_QUERY_TOPIC' &&
  issue.mappedTopicIds.includes('cpf_contribution_rates')),
'The payroll outcome remains separate when it precedes the relief clause.');

const dueBeforeReliefQuery = 'How much CPF contributions are due and what personal tax relief can I claim on compulsory CPF?';
const dueBeforeRelief = reconcile(dueBeforeReliefQuery, cpfReliefInterpretation());
assert.equal(dueBeforeRelief.issuePlan.issues.find(issue => issue.domain === 'IRAS_INCOME_TAX')?.contextualTopicIds, undefined);
assert.ok(dueBeforeRelief.issuePlan.issues.some(issue => issue.unresolvedReason === 'UNASSIGNED_QUERY_TOPIC' &&
  issue.mappedTopicIds.includes('cpf_contribution_rates')),
'A plural contribution amount request before a later relief clause remains separate.');

for (const firstPersonQuery of [
  'How much do I owe CPF, and can I claim personal tax relief on my compulsory CPF contributions?',
  'How much CPF must I pay, and can I claim personal tax relief on my compulsory CPF contributions?',
  'What amount should we contribute to CPF, and can I claim personal tax relief on my compulsory CPF contributions?',
  'What CPF amount will I owe, and can I claim personal tax relief on my compulsory CPF contributions?'
]) {
  const firstPerson = reconcile(firstPersonQuery, cpfReliefInterpretation());
  assert.equal(firstPerson.issuePlan.issues.find(issue => issue.domain === 'IRAS_INCOME_TAX')?.contextualTopicIds, undefined,
    'An explicitly requested first-person CPF amount is not treated as mere payer context.');
  assert.ok(firstPerson.issuePlan.issues.some(issue => issue.unresolvedReason === 'UNASSIGNED_QUERY_TOPIC' &&
    issue.mappedTopicIds.includes('cpf_contribution_rates')),
  'When the semantic model omits a first-person CPF payroll calculation, its independently recognized topic stays residual.');
  assert.equal(firstPerson.issuePlan.coverageEstablished, false);
}

const unsupportedExtraQuery = 'Can I claim personal tax relief on my compulsory CPF contributions, and what corporate tax return must a company file?';
const extra = reconcile(unsupportedExtraQuery, cpfReliefInterpretation());
assert.ok(extra.issuePlan.issues.some(issue => issue.unresolvedReason === 'UNASSIGNED_QUERY_TOPIC'),
  'Contextual CPF annotation does not swallow an unrelated unsupported extra request.');
assert.equal(extra.issuePlan.coverageEstablished, false);

console.log('IRAS private expense and CPF contextual-topic regressions passed.');
