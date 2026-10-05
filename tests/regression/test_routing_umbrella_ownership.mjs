import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { classifyQuestion } from '../../src/classification/questionClassifier.ts';
import { reconcileQuestionUnderstanding } from '../../src/services/semanticQuestionUnderstanding.ts';
import { inventoryRawRequest } from '../../src/services/rawRequestInventory.ts';
import { getCoverageTopicById } from '../../src/standards/coverageRegistry.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
// The fixture retains only the four raw mocks and question from the reviewed
// c252309 proof; the research artifact itself is intentionally not required.
const proofPath = path.join(root, 'tests/fixtures/routingUmbrellaMocks.json');
const proof = JSON.parse(await readFile(proofPath, 'utf8'));

const CPF_RELIEF = 'iras-individual-cpf-relief';
const RELIEF_PARENT = 'iras-individual-reliefs';
const CPF_CONTRIBUTIONS = 'cpf_contribution_rates';

function issue(subject, population, domain, authority, operation, overrides = {}) {
  return {
    subject,
    population,
    domain,
    governingAuthorities: [authority],
    contextualAuthorities: [],
    operation,
    mappedTopicIds: [],
    evidenceRequirement: 'AUTHORITATIVE_SOURCE',
    confidence: 0.96,
    ...overrides
  };
}

function understanding(issues, { confidence = 0.96, mode = 'SEMANTIC_INTERPRETATION' } = {}) {
  const primarySubject = issues.map(item => item.subject).join(' and ');
  return {
    mode,
    interpretation: {
      schemaVersion: 2,
      jurisdiction: ['Singapore'],
      authorityCandidates: ['IRAS'],
      contextualAuthorities: [],
      domain: 'IRAS_INCOME_TAX',
      population: 'INDIVIDUAL',
      primarySubject,
      concepts: [{ concept: primarySubject, role: 'PRIMARY' }],
      requestedOperation: 'OTHER',
      factsExplicitlyProvided: [],
      confidence,
      issues
    }
  };
}

function reconcile(query, issues, options) {
  return reconcileQuestionUnderstanding(query, classifyQuestion(query), understanding(issues, options));
}

function childIssue(subject = 'individual income tax relief for compulsory CPF', operation = 'CHECK_ELIGIBILITY', overrides = {}) {
  return issue(subject, 'INDIVIDUAL', 'IRAS_INCOME_TAX', 'IRAS', operation, overrides);
}

function employerIssue(subject = 'employer CPF contribution amount', operation = 'CALCULATE') {
  return issue(subject, 'EMPLOYER', 'CPF_PAYROLL', 'CPF', operation);
}

function assertRoutingParentResidual(result, label) {
  assert.ok(result.issuePlan.issues.some(item => item.unresolvedReason === 'UNASSIGNED_QUERY_TOPIC' &&
    item.mappedTopicIds.includes(RELIEF_PARENT)), `${label}: omitted overview remains a raw parent residual`);
}

function assertNoRoutingOwnership(result, label) {
  assert.ok(result.issuePlan.issues.every(item => !item.routingTopicIds?.includes(RELIEF_PARENT)),
    `${label}: no semantic issue receives parent routing ownership`);
}

assert.equal(getCoverageTopicById(RELIEF_PARENT)?.routingOnly, true, 'the umbrella remains routing-only metadata');
assert.deepEqual(getCoverageTopicById(CPF_RELIEF)?.routingParentTopicIds, [RELIEF_PARENT],
  'the specific CPF relief child declares its only routing parent');

// The raw inventory separates full syntactic consumption from an ambiguous operation.
const fixtureQuestion = proof.question;
const fixtureInventory = inventoryRawRequest(fixtureQuestion);
assert.equal(fixtureInventory.state, 'UNCERTAIN', 'the relief operation remains unresolved for later diagnostics');
assert.equal(fixtureInventory.fullyConsumed, true, 'all raw request scopes in the fixture were consumed');
assert.deepEqual(fixtureInventory.outcomes.map(item => item.identity), ['CPF_RELIEF', 'CPF_CONTRIBUTIONS']);
assert.equal(fixtureInventory.outcomes[0].operation, 'AMBIGUOUS', 'raw operation ambiguity is not rewritten by routing');
assert.equal(fixtureInventory.facts[0]?.amountText, '6,000', 'the supported salary frame is preserved as a fact');

