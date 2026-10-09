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
for (const childSubject of ['CPF relief for employees', 'individual personal tax relief on compulsory CPF contributions']) {
  const narrow = reconcile(narrowCpfQuery, [issue(childSubject)]);
  assert.equal(narrow.issuePlan.coverageEstablished, true, `A represented narrow CPF request is complete: ${childSubject}`);
  assert.deepEqual(narrow.issuePlan.issues[0].mappedTopicIds, ['iras-individual-cpf-relief']);
  assert.deepEqual(narrow.issuePlan.issues[0].routingTopicIds, ['iras-individual-reliefs']);
}

const employeeRelief = reconcile(narrowCpfQuery, [issue('CPF relief for employees', { population: 'EMPLOYEE' })]);
assert.equal(employeeRelief.issuePlan.coverageEstablished, true,
  'A directly mapped employee relief issue can own an individual CPF eligibility request.');

const namedSrs = reconcile('Explain SRS contribution relief.', [issue('SRS contribution relief', { operation: 'EXPLAIN_RULE' })]);
assert.equal(namedSrs.issuePlan.coverageEstablished, true, 'Registry noun phrases generalize beyond CPF relief.');
assert.ok(namedSrs.issuePlan.issues[0].mappedTopicIds.includes('iras-individual-srs-relief'));

const repeatedCpf = 'Explain personal tax relief on compulsory CPF contributions and explain personal tax relief on compulsory CPF contributions?';
const repeated = reconcile(repeatedCpf, [issue('individual personal tax relief on compulsory CPF contributions', { operation: 'EXPLAIN_RULE' })]);
assert.equal(repeated.issuePlan.coverageEstablished, true, 'Repeated child requests are parsed and owned occurrence by occurrence.');
assertPartition(repeatedCpf, analyzeRequestedTopicScope(repeatedCpf));

const representedBroadQuery = 'Explain individual tax relief categories and explain CPF relief for employees?';
const representedBroad = reconcile(representedBroadQuery, [
  issue('individual tax relief categories', { operation: 'EXPLAIN_RULE' }),
  issue('CPF relief for employees', { operation: 'EXPLAIN_RULE' })
]);
assert.equal(representedBroad.issuePlan.coverageEstablished, true,
  'A separately represented generic relief request and a child request are both accountable.');
assert.deepEqual(representedBroad.issuePlan.issues.find(item => item.mappedTopicIds.includes('iras-individual-reliefs'))?.mappedTopicIds,
  ['iras-individual-reliefs']);

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
