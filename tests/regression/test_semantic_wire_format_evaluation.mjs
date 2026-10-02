import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  loadAuthorityReliefTargetedCases,
  loadSemanticContractFollowupCases,
  loadSemanticIntentFinalCases,
  loadSemanticWireFormatTargetedCases,
  profileConfiguration,
  runSemanticContractFollowupEvaluation
} from '../evaluation/singapore/semantic-contract-followup-evaluation.mjs';
import { parseSemanticIntentProfileArgs } from '../evaluation/singapore/semantic-intent-followup-evaluation.mjs';
import { planAuthorityWorkstreams } from '../../src/services/authorityWorkstreams.ts';

const MODEL = 'gemini-3.5-flash-lite';
const START_GAP_MS = 15_250;
const TEST_KEY = 'synthetic-wire-format-provider-key';

function mockInterpretation(testCase, { wrongReliefOperation = false } = {}) {
  const issues = testCase.expected.map(expected => {
    const personalRelief = testCase.id === 'A-paraphrase-2' && expected.id === 'individual-cpf-tax-relief';
    const operation = personalRelief
      ? wrongReliefOperation ? 'DETERMINE_TREATMENT' : 'CHECK_ELIGIBILITY'
      : wrongReliefOperation && testCase.id === 'target-relief-entitlement' ? 'CALCULATE' : expected.operation[0];
    return {
      subject: expected.subject,
      population: expected.population[0],
      domain: expected.domain[0],
      governingAuthorities: testCase.id === 'control-general-recognition'
        ? ['IFRS_FOUNDATION'] : expected.governingAuthorities,
      contextualAuthorities: expected.contextualAuthoritiesAnyOf[0] || [],
      operation,
      mappedTopicIds: [],
      evidenceRequirement: ['CALCULATE', 'CHECK_ELIGIBILITY', 'DETERMINE_TREATMENT', 'PREPARE_JOURNAL'].includes(operation)
        ? 'AUTHORITATIVE_SOURCE_AND_CASE_FACTS' : 'AUTHORITATIVE_SOURCE',
      confidence: 0.96
    };
  });
  const distinctOperations = new Set(issues.map(item => item.operation));
  const distinctDomains = new Set(issues.map(item => item.domain));
  const distinctPopulations = new Set(issues.map(item => item.population));
  const distinctAuthorities = new Set(issues.flatMap(item => item.governingAuthorities));
  const needsFacts = testCase.expectedRequiresUserSpecificFacts ??
    issues.some(item => ['CALCULATE', 'CHECK_ELIGIBILITY', 'DETERMINE_TREATMENT', 'PREPARE_JOURNAL'].includes(item.operation));
  return {
    schemaVersion: 2,
    jurisdiction: ['Singapore'],
    authorityCandidates: distinctAuthorities.size === 1 ? [issues[0].governingAuthorities[0]] : ['UNKNOWN'],
    contextualAuthorities: [],
    domain: distinctDomains.size === 1 ? issues[0].domain : 'UNKNOWN',
    population: distinctPopulations.size === 1 ? issues[0].population : 'UNKNOWN',
    primarySubject: issues[0].subject,
    concepts: [{ concept: issues[0].subject, role: 'PRIMARY' }],
    requestedOperation: distinctOperations.size === 1 ? issues[0].operation : 'OTHER',
    requiresUserSpecificFacts: needsFacts,
    factsExplicitlyProvided: [],
    confidence: 0.96,
    issues
  };
}

function runtimeFromPlan(question, issuePlan, { questionUnderstanding } = {}) {
  // This no-API stub exercises report acceptance and final gating, not resolver coverage or evidence quality.
  issuePlan.coverageEstablished = true;
  issuePlan.hasUnmappedResidual = false;
  const requestedIssueCount = questionUnderstanding?.interpretation?.issues?.length ?? issuePlan.issues.length;
  for (const issue of issuePlan.issues.slice(0, requestedIssueCount)) {
    issue.status = 'MAPPED';
    issue.unresolvedReason = undefined;
  }
  const issuesById = new Map(issuePlan.issues.map(issue => [issue.id, issue]));
  const workstreams = planAuthorityWorkstreams(issuePlan).map(stream => ({
    authority: stream.authority,
    domain: stream.domain,
    issues: stream.issueIds.map(issueId => issuesById.get(issueId)).filter(Boolean).map(issue => {
      const mapped = issue.status === 'MAPPED';
      return {
        issueId: issue.id,
        operation: issue.operation,
        applicationStatus: 'UNRESOLVED',
        evidenceStatus: 'INSUFFICIENT',
        lifecycle: { requested: true, mapped, retrievalAttempted: mapped, evidenceFound: false, admitted: false, verified: false, covered: false },
        gaps: mapped
          ? [{ issueId: issue.id, code: 'NO_CANDIDATE_EVIDENCE' }, { issueId: issue.id, code: 'NO_VERIFIED_CLAIM' }]
          : [{ issueId: issue.id, code: issue.unresolvedReason || 'ISSUE_UNMAPPED' }]
      };
    })
  }));
  return Promise.resolve({
    question,
    status: 'CONDITIONAL',
    evidenceStatus: 'INSUFFICIENT',
    applicationStatus: 'UNRESOLVED',
    workstreams,
    gaps: workstreams.flatMap(stream => stream.issues.flatMap(issue => issue.gaps))
  });
}

