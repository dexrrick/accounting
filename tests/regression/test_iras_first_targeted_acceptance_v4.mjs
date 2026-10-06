// Passing API-free development checks, deliberately unregistered; live acceptance remains on HOLD.
// Nine-case local runtime plus controlled synthetic IRAS outcomes are checked; live capture and the full negative-control matrix remain unfinished.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyQuestion } from '../../src/classification/questionClassifier.ts';
import { ControlledWebRetriever } from '../../src/retrieval/controlledWebRetriever.ts';
import { evaluateEvidenceQuality } from '../../src/retrieval/evidenceQualityGate.ts';
import { SourceCache } from '../../src/retrieval/sourceCache.ts';
import { OfficialSitemapDiscoveryAdapter } from '../../src/retrieval/officialSitemapDiscovery.ts';
import { buildAuthorityWorkstreams } from '../../src/services/authorityWorkstreams.ts';
import { defaultAdvancedSourceRetriever } from '../../src/retrieval/advancedSourceRetriever.ts';
import { defaultQueryTopicResolver } from '../../src/retrieval/queryTopicResolver.ts';
import { supportGeneralIrasRuleConcept } from '../../src/retrieval/irasRuleConceptSupport.ts';
import {
  getRequestedQuestionConcepts,
  reconcileQuestionUnderstanding,
  validateSemanticQuestionInterpretation
} from '../../src/services/semanticQuestionUnderstanding.ts';
import { UNIFIED_SOURCE_REGISTRY } from '../../src/standards/unifiedSourceModel.ts';
import { getCoverageTopicById } from '../../src/standards/coverageRegistry.ts';
import { findRecordEligibilityRejection, verifyEvidenceClaims } from '../../src/verification/claimEvidenceVerifier.ts';
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
      ? issue.domain === 'IRAS_GST' ? 'IRAS_GST' : issue.population === 'INDIVIDUAL' ? 'IRAS_INDIVIDUAL_TAX' : 'IRAS_CORPORATE_TAX'
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
    assert.equal(routing.passed, true, `canonical workstream routing: ${item.caseId}`);
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

const localRuntimeObservations = [];
const localRuntimeResults = new Map();
const localCandidateSearches = new Map();
const localCandidateRecordGroups = new Map();
for (const row of semanticRows) {
  const candidateSearches = [];
  const candidateRecordGroups = [];
  const retriever = {
    async retrieveSources(request) {
      const records = await defaultAdvancedSourceRetriever.retrieveSources(request);
      candidateRecordGroups.push({ topicIds: [...(request.topicIds || [])], records });
      candidateSearches.push({ topicIds: [...(request.topicIds || [])], records: records.map(record => ({
        id: record.id, sourceStatus: record.sourceStatus, authority: record.authority,
        domain: record.domain, lifecycleState: record.lifecycleState
      })) });
      return records;
    },
    getSourceById(id) { return defaultAdvancedSourceRetriever.getSourceById(id); },
    findSourcesByStandardOrAct(code, section) { return defaultAdvancedSourceRetriever.findSourcesByStandardOrAct(code, section); }
  };
  const result = await buildAuthorityWorkstreams(row.item.question, row.issuePlan, {
    retriever,
    questionUnderstanding: { mode: 'SEMANTIC_INTERPRETATION', interpretation: row.interpretation },
    localOnly: true, referenceDate: '2026-10-04',
    groundingOptions: { localOnly: true, referenceDate: '2026-10-04' }
  });
  localRuntimeResults.set(row.item.caseId, result);
  localCandidateSearches.set(row.item.caseId, candidateSearches);
  localCandidateRecordGroups.set(row.item.caseId, candidateRecordGroups);
  const issues = result.workstreams.flatMap(stream => stream.issues).map(issue => ({
    issueId: issue.issueId, subject: issue.subject, population: issue.population, domain: issue.domain,
    authority: issue.governingAuthority, operation: issue.operation, lifecycle: issue.lifecycle,
    evidenceStatus: issue.evidenceStatus, applicationStatus: issue.applicationStatus,
    verifiedClaims: issue.verifiedClaims.map(claim => ({ recordId: claim.recordId, quote: claim.quote })),
    sources: issue.sources.map(source => ({ id: source.id, sourceStatus: source.sourceStatus,
      topicIds: source.topicIds, relatedTopicIds: source.relatedTopicIds, sourceMapTopicIds: source.sourceMapTopicIds })),
    gaps: issue.gaps.map(gap => ({ code: gap.code, stage: gap.stage }))
  }));
  localRuntimeObservations.push({ caseId: row.item.caseId, status: result.status, evidenceStatus: result.evidenceStatus,
    applicationStatus: result.applicationStatus, workstreams: result.workstreams.map(stream => ({
    authority: stream.authority, domain: stream.domain, issueCount: stream.issues.length,
      topicIds: row.issuePlan.issues.filter(issue => issue.governingAuthorities.includes(stream.authority))
        .flatMap(issue => issue.mappedTopicIds)
  })), issues, candidateSearches, topLevelGaps: result.gaps.filter(gap => gap.issueId === 'issue-plan').map(gap => gap.code) });
}

const runtimeTopicStateByCase = new Map();
const runtimeIssueStateByCase = new Map();
const runtimeAuthorityStateByCase = new Map();
function everyOwnedIssueHasVerifiedCoverage(issues) {
  return issues.length > 0 && issues.every(issue => issue.lifecycle.admitted === true && issue.lifecycle.verified === true &&
    issue.lifecycle.covered === true && issue.verifiedClaims.length > 0);
}
function authorityRuntimeObservationFields(issues, mappedTopicIds, topicStates) {
  const authorityTopicStates = mappedTopicIds.map(topicId => topicStates[topicId]).filter(Boolean);
  const retrievalCompleted = issues.length === 0 || issues.every(issue => issue.lifecycle.mapped !== true ||
    (issue.lifecycle.retrievalAttempted === true &&
      !issue.gaps.some(gap => /^(?:RETRIEVAL|PROVIDER|TRANSPORT)_.*(?:FAILED|ERROR)$/.test(gap.code))));
  const admitted = issues.length > 0 && issues.every(issue => issue.lifecycle.admitted === true);
  const topicCoverageObserved = mappedTopicIds.length > 0 && authorityTopicStates.length === mappedTopicIds.length &&
    authorityTopicStates.every(item => item.topicCovered === true);
  const topicClaimsVerified = mappedTopicIds.length > 0 && authorityTopicStates.length === mappedTopicIds.length &&
    authorityTopicStates.every(item => item.literalVerified === true);
  const literalVerified = everyOwnedIssueHasVerifiedCoverage(issues) && topicClaimsVerified;
  const topicCovered = issues.length > 0 && issues.every(issue => issue.lifecycle.covered === true) && topicCoverageObserved;
  const needsReviewCandidate = authorityTopicStates.some(item => item.needsReviewCandidate);
  const hasSubstantiveEvidence = issues.some(issue => issue.lifecycle.evidenceFound === true ||
    issue.lifecycle.admitted === true || issue.verifiedClaims.length > 0) ||
    authorityTopicStates.some(item => item.candidateCount > 0);
  const noEligibleCandidate = Boolean(issues.length && retrievalCompleted && !hasSubstantiveEvidence &&
    authorityTopicStates.every(item => item.candidateCount === 0));
  const substantiveScopeIncomplete = Boolean(issues.length && retrievalCompleted && hasSubstantiveEvidence &&
    !(admitted && literalVerified && topicCovered));
  return { governedWorkstreamObserved: issues.length > 0, noGoverningWorkstream: issues.length === 0,
    retrievalCompleted, needsReviewCandidate, admitted, literalVerified, topicCovered,
    noEligibleCandidate, substantiveScopeIncomplete };
}
const runtimeObservation = fields => ({ localOnly: true, actualRuntime: true, ...fields });
assert.equal(everyOwnedIssueHasVerifiedCoverage([
  { lifecycle: { admitted: true, verified: true, covered: true }, verifiedClaims: [{}] },
  { lifecycle: { admitted: true, verified: true, covered: false }, verifiedClaims: [{}] }
]), false, 'A single verified issue cannot make a multi-issue authority scope complete.');
const mixedSiblingIssues = [
  { lifecycle: { mapped: true, retrievalAttempted: true, evidenceFound: true, admitted: true, verified: true, covered: true },
    verifiedClaims: [{}], gaps: [] },
  { lifecycle: { mapped: true, retrievalAttempted: true, evidenceFound: true, admitted: true, verified: false, covered: true },
    verifiedClaims: [], gaps: [] }
];
const mixedSiblingObservation = authorityRuntimeObservationFields(mixedSiblingIssues, ['topic-verified', 'topic-unverified'], {
  'topic-verified': { literalVerified: true, topicCovered: true, candidateCount: 1 },
  'topic-unverified': { literalVerified: false, topicCovered: true, candidateCount: 1 }
});
const mixedSiblingClassification = classifyLocalCapabilityV4({
  reviewedLocalCapability: { expectedTopicStates: {}, expectedIssueStates: {}, expectedAuthorityStates: { IRAS: 'VERIFIED_LOCAL_RULE' } },
  semantic: { independentTopicAccounting: { requiredTopicOwners: [], contextualTopicOwners: [] } }
}, [{ authority: 'IRAS', ...runtimeObservation(mixedSiblingObservation) }]);
assert.equal(mixedSiblingClassification.authorityStates.IRAS.actual, 'EXPECTED_LOCAL_GAP',
  'An admitted and covered sibling with no verified claim cannot inherit another issue’s verified authority result.');
assert.equal(mixedSiblingClassification.authorityStates.IRAS.passed, false,
  'The full capability classifier rejects a falsely complete multi-issue authority observation.');
for (const row of semanticRows) {
  const runtime = localRuntimeResults.get(row.item.caseId);
  const actualIssues = runtime.workstreams.flatMap(stream => stream.issues);
  const candidates = localCandidateSearches.get(row.item.caseId);
  const queryDecomposition = defaultQueryTopicResolver.decomposeQuery(row.item.question);
  const rawTopicIds = [...new Set([...queryDecomposition.topics.map(topic => topic.id),
    ...classifyQuestion(row.item.question).topicIds])];
  const topicStates = {};
  for (const topicId of rawTopicIds) {
    const topic = getCoverageTopicById(topicId);
    if (!topic || topic.routingOnly || !/^(?:ACCOUNTING|IRAS|CPF|MOM|ACRA|MAS)_/.test(topic.domainId)) continue;
    const routedIssue = row.issuePlan.issues.find(issue => issue.mappedTopicIds.includes(topicId));
    const evidenceIssue = routedIssue && actualIssues.find(issue => issue.subject === routedIssue.subject);
    const associatedRecords = candidates.flatMap(search => search.topicIds.includes(topicId) ? search.records : []);
    const actualRecords = localCandidateRecordGroups.get(row.item.caseId)
      .flatMap(group => group.topicIds.includes(topicId) ? group.records : []);
    const rejectionObserved = Boolean(evidenceIssue?.gaps.some(gap => gap.code === 'CANDIDATE_REJECTED'));
    const needsReviewCandidate = rejectionObserved && evidenceIssue?.lifecycle.evidenceFound === true &&
      associatedRecords.some(record => topic.sourceRecordIds.includes(record.id) && record.sourceStatus === 'NEEDS_REVIEW');
    const topicConcepts = getRequestedQuestionConcepts(row.item.question, row.interpretation)
      .filter(concept => concept.topicIds.includes(topicId));
    const topicQuality = topic.domainId.startsWith('IRAS_') ? evaluateEvidenceQuality({
      query: row.item.question,
      topicIds: [topicId],
      records: actualRecords,
      missingFacts: [],
      referenceDate: '2026-10-04',
      authorities: ['IRAS'],
      requestedConcepts: topicConcepts,
      ...(topic.legacyDomains.length === 1 ? { domain: topic.legacyDomains[0] } : {}),
      ...(routedIssue ? { scopedSubject: routedIssue.subject, scopedPopulation: routedIssue.population } : {})
    }) : undefined;
    const topicQualityCovered = topicQuality
      ? topicQuality.coveredTopicIds.includes(topicId) && !topicQuality.uncoveredTopicIds.includes(topicId)
      : evidenceIssue?.lifecycle.covered === true && actualRecords.some(record =>
        topic.sourceRecordIds.includes(record.id) &&
        [record.tags, record.relatedTopicIds, record.sourceMapTopicIds, record.retrievalHints].some(ids => ids?.includes(topicId)));
    const verifiedTopicClaim = evidenceIssue?.lifecycle.admitted === true && evidenceIssue.lifecycle.verified === true &&
      topicQualityCovered && evidenceIssue.verifiedClaims.some(claim =>
        topic.sourceRecordIds.includes(claim.recordId) && actualRecords.some(record => record.id === claim.recordId) &&
        (topicQuality ? topicQuality.eligibleRecords.some(record => record.id === claim.recordId) : true));
    const governedWorkstreamObserved = Boolean(evidenceIssue);
    const retrievalCompleted = evidenceIssue?.lifecycle.retrievalAttempted === true &&
      !evidenceIssue.gaps.some(gap => /^(?:RETRIEVAL|PROVIDER|TRANSPORT)_.*(?:FAILED|ERROR)$/.test(gap.code));
    const noGoverningWorkstream = !routedIssue;
    const noEligibleCandidate = Boolean(routedIssue && retrievalCompleted && associatedRecords.length === 0 &&
      evidenceIssue?.lifecycle.evidenceFound !== true);
    const substantiveScopeIncomplete = Boolean(routedIssue && retrievalCompleted && !verifiedTopicClaim &&
      (associatedRecords.length > 0 || evidenceIssue?.lifecycle.evidenceFound === true || evidenceIssue?.lifecycle.admitted === true));
    const state = needsReviewCandidate ? 'INVALID_LOCAL_EVIDENCE'
      : verifiedTopicClaim ? 'VERIFIED_LOCAL_RULE' : 'EXPECTED_LOCAL_GAP';
    topicStates[topicId] = { state, routed: Boolean(routedIssue), lifecycle: evidenceIssue?.lifecycle,
      governedWorkstreamObserved, noGoverningWorkstream, retrievalCompleted, noEligibleCandidate,
      substantiveScopeIncomplete, admitted: evidenceIssue?.lifecycle.admitted === true,
      literalVerified: verifiedTopicClaim, topicCovered: topicQualityCovered,
      needsReviewCandidate, verifiedTopicClaim, candidateCount: associatedRecords.length };
  }
  const issueStates = {};
  for (const expectedIssue of Object.keys(row.item.reviewedLocalCapability.expectedIssueStates || {})) {
    const pair = row.semantic.pairs.find(item => item.expectedIssueId === expectedIssue);
    const subject = pair ? row.interpretation.issues[pair.actualIndex]?.subject : undefined;
    const plannedIssue = row.issuePlan.issues.find(issue => issue.subject === subject);
    const evidenceIssue = plannedIssue && actualIssues.find(issue => issue.subject === plannedIssue.subject);
    const scopedTopicStates = plannedIssue ? plannedIssue.mappedTopicIds.map(topicId => topicStates[topicId]?.state).filter(Boolean) : [];
    const state = scopedTopicStates.includes('INVALID_LOCAL_EVIDENCE') ? 'INVALID_LOCAL_EVIDENCE'
      : evidenceIssue?.lifecycle.retrievalAttempted !== true && plannedIssue?.mappedTopicIds.length
        ? 'PIPELINE_FAILURE'
        : scopedTopicStates.length > 0 && scopedTopicStates.every(item => item === 'VERIFIED_LOCAL_RULE') &&
          evidenceIssue?.lifecycle.covered === true ? 'VERIFIED_LOCAL_RULE' : 'EXPECTED_LOCAL_GAP';
    const mappedTopicIds = plannedIssue?.mappedTopicIds || [];
    const retrievalCompleted = evidenceIssue?.lifecycle.retrievalAttempted === true &&
      !evidenceIssue.gaps.some(gap => /^(?:RETRIEVAL|PROVIDER|TRANSPORT)_.*(?:FAILED|ERROR)$/.test(gap.code));
    const needsReviewCandidate = scopedTopicStates.includes('INVALID_LOCAL_EVIDENCE');
    const topicCovered = mappedTopicIds.length > 0 && mappedTopicIds.every(topicId => topicStates[topicId]?.topicCovered === true);
    const noEligibleCandidate = Boolean(mappedTopicIds.length && retrievalCompleted &&
      !evidenceIssue?.lifecycle.evidenceFound && !evidenceIssue?.lifecycle.admitted &&
      mappedTopicIds.every(topicId => topicStates[topicId]?.candidateCount === 0));
    const substantiveScopeIncomplete = Boolean(mappedTopicIds.length && retrievalCompleted && !topicCovered &&
      (evidenceIssue?.lifecycle.evidenceFound === true || evidenceIssue?.lifecycle.admitted === true ||
        mappedTopicIds.some(topicId => (topicStates[topicId]?.candidateCount || 0) > 0)));
    issueStates[expectedIssue] = { state, mappedTopicIds, lifecycle: evidenceIssue?.lifecycle,
      evidenceStatus: evidenceIssue?.evidenceStatus, governedWorkstreamObserved: Boolean(evidenceIssue && mappedTopicIds.length > 0),
      noGoverningWorkstream: !plannedIssue || mappedTopicIds.length === 0,
      retrievalCompleted, needsReviewCandidate, admitted: evidenceIssue?.lifecycle.admitted === true,
      literalVerified: evidenceIssue?.lifecycle.verified === true && evidenceIssue.verifiedClaims.length > 0,
      topicCovered, noEligibleCandidate, substantiveScopeIncomplete };
  }
  const authorityStates = {};
  for (const authority of Object.keys(row.item.reviewedLocalCapability.expectedAuthorityStates || {})) {
    const streams = runtime.workstreams.filter(stream => stream.authority === authority);
    const evidenceForAuthority = streams.flatMap(stream => stream.issues);
    const issues = evidenceForAuthority.map(issue => issueStates[
      row.item.semantic.expectedIssues.find(expected => row.semantic.pairs.some(pair => pair.expectedIssueId === expected.id &&
        row.interpretation.issues[pair.actualIndex]?.subject === issue.subject))?.id
    ]).filter(Boolean);
    const state = issues.some(item => item.state === 'INVALID_LOCAL_EVIDENCE') ? 'INVALID_LOCAL_EVIDENCE'
      : evidenceForAuthority.length === 0 || evidenceForAuthority.some(issue => issue.lifecycle.retrievalAttempted !== true &&
        issue.lifecycle.mapped === true) ? 'PIPELINE_FAILURE'
      : everyOwnedIssueHasVerifiedCoverage(evidenceForAuthority) ? 'VERIFIED_LOCAL_RULE' : 'EXPECTED_LOCAL_GAP';
    const mappedAuthorityTopics = row.issuePlan.issues.filter(issue => issue.governingAuthorities.includes(authority))
      .flatMap(issue => issue.mappedTopicIds);
    const observationFields = authorityRuntimeObservationFields(evidenceForAuthority, mappedAuthorityTopics, topicStates);
    authorityStates[authority] = { state, workstreamCount: streams.length,
      issueStates: issues.map(item => item.state), lifecycle: evidenceForAuthority.map(issue => issue.lifecycle),
      ...observationFields };
  }
  runtimeTopicStateByCase.set(row.item.caseId, topicStates);
  runtimeIssueStateByCase.set(row.item.caseId, issueStates);
  runtimeAuthorityStateByCase.set(row.item.caseId, authorityStates);
}
const localCapabilityRows = semanticRows.map(row => {
  const observations = [];
  for (const [topicId, item] of Object.entries(runtimeTopicStateByCase.get(row.item.caseId))) {
    observations.push({ topicId, ...runtimeObservation(item) });
  }
  for (const [issueId, item] of Object.entries(runtimeIssueStateByCase.get(row.item.caseId))) {
    observations.push({ issueId, ...runtimeObservation(item) });
  }
  for (const [authority, item] of Object.entries(runtimeAuthorityStateByCase.get(row.item.caseId))) {
    observations.push({ authority, ...runtimeObservation(item) });
  }
  return { caseId: row.item.caseId, result: classifyLocalCapabilityV4(row.item, observations) };
});
assert.equal(localCapabilityRows.length, CASE_IDS.length, 'All nine cases must have a production local-only capability observation.');
for (const row of localCapabilityRows) assert.equal(row.result.passed, true,
  `Observed local-only capabilities: ${row.caseId} ${JSON.stringify(row.result)}`);
