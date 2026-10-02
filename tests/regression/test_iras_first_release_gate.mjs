import assert from 'node:assert/strict';
import {
  AUTHORITY_COVERAGE_SCOPE,
  IRAS_FIRST_GAP_CODES,
  buildPerIssueScopeDiagnostics,
  evaluateIrasFirstCase,
  summarizeRuntimeIssueAssignments,
  summarizeIrasFirstAcceptance
} from '../evaluation/singapore/iras-first-release-contract.mjs';

function expectedIssue({ authority = 'IRAS', domain = 'IRAS_INCOME_TAX', operation = 'CHECK_ELIGIBILITY', population = 'INDIVIDUAL' } = {}) {
  return {
    id: 'expected-issue',
    subject: 'private fixture subject',
    matchAny: [['tax', 'relief']],
    population: [population],
    domain: [domain],
    governingAuthorities: [authority],
    contextualAuthoritiesAnyOf: [[]],
    operation: [operation]
  };
}

function runtimeFixture({
  authority = 'IRAS', domain = 'IRAS_INCOME_TAX', operation = 'CHECK_ELIGIBILITY', population = 'INDIVIDUAL',
  mapped = true, retrievalAttempted = true, evidence = true, unresolvedReason, routeAuthority = authority,
  routeDomain = authority === 'IRAS' ? 'IRAS_INDIVIDUAL_TAX' : domain, issueEvidenceStatus
} = {}) {
  const issueId = 'runtime-issue-private-id';
  const unresolved = unresolvedReason !== undefined;
  const planIssue = {
    id: issueId,
    status: unresolved ? 'UNRESOLVED' : 'MAPPED',
    unresolvedReason,
    mappedTopicIds: mapped ? ['private-topic-id'] : [],
    evidenceRequirement: operation === 'CHECK_ELIGIBILITY' && authority === 'IRAS'
      ? 'AUTHORITATIVE_SOURCE_AND_CASE_FACTS' : 'AUTHORITATIVE_SOURCE',
    population,
    governingAuthorities: [authority],
    operation,
    domain
  };
  const issue = {
    issueId,
    domain,
    population,
    operation,
    evidenceRequirement: planIssue.evidenceRequirement,
    governingAuthority: authority,
    evidenceStatus: issueEvidenceStatus || (evidence ? 'VERIFIED' : 'INSUFFICIENT'),
    applicationStatus: planIssue.evidenceRequirement === 'AUTHORITATIVE_SOURCE_AND_CASE_FACTS' ? 'UNRESOLVED' : 'NOT_REQUIRED',
    sources: evidence ? [{ id: 'private-source-id' }] : [],
    verifiedClaims: evidence ? [{ recordId: 'private-source-id' }] : [],
    lifecycle: {
      mapped, retrievalAttempted, evidenceFound: evidence, admitted: evidence,
      verified: evidence, covered: evidence
    },
    gaps: unresolvedReason ? [{ issueId, stage: 'mapped', code: unresolvedReason, subject: 'PRIVATE GAP SUBJECT' }] : []
  };
  const workstream = {
    authority: routeAuthority,
    domain: routeDomain,
    issues: [issue],
    gaps: issue.gaps
  };
  return {
    issuePlan: { coverageEstablished: !unresolved, hasUnmappedResidual: unresolved, issues: [planIssue] },
    runtime: {
      status: evidence && planIssue.evidenceRequirement === 'AUTHORITATIVE_SOURCE_AND_CASE_FACTS' ? 'CONDITIONAL'
        : evidence ? 'VERIFIED' : 'INSUFFICIENT',
      evidenceStatus: evidence ? 'VERIFIED' : 'INSUFFICIENT',
      workstreams: [workstream],
      gaps: issue.gaps
    },
    issueId
  };
}