const REQUIRED_WIRE_CASE_IDS = [
  'target-mixed-ifrs-singapore-accounting',
  'control-general-recognition',
  'A-paraphrase-2',
  'target-relief-entitlement',
  'dev-investment-comparison',
  'target-sfrsi-general-recognition'
];
const expectedFinalIds = [
  'A-paraphrase-2',
  'adversarial-C-employee-benefit',
  'control-general-recognition',
  'control-general-interaction',
  'A-paraphrase-3',
  'dev-conceptual-illustration',
  'dev-training-entitlement',
  'dev-mixed-entry-total',
  'dev-corporate-filing',
  'dev-investment-comparison'
];

const [wireCases, historicalCases, authorityReliefCases, finalCases] = await Promise.all([
  loadSemanticWireFormatTargetedCases(),
  loadSemanticContractFollowupCases(),
  loadAuthorityReliefTargetedCases(),
  loadSemanticIntentFinalCases()
]);
assert.deepEqual(wireCases.map(item => item.id), REQUIRED_WIRE_CASE_IDS,
  'the wire-format profile keeps the exact frozen six-case order');
const frozenById = new Map([...historicalCases, ...authorityReliefCases].map(item => [item.id, item]));
assert.deepEqual(wireCases, REQUIRED_WIRE_CASE_IDS.map(id => frozenById.get(id)),
  'the six cases reuse unchanged questions and expectations from the existing fixtures');
assert.deepEqual(finalCases, historicalCases, 'the final profile keeps the original ten case objects unchanged');
assert.deepEqual(finalCases.map(item => item.id), expectedFinalIds);

const targetedConfig = profileConfiguration('semantic-wire-format-targeted-live');
const finalConfig = profileConfiguration('semantic-wire-format-final-live');
assert.equal(targetedConfig.outputPrefix, 'semantic-wire-format-targeted-live');
assert.equal(finalConfig.outputPrefix, 'semantic-wire-format-final-live');
assert.equal(targetedConfig.defaultOutputDirectory, finalConfig.defaultOutputDirectory);
assert.equal(path.basename(targetedConfig.defaultOutputDirectory), 'semantic-wire-format-live-2026-10-02');
assert.ok(Object.hasOwn(targetedConfig.fixtureFiles, 'protectedWireFormatHashes'));
assert.ok(Object.hasOwn(finalConfig.fixtureFiles, 'protectedWireFormatHashes'));
assert.equal(typeof targetedConfig.sourceFiles.semanticInterpretation, 'string');
assert.equal(typeof targetedConfig.sourceFiles.transport, 'string');
assert.equal(typeof targetedConfig.sourceFiles.semanticContractEvaluationRunner, 'string');
assert.equal(typeof targetedConfig.sourceFiles.semanticWireFormatCliRunner, 'string');
assert.equal(parseSemanticIntentProfileArgs(['--profile', 'semantic-wire-format-targeted-live', '--live']),
  'semantic-wire-format-targeted-live');
assert.equal(parseSemanticIntentProfileArgs(['--profile', 'semantic-wire-format-final-live', '--live']),
  'semantic-wire-format-final-live');

