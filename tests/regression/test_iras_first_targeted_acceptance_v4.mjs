// Passing API-free development checks, deliberately unregistered; live acceptance remains on HOLD.
// Nine-case local runtime observations, full governed controls and explicit discovery outcomes remain unfinished.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyQuestion } from '../../src/classification/questionClassifier.ts';
import { ControlledWebRetriever } from '../../src/retrieval/controlledWebRetriever.ts';
import { SourceCache } from '../../src/retrieval/sourceCache.ts';
import { OfficialSitemapDiscoveryAdapter } from '../../src/retrieval/officialSitemapDiscovery.ts';
import { buildAuthorityWorkstreams } from '../../src/services/authorityWorkstreams.ts';
import {
  reconcileQuestionUnderstanding,
  validateSemanticQuestionInterpretation
} from '../../src/services/semanticQuestionUnderstanding.ts';
import { UNIFIED_SOURCE_REGISTRY } from '../../src/standards/unifiedSourceModel.ts';
import { getCoverageTopicById } from '../../src/standards/coverageRegistry.ts';
import { defaultExternalSourceValidator } from '../../src/retrieval/externalSourceValidator.ts';
import {
  assertV4ContractMatchesFrozenQuestions,
  buildV4Contract,
  CASE_IDS,
  classifyLifecycleFailure,
  classifyLocalCapabilityV4,
  createRequestBudgetGuard,
  evaluateV4Stages,
  firstFailureV4,
  parseSemanticResponseSafelyV4,
  PROFILE,
  readV4Contract,
  reserveConsumption,
  scoreApplicationStatusV4,
  scoreGovernedEvidenceV4,
  scoreSemanticV4,
  scoreWorkstreamRoutingV4,
  sha256,
  validateV4LivePreflight,
  writeFrozenV4Preregistration
} from '../evaluation/singapore/iras-first-targeted-acceptance-v4.mjs';
import { matchIssuesV2 } from '../evaluation/singapore/multi-authority-issue-scoring-v2.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const contract = await readV4Contract();
assert.deepEqual(contract.cases.map(row => row.caseId), CASE_IDS);
assert.equal(await assertV4ContractMatchesFrozenQuestions(contract), true);
assert.equal((await buildV4Contract()).cases.length, 9);
assert.equal(contract.contractStage, 'PROSPECTIVE_DESIGN_ONLY');
assert.equal(contract.targetedAcceptanceExecuted, false);
assert.equal(contract.semanticScorer.version, 'V2');
assert.equal(contract.futureEvidencePolicy.evidenceMode, 'governedProductionEvidence');
assert.equal(contract.futureEvidencePolicy.liveNetworkDuringSemanticRun, false);
assert.equal(contract.resourcePolicy.expectedCalls, 9);
assert.equal(contract.resourcePolicy.finalProfileSupported, false);

function fixtureInterpretation(caseContract, overrides = {}) {
  const issues = caseContract.semantic.expectedIssues.map(expected => ({
    subject: expected.subject,
    population: expected.population[0],
    domain: expected.domain[0],
    governingAuthorities: expected.governingAuthorities,
    contextualAuthorities: expected.contextualAuthoritiesAnyOf[0].filter(authority => !expected.governingAuthorities.includes(authority)),
    operation: expected.operation[0],
    mappedTopicIds: [],
    evidenceRequirement: 'AUTHORITATIVE_SOURCE',
    confidence: 0.96
  }));
  if (caseContract.caseId === 'private-expense-treatment' && !overrides.subjects) {
    issues[0].subject = 'corporate tax deductibility and disallowed expense treatment of company private holiday expense';
  }
  if (caseContract.caseId === 'unsupported-sfrsi-6-exploration-evaluation' && !overrides.subjects) {
    issues[0].subject = 'general SFRS(I) 6 accounting rules for mineral exploration and evaluation expenditure';
  }
  if (overrides.subjects) issues.forEach((issue, index) => { if (overrides.subjects[index]) issue.subject = overrides.subjects[index]; });
  const mixedMode = overrides.rootMode;
  const cpfIssue = issues.find(issue => issue.domain === 'CPF_PAYROLL');
  const rootIssue = mixedMode === 'CPF_FIRST' && cpfIssue ? cpfIssue : issues[0];
  const isUnknownMixed = mixedMode === 'UNKNOWN_MIXED';
  const rootIssues = isUnknownMixed ? [] : issues;
  const raw = {
    schemaVersion: 2,
    jurisdiction: ['Singapore'],
    authorityCandidates: isUnknownMixed ? ['UNKNOWN'] : [...new Set(rootIssues.flatMap(issue => issue.governingAuthorities))],
    contextualAuthorities: isUnknownMixed ? [] : [...new Set(rootIssue.contextualAuthorities)]
      .filter(authority => !rootIssue.governingAuthorities.includes(authority)),
    domain: isUnknownMixed ? 'UNKNOWN' : rootIssue.domain,
    population: isUnknownMixed ? 'UNKNOWN' : rootIssue.population,
    primarySubject: isUnknownMixed ? issues.map(issue => issue.subject).join(' and ') : rootIssue.subject,
    concepts: issues.map((issue, index) => ({ concept: issue.subject, role: index === 0 ? 'PRIMARY' : 'RELATED' })),
    requestedOperation: isUnknownMixed ? 'OTHER' : rootIssue.operation,
    factsExplicitlyProvided: [],
    confidence: 0.96,
    issues
  };
  return validateSemanticQuestionInterpretation(raw, caseContract.question);
}