function passingInput(overrides = {}) {
  const expected = expectedIssue(overrides.expected);
  const runtime = overrides.runtime?.issuePlan ? overrides.runtime : runtimeFixture(overrides.runtime);
  const evidenceRequirement = runtime.issuePlan.issues[0]?.evidenceRequirement || 'UNRESOLVED';
  const actualIssue = {
    subject: 'tax relief for CPF',
    population: overrides.actual?.population || 'INDIVIDUAL',
    domain: overrides.actual?.domain || 'IRAS_INCOME_TAX',
    governingAuthorities: overrides.actual?.governingAuthorities || ['IRAS'],
    contextualAuthorities: overrides.actual?.contextualAuthorities || [],
    operation: overrides.actual?.operation || 'CHECK_ELIGIBILITY',
    evidenceRequirement: overrides.actual?.evidenceRequirement || evidenceRequirement
  };
  const diagnostics = buildPerIssueScopeDiagnostics([actualIssue], runtime.issuePlan, runtime.runtime);
  const assignmentSummary = summarizeRuntimeIssueAssignments(
    [actualIssue], runtime.issuePlan, runtime.runtime.workstreams, runtime.runtime.gaps
  );
  const dimensions = {
    governingAuthority: true, contextualAuthority: true, domain: true, population: true, operation: true
  };
  const scoring = {
    expectedIssueCount: 1, predictedIssueCount: 1, matchedIssueCount: 1,
    completeQuestionIssueCoverage: true, operationCorrect: 1, operationMatched: 1,
    dimensionsCorrect: Object.fromEntries(Object.keys(dimensions).map(key => [key, 1]))
  };
  return {
    testCase: {
      expected: [expected], expectedRequiresUserSpecificFacts: overrides.expectedRequiresUserSpecificFacts ?? true,
      expectedWorkstreamsAnyOf: [['IRAS/IRAS_INDIVIDUAL_TAX']],
      ...(overrides.expectedCoverageOutcome ? { expectedCoverageOutcome: overrides.expectedCoverageOutcome } : {})
    },
    validInterpretation: overrides.validInterpretation ?? true,
    scoring,
    interpretation: { issues: [actualIssue], requiresUserSpecificFacts: overrides.requiresFacts ?? true },
    routing: {
      finalWorkstreamSetAccuracy: overrides.canonicalRouteCorrect ?? true,
      status: runtime.runtime.status,
      evidenceStatus: runtime.runtime.evidenceStatus,
      guardChecks: Object.hasOwn(overrides, 'guardChecks') ? overrides.guardChecks : {
        operationsPreserved: true,
        incompletePlanNotVerified: true,
        contextualAuthorityNotRouted: true,
        residualHasNoWorkstream: true,
        requiredApplicationStatusesUnresolved: true,
        unresolvedApplicationNotVerified: true
      },
      runtimeTimedOut: overrides.runtimeTimedOut ?? false,
      runtimeAssignmentIntegrity: assignmentSummary.runtimeAssignmentIntegrity,
      runtimeAssignmentCounts: assignmentSummary.runtimeAssignmentCounts,
      runtimeIssueScopeDiagnostics: overrides.diagnostics || diagnostics
    },
    production: overrides.production || { mode: 'SEMANTIC_INTERPRETATION' },
    capture: overrides.capture || { requestCount: 1, responseReceived: true },
    requestCount: 1,
    sourceHashesConsistent: true,
    fixtureHashesConsistent: true
  };
}

function evaluate(overrides) {
  return evaluateIrasFirstCase(passingInput(overrides));
}

assert.equal(AUTHORITY_COVERAGE_SCOPE.IRAS.state, 'RELEASE_REQUIRED');
assert.deepEqual(
  Object.fromEntries(Object.entries(AUTHORITY_COVERAGE_SCOPE).map(([authority, item]) => [authority, item.state])),
  {
    IRAS: 'RELEASE_REQUIRED', CPF: 'PARTIAL', MOM: 'PARTIAL', ACRA: 'PARTIAL', MAS: 'PARTIAL',
    ACCOUNTING_STANDARDS: 'PARTIAL', IFRS_FOUNDATION: 'PARTIAL', SSO: 'NOT_YET_COVERED', UNKNOWN: 'NOT_YET_COVERED'
  }
);
assert.equal(AUTHORITY_COVERAGE_SCOPE.IFRS_FOUNDATION.independentWorkstream, false,
  'IFRS Foundation remains an accounting alias, not a separate workstream');
assert.equal(AUTHORITY_COVERAGE_SCOPE.UNKNOWN.providerSupported, false);

const goodIras = evaluate();
assert.equal(goodIras.passed, true, 'IRAS passes only with mapped, retrieved, admitted, verified, covered evidence');

const irasNoTopic = runtimeFixture({ mapped: false, retrievalAttempted: false, evidence: false, unresolvedReason: 'NO_COVERAGE_TOPIC' });
assert.equal(evaluate({ runtime: irasNoTopic }).passed, false, 'NO_COVERAGE_TOPIC remains an IRAS blocker');

for (const wrongAuthority of ['CPF', 'MOM', 'ACCOUNTING_STANDARDS']) {
  const wrongRoute = runtimeFixture({ routeAuthority: wrongAuthority, routeDomain: 'UNKNOWN' });
  assert.equal(evaluate({ runtime: wrongRoute }).passed, false, `IRAS routed into ${wrongAuthority} fails`);
}

