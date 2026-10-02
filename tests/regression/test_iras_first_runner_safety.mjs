import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  loadIrasFirstTargetedCases,
  requirePassingIrasFirstTarget,
  runSemanticContractFollowupEvaluation,
  summarizeHistoricalAllAuthorityMetric
} from '../evaluation/singapore/semantic-contract-followup-evaluation.mjs';
import { parseSemanticIntentProfileArgs } from '../evaluation/singapore/semantic-intent-followup-evaluation.mjs';
import { canonicalAccountingWorkstreamAuthority, validateSemanticQuestionInterpretation } from '../../src/services/semanticQuestionUnderstanding.ts';

const TARGETED_PROFILE = 'iras-first-targeted-v1-live';
const FINAL_PROFILE = 'iras-first-final-v1-live';
const TARGETED_OUTPUT = 'iras-first-targeted-v1-live.json';
const FORBIDDEN_PRIVATE_KEYS = new Set(['question', 'questionText', 'facts', 'factsExplicitlyProvided', 'rawResponse', 'responseText',
  'prompt', 'systemInstruction', 'apiKey', 'credential', 'credentials', 'authorization', 'url', 'candidateUrl', 'finalUrl',
  'sourceText', 'sourceTitle', 'quote', 'subject', 'primarySubject', 'concept', 'labels', 'issueLabel']);

function findForbiddenPaths(value, path = '$') {
  if (Array.isArray(value)) return value.flatMap((item, index) => findForbiddenPaths(item, `${path}[${index}]`));
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, child]) => [
    ...(FORBIDDEN_PRIVATE_KEYS.has(key) ? [`${path}.${key}`] : []),
    ...findForbiddenPaths(child, `${path}.${key}`)
  ]);
}

assert.equal(parseSemanticIntentProfileArgs(['--profile', TARGETED_PROFILE, '--live']), TARGETED_PROFILE);
assert.equal(parseSemanticIntentProfileArgs(['--profile', FINAL_PROFILE, '--live']), FINAL_PROFILE);
assert.throws(() => parseSemanticIntentProfileArgs(['--profile', TARGETED_PROFILE, '--live', '--cases', 'x']), /Usage:/);

const cases = await loadIrasFirstTargetedCases();
assert.deepEqual(cases.map(item => item.id), [
  'target-relief-entitlement', 'target-relief-amount', 'A-paraphrase-2', 'private-expense-treatment',
  'foreign-dividend-receipt-treatment', 'corporate-residency-general-rule',
  'target-mixed-ifrs-singapore-accounting', 'dev-investment-comparison',
  'unsupported-sfrsi-6-exploration-evaluation'
]);
assert.equal(cases.length, 9, 'the fixed targeted profile contains exactly nine rows');

const invalidHistorical = summarizeHistoricalAllAuthorityMetric([{
  historicalScoring: {
    expectedIssueCount: 2, predictedIssueCount: 0, matchedIssueCount: 0,
    completeQuestionIssueCoverage: false,
    dimensionsCorrect: Object.fromEntries(['governingAuthority', 'contextualAuthority', 'domain', 'population', 'operation'].map(key => [key, 0]))
  }
}], 10, 'targeted-profile-overlap');
assert.equal(invalidHistorical.originalIssueRecall.expected, 2,
  'invalid historical responses retain their expected issue denominator');
assert.equal(invalidHistorical.dimensions.governingAuthority.expected, 2);
assert.equal(invalidHistorical.allDimensionCases.correct, 0);
assert.equal(invalidHistorical.originalTenCaseFinalRun, false,
  'a targeted historical overlap cannot be mistaken for the unchanged original ten-case final run');