const localApplicationRows = semanticRows.map(row => {
  const runtime = localRuntimeResults.get(row.item.caseId);
  const actualIssues = runtime.workstreams.flatMap(stream => stream.issues);
  const actualByIssue = Object.fromEntries(Object.keys(row.item.application.expectedByIssue || {}).map(issueId => {
    const pair = row.semantic.pairs.find(item => item.expectedIssueId === issueId);
    const subject = pair ? row.interpretation.issues[pair.actualIndex]?.subject : undefined;
    const issue = actualIssues.find(item => item.subject === subject);
    return [issueId, issue?.applicationStatus];
  }));
  assert.deepEqual(actualByIssue, row.item.application.expectedByIssue, `Production local-only application outputs: ${row.item.caseId}`);
  const expectedOverall = Object.values(actualByIssue).includes('UNRESOLVED') ? 'UNRESOLVED' : 'NOT_REQUIRED';
  assert.equal(runtime.applicationStatus, expectedOverall, `Production local-only overall application output: ${row.item.caseId}`);
  return { caseId: row.item.caseId, byIssue: actualByIssue, overall: runtime.applicationStatus };
});
console.log(`V4_LOCAL_ONLY_RUNTIME ${JSON.stringify(localCapabilityRows.map(row => ({
  caseId: row.caseId, topics: Object.fromEntries(Object.entries(runtimeTopicStateByCase.get(row.caseId)).map(([id, value]) => [id, value.state])),
  issues: Object.fromEntries(Object.entries(runtimeIssueStateByCase.get(row.caseId)).map(([id, value]) => [id, value.state])),
  authorities: Object.fromEntries(Object.entries(runtimeAuthorityStateByCase.get(row.caseId)).map(([id, value]) => [id, value.state])),
  passed: row.result.passed,
  candidateCount: localCandidateSearches.get(row.caseId).flatMap(search => search.records).length,
  needsReviewCandidates: localCandidateSearches.get(row.caseId).flatMap(search => search.records
    .filter(record => record.sourceStatus === 'NEEDS_REVIEW').map(record => ({
      topicIds: search.topicIds, id: record.id, sourceStatus: record.sourceStatus, authority: record.authority,
      domain: record.domain, lifecycleState: record.lifecycleState
    })))
})))}`);
console.log(`V4_LOCAL_ONLY_APPLICATION ${JSON.stringify(localApplicationRows)}`);

for (const item of contract.cases) {
  const local = classifyLocalCapabilityV4(item, syntheticLocalCapabilityObservations(item));
  assert.equal(local.passed, true, `explicit local states pass independently: ${item.caseId}`);
  assert.equal(classifyLocalCapabilityV4(item, []).passed, false, `missing local capability observations fail closed: ${item.caseId}`);
}
const whtLocalContract = contract.cases.find(row => row.caseId === 'wht-royalty-general-rule');
const whtTopicId = Object.keys(whtLocalContract.reviewedLocalCapability.expectedTopicStates)[0];
const classifyWhtTopicObservation = observation => classifyLocalCapabilityV4(whtLocalContract,
  observation ? [{ topicId: whtTopicId, localOnly: true, actualRuntime: true, ...observation }] : []).topicStates[whtTopicId].actual;
assert.equal(classifyWhtTopicObservation(undefined), 'PIPELINE_FAILURE', 'A missing runtime observation is not a substantive evidence gap.');
assert.equal(classifyWhtTopicObservation({ governedWorkstreamObserved: true }), 'PIPELINE_FAILURE',
  'A present workstream without positive retrieval-completion evidence is a pipeline failure.');
assert.equal(classifyWhtTopicObservation({ governedWorkstreamObserved: false, noGoverningWorkstream: true }), 'EXPECTED_LOCAL_GAP',
  'An observed absence of a governing workstream is a substantive routing gap.');
assert.equal(classifyWhtTopicObservation({ governedWorkstreamObserved: true, retrievalCompleted: true,
  admitted: true, literalVerified: false, topicCovered: false, substantiveScopeIncomplete: true }), 'EXPECTED_LOCAL_GAP',
  'Admitted but incomplete substantive scope remains a gap rather than a no-candidate or pipeline label.');
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
    const partialCpf = status === 'INSUFFICIENT' && item.governedProductionEvidence.acceptablePartialNonIrasBehaviour?.permitted === true;
    return { issueId, ruleEvidenceStatus: status, candidateCount: 1, rejectedCount: partialCpf ? 1 : 0,
      ...(partialCpf ? { authority: item.reviewedLocalCapability.rejectionExpectation.authority,
        operation: item.governedProductionEvidence.acceptablePartialNonIrasBehaviour.cpfOperation,
        actualReturnedSourceCount: 0, gaps: ['CANDIDATE_REJECTED', 'NO_ADMITTED_EVIDENCE'], rejectedCandidates: [{
          recordId: 'CPF_RATES_BY_AGE_2026', sourceStatus: 'NEEDS_REVIEW',
          eligibilityRejectionCode: 'LOCAL_SOURCE_NOT_VERIFIED', eligibilityGateResult: 'LOCAL_SOURCE_NOT_VERIFIED' }] } : {}),
      lifecycle: { retrievalAttempted: true, evidenceFound: true, admitted: complete, verified: complete, covered: complete },
      ...(!partialCpf ? { evidenceQuality: { eligibleRecords: complete ? [{}] : [], rejectedRecords: complete ? [] : [{}],
        uncoveredConcepts: [], uncoveredTopicIds: [] } } : {}),
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
const controlledRuleFixtureBodies = [];
function syntheticIrasResponse(family, polarity, urls, body, type = 'text/html') {
  controlledRuleFixtureBodies.push({ family, polarity, urls, body, type });
  return { body, status: 200, type };
}
function syntheticIrasPage(family, polarity, urls, title, ruleText) {
  const body = `<html><head><title>${title}</title></head><body><!-- SYNTHETIC API-FREE FIXTURE --><main><h1>${title}</h1><p>${ruleText}</p></main></body></html>`;
  return syntheticIrasResponse(family, polarity, urls, body);
}
function syntheticIrasResponses(family, polarity, pages, ruleText) {
  return Object.fromEntries(pages.map(([url, title]) => [url,
    syntheticIrasPage(family, polarity, [url], title, ruleText)]));
}
const controlledSitemapUrl = 'https://www.iras.gov.sg/sitemap';
const controlledRobotsUrl = 'https://www.iras.gov.sg/robots.txt';
const controlledDiscoveryResponses = {
  [controlledSitemapUrl]: syntheticIrasResponse('shared-controlled-discovery', 'sitemap',
    [controlledSitemapUrl], sitemapHtml, 'application/xml'),
  [controlledRobotsUrl]: syntheticIrasResponse('shared-controlled-discovery', 'robots',
    [controlledRobotsUrl], 'User-agent: *\nDisallow:', 'text/plain')
};
function withControlledDiscoveryFixtures(responses) {
  return { ...responses, ...controlledDiscoveryResponses };
}
function normalizeFixtureEvidence(value) {
  return String(value).normalize('NFC').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}
function assertClaimsBoundToSyntheticResponses(issue, responses, family, claimFilter = () => true) {
  const claims = issue.verifiedClaims.filter(claimFilter);
  assert.ok(claims.length > 0, `${family} positive must expose actual verified claims within the requested source scope.`);
  const sourcesById = new Map(issue.sources.map(source => [source.id, source]));
  for (const claim of claims) {
    const source = sourcesById.get(claim.recordId);
    assert.ok(source, `${family} verified claim ${claim.recordId} must link to a returned source record.`);
    const response = responses[source.officialSourceUrl];
    assert.ok(response, `${family} claim source URL must be one of the supplied controlled response URLs: ${source.officialSourceUrl}`);
    assert.equal(source.sourceStatus, 'NEEDS_REVIEW', `${family} synthetic content cannot upgrade source trust.`);
    assert.equal(source.provenance, 'LIVE_EXTERNAL', `${family} claim must be bound to the production controlled-transport record.`);
    const visibleFixtureText = response.body.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&');
    assert.equal(typeof claim.quote, 'string', `${family} verified claim must carry a string quote.`);
    const normalizedQuote = normalizeFixtureEvidence(claim.quote);
    assert.ok(normalizedQuote.length > 0, `${family} verified claim quote must be nonempty after normalization.`);
    assert.ok(normalizeFixtureEvidence(visibleFixtureText).includes(normalizedQuote),
      `${family} claim quote must occur literally in the supplied synthetic response body.`);
    assert.ok(normalizeFixtureEvidence(source.sourceText).includes(normalizedQuote),
      `${family} claim quote must occur literally in its associated returned source text.`);
  }
}

async function runControlledIras(query, issuePlan, questionUnderstanding, responseByUrl) {
  const requests = [];
  const missingFixtureRequests = [];
  const transportObservations = [];
  const fetchValidationObservations = [];
  const candidateRecordGroups = [];
  const sourceRetriever = {
    async retrieveSources(request) {
      const records = await defaultAdvancedSourceRetriever.retrieveSources(request);
      candidateRecordGroups.push({ topicIds: [...(request.topicIds || [])], records });
      return records;
    },
    getSourceById(id) { return defaultAdvancedSourceRetriever.getSourceById(id); },
    findSourcesByStandardOrAct(code, section) { return defaultAdvancedSourceRetriever.findSourcesByStandardOrAct(code, section); }
  };
  const customFetch = async url => {
    const key = String(url);
    requests.push(key);
    if (!Object.hasOwn(responseByUrl, key)) {
      missingFixtureRequests.push(key);
      throw new Error(`API_FREE_FIXTURE_MISSING:${key}`);
    }
    const response = responseByUrl[key];
    transportObservations.push({ url: key, status: response.status, bodyBytes: Buffer.byteLength(response.body),
      synthetic: true, sha256: createHash('sha256').update(response.body).digest('hex') });
    return new Response(response.body, { status: response.status, headers: { 'content-type': response.type || 'text/html' } });
  };
  const webRetriever = new ControlledWebRetriever(undefined, new SourceCache());
  const originalFetchOfficialSource = webRetriever.fetchOfficialSource.bind(webRetriever);
  webRetriever.fetchOfficialSource = async (url, options = {}) => {
    const result = await originalFetchOfficialSource(url, options);
    fetchValidationObservations.push({ url, topicValidationPresent: Boolean(options.topicValidation),
      status: result.status, sourceUrl: result.sourceUrl, finalUrl: result.finalUrl, pageTitle: result.pageTitle,
      contentHash: result.contentHash, topicMatched: result.topicMatched,
      titleMatched: result.titleMatched, contentMatched: result.contentMatched });
    return result;
  };
  const discoveryAdapter = new OfficialSitemapDiscoveryAdapter(webRetriever, { customFetch });
  const priorFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('AMBIENT_NETWORK_DISABLED_IN_V4_FIXTURE'); };
  try {
    const result = await buildAuthorityWorkstreams(query, issuePlan, {
      retriever: sourceRetriever,
      referenceDate,
      questionUnderstanding,
      groundingOptions: { localOnly: false, referenceDate, webRetriever,
        discoveryAdapter, officialDomainSearchAdapter: { async searchOfficialDomainCandidates() { return []; }, getLastSearchTrace() { return []; } },
        fetchOptions: { customFetch, useCache: false, timeoutMs: 50 } }
    });
    return { result, requests, missingFixtureRequests, transportObservations, fetchValidationObservations,
      candidateRecordGroups, discoveryAdapter, suppliedResponses: responseByUrl };
  } finally { globalThis.fetch = priorFetch; }
}

function observeControlledIrasRun(run) {
  const issue = run.result.workstreams.flatMap(workstream => workstream.issues)[0];
  return { requests: run.transportObservations, attempts: issue.retrievalTrace?.attempts?.map(attempt => ({
    fetchStatus: attempt.fetchStatus, topicId: attempt.topicId, pageTitle: attempt.pageTitle
  })), lifecycle: issue.lifecycle, evidenceStatus: issue.evidenceStatus,
  verifiedClaims: issue.verifiedClaims?.map(claim => ({ recordId: claim.recordId, quote: claim.quote })),
  gaps: issue.gaps?.map(gap => gap.code), sources: issue.sources?.map(source => ({ id: source.id, sourceStatus: source.sourceStatus })),
  applicationStatus: issue.applicationStatus, overallStatus: run.result.status };
}
function assertNoControlledFixtureMisses(run, label) {
  assert.deepEqual(run.missingFixtureRequests, [], `${label} supplies every requested synthetic response URL.`);
  assert.equal(run.transportObservations.every(observation => {
    const response = run.suppliedResponses[observation.url];
    return response && observation.synthetic === true && observation.status === response.status &&
      observation.bodyBytes === Buffer.byteLength(response.body) &&
      observation.sha256 === createHash('sha256').update(response.body).digest('hex');
  }), true, `${label} binds each requested response hash to the explicitly supplied fixture bytes.`);
}

const privateResolved = semanticResolution(privateQuery, 'DETERMINE_TREATMENT',
  'company private holiday travel expense corporate income tax treatment');
function evaluateIrasQuality(query, understanding, subject, population, topicIds, records) {
  const topics = topicIds.map(getCoverageTopicById).filter(Boolean);
  const requestedConcepts = getRequestedQuestionConcepts(query, understanding)
    .filter(concept => concept.topicIds.some(topicId => topicIds.includes(topicId)));
  const domains = [...new Set(topics.map(topic => topic.domainId))];
  return evaluateEvidenceQuality({ query, topicIds, records, missingFacts: [], referenceDate,
    authorities: ['IRAS'], requestedConcepts, ...(domains.length === 1 ? { domain: domains[0] } : {}),
    scopedSubject: subject, scopedPopulation: population });
}
function replayProductionIrasQuality(query, interpretation, subject, population, topicIds, records, sourceMapFallbackTrace) {
  const understanding = { mode: 'SEMANTIC_INTERPRETATION', interpretation };
  const requestedConcepts = getRequestedQuestionConcepts(query, understanding)
    .filter(concept => concept.topicIds.some(topicId => topicIds.includes(topicId)));
  return evaluateEvidenceQuality({ query, topicIds, records, missingFacts: [], referenceDate,
    authorities: ['IRAS'], requestedConcepts, scopedSubject: subject, scopedPopulation: population,
    ...(sourceMapFallbackTrace ? { sourceMapFallbackTrace } : {}) });
}

