import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { classifyQuestion } from '../../src/classification/questionClassifier.ts';
import {
  reconcileQuestionUnderstanding,
  validateSemanticQuestionInterpretation
} from '../../src/services/semanticQuestionUnderstanding.ts';
import {
  analyzeRequestedTopicScope,
  proveRequestedTopicOwnership
} from '../../src/services/requestedTopicOwnership.ts';
import {
  describeRawRequestSubject,
  effectiveRawRequestSubjectFacets,
  inventoryRawRequest
} from '../../src/services/rawRequestInventory.ts';
import { buildAuthorityWorkstreams } from '../../src/services/authorityWorkstreams.ts';

const retainedProof = JSON.parse(readFileSync(new URL(
  '../../docs/evaluation/multi-authority-workstreams/iras-first-targeted-acceptance-2026-10-04-v4/routing-classification-proof.json',
  import.meta.url
), 'utf8'));
const retainedQuery = retainedProof.question;
const unknownRoot = retainedProof.rows[1].rawMock;

const issue = (subject, overrides = {}) => ({
  subject,
  population: 'INDIVIDUAL',
  domain: 'IRAS_INCOME_TAX',
  governingAuthorities: ['IRAS'],
  contextualAuthorities: [],
  operation: 'CHECK_ELIGIBILITY',
  mappedTopicIds: [],
  evidenceRequirement: 'AUTHORITATIVE_SOURCE_AND_CASE_FACTS',
  confidence: 0.96,
  ...overrides
});

function reconcile(query, issues, root = unknownRoot) {
  const interpretation = validateSemanticQuestionInterpretation({
    ...root,
    domain: 'UNKNOWN',
    population: 'UNKNOWN',
    authorityCandidates: ['UNKNOWN'],
    primarySubject: issues.map(item => item.subject).join(' and '),
    requestedOperation: 'OTHER',
    issues
  }, query);
  assert.ok(interpretation, `The test semantic fixture must validate for: ${query}`);
  return reconcileQuestionUnderstanding(query, classifyQuestion(query), {
    mode: 'SEMANTIC_INTERPRETATION',
    interpretation
  });
}

function assertPartition(query, analysis) {
  assert.equal(analysis.spans[0]?.start ?? 0, 0, 'Source partition starts at the original query start.');
  assert.equal(analysis.spans.at(-1)?.end ?? 0, query.length, 'Source partition ends at the original query end.');
  let cursor = 0;
  for (const span of analysis.spans) {
    assert.equal(span.start, cursor, 'Spans are contiguous and do not overlap.');
    assert.ok(span.end > span.start, 'Every span consumes source text.');
    cursor = span.end;
  }
  assert.equal(analysis.spans.map(span => query.slice(span.start, span.end)).join(''), query,
    'Spans reproduce the original bytes, including whitespace and numeric punctuation.');
}

// Four retained raw mocks are reused unchanged. Each now maps only its actual
// IRAS child and separate CPF employer calculation; the umbrella is routing-only.
for (const retainedRow of retainedProof.rows) {
  const retainedInterpretation = validateSemanticQuestionInterpretation(retainedRow.rawMock, retainedQuery);
  assert.ok(retainedInterpretation, `The retained ${retainedRow.rootMode} raw mock validates unchanged.`);
  assert.equal(retainedInterpretation.domain, retainedRow.rawMock.domain);
  assert.equal(retainedInterpretation.population, retainedRow.rawMock.population);
  assert.equal(retainedInterpretation.requestedOperation, retainedRow.rawMock.requestedOperation);
  const result = reconcileQuestionUnderstanding(retainedQuery, classifyQuestion(retainedQuery), {
    mode: 'SEMANTIC_INTERPRETATION',
    interpretation: retainedInterpretation
  });
  assert.equal(result.issuePlan.issues.length, 2, `Retained ${retainedRow.rootMode} fixture has two semantic issues.`);
  assert.equal(result.issuePlan.coverageEstablished, true, `Retained ${retainedRow.rootMode} fixture is fully owned.`);
  assert.equal(result.issuePlan.hasUnmappedResidual, false);
  const relief = result.issuePlan.issues.find(item => item.domain === 'IRAS_INCOME_TAX');
  const employer = result.issuePlan.issues.find(item => item.domain === 'CPF_PAYROLL');
  assert.deepEqual(relief?.mappedTopicIds, ['iras-individual-cpf-relief']);
  assert.deepEqual(relief?.routingTopicIds, ['iras-individual-reliefs']);
  assert.deepEqual(employer?.mappedTopicIds, ['cpf_contribution_rates']);
  assert.equal(employer?.operation, 'CALCULATE');
  assert.equal(employer?.routingTopicIds, undefined);
}