// Reproduce all four retained raw V2 mocks, including both historical root modes.
for (const row of proof.rows) {
  const result = reconcileQuestionUnderstanding(fixtureQuestion, classifyQuestion(fixtureQuestion), {
    mode: 'SEMANTIC_INTERPRETATION', interpretation: row.rawMock
  });
  assert.equal(result.issuePlan.hasUnmappedResidual, false,
    `${row.rootMode}: owned specific relief plus employer request should not leave a false umbrella residual`);
  const child = result.issuePlan.issues.find(item => item.subject === row.subject);
  assert.ok(child, `${row.rootMode}: retained specific relief issue is preserved`);
  assert.equal(child.status, 'MAPPED');
  assert.deepEqual(child.mappedTopicIds, [CPF_RELIEF], 'specific mapped evidence remains the CPF child only');
  assert.deepEqual(child.routingTopicIds, [RELIEF_PARENT], 'the parent is recorded separately as routing ownership');
  assert.ok(!child.contextualTopicIds?.includes(RELIEF_PARENT), 'parent ownership is not issue context');
  assert.equal(child.operation, 'CHECK_ELIGIBILITY', 'ambiguous raw operation is not rewritten on the mapped issue');
  const employer = result.issuePlan.issues.find(item => item.domain === 'CPF_PAYROLL');
  assert.deepEqual(employer?.mappedTopicIds, [CPF_CONTRIBUTIONS], 'the independent employer issue keeps its own evidence topic');
  assertNoRoutingOwnership({ issuePlan: { issues: result.issuePlan.issues.filter(item => item !== child) } },
    `${row.rootMode} employer issue`);
}

const fullKnownInventory = inventoryRawRequest('Explain individual tax relief categories plus Explain personal tax relief on compulsory CPF.');
assert.equal(fullKnownInventory.fullyConsumed, true, 'recognized conjunctions consume every supported clause');
assert.deepEqual(fullKnownInventory.outcomes.map(item => item.identity), ['INDIVIDUAL_RELIEF_CATEGORIES', 'CPF_RELIEF']);
assert.equal(inventoryRawRequest('Explain personal tax relief on compulsory CPF and').fullyConsumed, false,
  'trailing conjunction prevents routing ownership');
assert.equal(inventoryRawRequest('unsupported prefix and Explain personal tax relief on compulsory CPF').fullyConsumed, false,
  'unknown prefix prevents routing ownership');
assert.equal(inventoryRawRequest('Explain personal tax relief on compulsory CPF and unsupported suffix').fullyConsumed, false,
  'unknown suffix prevents routing ownership');
assert.equal(inventoryRawRequest('Explain voluntary CPF tax relief').fullyConsumed, false,
  'unsupported specific scope does not receive an invented production');

const repeatedReliefQuery = 'Explain personal tax relief on compulsory CPF and Explain personal tax relief on compulsory CPF.';
const repeatedRelief = reconcile(repeatedReliefQuery, [
  childIssue('personal tax relief on compulsory CPF', 'EXPLAIN_RULE'),
  childIssue('personal tax relief on compulsory CPF', 'EXPLAIN_RULE')
]);
assert.equal(inventoryRawRequest(repeatedReliefQuery).outcomes.filter(item => item.identity === 'CPF_RELIEF').length, 2);
assertRoutingParentResidual(repeatedRelief, 'multiple specific relief requests');
assertNoRoutingOwnership(repeatedRelief, 'multiple specific relief requests');

const ambiguousReliefWithTwoIssues = reconcile(fixtureQuestion, [
  childIssue('individual income tax relief for compulsory CPF', 'CHECK_ELIGIBILITY'),
  childIssue('individual income tax relief for compulsory CPF', 'CALCULATE'),
  employerIssue()
]);
assertRoutingParentResidual(ambiguousReliefWithTwoIssues, 'ambiguous raw relief with multiple semantic candidates');
assertNoRoutingOwnership(ambiguousReliefWithTwoIssues, 'ambiguous raw relief with multiple semantic candidates');

const genericSentence = 'I need an overview of individual tax relief categories.';
const genericSentenceResult = reconcile(genericSentence, [
  issue('overview of individual tax relief categories', 'INDIVIDUAL', 'IRAS_INCOME_TAX', 'IRAS', 'EXPLAIN_RULE')
]);
assertNoRoutingOwnership(genericSentenceResult, 'sentence overview');
assert.ok(genericSentenceResult.issuePlan.issues.some(item => item.status === 'MAPPED' && item.mappedTopicIds.includes(RELIEF_PARENT)),
  'a generic sentence overview maps its parent normally');

