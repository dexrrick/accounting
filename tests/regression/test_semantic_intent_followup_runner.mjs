import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  loadSemanticContractFollowupCases,
  loadSemanticIntentFinalCases,
  loadSemanticIntentTargetedCases,
  runSemanticContractFollowupEvaluation
} from '../evaluation/singapore/semantic-contract-followup-evaluation.mjs';
import { parseSemanticIntentProfileArgs } from '../evaluation/singapore/semantic-intent-followup-evaluation.mjs';
import { planAuthorityWorkstreams } from '../../src/services/authorityWorkstreams.ts';

const MODEL = 'gemini-3.5-flash-lite';
const START_GAP_MS = 15_250;
const SECRET = 'INTENT_RUNNER_PRIVATE_SENTINEL_91bc';
const TEST_KEY = `API_KEY_${SECRET}`;
const STRICT_EMPLOYER_CASE = 'A-paraphrase-2';
const STRICT_BENEFIT_CASE = 'adversarial-C-employee-benefit';
const RATE_LIMIT_CASE = 'withholding-tax-liability-classification';
const TIMEOUT_CASE = 'wht-payment-amount-calculation';
const MOCK_CASE_SPECIFICITY = Object.freeze({
  'A-paraphrase-2': true,
  'adversarial-C-employee-benefit': true,
  'control-general-recognition': false,
  'control-general-interaction': false,
  'A-paraphrase-3': true,
  'dev-conceptual-illustration': false,
  'dev-training-entitlement': true,
  'dev-mixed-entry-total': true,
  'dev-corporate-filing': false,
  'dev-investment-comparison': false,
  'employer-cpf-implicit-calculation': true,
  'wht-payment-amount-calculation': true,
  'general-employment-benefit-rule': false,
  'specific-employee-benefit-treatment': true,
  'withholding-tax-liability-classification': true
});

function makeResponse(testCase, { operationOverrides = {}, caseSpecificityOverrides = {} } = {}) {
  const requiresUserSpecificFacts = Object.hasOwn(caseSpecificityOverrides, testCase.id)
    ? caseSpecificityOverrides[testCase.id]
    : MOCK_CASE_SPECIFICITY[testCase.id];
  assert.equal(typeof requiresUserSpecificFacts, 'boolean', `fixed mock fact-gate expectation exists for ${testCase.id}`);
  const issues = testCase.expected.map(expected => ({
    subject: `${expected.subject} ${SECRET}`,
    population: expected.population[0],
    domain: expected.domain[0],
    governingAuthorities: expected.governingAuthorities,
    contextualAuthorities: expected.contextualAuthoritiesAnyOf[0] || [],
    operation: operationOverrides[expected.id] ||
      (testCase.id === STRICT_BENEFIT_CASE && expected.id === 'employee-accommodation-benefit-tax'
        ? 'CHECK_ELIGIBILITY'
        : expected.operation[0]),
    mappedTopicIds: [],
    evidenceRequirement: ['CALCULATE', 'CHECK_ELIGIBILITY', 'DETERMINE_TREATMENT', 'PREPARE_JOURNAL'].includes(expected.operation[0])
      ? 'AUTHORITATIVE_SOURCE_AND_CASE_FACTS'
      : 'AUTHORITATIVE_SOURCE',
    confidence: 0.94
  }));
  return JSON.stringify({
    schemaVersion: 2,
    jurisdiction: ['Singapore'],
    authorityCandidates: ['UNKNOWN'],
    contextualAuthorities: [],
    domain: 'UNKNOWN',
    population: 'UNKNOWN',
    primarySubject: `private primary subject ${SECRET}`,
    concepts: [{ concept: `private concept ${SECRET}`, role: 'PRIMARY' }],
    requestedOperation: 'OTHER',
    requiresUserSpecificFacts,
    factsExplicitlyProvided: [`private case fact ${SECRET}`],
    confidence: 0.94,
    issues
  });
}