const wrongIrasArea = runtimeFixture({ routeAuthority: 'IRAS', routeDomain: 'IRAS_CORPORATE_TAX' });
assert.equal(evaluate({ runtime: wrongIrasArea }).passed, false,
  'a wrong canonical IRAS area fails even when the authority remains IRAS');

const irasGlobalGap = runtimeFixture();
irasGlobalGap.runtime.gaps = [{ issueId: 'issue-plan', authority: 'IRAS', domain: 'IRAS_INCOME_TAX',
  stage: 'covered', code: 'UNROUTED_MATERIAL_CONCEPT', subject: 'PRIVATE GLOBAL GAP LABEL' }];
assert.equal(evaluate({ runtime: irasGlobalGap }).passed, false,
  'an IRAS-scoped global routing gap remains a release blocker');
for (const code of ['IRAS_SCOPE_NOT_COVERED', 'NO_ADMITTED_EVIDENCE']) {
  const noOwnerGlobalIrasGap = runtimeFixture();
  noOwnerGlobalIrasGap.runtime.gaps = [{ authority: 'IRAS', domain: 'IRAS_INCOME_TAX',
    stage: 'verified', code, subject: 'PRIVATE OWNERLESS GAP LABEL' }];
  assert.equal(evaluate({ runtime: noOwnerGlobalIrasGap }).passed, false,
    `${code} without an issue id remains an IRAS release blocker`);
}
const rejectedCandidateWithCompleteEvidence = runtimeFixture();
rejectedCandidateWithCompleteEvidence.runtime.gaps = [{ issueId: 'issue-plan', authority: 'IRAS', domain: 'IRAS_INCOME_TAX',
  stage: 'retrievalAttempted', code: 'CANDIDATE_REJECTED', subject: 'PRIVATE REJECTED CANDIDATE LABEL' }];
assert.equal(evaluate({ runtime: rejectedCandidateWithCompleteEvidence }).passed, true,
  'a rejected candidate alone does not block independently admitted complete support');

const notRetrieved = runtimeFixture({ retrievalAttempted: false, evidence: false });
assert.equal(evaluate({ runtime: notRetrieved }).passed, false, 'IRAS retrieval must be attempted');

assert.equal(evaluate({ requiresFacts: false }).passed, false,
  'a case-specific IRAS eligibility request cannot pass with requiresUserSpecificFacts=false');

const nonIrasUnsupportedExpected = expectedIssue({ authority: 'ACCOUNTING_STANDARDS', domain: 'ACCOUNTING', operation: 'EXPLAIN_RULE', population: 'UNKNOWN' });
const nonIrasIssue = {
  subject: 'tax relief for CPF', population: 'UNKNOWN', domain: 'ACCOUNTING',
  governingAuthorities: ['ACCOUNTING_STANDARDS'], contextualAuthorities: [], operation: 'EXPLAIN_RULE',
  evidenceRequirement: 'AUTHORITATIVE_SOURCE'
};
const nonIrasRuntime = runtimeFixture({
  authority: 'ACCOUNTING_STANDARDS', domain: 'ACCOUNTING', operation: 'EXPLAIN_RULE', population: 'UNKNOWN',
  mapped: false, retrievalAttempted: false, evidence: false, unresolvedReason: 'NO_COVERAGE_TOPIC',
  routeAuthority: 'ACCOUNTING_STANDARDS', routeDomain: 'ACCOUNTING'
});
const nonIrasDiagnostic = buildPerIssueScopeDiagnostics([nonIrasIssue], nonIrasRuntime.issuePlan, nonIrasRuntime.runtime);
const nonIrasBase = passingInput({
  expected: { authority: 'ACCOUNTING_STANDARDS', domain: 'ACCOUNTING', operation: 'EXPLAIN_RULE', population: 'UNKNOWN' },
  runtime: nonIrasRuntime,
  actual: { domain: 'ACCOUNTING', population: 'UNKNOWN', governingAuthorities: ['ACCOUNTING_STANDARDS'], operation: 'EXPLAIN_RULE' },
  requiresFacts: false,
  expectedRequiresUserSpecificFacts: false
});
nonIrasBase.testCase.expectedCoverageOutcome = 'UNSUPPORTED';
nonIrasBase.testCase.expected = [nonIrasUnsupportedExpected];
nonIrasBase.testCase.expectedWorkstreamsAnyOf = [['ACCOUNTING_STANDARDS/ACCOUNTING']];
nonIrasBase.routing.runtimeIssueScopeDiagnostics = nonIrasDiagnostic;
assert.equal(evaluateIrasFirstCase(nonIrasBase).passed, true,
  'an explicit unsupported non-IRAS issue stays visible and does not block IRAS');