const semanticRows = [];
for (const item of contract.cases) {
  const interpretation = fixtureInterpretation(item);
  assert.ok(interpretation, `schema-v2 fixture is valid: ${item.caseId}`);
  const issuePlan = reconcileQuestionUnderstanding(item.question, classifyQuestion(item.question), {
    mode: 'SEMANTIC_INTERPRETATION', interpretation
  }).issuePlan;
  const semantic = scoreSemanticV4(item, interpretation, issuePlan);
  const plannedPairs = new Set();
  for (const issue of issuePlan.issues) for (const authority of issue.governingAuthorities) {
    const domain = authority === 'IRAS'
      ? issue.domain === 'IRAS_GST' ? 'IRAS_GST' : issue.domain === 'IRAS_INCOME_TAX' ? 'IRAS_CORPORATE_TAX' : 'IRAS_INDIVIDUAL_TAX'
      : authority === 'CPF' ? 'CPF_PAYROLL' : 'ACCOUNTING';
    plannedPairs.add(`${authority}/${domain}`);
  }
  const routing = scoreWorkstreamRoutingV4(item, issuePlan, {
    workstreams: [...plannedPairs].map(pair => { const [authority, domain] = pair.split('/'); return { authority, domain }; })
  });
  semanticRows.push({ item, interpretation, issuePlan, semantic, routing });
  assert.equal(semantic.stages.SEMANTIC_VALIDATION, true, `semantic validation: ${item.caseId}`);
  assert.equal(semantic.stages.SEMANTIC_ISSUE_IDENTITY, true, `issue identity: ${item.caseId}`);
  assert.equal(semantic.stages.SEMANTIC_DIMENSIONS, true, `dimensions: ${item.caseId}`);
  if (item.caseId !== 'unsupported-sfrsi-6-exploration-evaluation') {
    assert.equal(semantic.stages.TOPIC_OWNERSHIP, true, `topic inventory: ${item.caseId}`);
    assert.equal(semantic.stages.REQUESTED_CONCEPT_OWNERSHIP, true, `requested concepts: ${item.caseId}`);
    assert.equal(routing.hasIssueOwner, true, `workstream retains every V2-matched issue: ${item.caseId}`);
  }
}

const relief = semanticRows.find(row => row.item.caseId === 'target-relief-entitlement');
assert.equal(relief.issuePlan.issues.length, 1, 'CPF vocabulary remains contextual to the IRAS personal-relief issue.');
assert.ok(relief.issuePlan.issues[0].contextualTopicIds.includes('cpf_contribution_rates'));
assert.deepEqual(relief.issuePlan.issues[0].mappedTopicIds, ['iras-individual-cpf-relief']);
const reliefAmount = semanticRows.find(row => row.item.caseId === 'target-relief-amount');
assert.equal(reliefAmount.interpretation.issues[0].operation, 'CALCULATE');
const mixed = semanticRows.find(row => row.item.caseId === 'A-paraphrase-2');
assert.equal(mixed.issuePlan.issues.length, 2, 'Relief and employer obligations stay independent.');
assert.deepEqual(mixed.item.semantic.expectedIssues.map(issue => issue.operation), [['CALCULATE'], ['CHECK_ELIGIBILITY']],
  'The frozen mixed-case issue order keeps the employer calculation first.');
assert.ok(mixed.item.semantic.materialRequestedConcepts.some(concept => concept.id === 'cpf_employer_contribution'));
for (const rootMode of ['CPF_FIRST', 'UNKNOWN_MIXED']) {
  const mixedInterpretation = fixtureInterpretation(mixed.item, { rootMode });
  assert.ok(mixedInterpretation, `${rootMode} mixed semantic envelope is valid`);
  assert.equal(mixedInterpretation.issues.length, 2, `${rootMode} preserves both requested issues`);
  assert.equal(mixedInterpretation.concepts.length, 2, `${rootMode} preserves both requested concepts`);
  if (rootMode === 'UNKNOWN_MIXED') {
    assert.equal(mixedInterpretation.domain, 'UNKNOWN');
    assert.deepEqual(mixedInterpretation.authorityCandidates, ['UNKNOWN']);
    assert.equal(mixedInterpretation.requestedOperation, 'OTHER');
  } else {
    assert.equal(mixedInterpretation.domain, 'CPF_PAYROLL');
    assert.equal(mixedInterpretation.population, 'EMPLOYER');
  }
  const mixedPlan = reconcileQuestionUnderstanding(mixed.item.question, classifyQuestion(mixed.item.question), {
    mode: 'SEMANTIC_INTERPRETATION', interpretation: mixedInterpretation
  }).issuePlan;
  const mixedScore = scoreSemanticV4(mixed.item, mixedInterpretation, mixedPlan);
  assert.equal(mixedScore.stages.TOPIC_OWNERSHIP, true, `${rootMode} mixed inventory retains independently proved routing parent`);
}

function scoreAlteredPlan(item, interpretation, alter) {
  const base = reconcileQuestionUnderstanding(item.question, classifyQuestion(item.question), {
    mode: 'SEMANTIC_INTERPRETATION', interpretation
  }).issuePlan;
  const altered = structuredClone(base);
  alter(altered);
  return scoreSemanticV4(item, interpretation, altered);
}
const reliefRoute = relief.issuePlan.issues[0].routingTopicIds || [];
assert.ok(reliefRoute.includes('iras-individual-reliefs'), 'Production re-reconciliation proves the parent relief routing topic.');
assert.equal(scoreAlteredPlan(relief.item, relief.interpretation, plan => { delete plan.issues[0].routingTopicIds; })
  .stages.TOPIC_OWNERSHIP, false, 'Omitting the broad routing parent fails closed.');