const partitionQueries = [
  retainedQuery,
  'For someone earning SGD 6000.25 a month, can they claim personal tax relief on compulsory CPF contributions?',
  'How much personal tax relief can I claim for compulsory CPF contributions?',
  'Explain SRS contribution relief.',
  'Explain individual tax relief categories and explain CPF relief for employees?'
];
for (const query of partitionQueries) {
  const analysis = analyzeRequestedTopicScope(query);
  assert.equal(analysis.complete, true, `Supported grammar partitions: ${query}`);
  assertPartition(query, analysis);
  // Re-run after a different input to guard against shared RegExp lastIndex state.
  assert.equal(analyzeRequestedTopicScope(query).complete, true, `Parser remains stable across repeated calls: ${query}`);
}

const narrowCpfQuery = 'Can I claim personal tax relief on my compulsory CPF contributions?';
const narrow = reconcile(narrowCpfQuery, [issue('individual personal tax relief on compulsory CPF contributions')]);
assert.equal(narrow.issuePlan.coverageEstablished, true, 'A represented narrow CPF request is complete.');
assert.deepEqual(narrow.issuePlan.issues[0].mappedTopicIds, ['iras-individual-cpf-relief']);
assert.deepEqual(narrow.issuePlan.issues[0].routingTopicIds, ['iras-individual-reliefs']);
const whitespaceNarrowCpf = reconcile(`  ${narrowCpfQuery}  `, [issue('individual personal tax relief on compulsory CPF contributions')]);
assert.equal(whitespaceNarrowCpf.issuePlan.coverageEstablished, true,
  'Leading/trailing whitespace and terminal punctuation do not break exact CPF source-span matching.');

const salaryEmployeeReliefQuery = 'For someone earning SGD 6,000 a month, what can they claim for personal tax relief on compulsory CPF, and what does the employer have to pay into CPF?';
const salaryEmployeeRelief = reconcile(salaryEmployeeReliefQuery, [
  issue('employee personal tax relief eligibility for compulsory CPF', {
    population: 'EMPLOYEE', operation: 'CHECK_ELIGIBILITY'
  }),
  issue('employer compulsory CPF contribution amount', {
    population: 'EMPLOYER', domain: 'CPF_PAYROLL', governingAuthorities: ['CPF'], operation: 'CALCULATE'
  })
]);
assert.equal(salaryEmployeeRelief.issuePlan.coverageEstablished, true,
  'A salary fact plus the separately requested employer obligation bounds the individual-to-employee relief refinement.');

const noSalaryContextQuery = 'What can they claim for personal tax relief on compulsory CPF, and what does the employer have to pay into CPF?';
const noSalaryContext = reconcile(noSalaryContextQuery, [
  issue('employee personal tax relief eligibility for compulsory CPF', { population: 'EMPLOYEE', operation: 'CHECK_ELIGIBILITY' }),
  issue('employer compulsory CPF contribution amount', {
    population: 'EMPLOYER', domain: 'CPF_PAYROLL', governingAuthorities: ['CPF'], operation: 'CALCULATE'
  })
]);
assert.equal(noSalaryContext.issuePlan.coverageEstablished, false,
  'An employer request without the explicit salary frame cannot refine an individual relief request to an employee.');

