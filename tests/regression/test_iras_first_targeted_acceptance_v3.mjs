import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, access, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { additionalGates, runAcceptance, sha256, writePlan } from '../evaluation/singapore/iras-first-targeted-acceptance-v3.mjs';
import { loadIrasFirstV2TargetedCases } from '../evaluation/singapore/semantic-contract-followup-evaluation.mjs';
import { interpretSemanticQuestion, SEMANTIC_QUESTION_V2_RESPONSE_JSON_SCHEMA } from '../../src/services/semanticQuestionUnderstanding.ts';

const caseIds = [
  'target-relief-entitlement', 'target-relief-amount', 'A-paraphrase-2', 'private-expense-treatment',
  'foreign-dividend-receipt-treatment', 'corporate-residency-general-rule', 'wht-royalty-general-rule',
  'gst-input-tax-general-rule', 'unsupported-sfrsi-6-exploration-evaluation'
];
const privateSentinel = 'V3_PRIVATE_RAW_PROVIDER_RESPONSE_SENTINEL';
const privatePrompt = 'V3_PRIVATE_PROMPT_SENTINEL';
const scratch = await mkdtemp(path.join(os.tmpdir(), 'iras-first-targeted-v3-safety-'));
const output = name => path.join(scratch, name);
const exists = async file => { try { await access(file); return true; } catch { return false; } };