assert.equal(scoreAlteredPlan(relief.item, relief.interpretation, plan => { plan.issues[0].mappedTopicIds = []; })
  .stages.TOPIC_OWNERSHIP, false, 'Omitting the child topic fails closed even when the parent route is retained.');
assert.equal(scoreAlteredPlan(relief.item, relief.interpretation, plan => { plan.issues[0].operation = 'EXPLAIN_RULE'; })
  .stages.TOPIC_OWNERSHIP, false, 'A wrong operation cannot own the routing parent.');
assert.equal(scoreAlteredPlan(mixed.item, mixed.interpretation, plan => {
  const irasIssue = plan.issues.find(issue => issue.domain === 'IRAS_INCOME_TAX');
  const employerIssue = plan.issues.find(issue => issue.domain === 'CPF_PAYROLL');
  delete irasIssue.routingTopicIds;
  employerIssue.routingTopicIds = ['iras-individual-reliefs'];
}).stages.TOPIC_OWNERSHIP, false, 'An unrelated employer issue cannot satisfy the IRAS routing-parent owner.');
const missingEmployerInterpretation = validateSemanticQuestionInterpretation({ ...mixed.interpretation,
  issues: mixed.interpretation.issues.filter(issue => !issue.subject.includes('employer'))
}, mixed.item.question);
const missingEmployerPlan = reconcileQuestionUnderstanding(mixed.item.question, classifyQuestion(mixed.item.question), {
  mode: 'SEMANTIC_INTERPRETATION', interpretation: missingEmployerInterpretation
}).issuePlan;
assert.equal(scoreSemanticV4(mixed.item, missingEmployerInterpretation, missingEmployerPlan).stages.TOPIC_OWNERSHIP, false,
  'Omitting the separate employer obligation cannot be hidden by the broader IRAS routing parent.');

const wht = contract.cases.find(row => row.caseId === 'wht-royalty-general-rule');
const whtMatched = matchIssuesV2(wht.semantic.expectedIssues, [{ subject: 'company withholding tax on royalties paid to a nonresident corporate entity' }]);
assert.equal(whtMatched.ownerByExpected.size, 1, 'Joined nonresident spelling remains a bounded V2 subject equivalent.');
const whtResidentInterpretation = fixtureInterpretation(wht, { subjects: ['company withholding tax on royalties paid to a resident company'] });
const whtResident = scoreSemanticV4(wht, whtResidentInterpretation,
  reconcileQuestionUnderstanding(wht.question, classifyQuestion(wht.question), { mode: 'SEMANTIC_INTERPRETATION', interpretation: whtResidentInterpretation }).issuePlan);
assert.equal(whtResident.stages.SEMANTIC_ISSUE_IDENTITY, false, 'A resident-company subject does not match the nonresident-company request.');
assert.equal(whtResident.subjectAttribution.modelError, true, 'The retained resident-only output proves a material mismatch.');
const whtEmployee = fixtureInterpretation(wht, { subjects: ['company withholding tax on royalties paid to a nonresident employee'] });
assert.equal(matchIssuesV2(wht.semantic.expectedIssues, whtEmployee.issues).ownerByExpected.size, 1,
  'The V2 WHT anchor alone is intentionally insufficient for recipient-population ownership.');
const whtEmployeeScore = scoreSemanticV4(wht, whtEmployee,
  reconcileQuestionUnderstanding(wht.question, classifyQuestion(wht.question), { mode: 'SEMANTIC_INTERPRETATION', interpretation: whtEmployee }).issuePlan);
assert.equal(whtEmployeeScore.stages.SEMANTIC_ISSUE_IDENTITY, false);
assert.equal(whtEmployeeScore.subjectAttribution.modelError, true);

const employerControl = 'What must the employer contribute to CPF for an employee?';
const employerExpected = mixed.item.semantic.expectedIssues.find(issue => issue.id === 'employer-cpf-contribution');
assert.equal(matchIssuesV2([employerExpected], [{ subject: 'employer CPF contribution obligation and calculation' }]).ownerByExpected.size, 1,
  'An actual employer-obligation question retains the CPF payroll subject.');
assert.equal(matchIssuesV2([relief.item.semantic.expectedIssues[0]], [{ subject: employerControl }]).ownerByExpected.size, 0,
  'Employer contributions do not match personal tax relief.');

// This controlled evaluator input proves scoreLocalCapability behavior only; it is not a runtime observation.
function syntheticLocalCapabilityObservations(item) {
  const observations = [];
  const topicStates = item.reviewedLocalCapability.expectedTopicStates;
  for (const [topicId, expected] of Object.entries(topicStates)) observations.push({ topicId, localOnly: true,
    ...(expected === 'VERIFIED_LOCAL_RULE'
      ? { admitted: true, literalVerified: true, topicCovered: true, recordId: 'ITA_SEC15_PROHIBITED_DEDUCTIONS' }
      : expected === 'INVALID_LOCAL_EVIDENCE'
        ? { candidateStatus: 'NEEDS_REVIEW', admitted: false, rejectionCode: 'LOCAL_SOURCE_NOT_VERIFIED' }
        : { noSubstantiveCandidate: true }) });
  for (const [issueId, expected] of Object.entries(item.reviewedLocalCapability.expectedIssueStates || {})) observations.push({ issueId, localOnly: true,
    ...(expected === 'VERIFIED_LOCAL_RULE'
      ? { admitted: true, literalVerified: true, topicCovered: true }
      : expected === 'INVALID_LOCAL_EVIDENCE'
        ? { candidateStatus: 'NEEDS_REVIEW', admitted: false }
        : { noSubstantiveCandidate: true }) });
  for (const [authority, expected] of Object.entries(item.reviewedLocalCapability.expectedAuthorityStates || {})) {
    const hasTopic = Object.keys(topicStates).some(topicId => authority === 'CPF' ? topicId.startsWith('cpf_') : topicId.startsWith('iras-'));
    if (!hasTopic) observations.push({ authority, localOnly: true, noSubstantiveCandidate: true, expected });
  }
  return observations;
}