const noEmployerContextQuery = 'For someone earning SGD 6,000 a month, what can they claim for personal tax relief on compulsory CPF?';
const noEmployerContext = reconcile(noEmployerContextQuery, [
  issue('employee personal tax relief eligibility for compulsory CPF', { population: 'EMPLOYEE', operation: 'CHECK_ELIGIBILITY' })
]);
assert.equal(noEmployerContext.issuePlan.coverageEstablished, false,
  'A salary frame without a separate employer CPF obligation cannot refine an individual relief request to an employee.');

const salaryEmployeeInventory = inventoryRawRequest(salaryEmployeeReliefQuery);
const salaryEmployeeReliefOutcome = salaryEmployeeInventory.outcomes.find(outcome => outcome.identity === 'CPF_RELIEF');
const salaryEmployeeReliefDescriptor = describeRawRequestSubject('employee personal tax relief eligibility for compulsory CPF');
assert.ok(salaryEmployeeReliefOutcome && salaryEmployeeReliefDescriptor);
assert.deepEqual(effectiveRawRequestSubjectFacets(salaryEmployeeReliefOutcome, salaryEmployeeReliefDescriptor,
  'EMPLOYEE', 'CHECK_ELIGIBILITY', salaryEmployeeInventory), ['COMPULSORY']);
assert.equal(effectiveRawRequestSubjectFacets(salaryEmployeeReliefOutcome, salaryEmployeeReliefDescriptor,
  'EMPLOYEE', 'CHECK_ELIGIBILITY'), undefined,
  'Without the full raw salary-and-employer context, INDIVIDUAL cannot be widened to EMPLOYEE.');
assert.equal(effectiveRawRequestSubjectFacets(salaryEmployeeReliefOutcome,
  describeRawRequestSubject('CPF relief for employees'), 'EMPLOYEE', 'CHECK_ELIGIBILITY', salaryEmployeeInventory), undefined,
  'The employee-beneficiary descriptor cannot borrow the bounded individual-claimant refinement.');
assert.equal(effectiveRawRequestSubjectFacets(salaryEmployeeReliefOutcome, salaryEmployeeReliefDescriptor,
  'EMPLOYEE', 'CALCULATE', salaryEmployeeInventory), undefined,
  'The bounded alias is eligibility-only.');

const wrongBeneficiaryInventory = structuredClone(salaryEmployeeInventory);
wrongBeneficiaryInventory.outcomes[0].beneficiary = 'EMPLOYEE';
assert.equal(effectiveRawRequestSubjectFacets(wrongBeneficiaryInventory.outcomes[0], salaryEmployeeReliefDescriptor,
  'EMPLOYEE', 'CHECK_ELIGIBILITY', wrongBeneficiaryInventory), undefined,
  'An employee-beneficiary raw outcome cannot masquerade as individual relief.');
const wrongReliefFacetInventory = structuredClone(salaryEmployeeInventory);
wrongReliefFacetInventory.outcomes[0].facets = [];
assert.equal(effectiveRawRequestSubjectFacets(wrongReliefFacetInventory.outcomes[0], salaryEmployeeReliefDescriptor,
  'EMPLOYEE', 'CHECK_ELIGIBILITY', wrongReliefFacetInventory), undefined,
  'The bounded refinement requires the explicit compulsory-contribution facet.');
const wrongEmployerActorInventory = structuredClone(salaryEmployeeInventory);
wrongEmployerActorInventory.outcomes[1].actors = ['EMPLOYEE'];
assert.equal(effectiveRawRequestSubjectFacets(wrongEmployerActorInventory.outcomes[0], salaryEmployeeReliefDescriptor,
  'EMPLOYEE', 'CHECK_ELIGIBILITY', wrongEmployerActorInventory), undefined,
  'The supporting second atom must explicitly belong to the employer.');
const wrongEmployerOperationInventory = structuredClone(salaryEmployeeInventory);
wrongEmployerOperationInventory.outcomes[1].operation = 'EXPLAIN_RULE';
assert.equal(effectiveRawRequestSubjectFacets(wrongEmployerOperationInventory.outcomes[0], salaryEmployeeReliefDescriptor,
  'EMPLOYEE', 'CHECK_ELIGIBILITY', wrongEmployerOperationInventory), undefined,
  'The supporting employer atom must be the supported must/pay calculation.');