function runtimeFromPlan(question, issuePlan) {
  const issuesById = new Map(issuePlan.issues.map(issue => [issue.id, issue]));
  const workstreams = planAuthorityWorkstreams(issuePlan).map(stream => ({
    authority: stream.authority,
    domain: stream.domain,
    issues: stream.issueIds.map(issueId => issuesById.get(issueId)).filter(Boolean).map(issue => ({
      issueId: issue.id,
      operation: issue.operation,
      applicationStatus: 'UNRESOLVED'
    }))
  }));
  return Promise.resolve({
    question,
    status: 'CONDITIONAL',
    evidenceStatus: 'INSUFFICIENT',
    applicationStatus: 'UNRESOLVED',
    workstreams
  });
}

function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

const historicalCases = await loadSemanticContractFollowupCases();
const targetedCases = await loadSemanticIntentTargetedCases();
const finalCases = await loadSemanticIntentFinalCases();
const corporateFilingQuestion = 'Which annual income-tax return must a Singapore-incorporated company submit?';
assert.equal(finalCases.find(item => item.id === 'dev-corporate-filing')?.question, corporateFilingQuestion);
assert.equal(targetedCases.length, 8);
assert.deepEqual(targetedCases.map(item => item.id), [
  'A-paraphrase-2',
  'adversarial-C-employee-benefit',
  'control-general-recognition',
  'employer-cpf-implicit-calculation',
  'wht-payment-amount-calculation',
  'general-employment-benefit-rule',
  'specific-employee-benefit-treatment',
  'withholding-tax-liability-classification'
]);
assert.equal(targetedCases.filter(item => item.group === 'INDEPENDENT_CONTROL').length, 5);
assert.deepEqual(finalCases, historicalCases, 'intent-final reuses the original ten fixed cases unchanged');
assert.equal(parseSemanticIntentProfileArgs(['--profile', 'intent-targeted', '--live']), 'intent-targeted');
assert.equal(parseSemanticIntentProfileArgs(['--profile', 'intent-final', '--live']), 'intent-final');
assert.throws(() => parseSemanticIntentProfileArgs(['--live']), /Usage:/);
assert.throws(() => parseSemanticIntentProfileArgs(['--profile', 'intent-targeted']), /Usage:/);
assert.throws(() => parseSemanticIntentProfileArgs(['--profile', 'custom', '--live']), /Usage:/);

const outputDirectory = await mkdtemp(path.join(os.tmpdir(), 'semantic-intent-followup-'));
const targetCalls = [];
const targetSleeps = [];
let elapsed = 0;
let wallClock = Date.UTC(2026, 8, 30, 0, 0, 0);