const nonIrasNoShell = structuredClone(nonIrasRuntime);
nonIrasNoShell.runtime.workstreams = [];
nonIrasNoShell.runtime.gaps = [{ issueId: nonIrasNoShell.issuePlan.issues[0].id,
  authority: 'ACCOUNTING_STANDARDS', domain: 'ACCOUNTING', stage: 'mapped', code: 'NO_COVERAGE_TOPIC' }];
const nonIrasNoShellInput = passingInput({
  expected: { authority: 'ACCOUNTING_STANDARDS', domain: 'ACCOUNTING', operation: 'EXPLAIN_RULE', population: 'UNKNOWN' },
  runtime: nonIrasNoShell,
  actual: { domain: 'ACCOUNTING', population: 'UNKNOWN', governingAuthorities: ['ACCOUNTING_STANDARDS'], operation: 'EXPLAIN_RULE' },
  requiresFacts: false,
  expectedRequiresUserSpecificFacts: false
});
nonIrasNoShellInput.testCase.expectedCoverageOutcome = 'UNSUPPORTED';
nonIrasNoShellInput.testCase.expected = [nonIrasUnsupportedExpected];
nonIrasNoShellInput.testCase.expectedWorkstreamsAnyOf = [[]];
nonIrasNoShellInput.routing.runtimeIssueScopeDiagnostics = buildPerIssueScopeDiagnostics(
  [nonIrasIssue], nonIrasNoShell.issuePlan, nonIrasNoShell.runtime
);
const noShellAssignments = summarizeRuntimeIssueAssignments(
  [nonIrasIssue], nonIrasNoShell.issuePlan, nonIrasNoShell.runtime.workstreams, nonIrasNoShell.runtime.gaps
);
nonIrasNoShellInput.routing.runtimeAssignmentIntegrity = noShellAssignments.runtimeAssignmentIntegrity;
nonIrasNoShellInput.routing.runtimeAssignmentCounts = noShellAssignments.runtimeAssignmentCounts;
assert.equal(evaluateIrasFirstCase(nonIrasNoShellInput).passed, true,
  'a semantically matched, explicitly insufficient accounting issue may have no canonical runtime shell');

function mixedEvidenceInput({ status = 'INSUFFICIENT', evidenceStatus = 'INSUFFICIENT' } = {}) {
  const irasExpected = expectedIssue({ operation: 'EXPLAIN_RULE', population: 'UNKNOWN' });
  const cpfExpected = {
    id: 'cpf-issue', subject: 'payroll', matchAny: [['payroll']], population: ['EMPLOYER'], domain: ['CPF_PAYROLL'],
    governingAuthorities: ['CPF'], contextualAuthoritiesAnyOf: [[]], operation: ['EXPLAIN_RULE']
  };
  const iras = runtimeFixture({ operation: 'EXPLAIN_RULE', population: 'UNKNOWN' });
  const cpfId = 'cpf-runtime-issue';
  const cpfPlan = { id: cpfId, status: 'MAPPED', mappedTopicIds: ['cpf-topic'], evidenceRequirement: 'AUTHORITATIVE_SOURCE',
    population: 'EMPLOYER', governingAuthorities: ['CPF'], operation: 'EXPLAIN_RULE', domain: 'CPF_PAYROLL' };
  const cpfRuntimeIssue = { issueId: cpfId, domain: 'CPF_PAYROLL', population: 'EMPLOYER', operation: 'EXPLAIN_RULE',
    evidenceRequirement: 'AUTHORITATIVE_SOURCE', governingAuthority: 'CPF', evidenceStatus: 'INSUFFICIENT',
    applicationStatus: 'NOT_REQUIRED', sources: [], verifiedClaims: [],
    lifecycle: { mapped: true, retrievalAttempted: true, evidenceFound: false, admitted: false, verified: false, covered: false },
    gaps: [{ issueId: cpfId, stage: 'candidateEvidence', code: 'NO_CANDIDATE_EVIDENCE' }] };
  iras.issuePlan.issues.push(cpfPlan);
  iras.issuePlan.coverageEstablished = true;
  iras.issuePlan.hasUnmappedResidual = false;
  iras.runtime.status = status;
  iras.runtime.evidenceStatus = evidenceStatus;
  iras.runtime.workstreams.push({ authority: 'CPF', domain: 'CPF_PAYROLL', issues: [cpfRuntimeIssue], gaps: cpfRuntimeIssue.gaps });
  iras.runtime.gaps = cpfRuntimeIssue.gaps;
  const actualIssues = [
    { subject: 'tax relief', population: 'UNKNOWN', domain: 'IRAS_INCOME_TAX', governingAuthorities: ['IRAS'],
      contextualAuthorities: [], operation: 'EXPLAIN_RULE', evidenceRequirement: 'AUTHORITATIVE_SOURCE' },
    { subject: 'payroll', population: 'EMPLOYER', domain: 'CPF_PAYROLL', governingAuthorities: ['CPF'],
      contextualAuthorities: [], operation: 'EXPLAIN_RULE', evidenceRequirement: 'AUTHORITATIVE_SOURCE' }
  ];
  const input = passingInput({
    runtime: iras,
    expected: { operation: 'EXPLAIN_RULE', population: 'UNKNOWN' },
    actual: { operation: 'EXPLAIN_RULE', population: 'UNKNOWN' },
    expectedRequiresUserSpecificFacts: false,
    requiresFacts: false
  });
  input.testCase.expected = [irasExpected, cpfExpected];
  input.testCase.expectedWorkstreamsAnyOf = [['IRAS/IRAS_INDIVIDUAL_TAX', 'CPF/CPF_PAYROLL']];
  input.scoring.expectedIssueCount = 2;
  input.scoring.predictedIssueCount = 2;
  input.scoring.matchedIssueCount = 2;
  input.scoring.operationCorrect = 2;
  input.scoring.operationMatched = 2;
  input.scoring.dimensionsCorrect = Object.fromEntries(Object.keys(input.scoring.dimensionsCorrect).map(key => [key, 2]));
  input.interpretation.issues = actualIssues;
  input.routing.runtimeIssueScopeDiagnostics = buildPerIssueScopeDiagnostics(actualIssues, iras.issuePlan, iras.runtime);
  const assignments = summarizeRuntimeIssueAssignments(actualIssues, iras.issuePlan.issues.length > 0 ? iras.issuePlan : {},
    iras.runtime.workstreams, iras.runtime.gaps);
  input.routing.runtimeAssignmentIntegrity = assignments.runtimeAssignmentIntegrity;
  input.routing.runtimeAssignmentCounts = assignments.runtimeAssignmentCounts;
  input.routing.status = status;
  input.routing.evidenceStatus = evidenceStatus;
  input.routing.finalWorkstreamSetAccuracy = true;
  return input;
}