const wrongEmployerFacetInventory = structuredClone(salaryEmployeeInventory);
wrongEmployerFacetInventory.outcomes[1].facets = [];
assert.equal(effectiveRawRequestSubjectFacets(wrongEmployerFacetInventory.outcomes[0], salaryEmployeeReliefDescriptor,
  'EMPLOYEE', 'CHECK_ELIGIBILITY', wrongEmployerFacetInventory), undefined,
  'The supporting employer atom must retain its explicit obligation facet.');

const employeeRelief = reconcile(narrowCpfQuery, [issue('CPF relief for employees')]);
assert.equal(employeeRelief.issuePlan.coverageEstablished, false,
  'An employee-specific relief description cannot own a compulsory-contribution request for the individual claimant.');

const namedSrs = reconcile('Explain SRS contribution relief.', [issue('SRS contribution relief', { operation: 'EXPLAIN_RULE' })]);
assert.equal(namedSrs.issuePlan.coverageEstablished, true, 'Registry noun phrases generalize beyond CPF relief.');
assert.ok(namedSrs.issuePlan.issues[0].mappedTopicIds.includes('iras-individual-srs-relief'));

const repeatedCpf = 'Explain personal tax relief on compulsory CPF contributions and explain personal tax relief on compulsory CPF contributions?';
const repeated = reconcile(repeatedCpf, [issue('individual personal tax relief on compulsory CPF contributions', { operation: 'EXPLAIN_RULE' })]);
assert.equal(repeated.issuePlan.coverageEstablished, false,
  'One semantic issue cannot be reused as owner of two repeated request atoms.');
assertPartition(repeatedCpf, analyzeRequestedTopicScope(repeatedCpf));

const unsupportedRawCouldQuery = 'Could I claim personal tax relief on my compulsory CPF contributions?';
const unsupportedRawCould = reconcile(unsupportedRawCouldQuery, [
  issue('CPF relief for employees', {
    population: 'EMPLOYEE', operation: 'CHECK_ELIGIBILITY', mappedTopicIds: ['iras-individual-cpf-relief']
  })
]);
assert.equal(unsupportedRawCould.issuePlan.coverageEstablished, false,
  'An unsupported Could-I raw form cannot be owned by an employee-beneficiary descriptor.');
assertPartition(unsupportedRawCouldQuery, analyzeRequestedTopicScope(unsupportedRawCouldQuery));

const unsupportedMandatoryQuery = 'Can I claim personal tax relief for mandatory CPF contributions?';
const unsupportedMandatory = reconcile(unsupportedMandatoryQuery, [
  issue('individual personal income tax relief for compulsory CPF contributions', {
    operation: 'CHECK_ELIGIBILITY', mappedTopicIds: ['iras-individual-cpf-relief']
  })
]);
assert.equal(unsupportedMandatory.issuePlan.coverageEstablished, false,
  'A mandatory CPF variant without a supported raw outcome cannot be owned by an unknown descriptor.');
assertPartition(unsupportedMandatoryQuery, analyzeRequestedTopicScope(unsupportedMandatoryQuery));

const representedBroadQuery = 'Explain individual tax relief categories and explain CPF relief for employees?';
const representedBroad = reconcile(representedBroadQuery, [
  issue('individual tax relief categories', { operation: 'EXPLAIN_RULE' }),
  issue('CPF relief for employees', { operation: 'EXPLAIN_RULE', population: 'EMPLOYEE' })
]);
assert.equal(representedBroad.issuePlan.coverageEstablished, true,
  'A separately represented generic relief request and a child request are both accountable.');
assert.deepEqual(representedBroad.issuePlan.issues.find(item => item.mappedTopicIds.includes('iras-individual-reliefs'))?.mappedTopicIds,
  ['iras-individual-reliefs']);