for (const item of contract.cases) {
  const local = classifyLocalCapabilityV4(item, syntheticLocalCapabilityObservations(item));
  assert.equal(local.passed, true, `explicit local states pass independently: ${item.caseId}`);
  assert.equal(classifyLocalCapabilityV4(item, []).passed, false, `missing local capability observations fail closed: ${item.caseId}`);
}
const localPrivate = classifyLocalCapabilityV4(contract.cases.find(row => row.caseId === 'private-expense-treatment'), syntheticLocalCapabilityObservations(
  contract.cases.find(row => row.caseId === 'private-expense-treatment')));
assert.equal(localPrivate.topicStates['iras-cit-disallowed-expenses'].actual, 'VERIFIED_LOCAL_RULE');
assert.equal(localPrivate.topicStates['iras-cit-deductibility'].actual, 'EXPECTED_LOCAL_GAP');
const mixedCase = contract.cases.find(row => row.caseId === 'A-paraphrase-2');
const invalidCpf = classifyLocalCapabilityV4(mixedCase, syntheticLocalCapabilityObservations(mixedCase).filter(item => item.topicId !== 'cpf_contribution_rates' && item.issueId !== 'employer-cpf-contribution'));
assert.equal(invalidCpf.passed, false, 'The required CPF NEEDS_REVIEW rejection observation cannot be omitted.');

// Synthetic evaluator observations exercise scorer predicates; they are not production workstream evidence.
function governedObservations(item) {
  return Object.entries(item.governedProductionEvidence.expectedRuleEvidenceByIssue || {}).map(([issueId, status]) => {
    const complete = status === 'VERIFIED';
    return { issueId, ruleEvidenceStatus: status, candidateCount: 1, rejectedCount: 0,
      lifecycle: { retrievalAttempted: true, evidenceFound: true, admitted: complete, verified: complete, covered: complete },
      evidenceQuality: { eligibleRecords: complete ? [{}] : [], rejectedRecords: complete ? [] : [{}], uncoveredConcepts: [], uncoveredTopicIds: [] },
      verifiedClaimCount: complete ? 1 : 0, requestedConceptCoverage: complete };
  });
}
for (const item of contract.cases.filter(row => row.governedProductionEvidence.required)) {
  const result = scoreGovernedEvidenceV4(item, governedObservations(item));
  assert.equal(result.stages.GOVERNED_RETRIEVAL, true, `governed retrieval: ${item.caseId}`);
  assert.equal(result.stages.EVIDENCE_ADMISSION, true, `evidence admission: ${item.caseId}`);
  assert.equal(result.stages.CLAIM_VERIFICATION, true, `claim verification: ${item.caseId}`);
  assert.equal(result.stages.REQUESTED_CONCEPT_COVERAGE, true, `requested concepts: ${item.caseId}`);
}
const noCoverage = contract.cases.find(row => row.caseId === 'unsupported-sfrsi-6-exploration-evaluation');
assert.equal(scoreGovernedEvidenceV4(noCoverage, [{ irAsWorkstreamCount: 0, coverageStatus: 'NO_COVERAGE_TOPIC', candidateCount: 0, claimCount: 0 }]).stages.CLAIM_VERIFICATION, true);
const whtIncomplete = scoreGovernedEvidenceV4(wht, [{ ...governedObservations(wht)[0], ruleEvidenceStatus: 'INSUFFICIENT',
  lifecycle: { retrievalAttempted: true, evidenceFound: true, admitted: true, verified: true, covered: false },
  evidenceQuality: { eligibleRecords: [{}], uncoveredConcepts: ['nonresident-company-recipient'], uncoveredTopicIds: [] },
  verifiedClaimCount: 2, requestedConceptCoverage: false }]);
assert.equal(whtIncomplete.stages.CLAIM_VERIFICATION, true, 'Literal verified claims are reported independently from scope completeness.');
assert.equal(whtIncomplete.stages.REQUESTED_CONCEPT_COVERAGE, false, 'Verified claims cannot bypass requested-concept coverage.');
assert.equal(classifyLifecycleFailure({ lifecycle: { retrievalAttempted: true, evidenceFound: true, admitted: true,
  verified: true, covered: false }, candidateCount: 1, evidenceQuality: { eligibleRecords: [{}], uncoveredConcepts: ['royalty recipient'] },
  verifiedClaimCount: 1, requestedConceptCoverage: false }).state, 'verified_claims_scope_uncovered');
assert.equal(classifyLifecycleFailure({ lifecycle: { retrievalAttempted: true, evidenceFound: true, admitted: false }, candidateCount: 1,
  rejectedCount: 1, evidenceQuality: { rejectedRecords: [{}] } }).state, 'candidate_rejected');