function syntheticWirePayload(testCase) {
  const issues = testCase.expected.map(expected => {
    const domain = expected.domain[0];
    const operation = testCase.strictOperations?.find(item => item.issueId === expected.id)?.operation || expected.operation[0];
    return {
      subject: expected.matchAny.some(anchor => anchor.every(term => expected.subject.toLowerCase().split(/[^a-z0-9]+/).includes(term)))
        ? expected.subject : expected.matchAny[0].join(' '),
      population: expected.population[0],
      domain,
      governingAuthorities: expected.governingAuthorities.map(authority => canonicalAccountingWorkstreamAuthority(domain, authority)),
      contextualAuthorities: expected.contextualAuthoritiesAnyOf[0],
      operation,
      mappedTopicIds: [],
      evidenceRequirement: ['CALCULATE', 'DETERMINE_TREATMENT', 'PREPARE_JOURNAL'].includes(operation)
        ? 'AUTHORITATIVE_SOURCE_AND_CASE_FACTS' : 'AUTHORITATIVE_SOURCE',
      confidence: 0.99
    };
  });
  const domains = [...new Set(issues.map(issue => issue.domain))];
  const populations = [...new Set(issues.map(issue => issue.population))];
  const operations = [...new Set(issues.map(issue => issue.operation))];
  return {
    schemaVersion: 2,
    jurisdiction: ['Singapore'],
    authorityCandidates: [...new Set(issues.flatMap(issue => issue.governingAuthorities))],
    contextualAuthorities: [...new Set(issues.flatMap(issue => issue.contextualAuthorities))],
    domain: domains.length === 1 ? domains[0] : 'UNKNOWN',
    population: populations.length === 1 ? populations[0] : 'UNKNOWN',
    primarySubject: issues[0].subject,
    concepts: [],
    requestedOperation: operations.length === 1 ? operations[0] : 'OTHER',
    requiresUserSpecificFacts: testCase.expectedRequiresUserSpecificFacts,
    factsExplicitlyProvided: [],
    confidence: 0.99,
    issues
  };
}