const mixedPartial = evaluateIrasFirstCase(mixedEvidenceInput());
assert.equal(mixedPartial.passed, true,
  'verified local IRAS support remains valid while a mapped non-IRAS issue is explicitly insufficient');

function mappedAccountingPartial(issueEvidenceStatus) {
  const runtime = runtimeFixture({ authority: 'ACCOUNTING_STANDARDS', domain: 'ACCOUNTING', operation: 'COMPARE',
    population: 'UNKNOWN', issueEvidenceStatus });
  const issue = runtime.runtime.workstreams[0].issues[0];
  issue.lifecycle.covered = false;
  issue.gaps = [{ issueId: issue.issueId, authority: 'ACCOUNTING_STANDARDS', domain: 'ACCOUNTING',
    stage: 'covered', code: 'ISSUE_CONCEPT_UNCOVERED' }];
  runtime.runtime.workstreams[0].gaps = issue.gaps;
  runtime.runtime.gaps = issue.gaps;
  runtime.runtime.status = 'INSUFFICIENT';
  runtime.runtime.evidenceStatus = 'INSUFFICIENT';
  const input = passingInput({
    runtime,
    expected: { authority: 'ACCOUNTING_STANDARDS', domain: 'ACCOUNTING', operation: 'COMPARE', population: 'UNKNOWN' },
    actual: { governingAuthorities: ['ACCOUNTING_STANDARDS'], domain: 'ACCOUNTING', operation: 'COMPARE', population: 'UNKNOWN' },
    expectedRequiresUserSpecificFacts: false,
    requiresFacts: false
  });
  input.testCase.expectedWorkstreamsAnyOf = [['ACCOUNTING_STANDARDS/ACCOUNTING']];
  return input;
}

assert.equal(evaluateIrasFirstCase(mappedAccountingPartial('INSUFFICIENT')).passed, true,
  'an intermediate verified lifecycle with admitted support may remain explicitly insufficient while concept coverage is incomplete');
assert.equal(evaluateIrasFirstCase(mappedAccountingPartial('VERIFIED')).passed, false,
  'a final issue-level VERIFIED status requires complete covered support even when overall status is INSUFFICIENT');

assert.equal(evaluateIrasFirstCase(mixedEvidenceInput({ status: 'VERIFIED' })).passed, false,
  'aggregate VERIFIED cannot conceal a mapped non-IRAS issue without complete admitted support');