function actualIssueForExpected(row, runtime, expectedIssueId) {
  const expected = row.item.semantic.expectedIssues.find(issue => issue.id === expectedIssueId);
  const pair = row.semantic.pairs.find(item => item.expectedIssueId === expectedIssueId);
  assert.ok(expected && pair, `Expected semantic pair exists for ${row.item.caseId}/${expectedIssueId}`);
  const semanticIssue = row.interpretation.issues[pair.actualIndex];
  const authorities = expected.governingAuthorities;
  const planned = row.issuePlan.issues.filter(issue => issue.subject === semanticIssue.subject &&
    issue.domain === semanticIssue.domain && issue.population === semanticIssue.population &&
    issue.operation === expected.operation[0] && authorities.some(authority => issue.governingAuthorities.includes(authority)));
  assert.equal(planned.length, 1, `Expected issue maps uniquely to production issue plan: ${row.item.caseId}/${expectedIssueId}`);
  const matches = runtime.workstreams.filter(stream => authorities.includes(stream.authority))
    .flatMap(stream => stream.issues.map(issue => ({ issue, authority: stream.authority })))
    .filter(({ issue, authority }) => issue.subject === planned[0].subject && issue.domain === planned[0].domain &&
      issue.population === planned[0].population && issue.operation === planned[0].operation &&
      authorities.includes(authority));
  assert.equal(matches.length, 1, `Expected issue maps to exactly one actual runtime issue: ${row.item.caseId}/${expectedIssueId}`);
  return { expected, planned: planned[0], ...matches[0] };
}

function transportUrlIdentity(url) {
  if (typeof url !== 'string' || !url) return undefined;
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname) return undefined;
    parsed.hash = '';
    if (parsed.pathname.length > 1 && parsed.pathname.endsWith('/')) {
      parsed.pathname = parsed.pathname.slice(0, -1);
    }
    return parsed.toString();
  } catch { return undefined; }
}

function observedSourceSubsetTrace(records, topicIds, retrievalAttempts, fetchObservations) {
  const liveRecords = records.filter(record => record.provenance === 'LIVE_EXTERNAL');
  const selectedRecordIds = [];
  const attempts = [];
  const reasons = [];
  const observedTopicIds = new Set(retrievalAttempts.filter(attempt => attempt.fetchStatus === 'SUCCESS')
    .map(attempt => attempt.topicId).filter(Boolean));
  const scopedRegisteredTopics = new Set([...topicIds, ...observedTopicIds]
    .filter(topicId => getCoverageTopicById(topicId)));

  for (const record of liveRecords) {
    const recordTags = [...new Set((record.tags || []).filter(tag => scopedRegisteredTopics.has(tag)))];
    if (!recordTags.length) {
      reasons.push(`${record.id}:MISSING_REGISTERED_TOPIC_TAG`);
      continue;
    }
    const officialIdentity = transportUrlIdentity(record.officialSourceUrl);
    const canonicalIdentity = transportUrlIdentity(record.canonicalSourceUrl);
    if (!officialIdentity || officialIdentity !== canonicalIdentity || !record.contentHash ||
        !/^[a-f\d]{64}$/i.test(record.contentHash) || !record.documentTitle) {
      reasons.push(`${record.id}:SOURCE_METADATA_INCOMPLETE_OR_CONFLICTING`);
      continue;
    }

    const relevantFetches = fetchObservations.filter(observation => observation.status === 'SUCCESS' &&
      (observation.pageTitle === record.documentTitle ||
        (transportUrlIdentity(observation.finalUrl) === officialIdentity && observation.contentHash === record.contentHash)));
    if (!relevantFetches.length) {
      reasons.push(`${record.id}:MISSING_VALIDATED_TITLE_FETCH`);
      continue;
    }
    const fetchIdentity = observation => JSON.stringify([
      transportUrlIdentity(observation.url), transportUrlIdentity(observation.sourceUrl),
      transportUrlIdentity(observation.finalUrl), observation.pageTitle, observation.contentHash
    ]);
    const invalidRelevantFetch = relevantFetches.find(observation => {
      const requestIdentity = transportUrlIdentity(observation.url);
      const sourceIdentity = transportUrlIdentity(observation.sourceUrl);
      const finalIdentity = transportUrlIdentity(observation.finalUrl);
      return observation.topicValidationPresent !== true || observation.topicMatched !== true ||
        observation.titleMatched !== true || observation.contentMatched !== true ||
        !observation.url || !observation.sourceUrl || !observation.finalUrl || !observation.pageTitle ||
        !observation.contentHash || !/^[a-f\d]{64}$/i.test(observation.contentHash) ||
        !requestIdentity || !sourceIdentity || !finalIdentity ||
        observation.pageTitle !== record.documentTitle || observation.contentHash !== record.contentHash ||
        finalIdentity !== officialIdentity || finalIdentity !== canonicalIdentity;
    });
    if (invalidRelevantFetch) {
      reasons.push(`${record.id}:AMBIGUOUS_OR_INCOMPLETE_VALIDATED_TITLE_FETCH`);
      continue;
    }
    const uniqueRelevantFetches = [...new Map(relevantFetches.map(observation =>
      [fetchIdentity(observation), observation])).values()];
    const sameTitleFinalUrls = new Set(relevantFetches.map(observation =>
      transportUrlIdentity(observation.finalUrl)));
    if (uniqueRelevantFetches.length !== 1 || sameTitleFinalUrls.size !== 1) {
      reasons.push(`${record.id}:AMBIGUOUS_OR_INCOMPLETE_VALIDATED_TITLE_FETCH`);
      continue;
    }
    const observedFetch = uniqueRelevantFetches[0];
    const finalIdentity = transportUrlIdentity(observedFetch.finalUrl);
    if (observedFetch.pageTitle !== record.documentTitle || observedFetch.contentHash !== record.contentHash ||
        finalIdentity !== officialIdentity || finalIdentity !== canonicalIdentity) {
      reasons.push(`${record.id}:SOURCE_CONTENT_OR_URL_FETCH_MISMATCH`);
      continue;
    }

    const matchingAssociations = [];
    for (const topicId of recordTags) {
      const topicAttempts = retrievalAttempts.filter(attempt => attempt.topicId === topicId &&
        attempt.fetchStatus === 'SUCCESS' && attempt.pageTitle === record.documentTitle);
      if (topicAttempts.length !== 1) continue;
      const retrievalAttempt = topicAttempts[0];
      matchingAssociations.push({ topicId, retrievalAttempt, observedFetch });
    }
    if (matchingAssociations.length === 0) {
      reasons.push(`${record.id}:NO_UNIQUE_VALIDATED_TOPIC_FETCH`);
      continue;
    }
    selectedRecordIds.push(record.id);
    for (const { topicId, retrievalAttempt, observedFetch } of matchingAssociations) {
      attempts.push({ topicId, fetchStatus: retrievalAttempt.fetchStatus,
        finalUrl: observedFetch.finalUrl, pageTitle: observedFetch.pageTitle,
        titleMatched: observedFetch.titleMatched, contentMatched: observedFetch.contentMatched });
    }
  }
  const trace = { path: 'test_local_observed_source_tag_attempt_fetch_subset',
    selectedRecordIds: [...new Set(selectedRecordIds)],
    finalVerifiedUrls: [...new Set(attempts.map(attempt => attempt.finalUrl))], attempts };
  const complete = reasons.length === 0 && trace.selectedRecordIds.length === liveRecords.length;
  return { complete, reason: complete ? undefined : reasons.join(';') || 'LIVE_SOURCE_NOT_BOUND_TO_OBSERVED_FETCH',
    trace, selectedRecordIds: trace.selectedRecordIds };
}

function observedCandidateSubset(row, planned, issue, controlledRun) {
  const topicIds = new Set(planned.mappedTopicIds);
  const byId = new Map();
  const conflicts = [];
  const evidenceIdentity = record => JSON.stringify([
    record.sourceText, record.contentHash, record.officialSourceUrl, record.canonicalSourceUrl,
    record.documentTitle, record.provenance, record.authority, record.domain,
    record.sourceStatus, [...(record.tags || [])].sort()
  ]);
  const addRecord = (record, source) => {
    const existing = byId.get(record.id);
    if (!existing) {
      byId.set(record.id, { record, source });
      return;
    }
    if (evidenceIdentity(existing.record) !== evidenceIdentity(record)) {
      conflicts.push({ recordId: record.id, sources: [existing.source, source] });
      return;
    }
    if (source === 'actual_returned_source') byId.set(record.id, { record, source });
  };
  for (const group of controlledRun.candidateRecordGroups) {
    if (group.topicIds.some(topicId => topicIds.has(topicId))) {
      for (const record of group.records) addRecord(record, 'actual_through_call_candidate_group');
    }
  }
  for (const record of issue.sources || []) addRecord(record, 'actual_returned_source');
  assert.deepEqual(conflicts, [], `Duplicate source IDs must not hide conflicting observed evidence: ${row.item.caseId}/${issue.issueId}`);
  return [...byId.values()].map(item => item.record);
}

function actualGovernedObservations(row, controlledRun) {
  const expectedByIssue = row.item.governedProductionEvidence.expectedRuleEvidenceByIssue || {};
  return Object.keys(expectedByIssue).map(issueId => {
    const { planned, issue, authority } = actualIssueForExpected(row, controlledRun.result, issueId);
    const isIras = authority === 'IRAS';
    let records;
    let evidenceQuality;
    let observedTrace;
    if (isIras) {
      // The through-call raw local records and returned sources are separate observed subsets, not the initial inventory.
      records = observedCandidateSubset(row, planned, issue, controlledRun);
      observedTrace = observedSourceSubsetTrace(records, planned.mappedTopicIds,
        issue.retrievalTrace?.attempts || [], controlledRun.fetchValidationObservations);
      if (records.some(record => record.provenance === 'LIVE_EXTERNAL')) assert.equal(observedTrace.complete, true,
        `Every observed live IRAS source must bind through an actual registered tag, sanitized success attempt, and validated fetch: ${row.item.caseId}/${issueId} ${observedTrace.reason}`);
      evidenceQuality = replayProductionIrasQuality(row.item.question, row.interpretation, issue.subject,
        issue.population, planned.mappedTopicIds, records, observedTrace.trace);
    } else {
      const topicIds = new Set(planned.mappedTopicIds);
      const byId = new Map();
      for (const group of controlledRun.candidateRecordGroups) {
        if (group.topicIds.some(topicId => topicIds.has(topicId))) {
          for (const record of group.records) byId.set(record.id, record);
        }
      }
      records = [...byId.values()];
    }
    const candidateDiagnostics = records.map(record => {
      const eligibilityGateResult = findRecordEligibilityRejection(record, undefined, referenceDate);
      return { recordId: record.id, sourceStatus: record.sourceStatus,
        eligibilityGateResult, baseEligible: eligibilityGateResult === undefined };
    });
    const rejectedCandidates = candidateDiagnostics.filter(candidate => candidate.eligibilityGateResult !== undefined)
      .map(candidate => ({ ...candidate, eligibilityRejectionCode: candidate.eligibilityGateResult }));
    const requestedConceptCoverage = isIras
      ? issue.lifecycle.covered === true && planned.mappedTopicIds.length > 0 &&
        planned.mappedTopicIds.every(topicId => evidenceQuality.coveredTopicIds?.includes(topicId)) &&
        (evidenceQuality.uncoveredConcepts?.length || 0) === 0 && (evidenceQuality.uncoveredTopicIds?.length || 0) === 0
      : issue.lifecycle.covered === true;
    return { issueId, authority, operation: issue.operation, ruleEvidenceStatus: issue.evidenceStatus,
      providerError: issue.gaps.some(gap => /^(?:RETRIEVAL|PROVIDER|TRANSPORT)_.*(?:FAILED|ERROR)$/.test(gap.code)),
      lifecycle: { ...issue.lifecycle }, gaps: issue.gaps.map(gap => gap.code), candidateCount: records.length,
      candidateInventoryKind: isIras
        ? 'observed_through_call_local_retriever_records_plus_verified_returned_sources_not_full_provider_inventory'
        : 'actual_through_call_retriever_records',
      candidateCountBasis: isIras
        ? 'distinct observed record IDs across planned-topic through-call retriever groups and actual returned sources; not an initial candidate/admission inventory'
        : 'distinct observed record IDs across through-call retriever groups scoped to the planned issue topics',
      observedRecordIds: records.map(record => record.id),
      eligibleRecordIds: evidenceQuality?.eligibleRecords?.map(record => record.id) || [],
      candidateRecordProvenanceCounts: Object.fromEntries([...new Set(records.map(record => record.provenance))]
        .map(provenance => [provenance, records.filter(record => record.provenance === provenance).length])),
      ...(isIras ? { transportBinding: { path: observedTrace.trace.path,
        liveSourceIds: records.filter(record => record.provenance === 'LIVE_EXTERNAL').map(record => record.id),
        boundSourceIds: observedTrace.selectedRecordIds,
        observedAttempts: observedTrace.trace.attempts } } : {}),
      actualReturnedSourceCount: (issue.sources || []).length,
      ...(isIras ? {} : { baseEligibleCandidateCount: candidateDiagnostics.filter(candidate => candidate.baseEligible).length,
        candidateDiagnostics, candidateRecords: records }),
      rejectedCount: isIras ? evidenceQuality.rejectedRecords?.length || 0 : rejectedCandidates.length,
      rejectedCandidates, ...(isIras ? { evidenceQuality } : {}),
      verifiedClaimCount: issue.verifiedClaims.length, requestedConceptCoverage };
  });
}

function scoreControlledRuntime(row, controlledRun) {
  const actualIssues = Object.keys(row.item.application.expectedByIssue || {}).map(issueId => {
    const { issue } = actualIssueForExpected(row, controlledRun.result, issueId);
    return [issueId, issue.applicationStatus];
  });
  const application = scoreApplicationStatusV4(row.item, { byIssue: Object.fromEntries(actualIssues),
    overallStatus: controlledRun.result.status });
  const expectedGovernedIssueIds = Object.keys(row.item.governedProductionEvidence.expectedRuleEvidenceByIssue || {});
  const governedObservations = expectedGovernedIssueIds.length > 0
    ? actualGovernedObservations(row, controlledRun)
    : actualNoRouteGovernedObservation(row, controlledRun.result);
  const governed = scoreGovernedEvidenceV4(row.item, governedObservations);
  const routing = scoreWorkstreamRoutingV4(row.item, row.issuePlan, controlledRun.result);
  const local = localCapabilityRows.find(item => item.caseId === row.item.caseId)?.result;
  assert.ok(local, `Actual local-only capability observation exists: ${row.item.caseId}`);
  const stages = evaluateV4Stages({ semantic: row.semantic, routing, local, governed, application });
  return { routing, local, governed, application, stages, governedObservations };
}

function actualNoRouteGovernedObservation(row, runtime) {
  const plannedIrasIssues = row.issuePlan.issues.filter(issue => issue.governingAuthorities.includes('IRAS'));
  const plannedIrasTopics = [...new Set(plannedIrasIssues.flatMap(issue => issue.mappedTopicIds))];
  const irasWorkstreams = runtime.workstreams.filter(workstream => workstream.authority === 'IRAS');
  const irasIssues = irasWorkstreams.flatMap(workstream => workstream.issues);
  const candidateCount = irasIssues.reduce((sum, issue) => sum + (issue.sources?.length || 0), 0);
  const claimCount = irasIssues.reduce((sum, issue) => sum + (issue.verifiedClaims?.length || 0), 0);
  assert.equal(plannedIrasIssues.length, 0, `${row.item.caseId} issue plan has no IRAS route.`);
  assert.equal(plannedIrasTopics.length, 0, `${row.item.caseId} issue plan has no IRAS mapped topic.`);
  assert.equal(irasWorkstreams.length, 0, `${row.item.caseId} actual runtime has no IRAS workstream.`);
  assert.equal(candidateCount, 0, `${row.item.caseId} actual IRAS workstreams have no returned candidates.`);
  assert.equal(claimCount, 0, `${row.item.caseId} actual IRAS workstreams have no verified claims.`);
  return [{ source: 'actual_issue_plan_and_local_only_runtime', coverageStatus: 'NO_COVERAGE_TOPIC',
    irAsWorkstreamCount: irasWorkstreams.length, plannedIrasIssueCount: plannedIrasIssues.length,
    plannedIrasTopicIds: plannedIrasTopics, candidateCount, claimCount }];
}

