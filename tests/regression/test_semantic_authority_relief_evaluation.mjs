import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  authorityReliefCaseAcceptance,
  loadAuthorityReliefTargetedCases,
  loadSemanticContractFollowupCases,
  loadSemanticIntentFinalCases,
  profileConfiguration,
  runSemanticContractFollowupEvaluation,
  scoreAuthorityReliefCanonicalContract
} from '../evaluation/singapore/semantic-contract-followup-evaluation.mjs';
import { parseSemanticIntentProfileArgs } from '../evaluation/singapore/semantic-intent-followup-evaluation.mjs';
import { planAuthorityWorkstreams } from '../../src/services/authorityWorkstreams.ts';

const MODEL = 'gemini-3.5-flash-lite';
const START_GAP_MS = 15_250;
const SECRET = 'AUTHORITY_RELIEF_RUNNER_PRIVATE_SENTINEL_37bc';
const TEST_KEY = `API_KEY_${SECRET}`;

function mockInterpretation(testCase, { wrongReliefOperation = false } = {}) {
  const requiresUserSpecificFacts = testCase.expectedRequiresUserSpecificFacts ?? testCase.id === 'A-paraphrase-2';
  const issues = testCase.expected.map(expected => {
    const isPersonalRelief = testCase.id === 'A-paraphrase-2' && expected.id === 'individual-cpf-tax-relief';
    const operation = isPersonalRelief
      ? wrongReliefOperation ? 'DETERMINE_TREATMENT' : 'CHECK_ELIGIBILITY'
      : wrongReliefOperation && testCase.id === 'target-relief-entitlement' ? 'CALCULATE' : expected.operation[0];
    const subject = testCase.id === 'control-general-recognition'
      ? 'general principles for recognizing intangible assets under IFRS'
      : testCase.id === 'target-mixed-ifrs-singapore-accounting'
        ? 'general recognition of a lease liability under IFRS 16 and Singapore SFRS(I)'
        : isPersonalRelief ? 'individual personal tax relief for compulsory CPF contributions' : expected.subject;
    const requiresFacts = ['CALCULATE', 'CHECK_ELIGIBILITY', 'DETERMINE_TREATMENT', 'PREPARE_JOURNAL'].includes(operation);
    return {
      subject,
      population: expected.population[0],
      domain: expected.domain[0],
      governingAuthorities: testCase.id === 'control-general-recognition'
        ? ['IFRS_FOUNDATION'] : expected.governingAuthorities,
      contextualAuthorities: expected.contextualAuthoritiesAnyOf[0] || [],
      operation,
      mappedTopicIds: [],
      evidenceRequirement: requiresFacts ? 'AUTHORITATIVE_SOURCE_AND_CASE_FACTS' : 'AUTHORITATIVE_SOURCE',
      confidence: 0.96
    };
  });
  const requestedOperations = new Set(issues.map(issue => issue.operation));
  const requestedOperation = requestedOperations.size === 1 ? issues[0].operation : 'OTHER';
  const domains = new Set(issues.map(issue => issue.domain));
  const populations = new Set(issues.map(issue => issue.population));
  const topDomain = domains.size === 1 ? issues[0].domain : 'UNKNOWN';
  const topPopulation = populations.size === 1 ? issues[0].population : 'UNKNOWN';
  const primarySubject = `${issues[0].subject} ${SECRET}`;
  assert.ok(primarySubject.length <= 160, 'the private top-level sentinel remains within the semantic label limit');
  return {
    schemaVersion: 2,
    jurisdiction: ['Singapore'],
    authorityCandidates: testCase.id === 'control-general-recognition'
      ? ['IFRS_FOUNDATION'] : issues[0].governingAuthorities,
    contextualAuthorities: [],
    domain: topDomain,
    population: topPopulation,
    primarySubject,
    concepts: [{ concept: `private concept ${SECRET}`, role: 'PRIMARY' }],
    requestedOperation,
    requiresUserSpecificFacts,
    factsExplicitlyProvided: [],
    confidence: 0.96,
    issues
  };
}