assert.equal(classifyLifecycleFailure({ lifecycle: { retrievalAttempted: true, evidenceFound: false }, candidateCount: 0 }).state, 'candidate_missing');

const apps = scoreApplicationStatusV4(relief.item, { byIssue: { 'personal-cpf-relief': 'UNRESOLVED' }, overallStatus: 'CONDITIONAL' });
assert.equal(apps.passed, true);
const falselyApplied = scoreApplicationStatusV4(relief.item, { byIssue: { 'personal-cpf-relief': 'VERIFIED' }, overallStatus: 'VERIFIED' });
assert.equal(falselyApplied.passed, false, 'Verified rule evidence cannot auto-verify case-specific application.');
assert.equal(firstFailureV4({ SEMANTIC_ISSUE_IDENTITY: false, EVIDENCE_ADMISSION: false }), 'SEMANTIC_ISSUE_IDENTITY');
assert.equal(evaluateV4Stages({ semantic: { stages: { SEMANTIC_VALIDATION: false } } }).earliestFailure, 'SEMANTIC_VALIDATION');
const overallOnlyFailure = scoreApplicationStatusV4(relief.item,
  { byIssue: { 'personal-cpf-relief': 'UNRESOLVED' }, overallStatus: 'VERIFIED' });
assert.equal(overallOnlyFailure.applicationStatusesPassed, true);
assert.equal(evaluateV4Stages({ semantic: { stages: Object.fromEntries(['SEMANTIC_VALIDATION', 'SEMANTIC_ISSUE_IDENTITY',
  'SEMANTIC_DIMENSIONS', 'TOPIC_OWNERSHIP', 'REQUESTED_CONCEPT_OWNERSHIP'].map(stage => [stage, true])) },
  routing: { passed: true }, local: { passed: true }, governed: { stages: Object.fromEntries(['GOVERNED_RETRIEVAL',
    'EVIDENCE_ADMISSION', 'CLAIM_VERIFICATION', 'REQUESTED_CONCEPT_COVERAGE'].map(stage => [stage, true])) },
  application: overallOnlyFailure }).earliestFailure, 'OVERALL_STATUS');
assert.equal(parseSemanticResponseSafelyV4('{not json', relief.item.question).error, 'MALFORMED_SEMANTIC_RESPONSE');
assert.equal(parseSemanticResponseSafelyV4('x'.repeat(65_537), relief.item.question).error, 'SEMANTIC_RESPONSE_TOO_LARGE',
  'The evaluator bounds oversized responses without changing the provider schema.');

const missingGoverned = scoreGovernedEvidenceV4(relief.item, []);
assert.deepEqual(missingGoverned.stages, { GOVERNED_RETRIEVAL: false, EVIDENCE_ADMISSION: false,
  CLAIM_VERIFICATION: false, REQUESTED_CONCEPT_COVERAGE: false }, 'Every governed stage fails closed when no observation exists.');
const missingRetrieval = scoreGovernedEvidenceV4(relief.item, [{ ...governedObservations(relief.item)[0], providerError: true }]);
assert.equal(missingRetrieval.stages.GOVERNED_RETRIEVAL, false);
assert.equal(missingRetrieval.stages.EVIDENCE_ADMISSION, false, 'Admission cannot pass after a retrieval failure.');
assert.equal(missingRetrieval.stages.CLAIM_VERIFICATION, false, 'Verification cannot pass after a retrieval failure.');

const guardClock = { value: 0 };
let sent = 0;
const requestGuard = createRequestBudgetGuard({ clock: () => guardClock.value,
  sleep: async ms => { guardClock.value += ms; }, minimumStartGapMs: 15_250 });
for (const caseId of CASE_IDS) await requestGuard.invoke(caseId, async () => { sent += 1; return '{}'; });
assert.equal(sent, 9);
assert.deepEqual([...requestGuard.counts.values()], Array(9).fill(1));
assert.equal(guardClock.value, 8 * 15_250, 'Fake-clock pacing observes all eight inter-call gaps without wall-clock waits.');
await assert.rejects(() => requestGuard.invoke(CASE_IDS[8], async () => { sent += 1; }), /V4_EXTRA_OR_OUT_OF_ORDER_CALL_BLOCKED/);
assert.equal(sent, 9, 'The exact-nine guard blocks a retry before it reaches the callback.');

let releasePacing;
const concurrentClock = { value: 0 };
const concurrentGuard = createRequestBudgetGuard({ caseIds: CASE_IDS.slice(0, 2), clock: () => concurrentClock.value,
  sleep: ms => new Promise(resolve => { releasePacing = () => { concurrentClock.value += ms; resolve(); }; }) });
await concurrentGuard.invoke(CASE_IDS[0], async () => 'first');
let concurrentSent = 0;
const secondRequest = concurrentGuard.invoke(CASE_IDS[1], async () => { concurrentSent += 1; return 'second'; });
await assert.rejects(() => concurrentGuard.invoke(CASE_IDS[1], async () => { concurrentSent += 1; }), /V4_EXTRA_OR_OUT_OF_ORDER_CALL_BLOCKED/,
  'A concurrent duplicate is reserved out before the pacing await.');
releasePacing();
assert.equal(await secondRequest, 'second');
assert.equal(concurrentSent, 1);
const failedGuard = createRequestBudgetGuard({ caseIds: [CASE_IDS[0]], clock: () => 0, sleep: async () => {} });
await assert.rejects(() => failedGuard.invoke(CASE_IDS[0], async () => { throw new Error('synthetic transport failure'); }), /synthetic transport failure/);
await assert.rejects(() => failedGuard.invoke(CASE_IDS[0], async () => 'retry'), /V4_EXTRA_OR_OUT_OF_ORDER_CALL_BLOCKED/,
  'A failed send remains consumed and cannot be retried.');