const mappedRun = await runControlledIras(privateQuery, privateResolved.issuePlan, privateResolved.understanding, {
  ...withControlledDiscoveryFixtures({ [fixturePageUrl]: { body: mappedHtml, status: 200 } })
});
assertNoControlledFixtureMisses(mappedRun, 'Private-expense qualification positive');
const privateEvidence = mappedRun.result.workstreams.flatMap(workstream => workstream.issues)[0];
assert.ok(mappedRun.requests.includes(fixturePageUrl), 'The real default advanced retriever follows the reviewed mapped IRAS pointer.');
assert.equal(mappedRun.result.workstreams.length, 1);
const privateObservation = {
  evidenceKeys: Object.keys(privateEvidence), retrievalTrace: privateEvidence.retrievalTrace,
  lifecycle: privateEvidence.lifecycle, admission: privateEvidence.admission,
  evidenceQuality: privateEvidence.evidenceQuality, gaps: privateEvidence.gaps,
  evidenceStatus: privateEvidence.evidenceStatus, verifiedClaims: privateEvidence.verifiedClaims?.length,
  sources: privateEvidence.sources?.map(source => source.id), requests: mappedRun.transportObservations
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

const privateMissingQualificationText = 'For income tax, companies may deduct expenses wholly and exclusively incurred in producing income under the general deduction rule in section 14. This explains whether a company expense is tax deductible and whether it is deductible for tax purposes. Private and domestic expenses are not deductible under section 15. This guidance explains the treatment of business expenses for corporate income tax.';
const privateMissingQualificationFixture = syntheticIrasPage('private-expense-treatment', 'negative-missing-qualification',
  [fixturePageUrl], 'Business Expenses | IRAS', privateMissingQualificationText);
const privateMissingQualificationResponses = { [fixturePageUrl]: privateMissingQualificationFixture };
const privateMissingQualificationRun = await runControlledIras(privateQuery, privateResolved.issuePlan,
  privateResolved.understanding, withControlledDiscoveryFixtures(privateMissingQualificationResponses));
const privateMissingQualificationIssue = privateMissingQualificationRun.result.workstreams.flatMap(workstream => workstream.issues)[0];
assertNoControlledFixtureMisses(privateMissingQualificationRun, 'Private-expense missing-qualification negative control');
assert.deepEqual(privateMissingQualificationRun.requests, [fixturePageUrl, controlledSitemapUrl]);
assert.deepEqual(privateMissingQualificationRun.transportObservations.map(item => item.status), [200, 200]);
assert.equal(privateMissingQualificationRun.transportObservations[0].sha256,
  createHash('sha256').update(privateMissingQualificationFixture.body).digest('hex'));
assert.equal(/statutory exceptions|qualifications/i.test(privateMissingQualificationText), false,
  'The fetched private-expense page omits qualification language.');
assert.deepEqual(privateMissingQualificationIssue.retrievalTrace?.attempts?.map(attempt => attempt.fetchStatus), ['SUCCESS']);
assert.deepEqual(privateMissingQualificationIssue.lifecycle, { requested: true, mapped: true, retrievalAttempted: true,
  evidenceFound: true, admitted: true, verified: true, covered: true });
assert.equal(privateMissingQualificationIssue.evidenceStatus, 'VERIFIED');
assert.equal(privateMissingQualificationIssue.applicationStatus, 'UNRESOLVED');
assert.equal(privateMissingQualificationRun.result.status, 'CONDITIONAL');
const privateMissingPageClaim = privateMissingQualificationIssue.verifiedClaims.find(claim => claim.recordId.startsWith('LIVE_TOPIC_'));
const privateMissingPageSource = privateMissingQualificationIssue.sources.find(source => source.id === privateMissingPageClaim?.recordId);
assert.equal(privateMissingPageClaim?.quote, privateMissingQualificationText,
  'The fetched unqualified page remains traceable as its own literal claim.');
assert.equal(privateMissingPageSource?.officialSourceUrl, fixturePageUrl);
assert.equal(privateMissingPageSource?.sourceStatus, 'NEEDS_REVIEW');
const privateRetainedSection15Claim = privateMissingQualificationIssue.verifiedClaims.find(claim =>
  claim.recordId === 'ITA_SEC15_PROHIBITED_DEDUCTIONS');
assert.equal(privateRetainedSection15Claim?.quote, UNIFIED_SOURCE_REGISTRY.ITA_SEC15_PROHIBITED_DEDUCTIONS.sourceText,
  'The local reviewed Section 15 claim retains its statutory qualification despite the fetched page omission.');
assert.match(privateRetainedSection15Claim.quote, /subject to statutory exceptions/i);
console.log(`V4_CONTROLLED_PRIVATE_MISSING_QUALIFICATION ${JSON.stringify(observeControlledIrasRun(privateMissingQualificationRun))}`);

const privateIssue = privateResolved.issuePlan.issues[0];
const privateTopics = privateIssue.mappedTopicIds;
const sec14OnlyQuality = evaluateIrasQuality(privateQuery, privateResolved.understanding, privateIssue.subject,
  privateIssue.population, privateTopics, [UNIFIED_SOURCE_REGISTRY.ITA_SEC14_GENERAL_DEDUCTION]);
const motorcarOnlyQuality = evaluateIrasQuality(privateQuery, privateResolved.understanding, privateIssue.subject,
  privateIssue.population, privateTopics, [UNIFIED_SOURCE_REGISTRY.ITA_SEC15_1_K_MOTOR_CAR]);
const wrongAuthoritySec15 = { ...UNIFIED_SOURCE_REGISTRY.ITA_SEC15_PROHIBITED_DEDUCTIONS,
  authority: 'CPF', sourceAuthority: 'CPF' };
const wrongAuthorityQuality = evaluateIrasQuality(privateQuery, privateResolved.understanding, privateIssue.subject,
  privateIssue.population, privateTopics, [wrongAuthoritySec15]);
const wrongDomainSec15 = { ...UNIFIED_SOURCE_REGISTRY.ITA_SEC15_PROHIBITED_DEDUCTIONS, domain: 'CPF_BOARD' };
const wrongDomainQuality = evaluateIrasQuality(privateQuery, privateResolved.understanding, privateIssue.subject,
  privateIssue.population, privateTopics, [wrongDomainSec15]);
const relevantPointer = Object.values(UNIFIED_SOURCE_REGISTRY).find(record => record.recordRole === 'SOURCE_MAP_POINTER' &&
  record.sourceMapTopicIds?.some(topicId => privateTopics.includes(topicId)));
const pointerQuality = evaluateIrasQuality(privateQuery, privateResolved.understanding, privateIssue.subject,
  privateIssue.population, privateTopics, relevantPointer ? [relevantPointer] : []);
const completeSection15 = UNIFIED_SOURCE_REGISTRY.ITA_SEC15_PROHIBITED_DEDUCTIONS;
// This checks literal whole-source-span enforcement only; the adjacent positive asserts retain the full statutory caveat.
const qualificationAt = completeSection15.sourceText.toLowerCase().indexOf('subject to statutory exceptions');
const incompleteSection15Quote = qualificationAt > 0 ? completeSection15.sourceText.slice(0, qualificationAt).trim() : '';
const incompleteQualificationCheck = verifyEvidenceClaims([{ kind: 'RULE', text: incompleteSection15Quote,
  quote: incompleteSection15Quote, recordId: completeSection15.id }], [completeSection15], { missingFacts: [], targetDate: referenceDate });
const negatedPrivateSupport = supportGeneralIrasRuleConcept({
  sourceText: 'Section 15 does not disallow domestic or private expenses; they remain deductible.',
  domainId: 'IRAS_CORPORATE_TAX', topicIds: ['iras-cit-disallowed-expenses'],
  subject: privateIssue.subject, population: privateIssue.population,
  concepts: getRequestedQuestionConcepts(privateQuery, privateResolved.understanding)
    .filter(concept => concept.topicIds.includes('iras-cit-disallowed-expenses'))
});
const privateGateSummary = quality => ({ covered: quality.coveredTopicIds, uncovered: quality.uncoveredTopicIds,
  eligible: quality.eligibleRecords.map(record => record.id), rejected: quality.rejectedRecords.map(record => ({ id: record.recordId, code: record.code })) });
const whtContractRow = semanticRows.find(row => row.item.caseId === 'wht-royalty-general-rule');
const whtIssuePlan = whtContractRow.issuePlan.issues.find(issue => issue.governingAuthorities.includes('IRAS'));
const whtInterestRecord = UNIFIED_SOURCE_REGISTRY.ITA_SEC45_WITHHOLDING_TAX;
const whtQuality = evaluateIrasQuality(whtContractRow.item.question, whtContractRow.interpretation,
  whtIssuePlan.subject, whtIssuePlan.population, whtIssuePlan.mappedTopicIds, [whtInterestRecord]);
const gstContractRow = semanticRows.find(row => row.item.caseId === 'gst-input-tax-general-rule');
const gstIssuePlan = gstContractRow.issuePlan.issues.find(issue => issue.governingAuthorities.includes('IRAS'));
const gstBlockedRecord = UNIFIED_SOURCE_REGISTRY.GST_REG26_BLOCKED_INPUT_TAX;
const blockedOnlyGstQuality = evaluateIrasQuality(gstContractRow.item.question, gstContractRow.interpretation,
  gstIssuePlan.subject, gstIssuePlan.population, gstIssuePlan.mappedTopicIds, [gstBlockedRecord]);
const exactWhtLiteralCheck = verifyEvidenceClaims([{ kind: 'RULE', text: whtInterestRecord.sourceText,
  quote: whtInterestRecord.sourceText, recordId: whtInterestRecord.id }], [whtInterestRecord], { missingFacts: [], targetDate: referenceDate });
const exactBlockedGstLiteralCheck = verifyEvidenceClaims([{ kind: 'RULE', text: gstBlockedRecord.sourceText,
  quote: gstBlockedRecord.sourceText, recordId: gstBlockedRecord.id }], [gstBlockedRecord], { missingFacts: [], targetDate: referenceDate });
assert.ok(sec14OnlyQuality.eligibleRecords.some(record => record.id === 'ITA_SEC14_GENERAL_DEDUCTION'));
assert.equal(sec14OnlyQuality.coveredTopicIds.includes('iras-cit-disallowed-expenses'), false,
  'Section 14 evidence alone cannot establish the distinct private-expense prohibition topic.');
assert.ok(motorcarOnlyQuality.eligibleRecords.some(record => record.id === 'ITA_SEC15_1_K_MOTOR_CAR'));
assert.equal(motorcarOnlyQuality.coveredTopicIds.includes('iras-cit-disallowed-expenses'), false,
  'A reviewed motor-car rule remains insufficient for the unrelated private-holiday scope.');
assert.equal(wrongAuthorityQuality.eligibleRecords.length, 0);
assert.equal(wrongAuthorityQuality.rejectedRecords.some(item => item.recordId === wrongAuthoritySec15.id), true);
assert.equal(wrongDomainQuality.eligibleRecords.length, 0);
assert.equal(wrongDomainQuality.rejectedRecords.some(item => item.recordId === wrongDomainSec15.id), true);
assert.ok(relevantPointer);
assert.equal(findRecordEligibilityRejection(relevantPointer, undefined, referenceDate), 'SOURCE_RECORD_NOT_GROUNDING_ELIGIBLE');
assert.equal(pointerQuality.eligibleRecords.length, 0);
assert.equal(pointerQuality.rejectedRecords.some(item => item.code === 'SOURCE_MAP_POINTER_NOT_EVIDENCE'), true);
assert.equal(incompleteQualificationCheck.accepted.length, 0);
assert.equal(incompleteQualificationCheck.rejected[0]?.reason, 'QUOTE_NOT_WHOLE_SENTENCE_OR_PARAGRAPH');
assert.equal(negatedPrivateSupport, false, 'Negated private-expense wording cannot satisfy the production IRAS concept-support gate.');
assert.equal(whtQuality.coveredTopicIds.length === whtIssuePlan.mappedTopicIds.length, false,
  'The reviewed interest-only WHT record cannot cover the entire royalty/non-resident scope.');
assert.equal(blockedOnlyGstQuality.coveredTopicIds.includes('iras-gst-input-tax'), false,
  'The reviewed blocked-input-tax record alone cannot establish affirmative general input-tax recovery.');
assert.equal(exactWhtLiteralCheck.accepted.length, 1, 'The source text remains a verifiable WHT rule quotation at literal scope.');
assert.equal(whtQuality.coveredTopicIds.length, 0, 'The verified WHT quotation still lacks the requested royalty topic coverage.');
assert.equal(exactBlockedGstLiteralCheck.accepted.length, 1, 'The source text remains a verifiable blocked-input-tax quotation at literal scope.');
assert.equal(blockedOnlyGstQuality.coveredTopicIds.length, 0, 'The verified blocked-input-tax quotation does not cover general input-tax recovery.');
console.log(`V4_EVIDENCE_GATE_CONTROLS ${JSON.stringify({
  section14Only: privateGateSummary(sec14OnlyQuality), motorcarOnly: privateGateSummary(motorcarOnlyQuality),
  wrongAuthority: privateGateSummary(wrongAuthorityQuality), wrongDomain: privateGateSummary(wrongDomainQuality), pointerOnly: { found: Boolean(relevantPointer),
    rejection: relevantPointer && findRecordEligibilityRejection(relevantPointer, undefined, referenceDate), ...privateGateSummary(pointerQuality) },
  incompleteWholeSpan: incompleteQualificationCheck.rejected, negatedSupport: negatedPrivateSupport,
  whtInterestOnly: { quality: privateGateSummary(whtQuality), literalAccepted: exactWhtLiteralCheck.accepted.length },
  blockedOnlyGst: { quality: privateGateSummary(blockedOnlyGstQuality), literalAccepted: exactBlockedGstLiteralCheck.accepted.length }
})}`);
function onlyRuntimeIssue(caseId) {
  return localRuntimeResults.get(caseId).workstreams.flatMap(stream => stream.issues)[0];
}
for (const [caseId, issueId] of [['wht-royalty-general-rule', 'general-wht-royalty-rules'],
  ['gst-input-tax-general-rule', 'general-gst-input-tax-recovery-rules']]) {
  const issue = onlyRuntimeIssue(caseId);
  assert.equal(issue.lifecycle.retrievalAttempted, true, `${issueId} must be observed after retrieval.`);
  assert.equal(issue.lifecycle.evidenceFound, true, `${issueId} has candidate evidence to evaluate.`);
  assert.equal(issue.lifecycle.admitted, true, `${issueId} has admitted candidates, not a transport failure.`);
  assert.equal(issue.lifecycle.verified, false, `${issueId} has no verified scoped claim.`);
  assert.equal(issue.lifecycle.covered, false, `${issueId} remains incomplete at issue coverage.`);
  assert.equal(issue.verifiedClaims.length, 0);
  assert.ok(issue.gaps.some(gap => gap.code === 'IRAS_SCOPE_NOT_COVERED'));
  assert.ok(issue.gaps.some(gap => gap.code === 'NO_VERIFIED_CLAIM'));
}
const cpfRejectedIssue = localRuntimeResults.get('A-paraphrase-2').workstreams.find(stream => stream.authority === 'CPF').issues[0];
const cpfNeedsReview = localCandidateSearches.get('A-paraphrase-2').flatMap(search => search.records)
  .filter(record => record.sourceStatus === 'NEEDS_REVIEW');
assert.ok(cpfNeedsReview.some(record => record.id === 'CPF_RATES_BY_AGE_2026'));
assert.equal(UNIFIED_SOURCE_REGISTRY.CPF_RATES_BY_AGE_2026.sourceStatus, 'NEEDS_REVIEW');
assert.equal(findRecordEligibilityRejection(UNIFIED_SOURCE_REGISTRY.CPF_RATES_BY_AGE_2026, undefined, referenceDate),
  'LOCAL_SOURCE_NOT_VERIFIED');
assert.equal(cpfRejectedIssue.lifecycle.evidenceFound, true);
assert.equal(cpfRejectedIssue.lifecycle.admitted, false);
assert.equal(cpfRejectedIssue.lifecycle.verified, false);
assert.ok(cpfRejectedIssue.gaps.some(gap => gap.code === 'CANDIDATE_REJECTED'));
const unsupportedRuntime = localRuntimeResults.get('unsupported-sfrsi-6-exploration-evaluation');
assert.equal(unsupportedRuntime.workstreams.some(stream => stream.authority === 'IRAS'), false,
  'Unsupported SFRS(I) 6 wording creates no IRAS workstream.');
assert.equal(onlyRuntimeIssue('unsupported-sfrsi-6-exploration-evaluation').lifecycle.mapped, false);
console.log(`V4_INCOMPLETE_SCOPE_RUNTIME ${JSON.stringify(['wht-royalty-general-rule', 'gst-input-tax-general-rule'].map(caseId => {
  const issue = onlyRuntimeIssue(caseId);
  return { caseId, lifecycle: issue.lifecycle, claimCount: issue.verifiedClaims.length,
    candidateIds: localCandidateSearches.get(caseId).flatMap(search => search.records.map(record => record.id)),
    gaps: issue.gaps.map(gap => gap.code) };
}))}`);

const privateLocalSemanticRow = semanticRows.find(row => row.item.caseId === 'private-expense-treatment');
const privateLocalRuntime = localRuntimeResults.get('private-expense-treatment');
const privateLocalIssue = onlyRuntimeIssue('private-expense-treatment');
const privateLocalRecordsById = new Map(localCandidateRecordGroups.get('private-expense-treatment')
  .flatMap(group => group.records).map(record => [record.id, record]));
const privateLocalRecords = [...privateLocalRecordsById.values()];
const privateLocalPlannedIssue = privateLocalSemanticRow.issuePlan.issues.find(issue => issue.subject === privateLocalIssue.subject);
const privateLocalQuality = replayProductionIrasQuality(privateLocalSemanticRow.item.question,
  privateLocalSemanticRow.interpretation, privateLocalIssue.subject, privateLocalIssue.population,
  privateLocalPlannedIssue.mappedTopicIds, privateLocalRecords);
const privateLocalRequestedConceptCoverage = privateLocalIssue.lifecycle.covered === true &&
  privateLocalPlannedIssue.mappedTopicIds.every(topicId => privateLocalQuality.coveredTopicIds.includes(topicId)) &&
  privateLocalQuality.uncoveredConcepts.length === 0 && privateLocalQuality.uncoveredTopicIds.length === 0;
const privateLocalLifecycleFailure = classifyLifecycleFailure({ lifecycle: privateLocalIssue.lifecycle,
  candidateCount: privateLocalRecords.length, evidenceQuality: privateLocalQuality,
  verifiedClaimCount: privateLocalIssue.verifiedClaims.length, requestedConceptCoverage: privateLocalRequestedConceptCoverage });
const privateLocalExpectedIssueId = Object.keys(privateLocalSemanticRow.item.governedProductionEvidence.expectedRuleEvidenceByIssue)[0];
const privateLocalGovernedObservation = { issueId: privateLocalExpectedIssueId, authority: 'IRAS',
  operation: privateLocalIssue.operation, ruleEvidenceStatus: privateLocalIssue.evidenceStatus,
  providerError: privateLocalIssue.gaps.some(gap => /^(?:RETRIEVAL|PROVIDER|TRANSPORT)_.*(?:FAILED|ERROR)$/.test(gap.code)),
  lifecycle: { ...privateLocalIssue.lifecycle }, candidateCount: privateLocalRecords.length,
  candidateInventoryKind: 'actual_local_only_runtime_candidates',
  actualReturnedSourceCount: privateLocalIssue.sources.length, rejectedCount: privateLocalQuality.rejectedRecords.length,
  rejectedCandidates: [], evidenceQuality: privateLocalQuality,
  verifiedClaimCount: privateLocalIssue.verifiedClaims.length, requestedConceptCoverage: privateLocalRequestedConceptCoverage,
  gaps: privateLocalIssue.gaps.map(gap => gap.code) };
const privateLocalGovernedScore = scoreGovernedEvidenceV4(privateLocalSemanticRow.item, [privateLocalGovernedObservation]);
const privateLocalApplicationScore = scoreApplicationStatusV4(privateLocalSemanticRow.item, {
  byIssue: { [privateLocalExpectedIssueId]: privateLocalIssue.applicationStatus },
  overallStatus: privateLocalRuntime.status
});
const privateLocalRoutingScore = scoreWorkstreamRoutingV4(privateLocalSemanticRow.item,
  privateLocalSemanticRow.issuePlan, privateLocalRuntime);
const privateLocalStages = evaluateV4Stages({ semantic: privateLocalSemanticRow.semantic,
  routing: privateLocalRoutingScore,
  local: localCapabilityRows.find(row => row.caseId === 'private-expense-treatment')?.result,
  governed: privateLocalGovernedScore, application: privateLocalApplicationScore });
assert.deepEqual([...privateLocalRecordsById.keys()].sort(), [
  'ITA_SEC14_GENERAL_DEDUCTION', 'ITA_SEC15_1_K_MOTOR_CAR', 'ITA_SEC15_PROHIBITED_DEDUCTIONS'
]);
assert.equal(privateLocalExpectedIssueId, 'company-private-expense-tax-treatment');
assert.equal(privateLocalIssue.lifecycle.admitted, true);
assert.equal(privateLocalIssue.lifecycle.verified, true);
assert.equal(privateLocalIssue.lifecycle.covered, false);
assert.equal(privateLocalIssue.evidenceStatus, 'INSUFFICIENT');
assert.ok(privateLocalIssue.verifiedClaims.some(claim => claim.recordId === 'ITA_SEC15_PROHIBITED_DEDUCTIONS' &&
  claim.quote === UNIFIED_SOURCE_REGISTRY.ITA_SEC15_PROHIBITED_DEDUCTIONS.sourceText));
assert.ok(privateLocalQuality.coveredTopicIds.includes('iras-cit-disallowed-expenses'));
assert.ok(privateLocalQuality.uncoveredTopicIds.includes('iras-cit-deductibility'));
assert.equal(privateLocalRequestedConceptCoverage, false);
assert.deepEqual(privateLocalLifecycleFailure, { stage: 'REQUESTED_CONCEPT_COVERAGE', state: 'verified_claims_scope_uncovered' });
assert.equal(privateLocalGovernedScore.stages.GOVERNED_RETRIEVAL, true);
assert.equal(privateLocalGovernedScore.stages.EVIDENCE_ADMISSION, true);
assert.equal(privateLocalGovernedScore.stages.CLAIM_VERIFICATION, true);
assert.equal(privateLocalGovernedScore.stages.REQUESTED_CONCEPT_COVERAGE, false);
assert.equal(privateLocalApplicationScore.overallStatus, 'INSUFFICIENT');
assert.equal(privateLocalApplicationScore.applicationStatusesPassed, true);
assert.equal(privateLocalApplicationScore.overallAllowed, false);
assert.equal(privateLocalStages.earliestFailure, 'REQUESTED_CONCEPT_COVERAGE');
console.log(`V4_PRIVATE_LOCAL_RUNTIME_QUALIFICATION_TRACE ${JSON.stringify({
  provenance: 'actual local-only production runtime; prospective governed stage counterpart without transport proof',
  status: privateLocalRuntime.status, evidenceStatus: privateLocalIssue.evidenceStatus,
  lifecycle: privateLocalIssue.lifecycle, gaps: privateLocalIssue.gaps.map(gap => gap.code),
  candidateIds: privateLocalRecords.map(record => record.id),
  returnedSources: privateLocalIssue.sources.map(source => ({ id: source.id, sourceStatus: source.sourceStatus })),
  verifiedClaims: privateLocalIssue.verifiedClaims.map(claim => ({ recordId: claim.recordId, quote: claim.quote })),
  requestedConceptCoverage: privateLocalRequestedConceptCoverage, lifecycleFailure: privateLocalLifecycleFailure,
  governedStages: privateLocalGovernedScore.stages, earliestFailure: privateLocalStages.earliestFailure,
  quality: { eligibleIds: privateLocalQuality.eligibleRecords.map(record => record.id),
    coveredTopicIds: privateLocalQuality.coveredTopicIds, uncoveredTopicIds: privateLocalQuality.uncoveredTopicIds,
    uncoveredConcepts: privateLocalQuality.uncoveredConcepts,
    rejectedRecords: privateLocalQuality.rejectedRecords.map(record => ({ recordId: record.recordId, code: record.code })) }
})}`);

const reliefResolved = semanticResolution(reliefQuery, 'CHECK_ELIGIBILITY', 'individual personal tax relief on compulsory CPF contributions',
  'IRAS_INCOME_TAX', 'INDIVIDUAL');
const discoveredRun = await runControlledIras(reliefQuery, reliefResolved.issuePlan, reliefResolved.understanding, {
  [mappedReliefUrl]: { body: '<html><body>synthetic unavailable mapped response</body></html>', status: 404 },
  'https://www.iras.gov.sg/sitemap': { body: sitemapHtml, status: 200, type: 'application/xml' },
  [discoveredUrl]: { body: reliefHtml, status: 200 }
});
const reliefEvidence = discoveredRun.result.workstreams.flatMap(workstream => workstream.issues)[0];
const discoveryAttempts = reliefEvidence.retrievalTrace?.attempts || [];
assert.deepEqual(discoveredRun.requests, [mappedReliefUrl, 'https://www.iras.gov.sg/sitemap', discoveredUrl],
  'The actual IRAS route tries the mapped URL, consults the sitemap after its miss, then fetches the discovered official URL.');
assert.equal(discoveryAttempts.length, 2);
assert.deepEqual(discoveryAttempts.map(attempt => attempt.fetchStatus), ['HTTP_ERROR', 'SUCCESS']);
assert.equal(discoveryAttempts[0].topicId, 'iras-individual-cpf-relief');
assert.equal(discoveryAttempts[1].topicId, 'iras-individual-cpf-relief');
assert.equal(discoveryAttempts[1].pageTitle, 'Central Provident Fund (CPF) Relief for Employees | IRAS');
assert.equal(discoveredRun.result.status, 'CONDITIONAL');
assert.equal(discoveredRun.result.evidenceStatus, 'VERIFIED');
assert.equal(discoveredRun.result.applicationStatus, 'UNRESOLVED');
assert.equal(reliefEvidence.governingAuthority, 'IRAS');
assert.equal(reliefEvidence.evidenceStatus, 'VERIFIED');
assert.equal(reliefEvidence.applicationStatus, 'UNRESOLVED');
assert.deepEqual(reliefEvidence.lifecycle, { requested: true, mapped: true, retrievalAttempted: true,
  evidenceFound: true, admitted: true, verified: true, covered: true });
assert.deepEqual(reliefEvidence.gaps, []);
assert.equal(reliefEvidence.verifiedClaims.length, 1);
assert.equal(reliefEvidence.verifiedClaims[0].recordId, reliefEvidence.sources[0].id);
assert.equal(reliefEvidence.sources[0].sourceStatus, 'NEEDS_REVIEW',
  'The controlled synthetic page exercises the content gate but retains review status and does not certify current IRAS evidence.');
console.log(`V4_DISCOVERY_RUNTIME ${JSON.stringify({ route: discoveredRun.requests, fetchStages: discoveryAttempts.map(attempt => attempt.fetchStatus),
  issueStatus: reliefEvidence.evidenceStatus, applicationStatus: reliefEvidence.applicationStatus,
  overallStatus: discoveredRun.result.status, sourceStatus: reliefEvidence.sources[0].sourceStatus })}`);

const amountRow = semanticRows.find(row => row.item.caseId === 'target-relief-amount');
const amountResponses = { [mappedReliefUrl]: { body: reliefHtml, status: 200 } };
const amountRun = await runControlledIras(amountRow.item.question, amountRow.issuePlan,
  { mode: 'SEMANTIC_INTERPRETATION', interpretation: amountRow.interpretation }, amountResponses);
const amountIssue = actualIssueForExpected(amountRow, amountRun.result, 'personal-cpf-relief-amount').issue;
assert.ok(amountRun.requests.includes(mappedReliefUrl));
assert.equal(amountIssue.operation, 'CALCULATE');
assert.deepEqual(amountIssue.lifecycle, { requested: true, mapped: true, retrievalAttempted: true,
  evidenceFound: true, admitted: true, verified: true, covered: true });
assert.equal(amountIssue.evidenceStatus, 'VERIFIED');
assert.equal(amountIssue.applicationStatus, 'UNRESOLVED');
assert.equal(amountRun.result.status, 'CONDITIONAL');
assert.equal(amountRun.result.applicationStatus, 'UNRESOLVED');
assertClaimsBoundToSyntheticResponses(amountIssue, amountResponses, 'target-relief-amount');
const amountPlannedIssue = actualIssueForExpected(amountRow, amountRun.result, 'personal-cpf-relief-amount').planned;
const amountObservedTrace = observedSourceSubsetTrace(amountIssue.sources, amountPlannedIssue.mappedTopicIds,
  amountIssue.retrievalTrace.attempts, amountRun.fetchValidationObservations);
assert.equal(amountObservedTrace.complete, true,
  `The amount source binds to its actual tagged topic, observed content hash, unique fetch, and success attempt: ${JSON.stringify({
    reason: amountObservedTrace.reason,
    sources: amountIssue.sources.map(({ id, tags, relatedTopicIds, sourceMapTopicIds, documentTitle, officialSourceUrl,
      canonicalSourceUrl, contentHash, contentHashAlgorithm }) => ({ id, tags, relatedTopicIds, sourceMapTopicIds,
      documentTitle, officialSourceUrl, canonicalSourceUrl, contentHash, contentHashAlgorithm })),
    attempts: amountIssue.retrievalTrace.attempts.map(({ topicId, fetchStatus, pageTitle }) => ({ topicId, fetchStatus, pageTitle })),
    fetches: amountRun.fetchValidationObservations.map(({ topicId, topicValidationPresent, contentHash, sourceUrl,
      finalUrl, pageTitle, topicMatched, titleMatched, contentMatched }) => ({ topicId, topicValidationPresent,
      contentHash, sourceUrl, finalUrl, pageTitle, topicMatched, titleMatched, contentMatched }))
  })}`);
const ambiguousAmountTrace = observedSourceSubsetTrace(amountIssue.sources, amountPlannedIssue.mappedTopicIds,
  amountIssue.retrievalTrace.attempts, [...amountRun.fetchValidationObservations,
    { ...amountRun.fetchValidationObservations[0], finalUrl: 'https://www.iras.gov.sg/taxes/iras-conflicting-final-url' }]);
assert.equal(ambiguousAmountTrace.complete, false,
  'A conflicting final URL for the same observed page title cannot rescue an ambiguous trace join.');
const amountGovernedObservations = actualGovernedObservations(amountRow, amountRun);
const amountStages = scoreControlledRuntime(amountRow, amountRun);
assert.equal(amountStages.routing.passed, true);
const amountObservationSummary = { stages: amountStages.stages.stages,
  observations: amountGovernedObservations.map(item => ({ issueId: item.issueId,
    candidateCount: item.candidateCount, lifecycle: item.lifecycle, quality: {
      eligible: item.evidenceQuality.eligibleRecords.map(record => record.id),
      rejected: item.evidenceQuality.rejectedRecords.map(record => ({ id: record.recordId, code: record.code })),
      covered: item.evidenceQuality.coveredTopicIds, uncoveredTopics: item.evidenceQuality.uncoveredTopicIds,
      uncoveredConcepts: item.evidenceQuality.uncoveredConcepts } })) };
assert.deepEqual(Object.values(amountStages.stages.stages), Array(Object.keys(amountStages.stages.stages).length).fill(true),
  `The controlled amount run passes all observed V4 stages while leaving its application unresolved: ${JSON.stringify(amountObservationSummary)}`);

const mixedRow = semanticRows.find(row => row.item.caseId === 'A-paraphrase-2');
const mixedResponses = { [mappedReliefUrl]: { body: reliefHtml, status: 200 } };
const mixedRun = await runControlledIras(mixedRow.item.question, mixedRow.issuePlan,
  { mode: 'SEMANTIC_INTERPRETATION', interpretation: mixedRow.interpretation }, mixedResponses);
const mixedIrasIssue = actualIssueForExpected(mixedRow, mixedRun.result, 'individual-cpf-tax-relief').issue;
const mixedCpfIssue = actualIssueForExpected(mixedRow, mixedRun.result, 'employer-cpf-contribution').issue;
assert.equal(mixedIrasIssue.operation, 'CHECK_ELIGIBILITY');
assert.equal(mixedIrasIssue.evidenceStatus, 'VERIFIED');
assert.equal(mixedIrasIssue.applicationStatus, 'UNRESOLVED');
assertClaimsBoundToSyntheticResponses(mixedIrasIssue, mixedResponses, 'A-paraphrase-2 IRAS relief');
assert.equal(mixedCpfIssue.operation, 'CALCULATE');
assert.equal(mixedCpfIssue.evidenceStatus, 'INSUFFICIENT');
assert.equal(mixedCpfIssue.applicationStatus, 'UNRESOLVED');
assert.equal(mixedCpfIssue.lifecycle.admitted, false);
assert.equal(mixedCpfIssue.lifecycle.verified, false);
assert.equal(mixedCpfIssue.lifecycle.covered, false);
assert.equal(mixedCpfIssue.verifiedClaims.length, 0);
assert.ok(mixedCpfIssue.gaps.some(gap => gap.code === 'CANDIDATE_REJECTED'));
const mixedCpfCandidates = [...new Map(mixedRun.candidateRecordGroups
  .filter(group => group.topicIds.includes('cpf_contribution_rates'))
  .flatMap(group => group.records).map(record => [record.id, record])).values()];
assert.ok(mixedCpfCandidates.length > 0, 'The CPF rejection observation comes from captured through-call candidate records.');
assert.ok(mixedCpfCandidates.some(record => record.sourceStatus === 'NEEDS_REVIEW' &&
  findRecordEligibilityRejection(record, undefined, referenceDate) === 'LOCAL_SOURCE_NOT_VERIFIED'));
assert.equal(mixedRun.result.status, 'INSUFFICIENT');
assert.equal(mixedRun.result.applicationStatus, 'UNRESOLVED');
const actualMixedObservations = actualGovernedObservations(mixedRow, mixedRun);
const mixedStages = scoreControlledRuntime(mixedRow, mixedRun);
assert.equal(mixedStages.routing.passed, true);
assert.equal(mixedStages.governed.stages.GOVERNED_RETRIEVAL, true);
assert.equal(mixedStages.governed.stages.EVIDENCE_ADMISSION, true);
assert.equal(mixedStages.governed.stages.CLAIM_VERIFICATION, true,
  `The expected partial CPF result passes only with an observed NEEDS_REVIEW rejection and independently verified IRAS rule: ${JSON.stringify({
    diagnostics: mixedStages.governed.lifecycleDiagnostics.map(item => ({ issueId: item.issueId,
      expectedStatus: item.expectedStatus, actualStatus: item.actualStatus, statusPass: item.statusPass,
      retrieved: item.retrieved, admitted: item.admitted, verified: item.verified, covered: item.covered,
      partialRejectionPass: item.partialRejectionPass })),
    observations: actualMixedObservations.map(item => ({ issueId: item.issueId, authority: item.authority,
      operation: item.operation, status: item.ruleEvidenceStatus, lifecycle: item.lifecycle, candidateCount: item.candidateCount,
      eligibleCandidateCount: item.eligibleCandidateCount, rejectedCandidates: item.rejectedCandidates, gaps: item.gaps }))
  })}`);
assert.equal(mixedStages.governed.stages.REQUESTED_CONCEPT_COVERAGE, true);
assert.equal(mixedStages.application.passed, true);
assert.equal(mixedStages.stages.earliestFailure, undefined);
const partialCpfObservation = actualMixedObservations.find(item => item.issueId === 'employer-cpf-contribution');
assert.equal(partialCpfObservation.actualReturnedSourceCount, 0,
  'The actual CPF workstream exposes no issue-scoped admitted source records.');
assert.equal(partialCpfObservation.baseEligibleCandidateCount, 3,
  'Three raw CPF candidates pass the base record verifier but are not admitted to this issue scope.');
assert.deepEqual(partialCpfObservation.candidateDiagnostics.map(item => [item.recordId, item.sourceStatus, item.eligibilityGateResult]), [
  ['CPFA_SEC7_FIRST_SCHEDULE', 'VERIFIED', undefined],
  ['CPF_RATES_BY_AGE_2026', 'NEEDS_REVIEW', 'LOCAL_SOURCE_NOT_VERIFIED'],
  ['CPF_WAGE_CEILINGS_2026', 'VERIFIED', undefined],
  ['CPF_ACCOUNT_ALLOCATION_RATES', 'VERIFIED', undefined],
  ['CPF_SDL_SKILLS_DEVELOPMENT_LEVY', 'NEEDS_REVIEW', 'LOCAL_SOURCE_NOT_VERIFIED']
], 'All five actual CPF candidates and their base-verifier outcomes remain visible as diagnostics.');
const scoreMixedMutation = observations => scoreGovernedEvidenceV4(mixedRow.item, observations);
const forgedAdmission = structuredClone(actualMixedObservations);
const forgedAdmissionCpf = forgedAdmission.find(item => item.issueId === 'employer-cpf-contribution');
forgedAdmissionCpf.lifecycle.admitted = true;
forgedAdmissionCpf.actualReturnedSourceCount = 1;
assert.equal(scoreMixedMutation(forgedAdmission).stages.CLAIM_VERIFICATION, false,
  'Forged CPF admission cannot pass the partial-result claim gate.');
const forgedCpfVerification = structuredClone(actualMixedObservations);
const forgedCpfVerifiedRow = forgedCpfVerification.find(item => item.issueId === 'employer-cpf-contribution');
assert.equal(forgedCpfVerifiedRow.ruleEvidenceStatus, 'INSUFFICIENT',
  'The forged verification mutation keeps the actual insufficient status label.');
forgedCpfVerifiedRow.lifecycle.admitted = true;
forgedCpfVerifiedRow.lifecycle.verified = true;
forgedCpfVerifiedRow.lifecycle.covered = true;
forgedCpfVerifiedRow.verifiedClaimCount = 1;
forgedCpfVerifiedRow.actualReturnedSourceCount = 1;
assert.equal(scoreMixedMutation(forgedCpfVerification).stages.CLAIM_VERIFICATION, false,
  'Forged CPF verification cannot turn unsupported contribution calculation into a pass.');
const wrongCpfRejectionStatus = structuredClone(actualMixedObservations);
wrongCpfRejectionStatus.find(item => item.issueId === 'employer-cpf-contribution').rejectedCandidates
  .find(candidate => candidate.recordId === 'CPF_RATES_BY_AGE_2026').sourceStatus = 'VERIFIED';
assert.equal(scoreMixedMutation(wrongCpfRejectionStatus).stages.CLAIM_VERIFICATION, false,
  'A rejected CPF candidate with the wrong status cannot satisfy the reviewed rejection expectation.');
const wrongCpfRejectionCode = structuredClone(actualMixedObservations);
wrongCpfRejectionCode.find(item => item.issueId === 'employer-cpf-contribution').rejectedCandidates
  .find(candidate => candidate.recordId === 'CPF_RATES_BY_AGE_2026').eligibilityRejectionCode = 'UNRELATED_REJECTION';
assert.equal(scoreMixedMutation(wrongCpfRejectionCode).stages.CLAIM_VERIFICATION, false,
  'A rejection code that differs from the existing verifier result cannot satisfy the partial-result gate.');
const unrelatedRejectionOnly = structuredClone(actualMixedObservations);
unrelatedRejectionOnly.find(item => item.issueId === 'employer-cpf-contribution').rejectedCandidates =
  unrelatedRejectionOnly.find(item => item.issueId === 'employer-cpf-contribution').rejectedCandidates
    .filter(candidate => candidate.recordId !== 'CPF_RATES_BY_AGE_2026');
assert.equal(scoreMixedMutation(unrelatedRejectionOnly).stages.CLAIM_VERIFICATION, false,
  'The employer contribution-topic record must be the rejected candidate; the unrelated SDL rejection cannot substitute.');
const forgedCpfSource = structuredClone(actualMixedObservations);
forgedCpfSource.find(item => item.issueId === 'employer-cpf-contribution').actualReturnedSourceCount = 1;
assert.equal(scoreMixedMutation(forgedCpfSource).stages.CLAIM_VERIFICATION, false,
  'Any returned CPF source record invalidates the expected rejected-only partial result.');
const missingCpfAdmissionGap = structuredClone(actualMixedObservations);
missingCpfAdmissionGap.find(item => item.issueId === 'employer-cpf-contribution').gaps = ['CANDIDATE_REJECTED'];
assert.equal(scoreMixedMutation(missingCpfAdmissionGap).stages.CLAIM_VERIFICATION, false,
  'The partial result requires actual no-admitted-evidence diagnostics.');
const missingCpfLifecycleFlag = structuredClone(actualMixedObservations);
delete missingCpfLifecycleFlag.find(item => item.issueId === 'employer-cpf-contribution').lifecycle.admitted;
assert.equal(scoreMixedMutation(missingCpfLifecycleFlag).stages.CLAIM_VERIFICATION, false,
  'Missing CPF lifecycle admission state fails closed.');

const emptySitemapHtml = '<?xml version="1.0"?><urlset></urlset>';
const mixedFailureResponses = {
  [mappedReliefUrl]: { body: '<html><body>synthetic unavailable mapped response</body></html>', status: 404 },
  'https://www.iras.gov.sg/sitemap': { body: emptySitemapHtml, status: 200, type: 'application/xml' },
  'https://www.iras.gov.sg/robots.txt': { body: 'User-agent: *\nDisallow:', status: 200, type: 'text/plain' }
};
const mixedFailureRun = await runControlledIras(mixedRow.item.question, mixedRow.issuePlan,
  { mode: 'SEMANTIC_INTERPRETATION', interpretation: mixedRow.interpretation }, mixedFailureResponses);
const failedMixedIrasIssue = actualIssueForExpected(mixedRow, mixedFailureRun.result, 'individual-cpf-tax-relief').issue;
const failedMixedCpfIssue = actualIssueForExpected(mixedRow, mixedFailureRun.result, 'employer-cpf-contribution').issue;
assert.deepEqual(mixedFailureRun.requests, [mappedReliefUrl, 'https://www.iras.gov.sg/sitemap', 'https://www.iras.gov.sg/robots.txt'],
  'The negative mixed transport follows the mapped 404, supplied empty sitemap, and supplied robots response without ambient network access.');
assert.equal(mixedFailureRun.requests.every(url => Object.hasOwn(mixedFailureResponses, url)), true,
  'Every actual requested URL has an explicit controlled response; a missing-fixture exception is not the tested failure.');
assert.deepEqual(mixedFailureRun.transportObservations.map(({ url, status }) => ({ url, status })), [
  { url: mappedReliefUrl, status: 404 }, { url: 'https://www.iras.gov.sg/sitemap', status: 200 },
  { url: 'https://www.iras.gov.sg/robots.txt', status: 200 }
]);
assert.equal(mixedFailureRun.transportObservations.every(observation => {
  const response = mixedFailureResponses[observation.url];
  return observation.synthetic === true && observation.bodyBytes === Buffer.byteLength(response.body) &&
    observation.sha256 === createHash('sha256').update(response.body).digest('hex');
}), true, 'The mixed transport diagnostic binds each URL/status/body length to the exact supplied synthetic response bytes.');
assert.equal(failedMixedIrasIssue.evidenceStatus, 'INSUFFICIENT');
assert.equal(failedMixedIrasIssue.applicationStatus, 'UNRESOLVED');
assert.equal(failedMixedIrasIssue.verifiedClaims.length, 0);
assert.equal(failedMixedCpfIssue.evidenceStatus, 'INSUFFICIENT');
assert.ok(failedMixedCpfIssue.gaps.some(gap => gap.code === 'CANDIDATE_REJECTED'));
assert.equal(mixedFailureRun.result.status, 'INSUFFICIENT');
assert.equal(mixedFailureRun.result.applicationStatus, 'UNRESOLVED');
const failedMixedStages = scoreControlledRuntime(mixedRow, mixedFailureRun);
assert.equal(failedMixedStages.governed.stages.GOVERNED_RETRIEVAL, false,
  'The independent IRAS transport failure fails governed retrieval despite the expected CPF partial result.');
assert.equal(failedMixedStages.stages.earliestFailure, 'GOVERNED_RETRIEVAL');
assert.equal(partialCpfObservation.ruleEvidenceStatus, 'INSUFFICIENT');
console.log(`V4_CONTROLLED_CPF_RELIEF_AMOUNT ${JSON.stringify({ lifecycle: amountIssue.lifecycle,
  evidenceStatus: amountIssue.evidenceStatus, applicationStatus: amountIssue.applicationStatus,
  overall: amountRun.result.status, sourceInventory: actualGovernedObservations(amountRow, amountRun)[0].candidateInventoryKind,
  stages: amountStages.stages.stages })}`);
console.log(`V4_CONTROLLED_MIXED_CPF_RELIEF ${JSON.stringify({ positive: { iras: mixedIrasIssue.lifecycle,
  cpf: mixedCpfIssue.lifecycle, cpfCandidateCount: mixedCpfCandidates.length, cpfRejectedStatus: partialCpfObservation.rejectedCandidates.map(item => item.sourceStatus),
  overall: mixedRun.result.status, stages: mixedStages.stages.stages }, negative: { requests: mixedFailureRun.requests,
  transport: mixedFailureRun.transportObservations,
  iras: failedMixedIrasIssue.lifecycle, cpf: failedMixedCpfIssue.lifecycle, overall: mixedFailureRun.result.status,
  earliestFailure: failedMixedStages.stages.earliestFailure } })}`);

const foreignIncomeUrl = 'https://www.iras.gov.sg/taxes/corporate-income-tax/income-deductions-for-companies/companies-receiving-foreign-income';
const foreignRow = semanticRows.find(row => row.item.caseId === 'foreign-dividend-receipt-treatment');
const foreignPositiveFixture = syntheticIrasPage('foreign-dividend-receipt-treatment', 'positive', [foreignIncomeUrl], 'Companies Receiving Foreign Income | IRAS',
  'Foreign-sourced income includes dividends. For a company, foreign-sourced dividends received in Singapore are taxable when received, unless an applicable statutory exemption applies. The company must satisfy the specified conditions for that exemption.');
const foreignNegativeFixture = syntheticIrasPage('foreign-dividend-receipt-treatment', 'negative', [foreignIncomeUrl], 'Companies Receiving Foreign Income | IRAS',
  'Foreign-sourced income is considered under corporate income tax. Dividends received by a Singapore company from a domestic source are recorded as dividend income. This page describes dividends paid by a company to shareholders, not foreign-sourced dividends received by a company.');
const foreignPositiveResponses = { [foreignIncomeUrl]: foreignPositiveFixture };
const foreignPositiveRun = await runControlledIras(foreignRow.item.question, foreignRow.issuePlan,
  { mode: 'SEMANTIC_INTERPRETATION', interpretation: foreignRow.interpretation },
  withControlledDiscoveryFixtures(foreignPositiveResponses));
const foreignNegativeRun = await runControlledIras(foreignRow.item.question, foreignRow.issuePlan,
  { mode: 'SEMANTIC_INTERPRETATION', interpretation: foreignRow.interpretation },
  withControlledDiscoveryFixtures({ [foreignIncomeUrl]: foreignNegativeFixture }));
const foreignPayerOnlyText = 'For corporate income tax, foreign-sourced income includes dividends distributed by a company. The company paying an overseas dividend distributes that income to its shareholders.';
const foreignOtherIncomeOnlyText = 'Foreign-sourced income received by a Singapore company includes service income from services performed overseas and interest earned on foreign deposits. Foreign-sourced service and interest income is considered under company income tax.';
const foreignPayerOnlyResponses = { [foreignIncomeUrl]: syntheticIrasPage('foreign-dividend-receipt-treatment',
  'negative-payer-only', [foreignIncomeUrl], 'Companies Receiving Foreign Income | IRAS', foreignPayerOnlyText) };
const foreignOtherIncomeOnlyResponses = { [foreignIncomeUrl]: syntheticIrasPage('foreign-dividend-receipt-treatment',
  'negative-other-income-only', [foreignIncomeUrl], 'Companies Receiving Foreign Income | IRAS', foreignOtherIncomeOnlyText) };
const foreignPayerOnlyRun = await runControlledIras(foreignRow.item.question, foreignRow.issuePlan,
  { mode: 'SEMANTIC_INTERPRETATION', interpretation: foreignRow.interpretation },
  withControlledDiscoveryFixtures(foreignPayerOnlyResponses));
const foreignOtherIncomeOnlyRun = await runControlledIras(foreignRow.item.question, foreignRow.issuePlan,
  { mode: 'SEMANTIC_INTERPRETATION', interpretation: foreignRow.interpretation },
  withControlledDiscoveryFixtures(foreignOtherIncomeOnlyResponses));
for (const [label, run] of [
  ['foreign payer-only', foreignPayerOnlyRun], ['foreign other-income-only', foreignOtherIncomeOnlyRun]
]) {
  assertNoControlledFixtureMisses(run, label);
  assert.equal(run.transportObservations[0]?.url, foreignIncomeUrl);
  assert.equal(run.transportObservations[0]?.status, 200);
  const issue = run.result.workstreams.flatMap(workstream => workstream.issues)[0];
  assert.ok(issue.retrievalTrace?.attempts?.some(attempt => attempt.fetchStatus === 'SUCCESS'),
    `${label} passes the actual IRAS page-topic transport check.`);
  assert.deepEqual(issue.lifecycle, { requested: true, mapped: true, retrievalAttempted: true,
    evidenceFound: true, admitted: false, verified: false, covered: false });
  assert.equal(issue.evidenceStatus, 'INSUFFICIENT');
  assert.equal(issue.verifiedClaims.length, 0);
  assert.ok(issue.gaps.some(gap => gap.code === 'NO_ADMITTED_EVIDENCE'));
  assert.equal(issue.applicationStatus, 'UNRESOLVED');
  assert.equal(run.result.status, 'INSUFFICIENT');
  assert.equal(run.result.applicationStatus, 'UNRESOLVED');
}
assert.equal(/\breceived\b/i.test(foreignPayerOnlyText), false,
  'Payer-only evidence does not state that a Singapore company received the dividend.');
assert.equal(/\bdividend/i.test(foreignOtherIncomeOnlyText), false,
  'Other-income evidence is limited to foreign service income and interest.');
const foreignPositiveIssue = foreignPositiveRun.result.workstreams.flatMap(stream => stream.issues)[0];
const foreignNegativeIssue = foreignNegativeRun.result.workstreams.flatMap(stream => stream.issues)[0];
const foreignPositiveDiagnostic = { requests: foreignPositiveRun.transportObservations, retrievalTrace: foreignPositiveIssue.retrievalTrace,
  lifecycle: foreignPositiveIssue.lifecycle, gaps: foreignPositiveIssue.gaps, evidenceStatus: foreignPositiveIssue.evidenceStatus,
  claims: foreignPositiveIssue.verifiedClaims?.length, sourceIds: foreignPositiveIssue.sources?.map(source => source.id) };
assert.ok(foreignPositiveRun.requests.includes(foreignIncomeUrl));
assert.equal(foreignPositiveIssue.evidenceStatus, 'VERIFIED',
  `The synthetic received-foreign-dividend rule passes the actual governed evidence path: ${JSON.stringify(foreignPositiveDiagnostic)}`);
assert.deepEqual(foreignPositiveIssue.lifecycle, { requested: true, mapped: true, retrievalAttempted: true,
  evidenceFound: true, admitted: true, verified: true, covered: true });
assertClaimsBoundToSyntheticResponses(foreignPositiveIssue, foreignPositiveResponses, 'foreign-dividend-receipt-treatment');
assert.equal(foreignPositiveIssue.applicationStatus, 'UNRESOLVED');
assert.equal(foreignPositiveRun.result.status, 'CONDITIONAL');
assert.equal(foreignPositiveRun.result.applicationStatus, 'UNRESOLVED');
assert.equal(foreignPositiveIssue.sources[0].sourceStatus, 'NEEDS_REVIEW', 'Synthetic transport never upgrades source trust.');
assert.ok(foreignNegativeRun.requests.includes(foreignIncomeUrl));
assert.equal(foreignNegativeIssue.lifecycle.evidenceFound, true);
assert.equal(foreignNegativeIssue.lifecycle.admitted, false);
assert.equal(foreignNegativeIssue.lifecycle.verified, false);
assert.equal(foreignNegativeIssue.lifecycle.covered, false);
assert.equal(foreignNegativeIssue.evidenceStatus, 'INSUFFICIENT', 'Domestic and payer-side wording cannot prove the foreign-dividend receipt rule.');
assert.equal(foreignNegativeIssue.verifiedClaims.length, 0);
assert.ok(foreignNegativeIssue.gaps.some(gap => gap.code === 'NO_ADMITTED_EVIDENCE'));
assert.equal(foreignNegativeIssue.applicationStatus, 'UNRESOLVED');
assert.equal(foreignNegativeRun.result.status, 'INSUFFICIENT');
assert.equal(foreignNegativeRun.result.applicationStatus, 'UNRESOLVED');
for (const run of [foreignPositiveRun, foreignNegativeRun]) assertNoControlledFixtureMisses(run, 'Foreign-dividend control');
console.log(`V4_CONTROLLED_FOREIGN_DIVIDEND ${JSON.stringify({ positive: { lifecycle: foreignPositiveIssue.lifecycle,
  evidenceStatus: foreignPositiveIssue.evidenceStatus, applicationStatus: foreignPositiveIssue.applicationStatus,
  overall: foreignPositiveRun.result.status }, negative: { lifecycle: foreignNegativeIssue.lifecycle,
  evidenceStatus: foreignNegativeIssue.evidenceStatus, claims: foreignNegativeIssue.verifiedClaims.length,
  stages: foreignNegativeIssue.retrievalTrace?.attempts?.map(attempt => attempt.fetchStatus), gaps: foreignNegativeIssue.gaps.map(gap => gap.code),
  applicationStatus: foreignNegativeIssue.applicationStatus, overall: foreignNegativeRun.result.status },
  payerOnly: observeControlledIrasRun(foreignPayerOnlyRun), otherIncomeOnly: observeControlledIrasRun(foreignOtherIncomeOnlyRun) })}`);

const residencyUrl = 'https://www.iras.gov.sg/taxes/corporate-income-tax/basics-of-corporate-income-tax/tax-residency-of-a-company-certificate-of-residence';
const residencyRow = semanticRows.find(row => row.item.caseId === 'corporate-residency-general-rule');
const residencyTitle = 'Tax Residency of a Company/ Certificate of Residence | IRAS';
const residencyPositiveFixture = syntheticIrasPage('corporate-residency-general-rule', 'positive', [residencyUrl], residencyTitle,
  'For Singapore corporate income tax, a company is tax resident in Singapore when its control and management are exercised in Singapore. The residence analysis concerns where the company’s control and management is exercised, rather than relying only on its place of incorporation. A certificate of residence confirms a company’s tax-resident status.');
const residencyNegativeFixture = syntheticIrasPage('corporate-residency-general-rule', 'negative', [residencyUrl], residencyTitle,
  'This section describes individual income-tax residency based on an individual’s days of presence in Singapore during the relevant year. It does not state a corporate tax-residency test.');
const residencyResponses = fixture => ({ [residencyUrl]: fixture });
const residencyPositiveResponses = residencyResponses(residencyPositiveFixture);
const residencyPositiveRun = await runControlledIras(residencyRow.item.question, residencyRow.issuePlan,
  { mode: 'SEMANTIC_INTERPRETATION', interpretation: residencyRow.interpretation }, residencyPositiveResponses);
const residencyNegativeRun = await runControlledIras(residencyRow.item.question, residencyRow.issuePlan,
  { mode: 'SEMANTIC_INTERPRETATION', interpretation: residencyRow.interpretation }, residencyResponses(residencyNegativeFixture));
const residencyPositiveIssue = residencyPositiveRun.result.workstreams.flatMap(stream => stream.issues)[0];
const residencyNegativeIssue = residencyNegativeRun.result.workstreams.flatMap(stream => stream.issues)[0];
assert.ok(residencyPositiveRun.requests.includes(residencyUrl));
assert.deepEqual(residencyPositiveIssue.lifecycle, { requested: true, mapped: true, retrievalAttempted: true,
  evidenceFound: true, admitted: true, verified: true, covered: true });
assertClaimsBoundToSyntheticResponses(residencyPositiveIssue, residencyPositiveResponses, 'corporate-residency-general-rule');
assert.equal(residencyPositiveIssue.evidenceStatus, 'VERIFIED');
assert.equal(residencyPositiveIssue.applicationStatus, 'NOT_REQUIRED');
assert.equal(residencyPositiveRun.result.status, 'VERIFIED');
assert.equal(residencyPositiveRun.result.applicationStatus, 'NOT_REQUIRED');
assert.equal(residencyPositiveIssue.sources[0].sourceStatus, 'NEEDS_REVIEW');
assert.ok(residencyNegativeRun.requests.includes(residencyUrl));
assert.equal(residencyNegativeIssue.evidenceStatus, 'INSUFFICIENT', 'Individual residency material cannot prove company tax residency.');
assert.deepEqual(residencyNegativeIssue.lifecycle, { requested: true, mapped: true, retrievalAttempted: true,
  evidenceFound: false, admitted: false, verified: false, covered: false });
assert.ok(residencyNegativeIssue.retrievalTrace?.attempts?.some(attempt => attempt.fetchStatus === 'TOPIC_MISMATCH'));
assert.equal(residencyNegativeIssue.verifiedClaims.length, 0);
assert.equal(residencyNegativeIssue.applicationStatus, 'NOT_REQUIRED');
assert.equal(residencyNegativeRun.result.status, 'INSUFFICIENT');
assert.equal(residencyNegativeRun.result.applicationStatus, 'NOT_REQUIRED');
console.log(`V4_CONTROLLED_RESIDENCY ${JSON.stringify({ positive: { lifecycle: residencyPositiveIssue.lifecycle,
  evidenceStatus: residencyPositiveIssue.evidenceStatus, applicationStatus: residencyPositiveIssue.applicationStatus,
  overall: residencyPositiveRun.result.status }, negative: { lifecycle: residencyNegativeIssue.lifecycle,
  evidenceStatus: residencyNegativeIssue.evidenceStatus, claims: residencyNegativeIssue.verifiedClaims.length,
  stages: residencyNegativeIssue.retrievalTrace?.attempts?.map(attempt => attempt.fetchStatus), gaps: residencyNegativeIssue.gaps.map(gap => gap.code),
  applicationStatus: residencyNegativeIssue.applicationStatus, overall: residencyNegativeRun.result.status } })}`);

const whtUrlsAndTitles = [
  ['https://www.iras.gov.sg/taxes/withholding-tax/basics-of-withholding-tax/types-of-payment-and-withholding-tax-rates',
    'Types of Payment & the Applicable Withholding Tax Rates | IRAS'],
  ['https://www.iras.gov.sg/taxes/withholding-tax/payments-to-non-resident-company/payments-that-are-subject-to-withholding-tax',
    'Payments that are subject to withholding tax | IRAS'],
  ['https://www.iras.gov.sg/taxes/withholding-tax/basics-of-withholding-tax/overview-of-withholding-tax-(WHT)',
    'Overview of Withholding Tax (WHT) | IRAS']
];
const whtRow = semanticRows.find(row => row.item.caseId === 'wht-royalty-general-rule');
const whtPositiveText = 'Withholding tax applies to royalty payments to a non-resident company. This synthetic summary is limited to a royalty payment by a Singapore company to a non-resident corporate recipient; the applicable treatment depends on the payment facts and any available relief.';
const whtInterestOnlyText = 'Withholding tax applies to interest payments to non-resident companies. Royalties are listed as a payment type, but this text does not establish a royalty rule for payments to non-resident companies.';
const whtMissingRecipientText = 'Withholding tax applies to royalty payments to a foreign recipient. This description does not state that the recipient is a non-resident company.';
const whtPositiveResponses = syntheticIrasResponses('wht-royalty-general-rule', 'positive', whtUrlsAndTitles, whtPositiveText);
const whtPositiveRun = await runControlledIras(whtRow.item.question, whtRow.issuePlan,
  { mode: 'SEMANTIC_INTERPRETATION', interpretation: whtRow.interpretation }, whtPositiveResponses);
const whtInterestOnlyRun = await runControlledIras(whtRow.item.question, whtRow.issuePlan,
  { mode: 'SEMANTIC_INTERPRETATION', interpretation: whtRow.interpretation },
  syntheticIrasResponses('wht-royalty-general-rule', 'negative-interest-only', whtUrlsAndTitles, whtInterestOnlyText));
const whtMissingRecipientRun = await runControlledIras(whtRow.item.question, whtRow.issuePlan,
  { mode: 'SEMANTIC_INTERPRETATION', interpretation: whtRow.interpretation },
  syntheticIrasResponses('wht-royalty-general-rule', 'negative-missing-recipient', whtUrlsAndTitles, whtMissingRecipientText));
const whtPositiveIssue = whtPositiveRun.result.workstreams.flatMap(stream => stream.issues)[0];
const whtNegativeIssues = [whtInterestOnlyRun, whtMissingRecipientRun].map(run => ({
  run, issue: run.result.workstreams.flatMap(stream => stream.issues)[0]
}));
assert.deepEqual(whtPositiveIssue.lifecycle, { requested: true, mapped: true, retrievalAttempted: true,
  evidenceFound: true, admitted: true, verified: true, covered: true });
assertClaimsBoundToSyntheticResponses(whtPositiveIssue, whtPositiveResponses, 'wht-royalty-general-rule');
assert.equal(whtPositiveIssue.evidenceStatus, 'VERIFIED');
assert.equal(whtPositiveIssue.applicationStatus, 'NOT_REQUIRED');
assert.equal(whtPositiveRun.result.status, 'VERIFIED');
assert.equal(whtPositiveRun.result.applicationStatus, 'NOT_REQUIRED');
assert.equal(whtPositiveIssue.sources[0].sourceStatus, 'NEEDS_REVIEW');
for (const { run, issue } of whtNegativeIssues) {
  assert.equal(issue.evidenceStatus, 'INSUFFICIENT', 'Interest-only or unspecified recipient text cannot complete royalty WHT scope.');
  assert.deepEqual(issue.lifecycle, { requested: true, mapped: true, retrievalAttempted: true,
    evidenceFound: true, admitted: true, verified: false, covered: false });
  assert.equal(issue.verifiedClaims.length, 0);
  assert.ok(issue.retrievalTrace?.attempts?.length && issue.retrievalTrace.attempts.every(attempt => attempt.fetchStatus === 'SUCCESS'));
  assert.ok(issue.gaps.some(gap => gap.code === 'IRAS_SCOPE_NOT_COVERED'));
  assert.ok(issue.gaps.some(gap => gap.code === 'NO_VERIFIED_CLAIM'));
  assert.ok(issue.gaps.some(gap => gap.code === 'ISSUE_CONCEPT_UNCOVERED'));
  assert.equal(issue.applicationStatus, 'NOT_REQUIRED');
  assert.equal(run.result.status, 'INSUFFICIENT');
  assert.equal(run.result.applicationStatus, 'NOT_REQUIRED');
}
console.log(`V4_CONTROLLED_WHT ${JSON.stringify({ positive: { lifecycle: whtPositiveIssue.lifecycle,
  evidenceStatus: whtPositiveIssue.evidenceStatus, applicationStatus: whtPositiveIssue.applicationStatus,
  overall: whtPositiveRun.result.status, attempts: whtPositiveIssue.retrievalTrace?.attempts?.map(attempt => attempt.fetchStatus) },
  negatives: whtNegativeIssues.map(({ run, issue }) => ({ lifecycle: issue.lifecycle, evidenceStatus: issue.evidenceStatus,
    claims: issue.verifiedClaims.length, stages: issue.retrievalTrace?.attempts?.map(attempt => attempt.fetchStatus),
    gaps: issue.gaps.map(gap => gap.code), applicationStatus: issue.applicationStatus, overall: run.result.status })) })}`);

const gstUrlsAndTitles = [
  ['https://www.iras.gov.sg/taxes/goods-services-tax-(gst)/claiming-gst-(input-tax)/conditions-for-claiming-input-tax',
    'Conditions for Claiming Input Tax | IRAS'],
  ['https://www.iras.gov.sg/taxes/goods-services-tax-(gst)/basics-of-gst/invoicing-price-display-and-record-keeping/invoicing-customers',
    'Invoicing Customers | IRAS']
];
const gstRow = semanticRows.find(row => row.item.caseId === 'gst-input-tax-general-rule');
const gstPositiveText = 'A GST-registered business may claim input tax on business purchases used to make taxable supplies, subject to the applicable conditions and a valid tax invoice.';
const gstBlockedOnlyText = 'Input tax on the purchase and running expenses of a motor car is generally blocked from claim, subject to the vehicle definition and exceptions. Business purpose alone does not make a blocked motor-car claim recoverable. This page describes blocked input tax and does not establish the general recovery conditions for a GST-registered company’s business purchases.';
const gstPositiveResponses = syntheticIrasResponses('gst-input-tax-general-rule', 'positive', gstUrlsAndTitles, gstPositiveText);
const gstPositiveRun = await runControlledIras(gstRow.item.question, gstRow.issuePlan,
  { mode: 'SEMANTIC_INTERPRETATION', interpretation: gstRow.interpretation },
  withControlledDiscoveryFixtures(gstPositiveResponses));
const gstNegativeRun = await runControlledIras(gstRow.item.question, gstRow.issuePlan,
  { mode: 'SEMANTIC_INTERPRETATION', interpretation: gstRow.interpretation },
  withControlledDiscoveryFixtures(syntheticIrasResponses('gst-input-tax-general-rule', 'negative-blocked-only', gstUrlsAndTitles, gstBlockedOnlyText)));
const gstUnregisteredOnlyText = 'A business that is not registered for GST cannot claim input tax on its expenses. GST registration is required before a business may charge GST on its taxable supplies.';
const gstPrivateOnlyText = 'Input tax on private or domestic purchases cannot be claimed, even when the purchaser is GST-registered. Input tax attributable to private use is disallowed.';
const gstOutputTaxOnlyText = 'GST-registered businesses must account for output tax on their taxable supplies. Output tax is charged to customers and reported in the company’s GST return.';
const gstNegativeScenarios = [
  ['negative-unregistered-only', gstUnregisteredOnlyText],
  ['negative-private-only', gstPrivateOnlyText],
  ['negative-output-tax-only', gstOutputTaxOnlyText]
].map(([polarity, text]) => {
  const responses = syntheticIrasResponses('gst-input-tax-general-rule', polarity, gstUrlsAndTitles, text);
  return { polarity, responses };
});
const gstNegativeRuns = [];
for (const { responses } of gstNegativeScenarios) {
  gstNegativeRuns.push(await runControlledIras(gstRow.item.question, gstRow.issuePlan,
    { mode: 'SEMANTIC_INTERPRETATION', interpretation: gstRow.interpretation },
    withControlledDiscoveryFixtures(responses)));
}
const gstPositiveIssue = gstPositiveRun.result.workstreams.flatMap(stream => stream.issues)[0];
const gstNegativeIssue = gstNegativeRun.result.workstreams.flatMap(stream => stream.issues)[0];
assert.deepEqual(gstPositiveIssue.lifecycle, { requested: true, mapped: true, retrievalAttempted: true,
  evidenceFound: true, admitted: true, verified: true, covered: true });
assertClaimsBoundToSyntheticResponses(gstPositiveIssue, gstPositiveResponses, 'gst-input-tax-general-rule');
assert.equal(gstPositiveIssue.evidenceStatus, 'VERIFIED');
assert.equal(gstPositiveIssue.applicationStatus, 'NOT_REQUIRED');
assert.equal(gstPositiveRun.result.status, 'VERIFIED');
assert.equal(gstPositiveRun.result.applicationStatus, 'NOT_REQUIRED');
assert.equal(gstPositiveIssue.sources[0].sourceStatus, 'NEEDS_REVIEW');
assert.equal(gstNegativeIssue.evidenceStatus, 'INSUFFICIENT', 'Blocked-only input-tax evidence cannot establish general recovery conditions.');
assert.deepEqual(gstNegativeIssue.lifecycle, { requested: true, mapped: true, retrievalAttempted: true,
  evidenceFound: true, admitted: true, verified: false, covered: false });
assert.equal(gstNegativeIssue.verifiedClaims.length, 0);
assert.ok(gstNegativeIssue.retrievalTrace?.attempts?.some(attempt => attempt.fetchStatus === 'SUCCESS'));
assert.ok(gstNegativeIssue.gaps.some(gap => gap.code === 'IRAS_SCOPE_NOT_COVERED'));
assert.ok(gstNegativeIssue.gaps.some(gap => gap.code === 'NO_VERIFIED_CLAIM'));
assert.ok(gstNegativeIssue.gaps.some(gap => gap.code === 'ISSUE_CONCEPT_UNCOVERED'));
assert.equal(gstNegativeIssue.applicationStatus, 'NOT_REQUIRED');
assert.equal(gstNegativeRun.result.status, 'INSUFFICIENT');
assert.equal(gstNegativeRun.result.applicationStatus, 'NOT_REQUIRED');
assertNoControlledFixtureMisses(gstPositiveRun, 'GST positive');
assertNoControlledFixtureMisses(gstNegativeRun, 'GST blocked-input-tax control');
assert.deepEqual(gstNegativeScenarios.map(scenario => scenario.polarity), [
  'negative-unregistered-only', 'negative-private-only', 'negative-output-tax-only'
]);
assert.equal(/\bdividend/i.test(gstUnregisteredOnlyText), false);
assert.equal(/\boutput tax\b/i.test(gstPrivateOnlyText), false);
assert.equal(/\binput tax\b/i.test(gstOutputTaxOnlyText), false);
for (const [{ polarity }, run] of gstNegativeScenarios.map((scenario, index) => [scenario, gstNegativeRuns[index]])) {
  assertNoControlledFixtureMisses(run, `GST ${polarity}`);
  assert.ok(run.requests.some(url => gstUrlsAndTitles.some(([pageUrl]) => pageUrl === url)),
    `GST ${polarity} requested a mapped synthetic IRAS page.`);
  const issue = run.result.workstreams.flatMap(workstream => workstream.issues)[0];
  assert.ok(issue.retrievalTrace?.attempts?.some(attempt => attempt.fetchStatus === 'SUCCESS'),
    `GST ${polarity} passes actual page-topic transport validation.`);
  assert.deepEqual(issue.lifecycle, { requested: true, mapped: true, retrievalAttempted: true,
    evidenceFound: true, admitted: true, verified: false, covered: false });
  assert.equal(issue.evidenceStatus, 'INSUFFICIENT');
  assert.equal(issue.verifiedClaims.length, 0);
  assert.ok(issue.gaps.some(gap => gap.code === 'IRAS_SCOPE_NOT_COVERED'));
  assert.ok(issue.gaps.some(gap => gap.code === 'NO_VERIFIED_CLAIM'));
  assert.equal(issue.applicationStatus, 'NOT_REQUIRED');
  assert.equal(run.result.status, 'INSUFFICIENT');
  assert.equal(run.result.applicationStatus, 'NOT_REQUIRED');
}
console.log(`V4_CONTROLLED_GST ${JSON.stringify({ positive: { lifecycle: gstPositiveIssue.lifecycle,
  evidenceStatus: gstPositiveIssue.evidenceStatus, applicationStatus: gstPositiveIssue.applicationStatus,
  overall: gstPositiveRun.result.status, attempts: gstPositiveIssue.retrievalTrace?.attempts?.map(attempt => attempt.fetchStatus) },
  negative: { lifecycle: gstNegativeIssue.lifecycle, evidenceStatus: gstNegativeIssue.evidenceStatus,
    claims: gstNegativeIssue.verifiedClaims.length, stages: gstNegativeIssue.retrievalTrace?.attempts?.map(attempt => attempt.fetchStatus),
    gaps: gstNegativeIssue.gaps.map(gap => gap.code), applicationStatus: gstNegativeIssue.applicationStatus,
    overall: gstNegativeRun.result.status },
  scopedNegatives: gstNegativeScenarios.map(({ polarity }, index) => ({ polarity, ...observeControlledIrasRun(gstNegativeRuns[index]) })) })}`);

function tracedSourcesForMutation(row, run, label) {
  const expectedIssueId = Object.keys(row.item.governedProductionEvidence.expectedRuleEvidenceByIssue)[0];
  const { planned, issue } = actualIssueForExpected(row, run.result, expectedIssueId);
  const records = observedCandidateSubset(row, planned, issue, run);
  const attempts = issue.retrievalTrace?.attempts || [];
  const trace = observedSourceSubsetTrace(records, planned.mappedTopicIds, attempts, run.fetchValidationObservations);
  assert.equal(trace.complete, true, `${label} actual sources bind before mutation: ${trace.reason || 'complete'}`);
  assert.ok(records.some(record => record.provenance === 'LIVE_EXTERNAL'), `${label} has an actual returned live source.`);
  return { planned, issue, records, attempts, fetches: run.fetchValidationObservations };
}
function assertSourceTraceMutationFails({ planned, issue, records, attempts, fetches }, label, mutation) {
  const altered = mutation({ planned, issue, records: structuredClone(records),
    attempts: structuredClone(attempts), fetches: structuredClone(fetches) });
  const result = observedSourceSubsetTrace(altered.records, planned.mappedTopicIds, altered.attempts, altered.fetches);
  assert.equal(result.complete, false, `${label} fails closed: ${result.reason || 'incomplete observed binding'}`);
  return { mutation: label, reason: result.reason };
}
const gstTraceInputs = tracedSourcesForMutation(gstRow, gstPositiveRun, 'GST positive source binding');
const gstLiveRecord = gstTraceInputs.records.find(record => record.provenance === 'LIVE_EXTERNAL');
const gstLiveTag = gstLiveRecord.tags.find(tag => gstTraceInputs.attempts.some(attempt =>
  attempt.topicId === tag && attempt.fetchStatus === 'SUCCESS' && attempt.pageTitle === gstLiveRecord.documentTitle));
assert.ok(gstLiveTag, 'An actual registered live source tag joins to an actual successful sanitized topic/title attempt.');
const gstMutationResults = [];
const gstBoundFetch = gstTraceInputs.fetches.find(item => item.pageTitle === gstLiveRecord.documentTitle);
const identicalDuplicateTrace = observedSourceSubsetTrace(gstTraceInputs.records, gstTraceInputs.planned.mappedTopicIds,
  gstTraceInputs.attempts, [...gstTraceInputs.fetches, structuredClone(gstBoundFetch)]);
assert.equal(identicalDuplicateTrace.complete, true,
  'An identical duplicate of an actual validated fetch remains one unambiguous observed fetch.');
gstMutationResults.push(assertSourceTraceMutationFails(gstTraceInputs, 'Duplicate success lacks topic-validation presence', ({ fetches }) => {
  fetches.push({ ...gstBoundFetch, topicValidationPresent: undefined });
  return { records: gstTraceInputs.records, attempts: gstTraceInputs.attempts, fetches };
}));
gstMutationResults.push(assertSourceTraceMutationFails(gstTraceInputs, 'Duplicate success has false topic-validation presence and content flag', ({ fetches }) => {
  fetches.push({ ...gstBoundFetch, topicValidationPresent: false, contentMatched: false });
  return { records: gstTraceInputs.records, attempts: gstTraceInputs.attempts, fetches };
}));
gstMutationResults.push(assertSourceTraceMutationFails(gstTraceInputs, 'Duplicate success lacks actual content-validation flag', ({ fetches }) => {
  const fetch = fetches.find(item => item.pageTitle === gstLiveRecord.documentTitle);
  fetch.contentMatched = undefined;
  return { records: gstTraceInputs.records, attempts: gstTraceInputs.attempts, fetches };
}));
gstMutationResults.push(assertSourceTraceMutationFails(gstTraceInputs, 'Conflicting final URL for an actual validated title', ({ fetches }) => {
  const fetch = fetches.find(item => item.pageTitle === gstLiveRecord.documentTitle);
  fetches.push({ ...fetch, finalUrl: 'https://www.iras.gov.sg/taxes/goods-services-tax-(gst)/conflicting-final-url' });
  return { records: gstTraceInputs.records, attempts: gstTraceInputs.attempts, fetches };
}));
gstMutationResults.push(assertSourceTraceMutationFails(gstTraceInputs, 'Malformed observed request URL', ({ fetches }) => {
  fetches.find(item => item.pageTitle === gstLiveRecord.documentTitle).url = 'https://[broken.invalid';
  return { records: gstTraceInputs.records, attempts: gstTraceInputs.attempts, fetches };
}));
gstMutationResults.push(assertSourceTraceMutationFails(gstTraceInputs, 'Malformed observed source URL', ({ fetches }) => {
  fetches.find(item => item.pageTitle === gstLiveRecord.documentTitle).sourceUrl = 'https://%zz.invalid/';
  return { records: gstTraceInputs.records, attempts: gstTraceInputs.attempts, fetches };
}));
gstMutationResults.push(assertSourceTraceMutationFails(gstTraceInputs, 'Missing requested, source, or final URL metadata', ({ fetches }) => {
  const fetch = fetches.find(item => item.pageTitle === gstLiveRecord.documentTitle);
  fetch.url = undefined;
  fetch.sourceUrl = undefined;
  fetch.finalUrl = undefined;
  return { records: gstTraceInputs.records, attempts: gstTraceInputs.attempts, fetches };
}));
gstMutationResults.push(assertSourceTraceMutationFails(gstTraceInputs, 'Missing page title with matching observed final URL and hash', ({ fetches }) => {
  const fetch = fetches.find(item => item.pageTitle === gstLiveRecord.documentTitle);
  fetch.pageTitle = undefined;
  return { records: gstTraceInputs.records, attempts: gstTraceInputs.attempts, fetches };
}));
gstMutationResults.push(assertSourceTraceMutationFails(gstTraceInputs, 'Conflicting page title with matching observed final URL and hash', ({ fetches }) => {
  const fetch = fetches.find(item => item.pageTitle === gstLiveRecord.documentTitle);
  fetch.pageTitle = 'Conflicting title | IRAS';
  return { records: gstTraceInputs.records, attempts: gstTraceInputs.attempts, fetches };
}));
gstMutationResults.push(assertSourceTraceMutationFails(gstTraceInputs, 'Wrong topic binding in actual success attempt', ({ attempts }) => {
  const attempt = attempts.find(item => item.topicId === gstLiveTag && item.fetchStatus === 'SUCCESS' &&
    item.pageTitle === gstLiveRecord.documentTitle);
  attempt.topicId = 'iras-corporate-tax-residency';
  return { records: gstTraceInputs.records, attempts, fetches: gstTraceInputs.fetches };
}));
gstMutationResults.push(assertSourceTraceMutationFails(gstTraceInputs, 'Missing actual source topic tag', ({ records }) => {
  const record = records.find(item => item.id === gstLiveRecord.id);
  record.tags = [];
  return { records, attempts: gstTraceInputs.attempts, fetches: gstTraceInputs.fetches };
}));
gstMutationResults.push(assertSourceTraceMutationFails(gstTraceInputs, 'Missing matching sanitized success attempt', ({ attempts }) => {
  return { records: gstTraceInputs.records,
    attempts: attempts.filter(item => !(item.topicId === gstLiveTag && item.fetchStatus === 'SUCCESS' &&
      item.pageTitle === gstLiveRecord.documentTitle)), fetches: gstTraceInputs.fetches };
}));
gstMutationResults.push(assertSourceTraceMutationFails(gstTraceInputs, 'Returned content hash does not match observed fetch bytes', ({ records }) => {
  records.find(item => item.id === gstLiveRecord.id).contentHash = '0'.repeat(64);
  return { records, attempts: gstTraceInputs.attempts, fetches: gstTraceInputs.fetches };
}));
const whtTraceInputs = tracedSourcesForMutation(whtRow, whtPositiveRun, 'Withholding-tax positive source binding');
const whtUpperPath = whtUrlsAndTitles[2][0];
assert.notEqual(transportUrlIdentity(whtUpperPath), transportUrlIdentity(whtUpperPath.replace('(WHT)', '(wht)')),
  'Path case stays significant when URL identity normalizes the host.');
console.log(`V4_OBSERVED_SOURCE_BINDING_MUTATIONS ${JSON.stringify({
  gst: { sourceIds: gstTraceInputs.records.filter(record => record.provenance === 'LIVE_EXTERNAL').map(record => record.id),
    attemptCount: gstTraceInputs.attempts.length, fetchCount: gstTraceInputs.fetches.length,
    identicalDuplicateAccepted: identicalDuplicateTrace.complete, mutations: gstMutationResults },
  wht: { sourceIds: whtTraceInputs.records.filter(record => record.provenance === 'LIVE_EXTERNAL').map(record => record.id),
    attemptCount: whtTraceInputs.attempts.length, fetchCount: whtTraceInputs.fetches.length,
    pathCaseSensitive: true }
})}`);

const reliefStageRow = semanticRows.find(row => row.item.caseId === 'target-relief-entitlement');
const reliefMappedMissFixture = syntheticIrasResponse('target-relief-entitlement', 'stage-mapped-url-miss',
  [mappedReliefUrl], '<html><body>Synthetic mapped URL miss.</body></html>');
reliefMappedMissFixture.status = 404;
const reliefStageFixture = syntheticIrasResponse('target-relief-entitlement', 'stage-positive-discovered-page',
  [discoveredUrl], reliefHtml);
const reliefStageResponses = withControlledDiscoveryFixtures({
  [mappedReliefUrl]: reliefMappedMissFixture, [discoveredUrl]: reliefStageFixture
});
const reliefStageRun = await runControlledIras(reliefStageRow.item.question, reliefStageRow.issuePlan,
  { mode: 'SEMANTIC_INTERPRETATION', interpretation: reliefStageRow.interpretation }, reliefStageResponses);
const privateStageRow = semanticRows.find(row => row.item.caseId === 'private-expense-treatment');
const privateStageFixture = syntheticIrasResponse('private-expense-treatment', 'stage-positive-mapped-page',
  [fixturePageUrl], mappedHtml);
const privateStageResponses = withControlledDiscoveryFixtures({ [fixturePageUrl]: privateStageFixture });
const privateStageRun = await runControlledIras(privateStageRow.item.question, privateStageRow.issuePlan,
  { mode: 'SEMANTIC_INTERPRETATION', interpretation: privateStageRow.interpretation }, privateStageResponses);
const reliefStageIssue = actualIssueForExpected(reliefStageRow, reliefStageRun.result, 'personal-cpf-relief').issue;
assertClaimsBoundToSyntheticResponses(reliefStageIssue, reliefStageResponses, 'CPF relief entitlement stage');
const privateStageIssue = actualIssueForExpected(privateStageRow, privateStageRun.result,
  'company-private-expense-tax-treatment').issue;
const privateStageLiveSourceIds = new Set(privateStageIssue.sources.filter(source => source.provenance === 'LIVE_EXTERNAL')
  .map(source => source.id));
assertClaimsBoundToSyntheticResponses(privateStageIssue, privateStageResponses, 'Private-expense stage',
  claim => privateStageLiveSourceIds.has(claim.recordId));
const privateStageLocalSection15Claim = privateStageIssue.verifiedClaims.find(claim =>
  claim.recordId === 'ITA_SEC15_PROHIBITED_DEDUCTIONS');
assert.equal(privateStageLocalSection15Claim?.quote,
  UNIFIED_SOURCE_REGISTRY.ITA_SEC15_PROHIBITED_DEDUCTIONS.sourceText);
assert.match(privateStageLocalSection15Claim.quote, /subject to statutory exceptions/i);
for (const [label, run] of [
  ['relief entitlement stage runtime', reliefStageRun], ['private-expense stage runtime', privateStageRun],
  ['foreign-dividend stage runtime', foreignPositiveRun], ['company-residency stage runtime', residencyPositiveRun],
  ['withholding-tax stage runtime', whtPositiveRun], ['GST stage runtime', gstPositiveRun],
  ['CPF relief amount stage runtime', amountRun], ['mixed CPF relief stage runtime', mixedRun]
]) assertNoControlledFixtureMisses(run, label);

const fullStageRuns = [
  [reliefStageRow, reliefStageRun], [privateStageRow, privateStageRun], [foreignRow, foreignPositiveRun],
  [residencyRow, residencyPositiveRun], [whtRow, whtPositiveRun], [gstRow, gstPositiveRun],
  [amountRow, amountRun], [mixedRow, mixedRun]
];
const fullStageObservations = [];
for (const [row, run] of fullStageRuns) {
  const score = scoreControlledRuntime(row, run);
  const stages = score.stages.stages;
  assert.equal(Object.values(stages).every(value => value === true), true,
    `Actual API-free runtime passes its intended V4 development stages: ${row.item.caseId} ${JSON.stringify({
      stages, diagnostics: score.governed.lifecycleDiagnostics, overall: run.result.status
    })}`);
  assert.equal(score.application.overallStatus, run.result.status,
    `${row.item.caseId} application score uses actual runtime overall status.`);
  fullStageObservations.push({ caseId: row.item.caseId, status: run.result.status,
    evidenceStatus: run.result.evidenceStatus,
    applicationStatus: run.result.applicationStatus,
    lifecycle: score.governedObservations.map(observation => observation.lifecycle),
    gaps: score.governedObservations.map(observation => observation.gaps || []),
    inventory: score.governedObservations.map(observation => ({ kind: observation.candidateInventoryKind,
      countBasis: observation.candidateCountBasis,
      candidateCount: observation.candidateCount, actualReturnedSourceCount: observation.actualReturnedSourceCount,
      provenanceCounts: observation.candidateRecordProvenanceCounts,
      recordIds: observation.observedRecordIds || [],
      eligibleRecordIds: observation.eligibleRecordIds || [],
      transportBinding: observation.transportBinding })),
    stages });
}
const unsupportedRow = semanticRows.find(row => row.item.caseId === 'unsupported-sfrsi-6-exploration-evaluation');
const unsupportedStageRun = { result: unsupportedRuntime,
  candidateRecordGroups: localCandidateRecordGroups.get(unsupportedRow.item.caseId), fetchValidationObservations: [] };
const unsupportedStages = scoreControlledRuntime(unsupportedRow, unsupportedStageRun);
assert.equal(unsupportedStages.governed.expectedNoCoverageTopic, true,
  'The expected no-coverage observation comes from the actual unsupported issue plan and local-only runtime.');
assert.equal(Object.values(unsupportedStages.stages.stages).every(value => value === true), true,
  `Actual unsupported no-route runtime passes its intended V4 stages: ${JSON.stringify({
    stages: unsupportedStages.stages.stages, governed: unsupportedStages.governed,
    actualWorkstreams: unsupportedRuntime.workstreams.map(workstream => workstream.authority)
  })}`);
fullStageObservations.push({ caseId: unsupportedRow.item.caseId, status: unsupportedRuntime.status,
  evidenceStatus: unsupportedRuntime.evidenceStatus, applicationStatus: unsupportedRuntime.applicationStatus,
  noRouteObservation: unsupportedStages.governedObservations,
  inventory: [{ kind: 'actual_local_only_issue_plan_and_runtime_no_route', candidateCount: 0, recordIds: [] }],
  stages: unsupportedStages.stages.stages,
  provenance: 'actual local-only production runtime; no IRAS issue-plan route, mapped topic, candidate, or claim' });
assert.equal(fullStageObservations.length, 9);
assert.deepEqual(fullStageObservations.map(item => item.caseId).sort(), [...CASE_IDS].sort(),
  'The observed full-stage rows cover every frozen case exactly once.');
assert.equal(fullStageObservations.every(item => Object.values(item.stages).every(value => value === true)), true);
console.log(`V4_FULL_RUNTIME_STAGES ${JSON.stringify({ integrityScope:
  'API-free development stage exercise; no live corpus, committed ancestry, or transport-integrity proof',
  traceScope: 'test-local subset proof derived only from observed through-call records, returned sources, sanitized attempts, and validated fetch observations',
  cases: fullStageObservations })}`);

const allFixtureHashes = [...fixtureManifest, ...controlledRuleFixtureBodies.map(({ family, polarity, urls, body, type }) => ({
  family, polarity, urls, contentType: type, bodyBytes: Buffer.byteLength(body), synthetic: true,
  provenance: 'synthetic API-free test body; not live or authoritative IRAS content',
  sha256: createHash('sha256').update(body).digest('hex')
}))];
assert.equal(allFixtureHashes.every(item => item.synthetic && /^[a-f0-9]{64}$/.test(item.sha256)), true);
assert.equal(allFixtureHashes.slice(3).every(item => item.family && item.polarity && item.urls.length && item.contentType && item.bodyBytes > 0 && item.provenance), true);
for (const [family, polarity] of [
  ['private-expense-treatment', 'negative-missing-qualification'],
  ['foreign-dividend-receipt-treatment', 'negative-payer-only'],
  ['foreign-dividend-receipt-treatment', 'negative-other-income-only'],
  ['gst-input-tax-general-rule', 'negative-unregistered-only'],
  ['gst-input-tax-general-rule', 'negative-private-only'],
  ['gst-input-tax-general-rule', 'negative-output-tax-only']
]) assert.ok(allFixtureHashes.some(item => item.family === family && item.polarity === polarity),
  `Fixture manifest contains exact provenance for ${family}/${polarity}.`);
console.log(`V4_SYNTHETIC_FIXTURE_MANIFEST ${JSON.stringify(allFixtureHashes.slice(3))}`);
console.log(`V4 API-free contract, local-only runtime, one-use guards, controlled discovery and evidence-gate checks passed (${allFixtureHashes.length} explicitly synthetic fixture hashes).`);