const mixedSrsAndCpfQuery = 'Explain CPF relief for employees and explain SRS contribution relief.';
const mixedSrsAndCpf = reconcile(mixedSrsAndCpfQuery, [
  issue('CPF relief for employees', { operation: 'EXPLAIN_RULE', population: 'EMPLOYEE' }),
  issue('SRS contribution relief', { operation: 'EXPLAIN_RULE' })
]);
assert.equal(mixedSrsAndCpf.issuePlan.coverageEstablished, true,
  'A supported CPF atom keeps its independent raw descriptor proof when the same query includes supported SRS grammar.');
const srsFirstAndCpfQuery = 'Explain SRS contribution relief and explain personal tax relief for compulsory CPF contributions.';
const srsFirstAndCpf = reconcile(srsFirstAndCpfQuery, [
  issue('SRS contribution relief', { operation: 'EXPLAIN_RULE' }),
  issue('individual personal tax relief on compulsory CPF contributions', { operation: 'EXPLAIN_RULE' })
]);
assert.equal(srsFirstAndCpf.issuePlan.coverageEstablished, true,
  'The exact CPF span remains independently verifiable when unsupported pilot inventory stops at a supported SRS sibling.');
const alteredCpfFacetQuery = 'Explain individual tax relief categories and explain personal tax relief for compulsory CPF contributions?';
const alteredCpfFacet = reconcile(alteredCpfFacetQuery, [
  issue('individual tax relief categories', { operation: 'EXPLAIN_RULE' }),
  issue('personal CPF tax relief', { operation: 'EXPLAIN_RULE' })
]);
assert.equal(alteredCpfFacet.issuePlan.coverageEstablished, false,
  'A broad overview plus a CPF issue that drops the requested compulsory facet remains incomplete.');

const parentOnly = reconcile('Explain individual tax relief categories.', [
  issue('individual tax relief categories', { operation: 'EXPLAIN_RULE' })
]);
assert.equal(parentOnly.issuePlan.coverageEstablished, true, 'Generic parent-only baseline remains unchanged.');

// Original reviewer probes: narrow/canonical child subjects cannot absorb an
// omitted broad request or unsupported text merely because a parent is raw.
const reviewerProbes = [
  'What individual tax relief categories are available, plus explain CPF relief for employees?',
  'I need an overview of individual tax relief categories. Can I claim CPF relief for employees?',
  'Explain individual tax relief categories, including CPF relief for employees?'
];
for (const childSubject of ['CPF relief for employees', 'individual personal tax relief on compulsory CPF contributions']) {
  for (const query of reviewerProbes) {
    const probe = reconcile(query, [issue(childSubject, { operation: 'EXPLAIN_RULE' })]);
    assert.equal(probe.issuePlan.coverageEstablished, false, `Omitted broad/unsupported clause remains incomplete: ${query}`);
    assert.equal(probe.issuePlan.hasUnmappedResidual, true);
    assert.ok(probe.issuePlan.routingOwnershipFailure);
    assertPartition(query, analyzeRequestedTopicScope(query));
  }
}

const suffixProbes = [
  'Explain personal tax relief on compulsory CPF contributions together with other available reliefs.',
  'Explain personal tax relief on compulsory CPF contributions, covering SRS relief too.'
];
for (const childSubject of ['CPF relief for employees', 'individual personal tax relief on compulsory CPF contributions']) {
  for (const query of suffixProbes) {
    const withGenericSibling = reconcile(query, [
      issue('individual tax relief categories', { operation: 'EXPLAIN_RULE' }),
      issue(childSubject, { operation: 'EXPLAIN_RULE' })
    ]);
    assert.equal(withGenericSibling.issuePlan.issues.some(item => item.mappedTopicIds.includes('iras-individual-reliefs')), true,
      'The generic sibling can map the raw parent directly.');
    assert.equal(withGenericSibling.issuePlan.coverageEstablished, false,
      'An unsupported suffix vetoes coverage even when the generic sibling maps the parent.');
    assert.equal(withGenericSibling.issuePlan.hasUnmappedResidual, true);
    assert.equal(withGenericSibling.issuePlan.issues.some(item => item.routingTopicIds?.includes('iras-individual-reliefs')), false);
  }
}