function runtimeFromPlan(question, issuePlan) {
  const issuesById = new Map(issuePlan.issues.map(issue => [issue.id, issue]));
  const workstreams = planAuthorityWorkstreams(issuePlan).map(stream => ({
    authority: stream.authority,
    domain: stream.domain,
    issues: stream.issueIds.map(issueId => issuesById.get(issueId)).filter(Boolean).map(issue => {
      const mapped = issue.status === 'MAPPED';
      const gaps = mapped
        ? [{ issueId: issue.id, code: 'NO_CANDIDATE_EVIDENCE' }, { issueId: issue.id, code: 'NO_VERIFIED_CLAIM' }]
        : [{ issueId: issue.id, code: issue.unresolvedReason || 'ISSUE_UNMAPPED' }];
      return {
        issueId: issue.id,
        operation: issue.operation,
        applicationStatus: 'UNRESOLVED',
        evidenceStatus: 'INSUFFICIENT',
        lifecycle: {
          requested: true,
          mapped,
          retrievalAttempted: mapped,
          evidenceFound: false,
          admitted: false,
          verified: false,
          covered: false
        },
        gaps
      };
    })
  }));
  const gaps = workstreams.flatMap(stream => stream.issues.flatMap(issue => issue.gaps));
  return Promise.resolve({
    question,
    status: 'CONDITIONAL',
    evidenceStatus: 'INSUFFICIENT',
    applicationStatus: 'UNRESOLVED',
    workstreams,
    gaps
  });
}

function makeSyntheticPassingAuthorityReliefGateReport(report, cases) {
  // Synthetic gate data isolates manifest validation; it is never a pipeline result or live-evaluation evidence.
  const synthetic = structuredClone(report);
  for (const row of synthetic.cases) {
    const testCase = cases.find(item => item.id === row.caseId);
    const expectedCount = testCase.expected.length;
    const coverage = row.routing.requestedIssueCoverage;
    coverage.requestedIssueCount = expectedCount;
    coverage.mappedIssueCount = expectedCount;
    coverage.inCanonicalRuntimeCount = expectedCount;
    coverage.lifecycleMappedCount = expectedCount;
    coverage.retrievalAttemptedCount = expectedCount;
    coverage.blockingRoutingGapCount = 0;
    coverage.unclassifiedRoutingGapCount = 0;
    for (const code of Object.keys(coverage.routingGapCounts)) coverage.routingGapCounts[code] = 0;
    row.routing.runtimeTimedOut = false;
    for (const key of Object.keys(row.routing.guardChecks)) row.routing.guardChecks[key] = true;
    const acceptance = row.authorityReliefAcceptance;
    for (const key of [
      'validInterpretation', 'issueCoverageCorrect', 'allDimensionsCorrect', 'operationsCorrect',
      'caseSpecificityCorrect', 'topLevelCalculationFlagCorrect', 'routingCorrect', 'guardsCorrect',
      'requestedIssueCoverageCorrect', 'singleProviderCallPassed', 'fingerprintsStable'
    ]) acceptance[key] = true;
    acceptance.runtimeTimedOut = false;
    acceptance.passed = true;
  }
  synthetic.authorityReliefAcceptance.passed = true;
  synthetic.authorityReliefAcceptance.completedCases = cases.length;
  synthetic.authorityReliefAcceptance.passedCases = cases.length;
  synthetic.authorityReliefAcceptance.failedCases = [];
  synthetic.authorityReliefAcceptance.zeroInvalidTimeoutProviderFailures = true;
  synthetic.authorityReliefAcceptance.pacingPolicyPassed = true;
  synthetic.authorityReliefAcceptance.fingerprintsStable = true;
  synthetic.testFixtureNote = 'Synthetic gate-only fixture; not an observed evaluation result.';
  return synthetic;
}