assert.equal(evaluateIrasFirstCase(mixedEvidenceInput({ evidenceStatus: 'VERIFIED' })).passed, false,
  'aggregate evidence VERIFIED cannot conceal a mapped non-IRAS issue without complete admitted support');

const misroutedNonIras = structuredClone(nonIrasBase);
misroutedNonIras.routing.runtimeIssueScopeDiagnostics[0].canonicalWorkstreams = [{ authority: 'IRAS', domain: 'IRAS_INDIVIDUAL_TAX' }];
assert.equal(evaluateIrasFirstCase(misroutedNonIras).passed, false,
  'an unsupported non-IRAS issue routed to IRAS fails');

const droppedExpected = structuredClone(nonIrasBase);
droppedExpected.testCase.expected.push(expectedIssue({ authority: 'CPF', domain: 'CPF_PAYROLL', operation: 'EXPLAIN_RULE', population: 'EMPLOYER' }));
droppedExpected.scoring.expectedIssueCount = 2;
droppedExpected.scoring.completeQuestionIssueCoverage = false;
droppedExpected.scoring.matchedIssueCount = 1;
droppedExpected.scoring.dimensionsCorrect = Object.fromEntries(Object.keys(droppedExpected.scoring.dimensionsCorrect).map(key => [key, 1]));
droppedExpected.testCase.expectedCoverageOutcome = undefined;
assert.equal(evaluateIrasFirstCase(droppedExpected).passed, false, 'a requested non-IRAS issue cannot be silently dropped');

const verifiedUnsupported = structuredClone(nonIrasBase);
verifiedUnsupported.routing.runtimeIssueScopeDiagnostics[0].evidenceStatusCounts.VERIFIED = 1;
verifiedUnsupported.routing.runtimeIssueScopeDiagnostics[0].evidenceStatusCounts.INSUFFICIENT = 0;
verifiedUnsupported.routing.runtimeIssueScopeDiagnostics[0].lifecycleCounts.covered = 1;
verifiedUnsupported.routing.runtimeIssueScopeDiagnostics[0].admittedRecordCount = 1;
verifiedUnsupported.routing.runtimeIssueScopeDiagnostics[0].verifiedClaimCount = 1;
assert.equal(evaluateIrasFirstCase(verifiedUnsupported).passed, false,
  'a no-topic unsupported control cannot be promoted to VERIFIED');

const duplicateRuntimeProjection = runtimeFixture();
duplicateRuntimeProjection.runtime.workstreams.push({ authority: 'CPF', domain: 'CPF_PAYROLL',
  issues: [structuredClone(duplicateRuntimeProjection.runtime.workstreams[0].issues[0])] });
const duplicateAssignments = summarizeRuntimeIssueAssignments(
  [{ domain: 'IRAS_INCOME_TAX', governingAuthorities: ['IRAS'] }], duplicateRuntimeProjection.issuePlan,
  duplicateRuntimeProjection.runtime.workstreams, duplicateRuntimeProjection.runtime.gaps
);
assert.equal(duplicateAssignments.runtimeAssignmentCounts.duplicateRuntimeIssueIdCount, 1);
assert.equal(duplicateAssignments.runtimeAssignmentIntegrity, false,
  'duplicate same-id runtime projections cannot hide partial issue evidence');

const orphanRuntimeProjection = runtimeFixture();
orphanRuntimeProjection.runtime.workstreams.push({ authority: 'CPF', domain: 'CPF_PAYROLL', issues: [{
  issueId: 'orphan-runtime-issue', domain: 'CPF_PAYROLL', population: 'EMPLOYER', operation: 'EXPLAIN_RULE'
}] });
const orphanAssignments = summarizeRuntimeIssueAssignments(
  [{ domain: 'IRAS_INCOME_TAX', governingAuthorities: ['IRAS'] }], orphanRuntimeProjection.issuePlan,
  orphanRuntimeProjection.runtime.workstreams, orphanRuntimeProjection.runtime.gaps
);
assert.equal(orphanAssignments.runtimeAssignmentCounts.runtimeIssueIdMismatchCount, 1);
assert.equal(orphanAssignments.runtimeAssignmentIntegrity, false,
  'an extra CPF runtime issue cannot disappear from a supported IRAS route projection');