for (const query of [
  'Please explain personal tax relief on compulsory CPF contributions.',
  'Explain personal tax relief on compulsory CPF contributions, and also check other reliefs.',
  'Explain personal tax relief on compulsory CPF contributions and explain it again.'
]) {
  const analysis = analyzeRequestedTopicScope(query);
  assert.equal(analysis.complete, false, `Unknown lead, connector, or unsupported second request fails closed: ${query}`);
  assertPartition(query, analysis);
}

const omittedRelief = reconcile('Explain personal tax relief cap and explain CPF relief for employees?', [
  issue('CPF relief for employees', { operation: 'EXPLAIN_RULE' })
]);
assert.equal(omittedRelief.issuePlan.coverageEstablished, false, 'An omitted cap request remains unresolved.');
const omittedSrs = reconcile('Explain CPF relief for employees and explain SRS contribution relief.', [
  issue('CPF relief for employees', { operation: 'EXPLAIN_RULE' })
]);
assert.equal(omittedSrs.issuePlan.coverageEstablished, false, 'An omitted different child relief remains unresolved.');
const omittedEmployer = reconcile(retainedQuery, [issue('individual personal tax relief claim for compulsory CPF contributions')], retainedProof.rows[2].rawMock);
assert.equal(omittedEmployer.issuePlan.coverageEstablished, false, 'A child issue cannot own the separate employer calculation.');

const wrongOperation = reconcile('How much personal tax relief can I claim for compulsory CPF contributions?', [
  issue('individual personal tax relief on compulsory CPF contributions', { operation: 'CHECK_ELIGIBILITY' }),
  issue('individual tax relief categories', { operation: 'EXPLAIN_RULE' })
]);
assert.equal(wrongOperation.issuePlan.coverageEstablished, false, 'Eligibility or explanation issues cannot satisfy a calculation atom.');

const hintedOnly = reconcile('Explain individual tax relief categories.', [
  issue('individual tax relief categories', { operation: 'EXPLAIN_RULE' }),
  issue('CPF relief for employees', { operation: 'EXPLAIN_RULE', mappedTopicIds: ['iras-individual-cpf-relief'] })
]);
assert.equal(hintedOnly.issuePlan.coverageEstablished, false,
  'A provider topic hint cannot establish child ownership without independent raw support.');
assert.equal(hintedOnly.issuePlan.issues.some(item => item.routingTopicIds?.includes('iras-individual-reliefs')), false);

const grammarRecognizedButNotRaw = reconcile('Explain employee CPF relief.', [
  issue('employee CPF relief', { operation: 'EXPLAIN_RULE' }),
  issue('individual tax relief categories', { operation: 'EXPLAIN_RULE' })
]);
assert.equal(grammarRecognizedButNotRaw.issuePlan.coverageEstablished, false,
  'A registry-recognized child noun phrase without an independently recognized raw child topic fails closed.');

const rawIds = new Set(['iras-individual-reliefs', 'iras-individual-cpf-relief']);
const parsedCpf = analyzeRequestedTopicScope('Can I claim personal tax relief on my compulsory CPF contributions?').requestAtoms[0];
assert.ok(parsedCpf);
for (const incompatible of [
  { mappedTopicIds: ['iras-individual-cpf-relief'], domain: 'IRAS_GST', population: 'INDIVIDUAL', governingAuthorities: ['IRAS'], operation: 'CHECK_ELIGIBILITY' },
  { mappedTopicIds: ['iras-individual-cpf-relief'], domain: 'IRAS_INCOME_TAX', population: 'INDIVIDUAL', governingAuthorities: ['CPF'], operation: 'CHECK_ELIGIBILITY' },
  { mappedTopicIds: ['iras-individual-cpf-relief'], domain: 'IRAS_INCOME_TAX', population: 'EMPLOYER', governingAuthorities: ['IRAS'], operation: 'CHECK_ELIGIBILITY' }
]) {
  const proof = proveRequestedTopicOwnership(narrowCpfQuery, [incompatible], rawIds, ['iras-individual-cpf-relief']);
  assert.equal(proof.complete, false, 'A topic ID alone cannot bypass wrong authority, domain, or population.');
}