try {
  const refusedDirectory = path.join(outputDirectory, 'existing');
  await mkdir(refusedDirectory);
  await writeFile(path.join(refusedDirectory, 'semantic-intent-targeted-live.json'), 'preserve');
  let refusedCalls = 0;
  await assert.rejects(runSemanticContractFollowupEvaluation({
    live: true,
    evaluationProfile: 'intent-targeted',
    apiKey: TEST_KEY,
    outputDirectory: refusedDirectory,
    execute: async () => { refusedCalls += 1; }
  }), /output file already exists/);
  assert.equal(refusedCalls, 0, 'either existing intent output prevents provider calls');
  assert.equal(await readFile(path.join(refusedDirectory, 'semantic-intent-targeted-live.json'), 'utf8'), 'preserve');

  const markdownRefusedDirectory = path.join(outputDirectory, 'markdown-existing');
  await mkdir(markdownRefusedDirectory);
  await writeFile(path.join(markdownRefusedDirectory, 'semantic-intent-targeted-live.md'), 'preserve markdown');
  let markdownRefusedCalls = 0;
  await assert.rejects(runSemanticContractFollowupEvaluation({
    live: true,
    evaluationProfile: 'intent-targeted',
    apiKey: TEST_KEY,
    outputDirectory: markdownRefusedDirectory,
    execute: async () => { markdownRefusedCalls += 1; }
  }), /output file already exists/);
  assert.equal(markdownRefusedCalls, 0);
  assert.equal(await readFile(path.join(markdownRefusedDirectory, 'semantic-intent-targeted-live.md'), 'utf8'), 'preserve markdown');

  await assert.rejects(runSemanticContractFollowupEvaluation({
    live: true,
    evaluationProfile: 'intent-targeted',
    cases: targetedCases,
    apiKey: TEST_KEY,
    outputDirectory: path.join(outputDirectory, 'injected'),
    execute: async () => { throw new Error('must not execute'); }
  }), /required fixed evaluation case is missing/);

  const historicalOutput = path.join(outputDirectory, 'semantic-contract-followup-v2-live.json');
  await writeFile(historicalOutput, 'historical report sentinel');

  const result = await runSemanticContractFollowupEvaluation({
    live: true,
    evaluationProfile: 'intent-targeted',
    apiKey: TEST_KEY,
    outputDirectory,
    buildRuntime: runtimeFromPlan,
    sleep: async milliseconds => {
      targetSleeps.push(milliseconds);
      elapsed += milliseconds;
    },
    now: () => new Date(wallClock += 1000),
    monotonicNow: () => elapsed,
    execute: async (prompt, systemInstruction, provider, options) => {
      const caseIndex = targetCalls.length;
      const testCase = targetedCases[caseIndex];
      targetCalls.push({ id: testCase.id, prompt, systemInstruction, provider, options });
      assert.equal(provider.activeProvider, 'gemini');
      assert.equal(provider.gemini.model, MODEL);
      assert.equal(provider.gemini.apiKey, TEST_KEY);
      assert.equal(options.model, MODEL);
      assert.equal(options.timeoutMs, 8000);
      assert.equal(options.temperature, 0);
      assert.equal(options.jsonMode, true);
      elapsed += 25;
      if (testCase.id === RATE_LIMIT_CASE) throw new Error(`Gemini API request failed with HTTP 429. ${SECRET}`);
      if (testCase.id === TIMEOUT_CASE) throw new Error(`request timed out ${SECRET}`);
      return makeResponse(testCase, {
        operationOverrides: { 'employer-cpf-contribution': 'CHECK_ELIGIBILITY' },
        caseSpecificityOverrides: {
          'control-general-recognition': true,
          'specific-employee-benefit-treatment': false
        }
      });
    }
  });

  assert.equal(targetCalls.length, targetedCases.length, 'each selected fixed case makes exactly one provider request, including 429');
  assert.deepEqual(targetCalls.map(call => call.id), targetedCases.map(testCase => testCase.id));
  assert.equal(targetSleeps.length, targetedCases.length - 1);
  assert.ok(targetSleeps.every(milliseconds => milliseconds === START_GAP_MS));
  assert.ok(result.minimumObservedStartGapMs >= START_GAP_MS);
  assert.equal(result.requestCount, targetedCases.length);
  assert.equal(result.evaluationProfile, 'intent-targeted');
  assert.equal(result.outputPrefix, 'semantic-intent-targeted-live');
  assert.equal(result.sourceHashesConsistent, true);
  assert.equal(result.fixtureHashesConsistent, true);
  assert.equal(typeof result.sourceFingerprints.semanticIntentEvaluationRunner, 'string');
  assert.equal(typeof result.sourceFingerprints.semanticIntentCliRunner, 'string');
  assert.equal(typeof result.fixtureFingerprints.semanticIntentBoundaries, 'string');

  const rateLimited = result.cases.find(item => item.caseId === RATE_LIMIT_CASE);
  assert.equal(rateLimited.production.failure, 'RATE_LIMITED');
  assert.equal(rateLimited.capture.transportCategory, 'RATE_LIMITED');
  assert.equal(rateLimited.capture.requestCount, 1);
  const employer = result.cases.find(item => item.caseId === STRICT_EMPLOYER_CASE);
  assert.equal(employer.validInterpretation, true);
  assert.equal(employer.scoring.operationCorrect, employer.scoring.operationMatched,
    'historically accepted employer CHECK_ELIGIBILITY remains correctly scored');
  assert.deepEqual(employer.intentAcceptance.strictOperationChecks, [{
    expectedIssueId: 'employer-cpf-contribution',
    expectedOperation: 'CALCULATE',
    actualOperation: 'CHECK_ELIGIBILITY',
    matched: true,
    passed: false
  }], 'the strict employer calculation check does not inherit its broader frozen labels');
  const benefit = result.cases.find(item => item.caseId === STRICT_BENEFIT_CASE);
  assert.equal(benefit.validInterpretation, true);
  assert.equal(benefit.scoring.operationCorrect, benefit.scoring.operationMatched,
    'the historical accepted CHECK_ELIGIBILITY label remains correctly scored');
  assert.deepEqual(benefit.intentAcceptance.strictOperationChecks, [{
    expectedIssueId: 'employee-accommodation-benefit-tax',
    expectedOperation: 'DETERMINE_TREATMENT',
    actualOperation: 'CHECK_ELIGIBILITY',
    matched: true,
    passed: false
  }], 'the stricter intent acceptance diagnostic rejects the historically broad operation');
  assert.equal(benefit.intentAcceptance.strictOperationsCorrect, false);
  const timeout = result.cases.find(item => item.caseId === TIMEOUT_CASE);
  assert.equal(timeout.production.failure, 'TIMEOUT');
  assert.equal(timeout.capture.transportCategory, 'TIMEOUT');
  assert.equal(timeout.capture.responseReceived, false);
  assert.equal(timeout.capture.requestCount, 1);
  const employerControl = result.cases.find(item => item.caseId === 'employer-cpf-implicit-calculation');
  assert.equal(employerControl.intentAcceptance.passed, true, JSON.stringify({ acceptance: employerControl.intentAcceptance, guards: employerControl.routing.guardChecks }));
  assert.equal(employerControl.intentAcceptance.completeExpectedIssueCoverage, true);
  assert.equal(employerControl.intentAcceptance.correctRouting, true);
  assert.equal(employerControl.intentAcceptance.allRuntimeGuardsPassed, true, JSON.stringify(employerControl.routing.guardChecks));
  const conceptual = result.cases.find(item => item.caseId === 'control-general-recognition');
  assert.equal(conceptual.validInterpretation, true);
  assert.deepEqual(conceptual.intentAcceptance.caseSpecificity, { expected: false, actual: true });
  assert.equal(conceptual.intentAcceptance.caseSpecificityCorrect, false);
  assert.equal(conceptual.intentAcceptance.completeExpectedIssueCoverage, true);
  assert.equal(conceptual.intentAcceptance.matchedDimensionsCorrect, true);
  assert.equal(conceptual.intentAcceptance.allMatchedOperationsCorrect, true);
  assert.equal(conceptual.intentAcceptance.correctRouting, true);
  assert.equal(conceptual.intentAcceptance.allRuntimeGuardsPassed, true);
  assert.equal(conceptual.intentAcceptance.passed, false, 'an incorrect true fact gate rejects a conceptual control');
  const appliedBenefit = result.cases.find(item => item.caseId === 'specific-employee-benefit-treatment');
  assert.equal(appliedBenefit.validInterpretation, true, 'OTHER makes requiresUserSpecificFacts=false schema-valid');
  assert.deepEqual(appliedBenefit.intentAcceptance.caseSpecificity, { expected: true, actual: false });
  assert.equal(appliedBenefit.intentAcceptance.caseSpecificityCorrect, false);
  assert.equal(appliedBenefit.intentAcceptance.completeExpectedIssueCoverage, true);
  assert.equal(appliedBenefit.intentAcceptance.matchedDimensionsCorrect, true);
  assert.equal(appliedBenefit.intentAcceptance.allMatchedOperationsCorrect, true);
  assert.equal(appliedBenefit.intentAcceptance.correctRouting, true);
  assert.equal(appliedBenefit.intentAcceptance.allRuntimeGuardsPassed, true);
  assert.equal(appliedBenefit.intentAcceptance.passed, false, 'an incorrect false fact gate rejects an applied benefit case');

  const jsonPath = path.join(outputDirectory, 'semantic-intent-targeted-live.json');
  const markdownPath = path.join(outputDirectory, 'semantic-intent-targeted-live.md');
  const jsonText = await readFile(jsonPath, 'utf8');
  const markdownText = await readFile(markdownPath, 'utf8');
  assert.equal(jsonText.includes(SECRET), false, 'private response fields, API keys, and provider errors are not persisted');
  assert.equal(markdownText.includes(SECRET), false);
  assert.equal(jsonText.includes(targetedCases[0].question), false, 'fixed fixture questions are not persisted');
  assert.equal(markdownText.includes(targetedCases[0].question), false);
  assert.equal(await readFile(historicalOutput, 'utf8'), 'historical report sentinel', 'intent profiles leave historical report filenames untouched');
  assert.equal(result.fixtureFingerprints.semanticIntentBoundaries, sha256(await readFile(
    new URL('../evaluation/singapore/semantic-intent-boundaries.json', import.meta.url)
  )));
} finally {
  await rm(outputDirectory, { recursive: true, force: true });
}