const hash = 'a'.repeat(64);
const futureBinding = {
  contractSha256: hash, productionFingerprintSha256: hash, sourceFingerprintSha256: hash,
  schemaPromptFingerprintSha256: hash, protectedHistorySha256: hash, evaluationFingerprintSha256: hash
};
const now = new Date('2026-10-04T00:10:00.000Z');
const captureLock = { mode: 'frozenContemporaneousCapture', frozen: true, synthetic: false,
  preregistrationSha256: hash, ...futureBinding, capturePayloadSha256: hash,
  capturedAt: '2026-10-04T00:00:00.000Z', sourceReferenceDate: '2026-10-04' };
const allowance = { source: 'codex', readable: true, observedAt: now.toISOString(),
  fiveHourRemainingPercent: 9, weeklyRemainingPercent: 5,
  projectedFiveHourCostPercentagePoints: 1, projectedWeeklyCostPercentagePoints: 1 };
const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'iras-v4-api-free-'));
try {
  const namespace = path.join(tempRoot, 'run');
  await mkdir(namespace);
  const preregPath = path.join(tempRoot, 'preregistration.json');
  await assert.rejects(() => writeFrozenV4Preregistration(path.join(tempRoot, 'invalid-preregistration.json'), {
    profile: 'caller-cannot-override', frozen: true, ...futureBinding
  }), /V4_PREREG_PROFILE_MISMATCH/, 'The invalid caller profile is explicitly rejected before a valid preregistration is written.');
  const preregResult = await writeFrozenV4Preregistration(preregPath, {
    profile: PROFILE, frozen: true, ...futureBinding
  });
  const preregBytes = await readFile(preregPath, 'utf8');
  const prereg = JSON.parse(preregBytes);
  const boundCaptureLock = { ...captureLock, preregistrationSha256: preregResult.sha256 };
  assert.equal(prereg.profile, 'iras-first-targeted-acceptance-v4');
  assert.equal(prereg.status, 'FROZEN_PREREGISTRATION');
  assert.equal(prereg.targetedAcceptanceExecuted, false);
  await assert.rejects(() => writeFrozenV4Preregistration(preregPath, { profile: PROFILE, frozen: true, ...futureBinding }),
    error => error.code === 'EEXIST');
  const validPreflight = await validateV4LivePreflight({ preregistration: prereg, preregistrationSha256: preregResult.sha256,
    evidenceLock: boundCaptureLock, sharedAllowance: allowance, authorizedGeminiCalls: 9,
    namespaceDirectory: namespace, now });
  assert.equal(validPreflight.passed, true, validPreflight.failures.join(','));
  assert.equal((await validateV4LivePreflight({ preregistration: prereg, preregistrationSha256: preregResult.sha256,
    evidenceLock: boundCaptureLock, sharedAllowance: { ...allowance, fiveHourRemainingPercent: Number.NaN },
    authorizedGeminiCalls: 9, namespaceDirectory: namespace, now })).passed, false, 'NaN or missing shared allowance fails closed.');
  const missingAllowance = await validateV4LivePreflight({ preregistration: prereg, preregistrationSha256: preregResult.sha256,
    evidenceLock: boundCaptureLock, authorizedGeminiCalls: 9, namespaceDirectory: namespace, now });
  assert.equal(missingAllowance.passed, false);
  assert.ok(missingAllowance.failures.includes('SHARED_ALLOWANCE_UNAVAILABLE_OR_STALE'));
  const missingBinding = await validateV4LivePreflight({ preregistration: { ...prereg, evaluationFingerprintSha256: undefined },
    preregistrationSha256: preregResult.sha256, evidenceLock: { ...boundCaptureLock, evaluationFingerprintSha256: undefined },
    sharedAllowance: allowance, authorizedGeminiCalls: 9, namespaceDirectory: namespace, now });
  assert.equal(missingBinding.failures.includes('PREREGISTRATION_BINDING_INVALID:evaluationFingerprintSha256'), true);
  assert.equal(missingBinding.failures.includes('EVIDENCE_LOCK_BINDING_INVALID:evaluationFingerprintSha256'), true);
  const tamperedBinding = await validateV4LivePreflight({ preregistration: prereg, preregistrationSha256: preregResult.sha256,
    evidenceLock: { ...boundCaptureLock, evaluationFingerprintSha256: 'b'.repeat(64) },
    sharedAllowance: allowance, authorizedGeminiCalls: 9, namespaceDirectory: namespace, now });
  assert.equal(tamperedBinding.failures.includes('EVIDENCE_LOCK_BINDING_MISMATCH:evaluationFingerprintSha256'), true);
  assert.equal((await validateV4LivePreflight({ preregistration: prereg, preregistrationSha256: preregResult.sha256,
    evidenceLock: { ...boundCaptureLock, capturedAt: '2026-10-05T00:00:00.000Z', sourceReferenceDate: '2026-10-05' },
    sharedAllowance: allowance, authorizedGeminiCalls: 9, namespaceDirectory: namespace, now })).failures.includes('EVIDENCE_LOCK_EXPIRED'), true);
  assert.equal((await validateV4LivePreflight({ preregistration: prereg, preregistrationSha256: preregResult.sha256,
    evidenceLock: boundCaptureLock, sharedAllowance: allowance, authorizedGeminiCalls: 8, namespaceDirectory: namespace, now }))
    .failures.includes('NINE_CALL_AUTHORIZATION_REQUIRED'), true);
  const markerBinding = { preregistrationSha256: preregResult.sha256, contractSha256: hash, evidenceLockSha256: hash,
    productionFingerprintSha256: hash, sourceFingerprintSha256: hash, schemaPromptFingerprintSha256: hash,
    protectedHistorySha256: hash, evaluationFingerprintSha256: hash,
    sharedAllowanceObservation: { authorizedGeminiCalls: 9 } };
  await assert.rejects(() => reserveConsumption(namespace, markerBinding, { passed: false }), /V4_PREFLIGHT_NOT_PASSED/);
  const consumption = await reserveConsumption(namespace, markerBinding, validPreflight);
  const marker = JSON.parse(await readFile(consumption.markerPath, 'utf8'));
  assert.equal(marker.profile, 'iras-first-targeted-acceptance-v4');
  assert.equal(marker.status, 'CONSUMED_NO_RETRY');
  await assert.rejects(() => reserveConsumption(namespace, markerBinding, validPreflight), /V4_NAMESPACE_ALREADY_USED/);
  assert.equal((await validateV4LivePreflight({ preregistration: prereg, preregistrationSha256: preregResult.sha256,
    evidenceLock: boundCaptureLock, sharedAllowance: allowance, authorizedGeminiCalls: 9,
    namespaceDirectory: namespace, now })).passed, false, 'A marker in the actual namespace blocks reuse.');
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}