function syntheticRuntimeFor(testCase, issuePlan, noShellControl) {
  const isUnsupported = testCase.expectedCoverageOutcome === 'UNSUPPORTED';
  // This positive control supplies a clean synthetic reconciled plan so it can
  // exercise saved-report revalidation independently of unrelated classifier
  // residuals in the current local runtime. Production plans are never changed.
  issuePlan.issues = issuePlan.issues.slice(0, testCase.expected.length);
  issuePlan.coverageEstablished = !isUnsupported;
  issuePlan.hasUnmappedResidual = isUnsupported;
  for (const [index, planIssue] of issuePlan.issues.entries()) {
    if (isUnsupported) {
      planIssue.status = 'UNRESOLVED';
      planIssue.unresolvedReason = 'NO_COVERAGE_TOPIC';
      planIssue.mappedTopicIds = [];
    } else {
      planIssue.status = 'MAPPED';
      planIssue.unresolvedReason = undefined;
      planIssue.mappedTopicIds = ['synthetic-fixed-test-topic'];
    }
  }
  const routePairs = testCase.expectedWorkstreamsAnyOf[0].map(value => {
    const separator = value.indexOf('/');
    return { authority: value.slice(0, separator), domain: value.slice(separator + 1) };
  });
  const workstreamMap = new Map();
  const gaps = [];
  for (const [index, planIssue] of issuePlan.issues.entries()) {
    const expected = testCase.expected[index];
    if (!expected) throw new Error(`Synthetic plan mismatch for ${testCase.id}.`);
    const authorities = expected.governingAuthorities.map(authority => canonicalAccountingWorkstreamAuthority(expected.domain[0], authority));
    const route = routePairs.find(pair => authorities.includes(pair.authority));
    if (!route) throw new Error(`Synthetic route missing for ${testCase.id}.`);
    const omitShell = noShellControl && testCase.id === 'unsupported-sfrsi-6-exploration-evaluation' && isUnsupported;
    if (omitShell) {
      gaps.push({ issueId: planIssue.id, authority: route.authority, domain: expected.domain[0], stage: 'mapped', code: 'NO_COVERAGE_TOPIC' });
      continue;
    }
    const key = `${route.authority}/${route.domain}`;
    const workstream = workstreamMap.get(key) || { authority: route.authority, domain: route.domain, issues: [], gaps: [] };
    const insufficient = isUnsupported;
    const evidenceRequirement = planIssue.evidenceRequirement || 'AUTHORITATIVE_SOURCE';
    const caseFactsRequired = ['CASE_FACTS', 'AUTHORITATIVE_SOURCE_AND_CASE_FACTS'].includes(evidenceRequirement) ||
      evidenceRequirement === 'UNRESOLVED' && ['CALCULATE', 'PREPARE_JOURNAL', 'CHECK_ELIGIBILITY', 'DETERMINE_TREATMENT'].includes(planIssue.operation);
    const issueGaps = insufficient ? [{ issueId: planIssue.id, authority: route.authority, domain: route.domain,
      stage: 'mapped', code: 'NO_COVERAGE_TOPIC' }] : [];
    const runtimeIssue = {
      issueId: planIssue.id,
      domain: planIssue.domain,
      population: planIssue.population,
      operation: planIssue.operation,
      evidenceRequirement,
      governingAuthority: route.authority,
      evidenceStatus: insufficient ? 'INSUFFICIENT' : 'VERIFIED',
      applicationStatus: caseFactsRequired ? 'UNRESOLVED' : 'NOT_REQUIRED',
      sources: insufficient ? [] : [{ id: 'synthetic-reviewed-source' }],
      verifiedClaims: insufficient ? [] : [{ recordId: 'synthetic-reviewed-source' }],
      lifecycle: { mapped: !insufficient, retrievalAttempted: !insufficient, evidenceFound: !insufficient,
        admitted: !insufficient, verified: !insufficient, covered: !insufficient },
      gaps: issueGaps
    };
    workstream.issues.push(runtimeIssue);
    workstream.gaps.push(...issueGaps);
    workstreamMap.set(key, workstream);
    gaps.push(...issueGaps);
  }
  if (isUnsupported) gaps.push(
    { issueId: 'issue-plan', authority: 'UNKNOWN', domain: 'UNKNOWN', stage: 'planned', code: 'ISSUE_PLAN_HAS_UNMAPPED_RESIDUAL' },
    { issueId: 'issue-plan', authority: 'UNKNOWN', domain: 'UNKNOWN', stage: 'planned', code: 'ISSUE_PLAN_COVERAGE_UNESTABLISHED' }
  );
  const workstreams = [...workstreamMap.values()];
  const anyUnresolvedApplication = workstreams.some(stream => stream.issues.some(issue => issue.applicationStatus === 'UNRESOLVED'));
  return {
    status: isUnsupported || anyUnresolvedApplication ? 'CONDITIONAL' : 'VERIFIED',
    evidenceStatus: isUnsupported ? 'INSUFFICIENT' : 'VERIFIED',
    applicationStatus: anyUnresolvedApplication ? 'UNRESOLVED' : 'NOT_REQUIRED',
    workstreams,
    gaps
  };
}

const tempRoot = os.tmpdir();
const scratch = await mkdtemp(path.join(tempRoot, 'iras-first-runner-safety-'));
const resolvedTemp = path.resolve(tempRoot);
const resolvedScratch = path.resolve(scratch);
assert.equal(path.dirname(resolvedScratch), resolvedTemp, 'temporary output is directly inside the runtime temp directory');