const finalDirectory = await mkdtemp(path.join(os.tmpdir(), 'semantic-intent-final-'));
const finalCalls = [];
try {
  const result = await runSemanticContractFollowupEvaluation({
    live: true,
    evaluationProfile: 'intent-final',
    apiKey: TEST_KEY,
    outputDirectory: finalDirectory,
    buildRuntime: runtimeFromPlan,
    sleep: async () => {},
    monotonicNow: () => finalCalls.length * START_GAP_MS,
    execute: async (_prompt, _system, _provider, _options) => {
      const testCase = finalCases[finalCalls.length];
      finalCalls.push(testCase.id);
      return makeResponse(testCase, {
        operationOverrides: {
          'employer-cpf-contribution': 'CALCULATE',
          'employee-accommodation-benefit-tax': 'DETERMINE_TREATMENT'
        }
      });
    }
  });
  assert.equal(finalCalls.length, 10);
  assert.deepEqual(finalCalls, historicalCases.map(testCase => testCase.id));
  assert.equal(result.outputPrefix, 'semantic-intent-final-live');
  assert.equal(result.evaluationProfile, 'intent-final');
  const finalEmployer = result.cases.find(item => item.caseId === STRICT_EMPLOYER_CASE).intentAcceptance.strictOperationChecks[0];
  const finalBenefit = result.cases.find(item => item.caseId === STRICT_BENEFIT_CASE).intentAcceptance.strictOperationChecks[0];
  assert.equal(finalEmployer.expectedOperation, 'CALCULATE');
  assert.equal(finalEmployer.passed, true);
  assert.equal(finalBenefit.expectedOperation, 'DETERMINE_TREATMENT');
  assert.equal(finalBenefit.passed, true);
  // This asks for general filing guidance and supplies no specific return case requiring facts.
  const corporateFiling = result.cases.find(item => item.caseId === 'dev-corporate-filing');
  assert.deepEqual(corporateFiling.intentAcceptance.caseSpecificity, { expected: false, actual: false });
  assert.equal(corporateFiling.intentAcceptance.caseSpecificityCorrect, true);
  assert.ok(result.cases.every(item => item.intentAcceptance.caseSpecificityCorrect),
    'every fixed final case has a known boolean fact-gate expectation');
  assert.equal(result.sourceHashesConsistent, true);
  assert.equal(result.fixtureHashesConsistent, true);
  assert.equal(typeof result.sourceFingerprints.semanticIntentEvaluationRunner, 'string');
  assert.equal(typeof result.sourceFingerprints.semanticIntentCliRunner, 'string');
  assert.equal(await readFile(path.join(finalDirectory, 'semantic-intent-final-live.json'), 'utf8').then(text => text.includes(SECRET)), false);
} finally {
  await rm(finalDirectory, { recursive: true, force: true });
}

await assert.rejects(runSemanticContractFollowupEvaluation({
  live: true,
  evaluationProfile: 'unsupported-profile',
  apiKey: TEST_KEY,
  outputDirectory: os.tmpdir()
}), /supported fixed evaluation profile/);

console.log('Semantic intent follow-up runner regression tests passed.');