function semanticResolution(query, operation, subject, domain = 'IRAS_INCOME_TAX', population = 'COMPANY', authority = 'IRAS') {
  const raw = { schemaVersion: 2, jurisdiction: ['Singapore'], authorityCandidates: [authority], contextualAuthorities: [],
    domain, population, primarySubject: subject, concepts: [], requestedOperation: operation, factsExplicitlyProvided: [], confidence: 0.96,
    issues: [{ subject, population, domain, governingAuthorities: [authority], contextualAuthorities: [], operation,
      mappedTopicIds: [], evidenceRequirement: 'AUTHORITATIVE_SOURCE', confidence: 0.96 }] };
  const interpretation = validateSemanticQuestionInterpretation(raw, query);
  assert.ok(interpretation, `controlled issue fixture validates: ${query}`);
  return reconcileQuestionUnderstanding(query, classifyQuestion(query), { mode: 'SEMANTIC_INTERPRETATION', interpretation });
}

const referenceDate = '2026-10-04';
const fixturePageUrl = 'https://www.iras.gov.sg/taxes/corporate-income-tax/income-deductions-for-companies/business-expenses';
const privateQuery = contract.cases.find(row => row.caseId === 'private-expense-treatment').question;
const mappedHtml = '<html><head><title>Business Expenses | IRAS</title></head><body><!-- SYNTHETIC API-FREE FIXTURE -->' +
  '<main><h1>Business Expenses</h1><p>For income tax, companies may deduct expenses wholly and exclusively incurred in producing income under the general deduction rule in section 14. This explains whether a company expense is tax deductible and whether it is deductible for tax purposes. Private and domestic expenses are not deductible under section 15, subject to the statutory exceptions and qualifications. This guidance explains the treatment of business expenses for corporate income tax.</p></main></body></html>';
const discoveredUrl = 'https://www.iras.gov.sg/taxes/individual-income-tax/basics-of-individual-income-tax/tax-reliefs-rebates-and-deductions/tax-reliefs/cpf-relief-employees';
const mappedReliefUrl = 'https://www.iras.gov.sg/taxes/individual-income-tax/basics-of-individual-income-tax/tax-reliefs-rebates-and-deductions/tax-reliefs/central-provident-fund(cpf)-relief-for-employees';
const reliefQuery = contract.cases.find(row => row.caseId === 'target-relief-entitlement').question;
const reliefHtml = '<html><head><title>Central Provident Fund (CPF) Relief for Employees | IRAS</title></head><body><!-- SYNTHETIC API-FREE FIXTURE -->' +
  '<main><h1>CPF Relief for employees</h1><p>Singapore tax residents may claim CPF relief for compulsory employee contributions to the Central Provident Fund. The relief is based on contributions made by the employee and is subject to eligibility and the applicable annual relief limits. Employer contributions are not personal CPF relief.</p></main></body></html>';
const sitemapHtml = `<?xml version="1.0"?><urlset><url><loc>${discoveredUrl}</loc><lastmod>2026-10-04</lastmod></url></urlset>`;
const fixtureManifest = [mappedHtml, reliefHtml, sitemapHtml].map(text => ({ synthetic: true, sha256: createHash('sha256').update(text).digest('hex') }));
assert.equal(fixtureManifest.every(item => item.synthetic && /^[a-f0-9]{64}$/.test(item.sha256)), true);