const employerCpfQuery = 'What does the employer have to pay into CPF?';
const employerCpfIds = new Set(['cpf_contribution_rates']);
const employerCpfOwner = {
  subject: 'employer CPF contribution amount', mappedTopicIds: ['cpf_contribution_rates'], domain: 'CPF_PAYROLL',
  population: 'EMPLOYER', governingAuthorities: ['CPF'], operation: 'CALCULATE'
};
const employerAmountProof = proveRequestedTopicOwnership(
  employerCpfQuery, [employerCpfOwner], employerCpfIds, []
);
assert.equal(employerAmountProof.complete, true,
  'An exact employer amount descriptor can own the supported required-payment calculation.');
const employerObligationProof = proveRequestedTopicOwnership(
  employerCpfQuery, [{ ...employerCpfOwner, subject: 'employer CPF contribution obligation' }], employerCpfIds, []
);
assert.equal(employerObligationProof.complete, true,
  'An explicit obligation descriptor owns the same must/pay calculation with its obligation facet.');
const employerWrongOperationProof = proveRequestedTopicOwnership(
  employerCpfQuery, [{ ...employerCpfOwner, operation: 'EXPLAIN_RULE' }], employerCpfIds, []
);
assert.equal(employerWrongOperationProof.complete, false,
  'The amount alias cannot own the required-payment calculation under an explanation operation.');
const employerWrongActorProof = proveRequestedTopicOwnership(
  employerCpfQuery, [{ ...employerCpfOwner, population: 'EMPLOYEE' }], employerCpfIds, []
);
assert.equal(employerWrongActorProof.complete, false,
  'The employer-specific amount alias cannot own another actor’s contribution request.');
const repeatedEmployerQuery = `${employerCpfQuery.slice(0, -1)}, and ${employerCpfQuery.slice(0, -1)}?`;
const repeatedEmployerProof = proveRequestedTopicOwnership(
  repeatedEmployerQuery, [employerCpfOwner], employerCpfIds, []
);
assert.equal(repeatedEmployerProof.complete, false,
  'One employer CPF issue cannot own two repeated employer contribution requests.');
const duplicateEmployerProof = proveRequestedTopicOwnership(
  employerCpfQuery, [employerCpfOwner, { ...employerCpfOwner }], employerCpfIds, []
);
assert.equal(duplicateEmployerProof.complete, false,
  'A request with two equally compatible semantic owners fails closed as ambiguous.');
const unknownCpfDescriptorProof = proveRequestedTopicOwnership(
  narrowCpfQuery,
  [{ ...issue('unrecognized compulsory CPF tax allowance', { operation: 'CHECK_ELIGIBILITY', mappedTopicIds: ['iras-individual-cpf-relief'] }), subject: 'unrecognized compulsory CPF tax allowance' }],
  rawIds,
  ['iras-individual-cpf-relief']
);
assert.equal(unknownCpfDescriptorProof.complete, false,
  'An unknown CPF issue descriptor cannot claim a supported raw CPF request.');

// The inferred umbrella is not substantive evidence scope. Exercise the actual
// workstream request path with in-memory providers and inspect its topic IDs.
const retainedResult = reconcile(retainedQuery, retainedProof.rows[2].rawMock.issues, retainedProof.rows[2].rawMock);
const capturedEvidenceRequests = [];
const captureProvider = authority => ({
  authority,
  async retrieve(request) {
    capturedEvidenceRequests.push(request);
    return { candidates: [] };
  }
});
await buildAuthorityWorkstreams(retainedQuery, retainedResult.issuePlan, {
  providers: { IRAS: captureProvider('IRAS'), CPF: captureProvider('CPF') },
  localOnly: true
});
const irasEvidenceRequest = capturedEvidenceRequests.find(request => request.issue.domain === 'IRAS_INCOME_TAX');
assert.deepEqual(irasEvidenceRequest?.retrievalIntent.topicIds, ['iras-individual-cpf-relief'],
  'Evidence retrieval receives the mapped child topic only, never the inferred routing parent.');

console.log('Routing clause ownership: bounded partitions and per-atom ownership passed.');