const overviewChildQueries = [
  'Explain individual tax relief categories and Explain personal tax relief on compulsory CPF.',
  'Explain personal tax relief on compulsory CPF. Explain individual tax relief categories.',
  'Explain personal tax reliefs, plus explain personal tax relief on compulsory CPF.'
];
for (const [index, query] of overviewChildQueries.entries()) {
  const overviewSubject = index === 2 ? 'personal tax reliefs' : 'individual tax relief categories';
  const result = reconcile(query, [
    issue(overviewSubject, 'INDIVIDUAL', 'IRAS_INCOME_TAX', 'IRAS', 'EXPLAIN_RULE'),
    childIssue('personal tax relief on compulsory CPF', 'EXPLAIN_RULE')
  ]);
  assert.equal(result.issuePlan.hasUnmappedResidual, false, `overview and child both remain represented: ${query}`);
  const generic = result.issuePlan.issues.find(item => item.subject === overviewSubject);
  assert.ok(generic?.mappedTopicIds.includes(RELIEF_PARENT), `generic issue owns the parent in its own right: ${query}`);
  assertNoRoutingOwnership({ issuePlan: { issues: result.issuePlan.issues.filter(item => item !== generic) } },
    `specific issue when overview is represented: ${query}`);
}

const exampleQuery = 'Explain individual tax relief categories, including CPF relief for employees.';
const exampleSubject = 'individual tax relief categories including CPF relief for employees';
const exampleResult = reconcile(exampleQuery, [
  issue(exampleSubject, 'INDIVIDUAL', 'IRAS_INCOME_TAX', 'IRAS', 'EXPLAIN_RULE')
]);
assert.deepEqual(inventoryRawRequest(exampleQuery).outcomes.map(item => item.identity), ['INDIVIDUAL_RELIEF_CATEGORIES']);
assertNoRoutingOwnership(exampleResult, 'overview with CPF example');
assert.ok(exampleResult.issuePlan.issues.some(item => item.status === 'MAPPED' && item.mappedTopicIds.includes(RELIEF_PARENT)),
  'an illustrative CPF example remains an overview issue rather than child ownership');

const compoundOverviewQuery = 'Explain individual tax relief categories plus Explain personal tax relief on compulsory CPF.';
const representedOverview = reconcile(compoundOverviewQuery, [
  issue('individual tax relief categories', 'INDIVIDUAL', 'IRAS_INCOME_TAX', 'IRAS', 'EXPLAIN_RULE'),
  childIssue('individual personal tax relief claim for compulsory CPF contributions', 'EXPLAIN_RULE', {
    mappedTopicIds: [RELIEF_PARENT, CPF_RELIEF]
  })
]);
assert.equal(representedOverview.issuePlan.hasUnmappedResidual, false, 'represented generic request and specific child both map');
const representedChild = representedOverview.issuePlan.issues.find(item => item.subject === 'individual personal tax relief claim for compulsory CPF contributions');
assert.deepEqual(representedChild?.mappedTopicIds, [CPF_RELIEF], 'model parent hints are ignored for substantive mapping');
assertNoRoutingOwnership({ issuePlan: { issues: resultIssues(representedOverview).filter(item => item !== representedChild) } },
  'specific child when generic request is represented');

const omittedOverview = reconcile(compoundOverviewQuery, [
  childIssue('individual personal tax relief claim for compulsory CPF contributions', 'EXPLAIN_RULE')
]);
assertRoutingParentResidual(omittedOverview, 'omitted generic overview');
const omittedChild = omittedOverview.issuePlan.issues.find(item => item.subject === 'individual personal tax relief claim for compulsory CPF contributions');
assert.deepEqual(omittedChild?.mappedTopicIds, [CPF_RELIEF], 'a child alias cannot directly consume the umbrella');
assertNoRoutingOwnership(omittedOverview, 'omitted overview request');

// Both canonical and alternate child subjects can establish the narrow specific relationship.
for (const [query, subject, operation] of [
  ['Can I claim personal tax relief on my compulsory CPF contributions?', 'personal tax relief on compulsory CPF contributions', 'CHECK_ELIGIBILITY'],
  ['How much personal tax relief can I claim for compulsory CPF contributions?', 'individual income tax relief for compulsory CPF', 'CALCULATE']
]) {
  const result = reconcile(query, [childIssue(subject, operation)]);
  assert.equal(result.issuePlan.hasUnmappedResidual, false, `recognized specific request owns its parent routing topic: ${subject}`);
  const child = result.issuePlan.issues.find(item => item.subject === subject);
  assert.deepEqual(child?.mappedTopicIds, [CPF_RELIEF]);
  assert.deepEqual(child?.routingTopicIds, [RELIEF_PARENT]);
}