async function runControlledIras(query, issuePlan, questionUnderstanding, responseByUrl) {
  const requests = [];
  const transportObservations = [];
  const customFetch = async url => {
    const key = String(url);
    requests.push(key);
    if (!Object.hasOwn(responseByUrl, key)) throw new Error(`API_FREE_FIXTURE_MISSING:${key}`);
    const response = responseByUrl[key];
    transportObservations.push({ url: key, status: response.status, bodyBytes: Buffer.byteLength(response.body), synthetic: true });
    return new Response(response.body, { status: response.status, headers: { 'content-type': response.type || 'text/html' } });
  };
  const retriever = new ControlledWebRetriever(undefined, new SourceCache());
  const discoveryAdapter = new OfficialSitemapDiscoveryAdapter(retriever, { customFetch });
  const priorFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('AMBIENT_NETWORK_DISABLED_IN_V4_FIXTURE'); };
  try {
    const result = await buildAuthorityWorkstreams(query, issuePlan, {
      referenceDate,
      questionUnderstanding,
      groundingOptions: { localOnly: false, referenceDate, webRetriever: retriever,
        discoveryAdapter, officialDomainSearchAdapter: { async searchOfficialDomainCandidates() { return []; }, getLastSearchTrace() { return []; } },
        fetchOptions: { customFetch, useCache: false, timeoutMs: 50 } }
    });
    return { result, requests, transportObservations, discoveryAdapter };
  } finally { globalThis.fetch = priorFetch; }
}

const privateResolved = semanticResolution(privateQuery, 'DETERMINE_TREATMENT',
  'company private holiday travel expense corporate income tax treatment');
const mappedRun = await runControlledIras(privateQuery, privateResolved.issuePlan, privateResolved.understanding, {
  [fixturePageUrl]: { body: mappedHtml, status: 200 }
});
const privateEvidence = mappedRun.result.workstreams.flatMap(workstream => workstream.issues)[0];
assert.ok(mappedRun.requests.includes(fixturePageUrl), 'The real default advanced retriever follows the reviewed mapped IRAS pointer.');
assert.equal(mappedRun.result.workstreams.length, 1);
const privateObservation = {
  evidenceKeys: Object.keys(privateEvidence), retrievalTrace: privateEvidence.retrievalTrace,
  lifecycle: privateEvidence.lifecycle, admission: privateEvidence.admission,
  evidenceQuality: privateEvidence.evidenceQuality, gaps: privateEvidence.gaps,
  evidenceStatus: privateEvidence.evidenceStatus, verifiedClaims: privateEvidence.verifiedClaims?.length,
  sources: privateEvidence.sources?.map(source => source.id), requests: mappedRun.transportObservations,
  validator: (() => {
    const topic = getCoverageTopicById('iras-cit-deductibility');
    const allTerms = [...new Set([topic.title, ...(topic.aliases || []), ...topic.keywords,
      ...(topic.requiredContentTerms || []), ...(topic.paragraphHints || []), ...(topic.sectionHints || [])])];
    return defaultExternalSourceValidator.validateTopicContent(mappedHtml, {
      standardIdentifiers: ['Business Expenses'], expectedTitles: ['Business Expenses'], topicTerms: allTerms,
      allowIrasTopicTokenEquivalence: true
    });
  })()
};
assert.ok(privateEvidence.retrievalTrace?.attempts?.some(attempt => attempt.fetchStatus === 'SUCCESS'),
  `Mapped synthetic retrieval should expose a successful production attempt: ${JSON.stringify(privateObservation)}`);
assert.equal(privateEvidence.evidenceStatus, 'VERIFIED', 'Synthetic mapped evidence passes production admission, literal verification and topic/concept coverage.');
assert.equal(privateEvidence.applicationStatus, 'UNRESOLVED', 'Verified rule evidence leaves case-specific application unresolved.');
assert.ok(privateEvidence.sources.some(source => source.id === 'ITA_SEC15_PROHIBITED_DEDUCTIONS'),
  'Reviewed substantive local Section 15 material remains in the source set.');
assert.equal(privateEvidence.verifiedClaims.some(claim => claim.recordId === 'ITA_SEC15_PROHIBITED_DEDUCTIONS' &&
  claim.quote === UNIFIED_SOURCE_REGISTRY.ITA_SEC15_PROHIBITED_DEDUCTIONS.sourceText && /statutory exceptions/i.test(claim.quote)), true,
  'The actual local evidence verifier retains the literal caveated reviewed quotation.');

const reliefResolved = semanticResolution(reliefQuery, 'CHECK_ELIGIBILITY', 'individual personal tax relief on compulsory CPF contributions',
  'IRAS_INCOME_TAX', 'INDIVIDUAL');
const discoveredRun = await runControlledIras(reliefQuery, reliefResolved.issuePlan, reliefResolved.understanding, {
  [mappedReliefUrl]: { body: '<html><body>synthetic unavailable mapped response</body></html>', status: 404 },
  'https://www.iras.gov.sg/sitemap': { body: sitemapHtml, status: 200, type: 'application/xml' },
  [discoveredUrl]: { body: reliefHtml, status: 200 }
});
const reliefEvidence = discoveredRun.result.workstreams.flatMap(workstream => workstream.issues)[0];
assert.ok(discoveredRun.requests.includes('https://www.iras.gov.sg/sitemap'), 'The production sitemap adapter is exercised after a mapped source miss.');
assert.ok(discoveredRun.requests.includes(discoveredUrl), 'The discovered official candidate is separately fetched through the controlled transport.');
assert.equal(reliefEvidence.applicationStatus, 'UNRESOLVED');
assert.ok(['VERIFIED', 'INSUFFICIENT'].includes(reliefEvidence.evidenceStatus),
  'A synthetic page may pass or fail substantive gates, but cannot certify current IRAS content.');
assert.ok(reliefEvidence.retrievalTrace?.attempts?.some(attempt => attempt.path === 'SITEMAP_DISCOVERY' || attempt.fetchStatus === 'SUCCESS'));

console.log(`V4 API-free contract, scoring, one-use controls and controlled production lifecycle tests passed (${fixtureManifest.length} explicitly synthetic fixture hashes).`);