const historicalCases = await loadSemanticContractFollowupCases();
const finalCases = await loadSemanticIntentFinalCases();
const targetedCases = await loadAuthorityReliefTargetedCases();
assert.deepEqual(finalCases, historicalCases, 'the final profile keeps the original ten frozen cases and expectations unchanged');
assert.equal(finalCases.length, 10);
assert.equal(targetedCases.length, 8);
assert.deepEqual(targetedCases.map(testCase => testCase.id), [
  'control-general-recognition', 'A-paraphrase-2',
  'target-sfrsi-general-recognition', 'target-mixed-ifrs-singapore-accounting',
  'target-relief-entitlement', 'target-relief-amount',
  'target-cpf-general-control', 'target-mom-general-control'
]);
assert.equal(targetedCases.find(testCase => testCase.id === 'A-paraphrase-2')?.question,
  'For someone earning SGD 6,000 a month, what can they claim for personal tax relief on compulsory CPF, and what does the employer have to pay into CPF?');
assert.deepEqual(profileConfiguration('authority-relief-targeted-live').outputPrefix, 'authority-relief-targeted-live');
assert.deepEqual(profileConfiguration('authority-relief-final-live').outputPrefix, 'authority-relief-final-live');
for (const profile of ['authority-relief-targeted-live', 'authority-relief-final-live']) {
  const config = profileConfiguration(profile);
  assert.ok(Object.hasOwn(config.fixtureFiles, 'protectedAuditHashes'));
  assert.equal(typeof config.sourceFiles.semanticInterpretation, 'string');
  assert.equal(typeof config.sourceFiles.queryTopicResolver, 'string', 'authority-relief profiles fingerprint query topic resolution');
  assert.equal(typeof config.sourceFiles.coverageRegistry, 'string', 'authority-relief profiles fingerprint coverage metadata');
}
assert.equal(Object.hasOwn(profileConfiguration('intent-targeted').sourceFiles, 'queryTopicResolver'), false,
  'resolver fingerprints are scoped to the authority-relief profiles');
assert.equal(parseSemanticIntentProfileArgs(['--profile', 'authority-relief-targeted-live', '--live']), 'authority-relief-targeted-live');
assert.equal(parseSemanticIntentProfileArgs(['--profile', 'authority-relief-final-live', '--live']), 'authority-relief-final-live');

const accountingExpected = {
  id: 'recognition',
  subject: 'general principles for recognizing intangible assets',
  matchAny: [['intangible', 'asset']],
  population: ['COMPANY'],
  domain: ['ACCOUNTING'],
  governingAuthorities: ['ACCOUNTING_STANDARDS'],
  contextualAuthoritiesAnyOf: [[]],
  operation: ['EXPLAIN_RULE']
};
const accountingCase = { expected: [accountingExpected] };
const rawAccountingInterpretation = { issues: [{
  id: 'recognition', subject: accountingExpected.subject, population: 'COMPANY', domain: 'ACCOUNTING',
  governingAuthorities: ['IFRS_FOUNDATION'], contextualAuthorities: [], operation: 'EXPLAIN_RULE'
}] };
const canonicalScore = scoreAuthorityReliefCanonicalContract(accountingCase, rawAccountingInterpretation);
assert.equal(canonicalScore.dimensionsCorrect.governingAuthority, 1,
  'canonical scoring maps only the ACCOUNTING governing IFRS alias');

const contextualCase = {
  expected: [{
    id: 'tax', subject: 'Singapore company tax deductibility of intangible cost',
    matchAny: [['tax', 'deductibility']], population: ['COMPANY'], domain: ['IRAS_INCOME_TAX'],
    governingAuthorities: ['IRAS'], contextualAuthoritiesAnyOf: [[]], operation: ['CHECK_ELIGIBILITY']
  }]
};
const contextualScore = scoreAuthorityReliefCanonicalContract(contextualCase, { issues: [{
  id: 'tax', subject: 'Singapore company tax deductibility of intangible cost', population: 'COMPANY',
  domain: 'IRAS_INCOME_TAX', governingAuthorities: ['IRAS'], contextualAuthorities: ['IFRS_FOUNDATION'],
  operation: 'CHECK_ELIGIBILITY'
}] });
assert.equal(contextualScore.dimensionsCorrect.governingAuthority, 1);
assert.equal(contextualScore.dimensionsCorrect.contextualAuthority, 0,
  'contextual IFRS stays visible and is not normalized as an accounting governing authority');