try {
  const protectedOutputDirectory = path.join(scratch, 'non-overwrite');
  await mkdir(protectedOutputDirectory, { recursive: true });
  const protectedOutput = path.join(protectedOutputDirectory, TARGETED_OUTPUT);
  await writeFile(protectedOutput, 'PRESERVE_EXISTING_REPORT', { encoding: 'utf8', flag: 'wx' });
  await assert.rejects(runSemanticContractFollowupEvaluation({
    live: true, evaluationProfile: TARGETED_PROFILE, outputDirectory: protectedOutputDirectory,
    apiKey: 'synthetic-test-api-key-only', execute: async () => { throw new Error('No capture expected.'); }
  }), /output file already exists/);
  assert.equal(await readFile(protectedOutput, 'utf8'), 'PRESERVE_EXISTING_REPORT', 'existing report bytes remain untouched');

  const forgedTargetDirectory = path.join(scratch, 'forged-target');
  await mkdir(forgedTargetDirectory, { recursive: true });
  await writeFile(path.join(forgedTargetDirectory, TARGETED_OUTPUT), JSON.stringify({
    evaluationProfile: TARGETED_PROFILE,
    outputPrefix: 'iras-first-targeted-v1-live',
    requestCount: 9,
    irasFirstAcceptance: { passed: true },
    cases: []
  }), { encoding: 'utf8', flag: 'wx' });
  let forbiddenProviderCalls = 0;
  await assert.rejects(runSemanticContractFollowupEvaluation({
    live: true, evaluationProfile: FINAL_PROFILE, outputDirectory: forgedTargetDirectory,
    apiKey: 'synthetic-test-api-key-only',
    execute: async () => { forbiddenProviderCalls += 1; return '{}'; }
  }), /IRAS-first targeted profile has not passed/);
  assert.equal(forbiddenProviderCalls, 0, 'a forged aggregate-only targeted report cannot unlock final capture');

  await assert.rejects(runSemanticContractFollowupEvaluation({
    live: true, evaluationProfile: TARGETED_PROFILE, outputDirectory: path.join(scratch, 'caller-cases'),
    apiKey: 'synthetic-test-api-key-only', cases
  }), /required fixed evaluation case is missing/);

  const captureDirectory = path.join(scratch, 'fake-capture');
  let providerCalls = 0;
  let monotonic = 10_000;
  let wallClock = Date.parse('2026-10-02T00:00:00.000Z');
  const privateSentinels = [
    'IRAS_FIRST_PRIVATE_SENTINEL_FACT', 'IRAS_FIRST_PRIVATE_SENTINEL_SUBJECT',
    'IRAS_FIRST_PRIVATE_SENTINEL_SOURCE_TEXT', 'https://private-sentinel.invalid/source'
  ];
  const fakeRawResponse = JSON.stringify({
    schemaVersion: 2,
    factsExplicitlyProvided: [privateSentinels[0]],
    primarySubject: privateSentinels[1],
    sourceText: privateSentinels[2],
    candidateUrl: privateSentinels[3]
  });
  const result = await runSemanticContractFollowupEvaluation({
    live: true,
    evaluationProfile: TARGETED_PROFILE,
    outputDirectory: captureDirectory,
    apiKey: 'synthetic-test-api-key-only',
    execute: async () => {
      providerCalls += 1;
      return fakeRawResponse;
    },
    interpret: async (_question, _providerSettings, executeOnce) => {
      await executeOnce('synthetic prompt that is not persisted', 'synthetic system instruction', 'gemini');
      return { mode: 'DETERMINISTIC_FALLBACK', failure: 'INVALID_RESPONSE' };
    },
    sleep: async milliseconds => { monotonic += milliseconds; },
    monotonicNow: () => monotonic++,
    now: () => new Date(wallClock += 1_000)
  });
  assert.equal(providerCalls, 9, 'the fake transport is called once per fixed row');
  assert.equal(result.requestCount, 9);
  assert.equal(result.cases.length, 9);
  assert.equal(result.cases.every(row => row.capture?.requestCount === 1), true);
  assert.equal(result.minimumObservedStartGapMs >= 15_250, true);
  const report = await readFile(path.join(captureDirectory, TARGETED_OUTPUT), 'utf8');
  for (const sentinel of privateSentinels) assert.equal(report.includes(sentinel), false, 'private response payload is not persisted');
  assert.equal(report.includes('synthetic-test-api-key-only'), false, 'provider credential is not persisted');
  assert.equal(report.includes('synthetic prompt that is not persisted'), false);

  for (const noShellControl of [false, true]) {
    const passingTargetDirectory = path.join(scratch, noShellControl ? 'passing-no-shell-target' : 'passing-accounting-shell-target');
    const casesByQuestion = new Map(cases.map(testCase => [testCase.question, testCase]));
    let currentRawResponse;
    let passingProviderCalls = 0;
    let clock = 30_000;
    await runSemanticContractFollowupEvaluation({
      live: true,
      evaluationProfile: TARGETED_PROFILE,
      outputDirectory: passingTargetDirectory,
      apiKey: 'synthetic-test-api-key-only',
      execute: async () => { passingProviderCalls += 1; return currentRawResponse; },
      interpret: async (question, _settings, executeOnce) => {
        const testCase = casesByQuestion.get(question);
        const payload = syntheticWirePayload(testCase);
        const parsed = validateSemanticQuestionInterpretation(payload);
        assert.ok(parsed, `synthetic wire response validates for ${testCase.id}`);
        currentRawResponse = JSON.stringify(payload);
        await executeOnce('synthetic safe prompt', 'synthetic safe instruction', 'gemini');
        return { mode: 'SEMANTIC_INTERPRETATION', interpretation: parsed };
      },
      buildRuntime: async (question, issuePlan) => {
        const testCase = casesByQuestion.get(question);
        return syntheticRuntimeFor(testCase, issuePlan, noShellControl);
      },
      sleep: async milliseconds => { clock += milliseconds; },
      monotonicNow: () => clock++,
      now: () => new Date(Date.parse('2026-10-02T00:00:00.000Z') + clock++)
    });
    assert.equal(passingProviderCalls, 9, 'each passing synthetic targeted row makes exactly one fake provider call');
    const passingReport = JSON.parse(await readFile(path.join(passingTargetDirectory, TARGETED_OUTPUT), 'utf8'));
    assert.equal(passingReport.irasFirstAcceptance?.passed, true,
      'synthetic reconciled target fixture passes the versioned IRAS-first acceptance checks');
    assert.equal(passingReport.cases.every(row => findForbiddenPaths(row).length === 0), true,
      'synthetic reports persist no private payload keys');
    await requirePassingIrasFirstTarget(passingTargetDirectory);
    if (!noShellControl) {
      const forgedReport = structuredClone(passingReport);
      const mixedCpfRow = forgedReport.cases.find(row => row.caseId === 'A-paraphrase-2');
      const cpfDiagnostic = mixedCpfRow.routing.runtimeIssueScopeDiagnostics.find(issue => issue.governingAuthorities.includes('CPF'));
      assert.ok(cpfDiagnostic, 'the fixed mixed CPF/IRAS row supplies a non-release issue for the forged final-status control');
      cpfDiagnostic.evidenceStatusCounts.VERIFIED = 1;
      cpfDiagnostic.evidenceStatusCounts.INSUFFICIENT = 0;
      cpfDiagnostic.lifecycleCounts.covered = 0;
      cpfDiagnostic.gapCounts.ISSUE_CONCEPT_UNCOVERED = 1;
      mixedCpfRow.routing.status = 'CONDITIONAL';
      mixedCpfRow.routing.evidenceStatus = 'INSUFFICIENT';
      const forgedIssueEvidenceDirectory = path.join(scratch, 'forged-issue-verified-target');
      await mkdir(forgedIssueEvidenceDirectory, { recursive: true });
      await writeFile(path.join(forgedIssueEvidenceDirectory, TARGETED_OUTPUT), JSON.stringify(forgedReport),
        { encoding: 'utf8', flag: 'wx' });
      await assert.rejects(requirePassingIrasFirstTarget(forgedIssueEvidenceDirectory),
        /IRAS-first targeted profile has not passed/);
    }
  }
} finally {
  if (path.dirname(path.resolve(scratch)) !== resolvedTemp || !path.basename(scratch).startsWith('iras-first-runner-safety-')) {
    throw new Error('Refusing to remove an unexpected safety-test directory.');
  }
  await rm(scratch, { recursive: true, force: true });
}

console.log('IRAS-first fixed-profile, fake-capture, privacy, final-gate, and output-safety regressions passed.');