const outputDirectory = await mkdtemp(path.join(os.tmpdir(), 'semantic-wire-format-profile-'));
try {
  let providerCalls = 0;
  await assert.rejects(runSemanticContractFollowupEvaluation({
    live: true,
    evaluationProfile: 'semantic-wire-format-final-live',
    apiKey: 'synthetic-live-key-12345',
    outputDirectory: path.join(outputDirectory, 'missing-target'),
    execute: async () => { providerCalls += 1; }
  }), /semantic wire-format targeted profile has not passed/);
  assert.equal(providerCalls, 0, 'the final ten-case profile is gated before any provider request');

  const passingDirectory = path.join(outputDirectory, 'passing-target');
  let elapsed = 0;
  let caseIndex = 0;
  const passingTarget = await runSemanticContractFollowupEvaluation({
    live: true,
    evaluationProfile: 'semantic-wire-format-targeted-live',
    apiKey: TEST_KEY,
    outputDirectory: passingDirectory,
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
      const testCase = wireCases[caseIndex++];
      elapsed += 5;
      return JSON.stringify(mockInterpretation(testCase));
    }
  });
  assert.equal(caseIndex, 6);
  assert.equal(passingTarget.authorityReliefAcceptance.passed, true,
    `a synthetic no-API six-case run satisfies strict acceptance: ${JSON.stringify({
      failed: passingTarget.authorityReliefAcceptance.failedCases,
      rows: passingTarget.cases.map(row => ({
        id: row.caseId,
        score: row.canonicalScoring,
        acceptance: row.authorityReliefAcceptance,
        routing: row.routing
      }))
    })}`);
  assert.equal(passingTarget.authorityReliefAcceptance.passedCases, 6);
  assert.equal(passingTarget.minimumObservedStartGapMs >= START_GAP_MS, true);
  let finalCalls = 0;
  await assert.rejects(runSemanticContractFollowupEvaluation({
    live: true,
    evaluationProfile: 'semantic-wire-format-final-live',
    apiKey: 'short',
    outputDirectory: passingDirectory,
    execute: async () => { finalCalls += 1; }
  }), /GEMINI_API_KEY is not configured/);
  assert.equal(finalCalls, 0,
    'a passing fixed six-case report satisfies the gate before final-profile provider setup');

  const failedDirectory = path.join(outputDirectory, 'failed-target');
  await mkdir(failedDirectory);
  const failedTarget = structuredClone(passingTarget);
  failedTarget.authorityReliefAcceptance.passed = false;
  await writeFile(path.join(failedDirectory, `${targetedConfig.outputPrefix}.json`), JSON.stringify(failedTarget));
  await assert.rejects(runSemanticContractFollowupEvaluation({
    live: true,
    evaluationProfile: 'semantic-wire-format-final-live',
    apiKey: TEST_KEY,
    outputDirectory: failedDirectory,
    execute: async () => { providerCalls += 1; }
  }), /semantic wire-format targeted profile has not passed/);
  assert.equal(providerCalls, 0, 'a failed targeted acceptance blocks the final profile before provider calls');

  const staleDirectory = path.join(outputDirectory, 'stale-target');
  await mkdir(staleDirectory);
  const staleTarget = structuredClone(passingTarget);
  staleTarget.sourceFingerprints.semanticInterpretation = 'stale-source-fingerprint';
  await writeFile(path.join(staleDirectory, `${targetedConfig.outputPrefix}.json`), JSON.stringify(staleTarget));
  await assert.rejects(runSemanticContractFollowupEvaluation({
    live: true,
    evaluationProfile: 'semantic-wire-format-final-live',
    apiKey: TEST_KEY,
    outputDirectory: staleDirectory,
    execute: async () => { providerCalls += 1; }
  }), /semantic wire-format targeted profile has not passed/);
  assert.equal(providerCalls, 0, 'a fingerprint-stale targeted report blocks the final profile before provider calls');

  const preserveDirectory = path.join(outputDirectory, 'existing-target-output');
  await mkdir(preserveDirectory);
  const existingPath = path.join(preserveDirectory, 'semantic-wire-format-targeted-live.md');
  await writeFile(existingPath, 'preserve existing report');
  await assert.rejects(runSemanticContractFollowupEvaluation({
    live: true,
    evaluationProfile: 'semantic-wire-format-targeted-live',
    apiKey: 'synthetic-live-key-12345',
    outputDirectory: preserveDirectory,
    execute: async () => { providerCalls += 1; }
  }), /output file already exists/);
  assert.equal(providerCalls, 0, 'existing profile output prevents provider calls');
  assert.equal(await readFile(existingPath, 'utf8'), 'preserve existing report', 'existing profile output is not overwritten');
} finally {
  await rm(outputDirectory, { recursive: true, force: true });
}

console.log('Semantic wire-format fixed profile, gate, and output-safety regressions passed.');