const aliasQuery = 'Can I claim personal tax relief on my compulsory CPF contributions?';
for (const subject of [
  'individual personal tax relief on compulsory CPF contributions',
  'individual entitlement to personal tax relief for compulsory CPF contributions'
]) {
  const inventory = inventoryRawRequest(aliasQuery);
  assert.equal(inventory.fullyConsumed, true);
  assert.equal(inventory.outcomes.length, 1);
  assert.equal(inventory.outcomes[0].identity, 'CPF_RELIEF');
  assert.equal(inventory.outcomes[0].population, 'INDIVIDUAL');
  assert.equal(inventory.outcomes[0].scope, 'SPECIFIC');
  assert.deepEqual(inventory.outcomes[0].facets, ['COMPULSORY']);
  const accepted = reconcile(aliasQuery, [childIssue(subject, 'CHECK_ELIGIBILITY')]);
  const child = accepted.issuePlan.issues.find(item => item.subject === subject);
  assert.deepEqual(child?.mappedTopicIds, [CPF_RELIEF], `${subject}: mapped evidence stays on the child`);
  assert.deepEqual(child?.routingTopicIds, [RELIEF_PARENT], `${subject}: exact alias can own the parent route`);

  for (const [label, wrongIssue] of [
    ['operation', childIssue(subject, 'EXPLAIN_RULE')],
    ['population', childIssue(subject, 'CHECK_ELIGIBILITY', { population: 'EMPLOYEE' })],
    ['scope', childIssue('individual personal tax relief on voluntary CPF contributions', 'CHECK_ELIGIBILITY')]
  ]) {
    const denied = reconcile(aliasQuery, [wrongIssue]);
    assertRoutingParentResidual(denied, `${subject}: wrong ${label}`);
    assertNoRoutingOwnership(denied, `${subject}: wrong ${label}`);
  }
}

// Any unowned recognized outcome closes the routing exception, including same-topic employer/employee omissions.
const missingEmployer = reconcile(fixtureQuestion, [childIssue()]);
assertRoutingParentResidual(missingEmployer, 'omitted employer contribution');
assert.ok(missingEmployer.issuePlan.issues.some(item => item.unresolvedReason === 'UNASSIGNED_QUERY_TOPIC' &&
  item.mappedTopicIds.includes(CPF_CONTRIBUTIONS)), 'the omitted employer request stays residual');

const combinedPartyQuestion = 'What can they claim for personal tax relief on compulsory CPF, and how much CPF do the employee and employer contribute?';
const omittedEmployee = reconcile(combinedPartyQuestion, [childIssue(), employerIssue()]);
assertRoutingParentResidual(omittedEmployee, 'omitted employee contribution in a dual-party request');
assertNoRoutingOwnership(omittedEmployee, 'dual-party request with omitted employee outcome');

const duplicateEmployerQuestion = 'Explain personal tax relief on compulsory CPF, and How much CPF must the employer contribute, and How much CPF must the employer contribute?';
const duplicateEmployer = reconcile(duplicateEmployerQuestion, [
  childIssue('personal tax relief on compulsory CPF', 'EXPLAIN_RULE'), employerIssue()
]);
assertRoutingParentResidual(duplicateEmployer, 'duplicate employer asks cannot reuse one semantic owner');
assertNoRoutingOwnership(duplicateEmployer, 'duplicate employer asks');

// Invalid authority/population, an absent child, and unsupported text each fail closed.
const wrongAuthorityIssues = proof.rows[0].rawMock.issues.map(item => item.subject === proof.rows[0].subject
  ? { ...item, governingAuthorities: ['CPF'] }
  : item);
const wrongAuthority = reconcileQuestionUnderstanding(fixtureQuestion, classifyQuestion(fixtureQuestion), {
  mode: 'SEMANTIC_INTERPRETATION', interpretation: { ...proof.rows[0].rawMock, issues: wrongAuthorityIssues }
});
assertNoRoutingOwnership(wrongAuthority, 'wrong authority');
assert.equal(wrongAuthority.issuePlan.hasUnmappedResidual, true, 'an invalid IRAS/CPF authority pairing cannot consume routing residuals');

const wrongPopulation = reconcile(fixtureQuestion, [employerIssue(), childIssue('individual income tax relief for compulsory CPF', 'CHECK_ELIGIBILITY', {
  population: 'EMPLOYER'
})]);
assertRoutingParentResidual(wrongPopulation, 'wrong relief population');
assertNoRoutingOwnership(wrongPopulation, 'wrong relief population');

const absentChild = reconcile(fixtureQuestion, [employerIssue(), childIssue('unclassified compulsory relief')]);
assertRoutingParentResidual(absentChild, 'absent mapped child');
assertNoRoutingOwnership(absentChild, 'absent mapped child');