const unknownOwnedGap = runtimeFixture();
unknownOwnedGap.runtime.gaps = [{ issueId: 'unknown-plan-owner', authority: 'IRAS', domain: 'IRAS_INCOME_TAX', code: 'IRAS_SCOPE_NOT_COVERED' }];
assert.equal(summarizeRuntimeIssueAssignments(
  [{ domain: 'IRAS_INCOME_TAX', governingAuthorities: ['IRAS'] }], unknownOwnedGap.issuePlan,
  unknownOwnedGap.runtime.workstreams, unknownOwnedGap.runtime.gaps
).runtimeAssignmentIntegrity, false, 'unknown gap ownership fails closed');

const mixedPlanIras = runtimeFixture({ operation: 'EXPLAIN_RULE', population: 'UNKNOWN' });
const mixedPlanAccounting = {
  id: 'unmapped-accounting-issue', status: 'UNRESOLVED', unresolvedReason: 'NO_COVERAGE_TOPIC', mappedTopicIds: [],
  evidenceRequirement: 'AUTHORITATIVE_SOURCE', population: 'UNKNOWN', governingAuthorities: ['ACCOUNTING_STANDARDS'],
  operation: 'EXPLAIN_RULE', domain: 'ACCOUNTING'
};
const mixedPlanSemantic = [
  { domain: 'IRAS_INCOME_TAX', population: 'UNKNOWN', operation: 'EXPLAIN_RULE', governingAuthorities: ['IRAS'] },
  { domain: 'ACCOUNTING', population: 'UNKNOWN', operation: 'EXPLAIN_RULE', governingAuthorities: ['ACCOUNTING_STANDARDS'] }
];
const mixedPlan = {
  coverageEstablished: false, hasUnmappedResidual: true,
  issues: [mixedPlanIras.issuePlan.issues[0], mixedPlanAccounting]
};
const mixedGlobalGaps = [
  { issueId: 'issue-plan', authority: 'UNKNOWN', domain: 'UNKNOWN', stage: 'planned', code: 'ISSUE_PLAN_HAS_UNMAPPED_RESIDUAL' },
  { issueId: 'issue-plan', authority: 'UNKNOWN', domain: 'UNKNOWN', stage: 'planned', code: 'ISSUE_PLAN_COVERAGE_UNESTABLISHED' },
  { issueId: mixedPlanAccounting.id, authority: 'ACCOUNTING_STANDARDS', domain: 'ACCOUNTING', stage: 'mapped', code: 'NO_COVERAGE_TOPIC' }
];
const mixedPlanRuntime = { ...mixedPlanIras.runtime, gaps: mixedGlobalGaps };
const mixedPlanAssignments = summarizeRuntimeIssueAssignments(
  mixedPlanSemantic, mixedPlan, mixedPlanRuntime.workstreams, mixedGlobalGaps
);
assert.equal(mixedPlanAssignments.runtimeAssignmentIntegrity, true,
  'only a represented known non-IRAS unsupported issue may accommodate aggregate plan residuals');
const mixedPlanDiagnostics = buildPerIssueScopeDiagnostics(mixedPlanSemantic, mixedPlan, mixedPlanRuntime);
assert.equal(mixedPlanDiagnostics[0].gapCounts.ISSUE_PLAN_HAS_UNMAPPED_RESIDUAL, 0,
  'known non-IRAS unsupported residual gaps do not contaminate supported IRAS issue diagnostics');
assert.equal(mixedPlanDiagnostics[1].gapCounts.ISSUE_PLAN_HAS_UNMAPPED_RESIDUAL, 1,
  'the same aggregate residual remains visible on the unsupported non-IRAS diagnostic');

const irasResidualPlan = { ...mixedPlan, issues: [
  { ...mixedPlanIras.issuePlan.issues[0], status: 'UNRESOLVED', unresolvedReason: 'NO_COVERAGE_TOPIC', mappedTopicIds: [] },
  mixedPlanAccounting
] };
const irasResidualAssignments = summarizeRuntimeIssueAssignments(
  mixedPlanSemantic, irasResidualPlan, mixedPlanRuntime.workstreams, mixedGlobalGaps
);
assert.equal(irasResidualAssignments.runtimeAssignmentIntegrity, false,
  'an IRAS unresolved residual never receives the non-IRAS unsupported accommodation');
const irasResidualDiagnostics = buildPerIssueScopeDiagnostics(mixedPlanSemantic, irasResidualPlan, mixedPlanRuntime);
assert.equal(irasResidualDiagnostics[0].gapCounts.ISSUE_PLAN_HAS_UNMAPPED_RESIDUAL, 1,
  'aggregate residual blockers remain attached to an unresolved IRAS issue');

assert.equal(evaluate({ guardChecks: undefined }).passed, false, 'missing required runtime guards fail closed');