try {
  const planned = await writePlan({ outputDirectory: output('plan-inspection') });
  const plan = planned.preregistration;
  assert.deepEqual(plan.cases.map(item => item.caseId), caseIds);
  assert.equal(plan.expectedProviderCalls, 9);
  assert.equal(plan.timeoutMs, 8000);
  assert.equal(plan.minimumStartGapMs, 15_250);
  assert.equal(plan.retries, 0);
  assert.equal(plan.evidenceMode, 'localOnly');
  assert.equal(plan.protectedHistory.v9HistoricalRows, 389);
  assert.equal(plan.protectedHistory.legacyArtifacts, 118);
  assert.ok(plan.historicalFingerprints.some(item => item.path === 'docs/evaluation/multi-authority-workstreams/iras-first-live-2026-10-03-v9/iras-mapped-evidence-plan-v9.json'));
  assert.ok(plan.historicalFingerprints.some(item => item.path === 'docs/evaluation/multi-authority-workstreams/iras-first-local-2026-10-02-v6/iras-factual-conjunction-residual-probe-v1.json'));
  assert.ok(plan.sourceFingerprints.some(item => item.path === 'tests/evaluation/singapore/iras-first-targeted-acceptance-v3.mjs'));
  assert.ok(plan.sourceFingerprints.some(item => item.path === 'tests/evaluation/singapore/iras-factual-conjunction-residual-probe-v1.mjs'));
  assert.ok(plan.sourceFingerprints.some(item => item.path === 'package-lock.json'));
  assert.ok(plan.cases.every(item => item.expectedIssueTopics.every(row => Array.isArray(row.topicIds))));

  const malformedDirectory = output('malformed');
  await writePlan({ outputDirectory: malformedDirectory });
  let malformedCalls = 0;
  let markerExistedBeforeFirstCall = false;
  let requestedSleeps = 0;
  const malformed = await runAcceptance({
    outputDirectory: malformedDirectory,
    apiKey: 'synthetic-test-key-long-enough',
    requireCommittedPlan: false,
    sleep: async ms => { requestedSleeps += ms; },
    execute: async (_prompt, _system, provider, options) => {
      malformedCalls += 1;
      assert.equal(provider.activeProvider, 'gemini');
      assert.equal(provider.gemini.model, 'gemini-3.5-flash-lite');
      assert.deepEqual(Object.keys(options).sort(), ['jsonMode', 'model', 'responseJsonSchema', 'temperature', 'timeoutMs']);
      assert.equal(options.timeoutMs, 8000);
      assert.equal(options.temperature, 0);
      assert.equal(options.jsonMode, true);
      assert.deepEqual(options.responseJsonSchema, SEMANTIC_QUESTION_V2_RESPONSE_JSON_SCHEMA);
      markerExistedBeforeFirstCall ||= await exists(path.join(malformedDirectory, 'consumed-v3.json'));
      return privateSentinel;
    },
  });
  assert.equal(malformedCalls, 9);
  assert.equal(malformed.requestCount, 9);
  assert.equal(markerExistedBeforeFirstCall, true, 'the permanent consumption marker exists before transport starts');
  assert.equal(requestedSleeps, 8 * 15_250);
  assert.equal(malformed.status, 'FAIL/HOLD');
  assert.equal(malformed.invalidResponseCount, 9);
  const malformedReport = await readFile(path.join(malformedDirectory, 'acceptance-v3.json'), 'utf8');
  assert.ok(!malformedReport.includes(privateSentinel));
  assert.ok(!malformedReport.includes(privatePrompt));
  await assert.rejects(runAcceptance({
    outputDirectory: malformedDirectory,
    apiKey: 'synthetic-test-key-long-enough',
    requireCommittedPlan: false,
    execute: async () => { malformedCalls += 1; return '{}'; }
  }), /RUN_CONSUMED/);
  assert.equal(malformedCalls, 9, 'a second invocation is blocked before another provider call');

  const changedDirectory = output('changed-plan');
  await writePlan({ outputDirectory: changedDirectory });
  const planPath = path.join(changedDirectory, 'preregistration-v3.json');
  const changedEnvelope = JSON.parse(await readFile(planPath, 'utf8'));
  changedEnvelope.preregistrationSha256 = sha256('changed plan sentinel');
  await writeFile(planPath, JSON.stringify(changedEnvelope));
  let changedPlanCalls = 0;
  await assert.rejects(runAcceptance({
    outputDirectory: changedDirectory,
    apiKey: 'synthetic-test-key-long-enough',
    requireCommittedPlan: false,
    execute: async () => { changedPlanCalls += 1; return '{}'; }
  }), /PLAN_HASH_CHANGED/);
  assert.equal(changedPlanCalls, 0);
  assert.equal(await exists(path.join(changedDirectory, 'consumed-v3.json')), false);

  const missingCallDirectory = output('missing-call');
  await writePlan({ outputDirectory: missingCallDirectory });
  const missingCall = await runAcceptance({
    outputDirectory: missingCallDirectory,
    apiKey: 'synthetic-test-key-long-enough',
    requireCommittedPlan: false,
    sleep: async () => {},
    execute: async () => { throw new Error('Unexpected transport call'); },
    interpret: async () => ({ mode: 'DETERMINISTIC_FALLBACK', failure: 'PROVIDER_ERROR' })
  });
  assert.equal(missingCall.status, 'FAIL/HOLD');
  assert.equal(missingCall.requestCount, 0);
  assert.ok(missingCall.cases.every(row => row.passed === false));

  const extraCallDirectory = output('extra-call');
  await writePlan({ outputDirectory: extraCallDirectory });
  let extraTransportCalls = 0;
  const extraCall = await runAcceptance({
    outputDirectory: extraCallDirectory,
    apiKey: 'synthetic-test-key-long-enough',
    requireCommittedPlan: false,
    sleep: async () => {},
    execute: async () => { extraTransportCalls += 1; return '{}'; },
    interpret: (question, provider, captureCall) => interpretSemanticQuestion(question, provider, async (prompt, system, selectedProvider, options) => {
      await captureCall(prompt, system, selectedProvider, options);
      await captureCall(prompt, system, selectedProvider, options);
      return '{}';
    })
  });
  assert.equal(extraTransportCalls, 9, 'the runner blocks a second execution per case');
  assert.equal(extraCall.extraCallAttempts, 9);
  assert.equal(extraCall.status, 'FAIL/HOLD');

  const cases = await loadIrasFirstV2TargetedCases();
  const controlCase = cases[0];
  const frozenControl = plan.cases.find(item => item.caseId === controlCase.id);
  const expectedIssue = controlCase.expected[0];
  const semanticIssue = {
    subject: expectedIssue.matchAny[0].join(' '),
    population: expectedIssue.population[0], domain: expectedIssue.domain[0],
    governingAuthorities: [...expectedIssue.governingAuthorities],
    contextualAuthorities: [...expectedIssue.contextualAuthoritiesAnyOf[0]],
    operation: expectedIssue.operation[0], evidenceRequirement: 'AUTHORITATIVE_SOURCE_AND_CASE_FACTS'
  };
  const semantic = { issues: [semanticIssue] };
  const issuePlan = { coverageEstablished: true, hasUnmappedResidual: false, issues: [{
    ...semanticIssue, id: 'synthetic-control-issue', status: 'MAPPED',
    mappedTopicIds: [...new Set([...frozenControl.independentInventory.topicIds,
      ...frozenControl.expectedIssueTopics[0].topicIds])]
  }] };
  const issueRuntime = {
    issueId: 'synthetic-control-issue', domain: semanticIssue.domain, population: semanticIssue.population,
    operation: semanticIssue.operation, evidenceRequirement: semanticIssue.evidenceRequirement,
    governingAuthority: 'IRAS', applicationStatus: 'UNRESOLVED', evidenceStatus: 'VERIFIED',
    lifecycle: { requested: true, mapped: true, retrievalAttempted: true, evidenceFound: true, admitted: true, verified: true, covered: true },
    sources: [{ id: 'synthetic-safe-id' }], verifiedClaims: [{ id: 'synthetic-safe-claim' }]
  };
  const streamPairs = controlCase.expectedWorkstreamsAnyOf[0];
  const runtime = {
    status: 'CONDITIONAL', applicationStatus: 'UNRESOLVED',
    workstreams: streamPairs.map(pair => {
      const [authority, domain] = pair.split('/');
      return { authority, domain, issues: authority === 'IRAS' ? [issueRuntime] : [] };
    }).filter(stream => stream.issues.length > 0), gaps: []
  };
  const control = additionalGates(controlCase, semantic, issuePlan, runtime, frozenControl);
  assert.equal(control.passed, true, 'synthetic supported lifecycle satisfies the independent gates');
  issueRuntime.lifecycle.covered = false;
  const missingCoverage = additionalGates(controlCase, semantic, issuePlan, runtime, frozenControl);
  assert.equal(missingCoverage.fullIrasLifecycle, false);
  assert.equal(missingCoverage.passed, false, 'the lifecycle gate rejects missing final coverage');
} finally {
  await rm(scratch, { recursive: true, force: true });
}