const unknownMappedChild = reconcile('Can I claim personal tax relief on my compulsory CPF contributions?', [
  childIssue('personal tax relief eligibility for compulsory CPF contributions', 'CHECK_ELIGIBILITY')
]);
assertRoutingParentResidual(unknownMappedChild, 'unknown child subject descriptor');
const unknownMappedIssue = unknownMappedChild.issuePlan.issues.find(item => item.subject === 'personal tax relief eligibility for compulsory CPF contributions');
assert.ok(unknownMappedIssue?.mappedTopicIds.includes(CPF_RELIEF), 'the existing resolver recognizes the child topic');
assert.ok(!unknownMappedIssue?.mappedTopicIds.includes(RELIEF_PARENT), 'unknown child wording cannot directly consume the parent');
assertNoRoutingOwnership(unknownMappedChild, 'unknown child subject descriptor');

const unknownScopeQuery = 'Explain personal tax relief for voluntary CPF contributions.';
const unknownScope = reconcile(unknownScopeQuery, [childIssue('CPF relief', 'EXPLAIN_RULE')]);
assert.equal(inventoryRawRequest(unknownScopeQuery).fullyConsumed, false);
assertRoutingParentResidual(unknownScope, 'unsupported relief scope');
assertNoRoutingOwnership(unknownScope, 'unsupported relief scope');

const unsupportedSuffixQuery = `${fixtureQuestion} Also explain the special exemption.`;
const unsupportedSuffix = reconcile(unsupportedSuffixQuery, [employerIssue(), childIssue()]);
assert.equal(inventoryRawRequest(unsupportedSuffixQuery).fullyConsumed, false);
assertRoutingParentResidual(unsupportedSuffix, 'unsupported trailing request');
assertNoRoutingOwnership(unsupportedSuffix, 'unsupported trailing request');

const lowConfidenceQuery = 'Can I claim personal tax relief on my compulsory CPF contributions?';
const lowConfidence = reconcile(lowConfidenceQuery, [
  childIssue('personal tax relief on compulsory CPF contributions', 'CHECK_ELIGIBILITY')
], { confidence: 0.71 });
assert.equal(lowConfidence.issuePlan.source, 'TAXONOMY_FALLBACK', 'low root confidence cannot establish semantic ownership');
assert.equal(lowConfidence.issuePlan.coverageEstablished, false);
assert.equal(lowConfidence.issuePlan.hasUnmappedResidual, true);
assert.ok(lowConfidence.issuePlan.issues.some(item => item.mappedTopicIds.includes(RELIEF_PARENT)),
  'the taxonomy fallback retains the independently recognized umbrella');
assertNoRoutingOwnership(lowConfidence, 'root confidence below 0.72');

const lowConfidenceChildOnly = reconcile('Explain CPF relief for employees.', [
  childIssue('CPF relief for employees', 'EXPLAIN_RULE')
], { confidence: 0.71 });
assert.equal(lowConfidenceChildOnly.issuePlan.source, 'TAXONOMY_FALLBACK',
  'a low-confidence root cannot establish semantic issue-plan ownership for a child-only question');
assert.equal(lowConfidenceChildOnly.issuePlan.coverageEstablished, false,
  'taxonomy fallback remains conservative when the root semantic confidence is below threshold');
assert.ok(lowConfidenceChildOnly.issuePlan.issues.every(item => !item.routingTopicIds?.includes(RELIEF_PARENT)),
  'a child-only low-confidence question cannot own the umbrella routing parent');
assert.ok(!lowConfidenceChildOnly.issuePlan.issues.some(item =>
  item.unresolvedReason === 'UNASSIGNED_QUERY_TOPIC' && item.mappedTopicIds.includes(RELIEF_PARENT)),
  'a child-only question does not create an umbrella residual');

const fallback = reconcileQuestionUnderstanding(lowConfidenceQuery, classifyQuestion(lowConfidenceQuery), {
  mode: 'DETERMINISTIC_FALLBACK', interpretation: understanding([
    childIssue('personal tax relief on compulsory CPF contributions', 'CHECK_ELIGIBILITY')
  ]).interpretation
});
assert.equal(fallback.issuePlan.source, 'TAXONOMY_FALLBACK');
assert.equal(fallback.issuePlan.hasUnmappedResidual, true);
assertNoRoutingOwnership(fallback, 'deterministic fallback');

console.log('Umbrella ownership routing regression passed.');

function resultIssues(result) {
  return result.issuePlan.issues;
}