const overallVerifiedWithUnresolvedFacts = passingInput();
overallVerifiedWithUnresolvedFacts.routing.status = 'VERIFIED';
overallVerifiedWithUnresolvedFacts.routing.guardChecks.unresolvedApplicationNotVerified = true;
assert.equal(evaluateIrasFirstCase(overallVerifiedWithUnresolvedFacts).passed, false,
  'an overall VERIFIED status cannot coexist with unresolved issue application facts');

const extraContextualRoute = passingInput();
extraContextualRoute.routing.guardChecks.contextualAuthorityNotRouted = false;
assert.equal(evaluateIrasFirstCase(extraContextualRoute).passed, false,
  'an extra contextual-only workstream fails the runtime guard');

const wrongRuntimeOperation = passingInput();
wrongRuntimeOperation.routing.runtimeIssueScopeDiagnostics[0].runtimeMetadataConsistent = false;
assert.equal(evaluateIrasFirstCase(wrongRuntimeOperation).passed, false,
  'runtime metadata must agree with planned and semantic issue metadata');

const wrongRuntimeOperationFixture = runtimeFixture();
wrongRuntimeOperationFixture.runtime.workstreams[0].issues[0].operation = 'EXPLAIN_RULE';
const wrongRuntimeOperationDiagnostic = buildPerIssueScopeDiagnostics(
  [{ population: 'INDIVIDUAL', domain: 'IRAS_INCOME_TAX', operation: 'CHECK_ELIGIBILITY',
    evidenceRequirement: 'AUTHORITATIVE_SOURCE_AND_CASE_FACTS', governingAuthorities: ['IRAS'], contextualAuthorities: [] }],
  wrongRuntimeOperationFixture.issuePlan,
  wrongRuntimeOperationFixture.runtime
);
assert.equal(wrongRuntimeOperationDiagnostic[0].runtimeMetadataConsistent, false,
  'diagnostics compare the actual runtime issue operation with the semantic plan');
assert.equal(wrongRuntimeOperationDiagnostic[0].runtimeMetadataMismatchCount, 1);

assert.equal(evaluate({ production: { failure: 'PROVIDER_ERROR' } }).passed, false,
  'provider errors always fail irrespective of authority');
assert.equal(evaluate({ capture: { requestCount: 1, responseReceived: false, transportCategory: 'TIMEOUT' } }).passed, false,
  'timeouts always fail irrespective of authority');
assert.equal(evaluate({ validInterpretation: false }).passed, false,
  'invalid semantic JSON cannot pass by virtue of authority scope');

const missingMetadata = evaluate({ diagnostics: [] });
assert.equal(missingMetadata.passed, false, 'missing runtime metadata fails closed');
const absentPlan = buildPerIssueScopeDiagnostics([nonIrasIssue], { issues: [] }, { workstreams: [], gaps: [] });
assert.equal(absentPlan[0].presentInIssuePlan, false, 'missing issue-plan membership remains explicit');

const privateDiagnostic = buildPerIssueScopeDiagnostics(
  [{ ...nonIrasIssue, subject: 'PRIVATE QUESTION LABEL', facts: ['PRIVATE FACT'] }],
  nonIrasRuntime.issuePlan,
  nonIrasRuntime.runtime
);
const serializedDiagnostic = JSON.stringify(privateDiagnostic);
assert.doesNotMatch(serializedDiagnostic, /PRIVATE QUESTION LABEL|PRIVATE FACT|private-source-id|PRIVATE GAP SUBJECT/);
assert.deepEqual(Object.keys(privateDiagnostic[0].gapCounts).sort(), [...IRAS_FIRST_GAP_CODES].sort());

const metrics = summarizeIrasFirstAcceptance({
  requestCount: 1, sourceHashesConsistent: true, fixtureHashesConsistent: true,
  cases: [{ validInterpretation: true, scoring: goodIras ? {
    expectedIssueCount: 1, matchedIssueCount: 1, predictedIssueCount: 1,
    dimensionsCorrect: Object.fromEntries(['governingAuthority', 'contextualAuthority', 'domain', 'population', 'operation'].map(key => [key, 1]))
  } : {}, irasFirstAcceptance: goodIras, routing: { runtimeIssueScopeDiagnostics: [] } }]
}, 1);
assert.equal(metrics.releaseRequiredCoverage.irasIssues, 1);
assert.equal(metrics.nonIrasSemantic.issues, 0);
assert.notEqual(metrics.releaseRequiredCoverage, metrics.nonIrasCoverageGaps,
  'IRAS release coverage and non-IRAS gaps remain separate metrics');

console.log('IRAS-first per-issue scope, evidence, and release-gate regressions passed.');