const outputDirectory = await mkdtemp(path.join(os.tmpdir(), 'authority-relief-runner-'));
let elapsed = 0;
let resultCaseIndex = 0;
try {
  const result = await runSemanticContractFollowupEvaluation({
    live: true,
    evaluationProfile: 'authority-relief-targeted-live',
    apiKey: TEST_KEY,
    outputDirectory,
    buildRuntime: runtimeFromPlan,
    sleep: async milliseconds => { elapsed += milliseconds; },
    now: () => new Date(Date.UTC(2026, 8, 30, 0, 0, 0) + elapsed),
    monotonicNow: () => elapsed,
    execute: async (_prompt, _system, provider, options) => {
      assert.equal(provider.activeProvider, 'gemini');
      assert.equal(provider.gemini.model, MODEL);
      assert.equal(options.model, MODEL);
      assert.equal(options.timeoutMs, 8_000);
      assert.equal(options.temperature, 0);
      assert.equal(options.jsonMode, true);
      const testCase = targetedCases[resultCaseIndex++];
      elapsed += 20;
      return JSON.stringify(mockInterpretation(testCase));
    }
  });
  assert.equal(result.requestCount, 8);
  assert.equal(result.authorityReliefAcceptance.passed, true,
    'the updated resolver metadata maps the frozen CPF case and independent generic MOM control');
  assert.equal(result.authorityReliefAcceptance.passedCases, 8);
  assert.deepEqual(result.authorityReliefAcceptance.failedCases, []);
  assert.equal(result.authorityReliefAcceptance.canonicalContractScoring.issueRecall.rate, 1);
  assert.equal(result.authorityReliefAcceptance.canonicalContractScoring.issueRecall.total, 9);
  const requestedIssueCoverageTotals = result.cases.reduce((totals, row) => {
    const coverage = row.routing.requestedIssueCoverage;
    totals.requested += coverage.requestedIssueCount;
    totals.mapped += coverage.mappedIssueCount;
    totals.retrievalAttempted += coverage.retrievalAttemptedCount;
    return totals;
  }, { requested: 0, mapped: 0, retrievalAttempted: 0 });
  assert.deepEqual(requestedIssueCoverageTotals, { requested: 9, mapped: 9, retrievalAttempted: 9 });
  assert.equal(result.authorityReliefAcceptance.zeroInvalidTimeoutProviderFailures, true);
  assert.equal(result.minimumObservedStartGapMs >= START_GAP_MS, true);
  const recognition = result.cases.find(item => item.caseId === 'control-general-recognition');
  assert.equal(recognition.scoring.dimensionsCorrect.governingAuthority, 0,
    'historical raw scoring still exposes the provider IFRS alias');
  assert.equal(recognition.canonicalScoring.dimensionsCorrect.governingAuthority, 1,
    'the new profile separately scores the canonical accounting workstream contract');
  assert.equal(recognition.authorityReliefAcceptance.passed, true);
  const markdown = await readFile(path.join(outputDirectory, 'authority-relief-targeted-live.md'), 'utf8');
  assert.match(markdown, /# Authority and relief targeted live evaluation/);
  assert.match(markdown, /Canonical contract scoring/);
  assert.match(markdown, /Strict acceptance passed: true \(8 \/ 8 cases\)/);
  const serialized = await readFile(path.join(outputDirectory, 'authority-relief-targeted-live.json'), 'utf8');
  assert.equal(serialized.includes(TEST_KEY), false);
  assert.equal(serialized.includes(SECRET), false, 'private provider data is not written to the report');

  const standardsCase = targetedCases.find(testCase => testCase.id === 'target-sfrsi-general-recognition');
  const standardsRow = result.cases.find(item => item.caseId === standardsCase.id);
  const standardsExpected = standardsCase.expected[0];
  const standardsInterpretation = {
    requiresUserSpecificFacts: false,
    requestedOperation: 'EXPLAIN_RULE',
    calculationRequested: false,
    issues: [{
      subject: standardsExpected.subject,
      population: standardsExpected.population[0],
      domain: standardsExpected.domain[0],
      governingAuthorities: standardsExpected.governingAuthorities,
      contextualAuthorities: [],
      operation: 'EXPLAIN_RULE'
    }]
  };
  const standardsAcceptanceInput = {
    testCase: standardsCase,
    validInterpretation: true,
    canonicalScoring: standardsRow.canonicalScoring,
    routing: standardsRow.routing,
    interpretation: standardsInterpretation,
    productionResult: standardsRow.production,
    capture: standardsRow.capture,
    requestCount: 1,
    sourceHashesConsistent: true,
    fixtureHashesConsistent: true
  };
  assert.equal(authorityReliefCaseAcceptance(standardsAcceptanceInput).passed, true,
    'an actual attempted retrieval with no candidate/admitted evidence remains an allowed INSUFFICIENT outcome');
  const routingWithMissingTopics = structuredClone(standardsRow.routing);
  routingWithMissingTopics.requestedIssueCoverage.mappedIssueCount = 0;
  routingWithMissingTopics.requestedIssueCoverage.lifecycleMappedCount = 0;
  routingWithMissingTopics.requestedIssueCoverage.routingGapCounts.NO_COVERAGE_TOPIC = 1;
  routingWithMissingTopics.requestedIssueCoverage.blockingRoutingGapCount = 1;
  routingWithMissingTopics.guardChecks.requestedIssuesMappedAndRetrieved = false;
  assert.equal(authorityReliefCaseAcceptance({ ...standardsAcceptanceInput, routing: routingWithMissingTopics }).passed, false,
    'a canonical workstream shell without mapped requested topics fails acceptance');
  const routingWithoutAttempt = structuredClone(standardsRow.routing);
  routingWithoutAttempt.requestedIssueCoverage.retrievalAttemptedCount = 0;
  routingWithoutAttempt.guardChecks.requestedIssuesMappedAndRetrieved = false;
  assert.equal(authorityReliefCaseAcceptance({ ...standardsAcceptanceInput, routing: routingWithoutAttempt }).passed, false,
    'a canonical workstream shell without a retrieval attempt fails acceptance');
  const unavailableRouting = structuredClone(standardsRow.routing);
  unavailableRouting.requestedIssueCoverage.routingGapCounts.PROVIDER_UNAVAILABLE = 1;
  unavailableRouting.requestedIssueCoverage.blockingRoutingGapCount = 1;
  unavailableRouting.guardChecks.requestedIssuesMappedAndRetrieved = false;
  assert.equal(authorityReliefCaseAcceptance({ ...standardsAcceptanceInput, routing: unavailableRouting }).passed, false,
    'a canonical shell with a requested provider-unavailable gap fails acceptance');
  for (const unavailableCode of ['PROVIDER_AUTHORITY_MISMATCH', 'PROVIDER_ERROR']) {
    const failedProviderRouting = structuredClone(standardsRow.routing);
    failedProviderRouting.requestedIssueCoverage.routingGapCounts[unavailableCode] = 1;
    failedProviderRouting.requestedIssueCoverage.blockingRoutingGapCount = 1;
    failedProviderRouting.guardChecks.requestedIssuesMappedAndRetrieved = false;
    assert.equal(authorityReliefCaseAcceptance({ ...standardsAcceptanceInput, routing: failedProviderRouting }).passed, false,
      `${unavailableCode} is a failed routing path even when a canonical workstream shell exists`);
  }
  const timedOutRouting = structuredClone(standardsRow.routing);
  timedOutRouting.runtimeTimedOut = true;
  timedOutRouting.guardChecks.requestedIssuesMappedAndRetrieved = false;
  assert.equal(authorityReliefCaseAcceptance({ ...standardsAcceptanceInput, routing: timedOutRouting }).passed, false,
    'a timed-out local runtime cannot pass strict authority-relief acceptance');

  let wrongOperationIndex = 0;
  elapsed = 0;
  const wrongOperationResult = await runSemanticContractFollowupEvaluation({
    live: true,
    evaluationProfile: 'authority-relief-targeted-live',
    apiKey: TEST_KEY,
    outputDirectory: path.join(outputDirectory, 'wrong-operation'),
    buildRuntime: runtimeFromPlan,
    sleep: async milliseconds => { elapsed += milliseconds; },
    now: () => new Date(Date.UTC(2026, 8, 30, 0, 0, 0) + elapsed),
    monotonicNow: () => elapsed,
    execute: async () => {
      const testCase = targetedCases[wrongOperationIndex++];
      elapsed += 20;
      return JSON.stringify(mockInterpretation(testCase, { wrongReliefOperation: true }));
    }
  });
  const wrongReliefRow = wrongOperationResult.cases.find(item => item.caseId === 'A-paraphrase-2');
  assert.equal(wrongReliefRow.validInterpretation, true);
  const wrongMappedReliefRow = wrongOperationResult.cases.find(item => item.caseId === 'target-relief-entitlement');
  assert.equal(wrongMappedReliefRow.validInterpretation, true);
  assert.equal(wrongMappedReliefRow.authorityReliefAcceptance.requestedIssueCoverageCorrect, true,
    'the wrong-operation control has a valid mapped workstream and actual retrieval attempt');
  assert.equal(wrongMappedReliefRow.authorityReliefAcceptance.operationsCorrect, false,
    'valid but incorrectly classified entitlement fails strict semantic acceptance');
  assert.equal(wrongOperationResult.authorityReliefAcceptance.zeroInvalidTimeoutProviderFailures, true,
    'a semantic operation failure does not get counted as an invalid response or transport failure');

  const staleGateDirectory = path.join(outputDirectory, 'stale-manifest-gate');
  await mkdir(staleGateDirectory);
  const syntheticGateReport = makeSyntheticPassingAuthorityReliefGateReport(JSON.parse(serialized), targetedCases);
  const passGateDirectory = path.join(outputDirectory, 'synthetic-pass-gate');
  await mkdir(passGateDirectory);
  await writeFile(path.join(passGateDirectory, 'authority-relief-targeted-live.json'), JSON.stringify(syntheticGateReport));
  let syntheticGateCalls = 0;
  await assert.rejects(runSemanticContractFollowupEvaluation({
    live: true,
    evaluationProfile: 'authority-relief-final-live',
    apiKey: 'short',
    outputDirectory: passGateDirectory,
    execute: async () => { syntheticGateCalls += 1; }
  }), /GEMINI_API_KEY is not configured/);
  assert.equal(syntheticGateCalls, 0, 'the synthetic report passes gate validation but the short key stops before a provider call');

  const staleTarget = structuredClone(syntheticGateReport);
  staleTarget.sourceFingerprints.semanticInterpretation = 'stale-manifest';
  await writeFile(path.join(staleGateDirectory, 'authority-relief-targeted-live.json'), JSON.stringify(staleTarget));
  let staleGateCalls = 0;
  await assert.rejects(runSemanticContractFollowupEvaluation({
    live: true,
    evaluationProfile: 'authority-relief-final-live',
    apiKey: TEST_KEY,
    outputDirectory: staleGateDirectory,
    execute: async () => { staleGateCalls += 1; }
  }), /targeted profile has not passed/);
  assert.equal(staleGateCalls, 0,
    'a stale report is rejected even if it retains prior passing booleans and case results');

  let finalProviderCalls = 0;
  await assert.rejects(runSemanticContractFollowupEvaluation({
    live: true,
    evaluationProfile: 'authority-relief-final-live',
    apiKey: TEST_KEY,
    outputDirectory: path.join(outputDirectory, 'gated-final'),
    execute: async () => { finalProviderCalls += 1; }
  }), /targeted profile has not passed/);
  assert.equal(finalProviderCalls, 0, 'the final profile is gated before any provider call without a validated target report');
  assert.equal(await readFile(path.join(outputDirectory, 'gated-final', 'authority-relief-final-live.json'), 'utf8').catch(() => ''), '');
} finally {
  await rm(outputDirectory, { recursive: true, force: true });
}

console.log('Semantic authority and relief evaluation safety regressions passed.');
