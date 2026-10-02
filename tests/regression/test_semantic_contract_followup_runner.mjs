import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildAuthorityWorkstreams } from '../../src/services/authorityWorkstreams.ts';
import {
  loadSemanticContractFollowupCases,
  runSemanticContractFollowupEvaluation
} from '../evaluation/singapore/semantic-contract-followup-evaluation.mjs';

const MODEL = 'gemini-3.5-flash-lite';
const START_GAP_MS = 15_250;
const SECRET = 'TEST_PRIVACY_SENTINEL_7f3d';
const KEY_SENTINEL = 'UNRECOGNIZED_PROPERTY_SENTINEL';
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
  'dev-investment-comparison': false
});
const FACT_DEPENDENT_OPERATIONS = new Set([
  'CALCULATE', 'DETERMINE_TREATMENT', 'PREPARE_JOURNAL'
]);

function makeResponse(testCase) {
  const requiresUserSpecificFacts = MOCK_CASE_SPECIFICITY[testCase.id];
  assert.equal(typeof requiresUserSpecificFacts, 'boolean', `fixed mock fact-gate expectation exists for ${testCase.id}`);
  const issues = testCase.expected.map(expected => ({
    subject: `${expected.subject} ${SECRET} SUBJECT`,
    population: expected.population[0],
    domain: expected.domain[0],
    governingAuthorities: expected.governingAuthorities,
    contextualAuthorities: expected.contextualAuthoritiesAnyOf?.[0] || [],
    operation: expected.operation[0],
    mappedTopicIds: [],
    evidenceRequirement: FACT_DEPENDENT_OPERATIONS.has(expected.operation[0]) ||
      (expected.operation[0] === 'CHECK_ELIGIBILITY' && requiresUserSpecificFacts)
      ? 'AUTHORITATIVE_SOURCE_AND_CASE_FACTS'
      : 'AUTHORITATIVE_SOURCE',
    confidence: 0.93
  }));
  const response = {
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
    confidence: 0.93,
    issues
  };
  return JSON.stringify(response);
}

function workstreamsFromIssuePlan(issuePlan) {
  const byKey = new Map();
  for (const issue of issuePlan.issues) {
    if (issue.unresolvedReason === 'UNASSIGNED_QUERY_TOPIC') continue;
    const authority = issue.governingAuthorities?.[0];
    if (!authority || authority === 'UNKNOWN') continue;
    const key = `${authority}/${issue.domain}`;
    if (!byKey.has(key)) byKey.set(key, { authority, domain: issue.domain, issues: [] });
    byKey.get(key).issues.push({ issueId: issue.id, operation: issue.operation, applicationStatus: 'UNRESOLVED' });
  }
  return [...byKey.values()];
}

const cases = await loadSemanticContractFollowupCases();
assert.equal(cases.length, 10);
assert.deepEqual(cases.filter(item => item.group === 'PRESELECTED_KNOWN_FAILURE').map(item => item.id).sort(), [
  'A-paraphrase-2', 'A-paraphrase-3', 'adversarial-C-employee-benefit',
  'control-general-interaction', 'control-general-recognition'
].sort());
assert.equal(cases.find(item => item.id === 'A-paraphrase-2').expected.length, 2);
assert.equal(cases.find(item => item.id === 'A-paraphrase-3').expected.length, 3);

const outputDirectory = await mkdtemp(path.join(os.tmpdir(), 'semantic-contract-followup-'));
const calls = [];
const sleeps = [];
let elapsed = 0;
let wallClock = Date.UTC(2026, 8, 30, 0, 0, 0);
let runIndex = 0;
const testKey = `API_KEY_${SECRET}`;

await assert.rejects(
  runSemanticContractFollowupEvaluation({ live: false, apiKey: testKey, outputDirectory, execute: async () => { throw new Error('must not execute'); } }),
  /--live/
);

const buildRuntime = async (question, issuePlan, options) => {
  assert.equal(options.localOnly, true, 'routing uses the offline local-only path');
  const runtime = await buildAuthorityWorkstreams(question, issuePlan, options);
  if (question === cases.find(item => item.id === 'dev-mixed-entry-total').question) {
    issuePlan.coverageEstablished = false;
    for (const issue of issuePlan.issues) {
      if (['CALCULATE', 'PREPARE_JOURNAL', 'CHECK_ELIGIBILITY', 'DETERMINE_TREATMENT'].includes(issue.operation)) {
        issue.status = 'UNRESOLVED';
      }
    }
    return {
      ...runtime,
      status: 'VERIFIED',
      evidenceStatus: 'VERIFIED',
      applicationStatus: 'UNRESOLVED',
      workstreams: workstreamsFromIssuePlan(issuePlan)
    };
  }
  if (question === cases.find(item => item.id === 'A-paraphrase-2').question) {
    issuePlan.coverageEstablished = true;
    issuePlan.hasUnmappedResidual = false;
    for (const issue of issuePlan.issues) {
      issue.status = 'MAPPED';
      issue.unresolvedReason = undefined;
    }
    return {
      ...runtime,
      status: 'CONDITIONAL',
      evidenceStatus: 'VERIFIED',
      applicationStatus: 'UNRESOLVED',
      workstreams: workstreamsFromIssuePlan(issuePlan)
    };
  }
  if (question === cases.find(item => item.id === 'dev-corporate-filing').question) {
    issuePlan.coverageEstablished = true;
    issuePlan.hasUnmappedResidual = false;
    for (const issue of issuePlan.issues) {
      issue.status = 'MAPPED';
      issue.unresolvedReason = undefined;
    }
    return {
      ...runtime,
      status: 'CONDITIONAL',
      evidenceStatus: 'VERIFIED',
      applicationStatus: 'UNRESOLVED',
      workstreams: workstreamsFromIssuePlan(issuePlan)
    };
  }
  if (question === cases.find(item => item.id === 'control-general-recognition').question) {
    throw new Error(`RUNTIME_ERROR_${SECRET}`);
  }
  return runtime;
};

try {
  const result = await runSemanticContractFollowupEvaluation({
    live: true,
    apiKey: testKey,
    outputDirectory,
    buildRuntime,
    sleep: async milliseconds => {
      sleeps.push(milliseconds);
      elapsed += milliseconds;
    },
    now: () => new Date(wallClock += 1000),
    monotonicNow: () => elapsed,
    execute: async (prompt, systemInstruction, provider, options) => {
      const callIndex = calls.length;
      const testCase = cases[callIndex];
      calls.push({ prompt, systemInstruction, provider, options, caseId: testCase.id });
      assert.equal(provider.activeProvider, 'gemini');
      assert.equal(provider.gemini.model, MODEL);
      assert.equal(provider.gemini.apiKey, testKey);
      assert.equal(options.model, MODEL);
      assert.equal(options.timeoutMs, 8000);
      assert.equal(options.temperature, 0);
      assert.equal(options.jsonMode, true);
      elapsed += 25;
      if (testCase.id === 'A-paraphrase-3') throw new Error(`Gemini API request failed with HTTP 429. ${SECRET}`);
      if (testCase.id === 'dev-conceptual-illustration') throw new Error(`Request timed out ${SECRET}`);
      if (testCase.id === 'dev-training-entitlement') throw new Error(`Arbitrary provider failure ${SECRET}`);
      const response = makeResponse(testCase);
      if (testCase.id === 'A-paraphrase-2') {
        const parsed = JSON.parse(response);
        parsed.issues[1].domain = 'UNKNOWN';
        parsed.issues[1].population = 'UNKNOWN';
        parsed.issues[1].governingAuthorities = ['UNKNOWN'];
        parsed.issues[1].contextualAuthorities = [];
        return JSON.stringify(parsed);
      }
      if (testCase.id === 'dev-investment-comparison') {
        const parsed = JSON.parse(response);
        parsed.schemaVersion = 77;
        parsed.concepts[0].role = `UNKNOWN_ROLE_${SECRET}`;
        parsed[KEY_SENTINEL] = true;
        return JSON.stringify(parsed);
      }
      return response;
    }
  });

  assert.equal(calls.length, 10, 'one provider request is made for each fixed case');
  assert.deepEqual(calls.map(call => call.caseId), cases.map(item => item.id));
  assert.equal(sleeps.length, 9, 'no pacing wait is added before the first request');
  assert.ok(sleeps.every(milliseconds => milliseconds === START_GAP_MS));
  assert.ok(result.minimumObservedStartGapMs >= START_GAP_MS);
  assert.equal(result.requestCount, 10);

  const known = result.summaries.find(item => item.group === 'PRESELECTED_KNOWN_FAILURE');
  const controls = result.summaries.find(item => item.group === 'INDEPENDENT_CONTROL');
  const combined = result.summaries.find(item => item.group === 'COMBINED');
  assert.equal(known.cases, 5);
  assert.equal(known.issueRecallAllCases.expected, 8);
  assert.equal(known.issueRecallValidInterpretations.expected, 5);
  assert.equal(controls.cases, 5);
  assert.equal(controls.issueRecallAllCases.expected, 6);
  assert.equal(combined.cases, 10);
  assert.equal(combined.issueRecallAllCases.expected, 14);
  assert.equal(known.invalidResponses.rateLimited.count, 1);
  assert.equal(controls.invalidResponses.timeout.count, 1);
  assert.equal(controls.invalidResponses.providerFailure.count, 1);
  assert.equal(controls.invalidResponses.count, 1, 'invalid response rate excludes transport failures');
  assert.equal(controls.nonValidOutcomes.count, 3);

  const mixed = result.cases.find(item => item.caseId === 'A-paraphrase-2');
  assert.equal(mixed.scoring.predictedIssueCount, 2);
  assert.equal(mixed.scoring.operationMatched, 2);
  assert.equal(mixed.routing.guardChecks.operationsPreserved, true);
  assert.equal(mixed.routing.guardChecks.caseFactsRequired, true);
  assert.equal(mixed.routing.guardChecks.residualHasNoWorkstream, true);
  assert.equal(mixed.routing.status, 'CONDITIONAL');
  assert.equal(mixed.routing.evidenceStatus, 'VERIFIED', 'verified evidence can coexist with unresolved application facts');
  assert.equal(mixed.routing.applicationStatus, 'UNRESOLVED');
  assert.equal(mixed.routing.guardChecks.incompletePlanNotVerified, true);
  assert.equal(mixed.routing.guardChecks.caseSpecificApplicationsUnresolved, true);
  assert.equal(mixed.routing.guardChecks.requiredApplicationStatusesUnresolved, true);
  assert.equal(mixed.routing.guardChecks.unresolvedApplicationNotVerified, true);
  assert.ok(mixed.routing.applicationStatusCounts.requiredPlanIssues > mixed.routing.applicationStatusCounts.routedRequiredIssues,
    'an unknown-governor application can remain unresolved outside a requested stream');

  const guarded = result.cases.find(item => item.caseId === 'dev-mixed-entry-total');
  assert.equal(guarded.routing.guardChecks.incompletePlanNotVerified, false);
  assert.equal(guarded.routing.guardChecks.unresolvedApplicationNotVerified, false);
  assert.equal(guarded.routing.guardChecks.caseSpecificApplicationsUnresolved, true);
  assert.ok(guarded.routing.applicationStatusCounts.UNRESOLVED >= 1);
  const filing = result.cases.find(item => item.caseId === 'dev-corporate-filing');
  assert.equal(filing.routing.status, 'CONDITIONAL');
  assert.equal(filing.routing.evidenceStatus, 'VERIFIED');
  assert.equal(filing.routing.guardChecks.requiredApplicationStatusesUnresolved, true);
  assert.ok(filing.routing.applicationStatusCounts.UNRESOLVED >= 1);
  const runtimeFailure = result.cases.find(item => item.caseId === 'control-general-recognition');
  assert.equal(runtimeFailure.routing.category, 'LOCAL_ROUTING_FAILURE');
  const malformed = result.cases.find(item => item.caseId === 'dev-investment-comparison');
  assert.equal(malformed.responseDiagnostic.rejectionCode, 'INVALID_SCHEMA_VERSION');
  assert.ok(malformed.responseDiagnostic.violationCodes.includes('INVALID_SCHEMA_VERSION'));
  assert.ok(malformed.responseDiagnostic.violationCodes.includes('INVALID_CONCEPT_ROLE'));

  const jsonPath = path.join(outputDirectory, 'semantic-contract-followup-v2-live.json');
  const markdownPath = path.join(outputDirectory, 'semantic-contract-followup-v2-live.md');
  const jsonText = await readFile(jsonPath, 'utf8');
  const markdownText = await readFile(markdownPath, 'utf8');
  assert.equal(jsonText.includes(SECRET), false, 'private facts, subjects, concepts, API keys, and errors are not persisted');
  assert.equal(markdownText.includes(SECRET), false);
  assert.equal(jsonText.includes(KEY_SENTINEL), false, 'unrecognized property names are reduced to safe shape counts');
  assert.equal(markdownText.includes(KEY_SENTINEL), false);
  assert.equal(jsonText.includes(cases[0].question), false, 'raw fixture questions are never persisted');

  let callsAfterRefusal = calls.length;
  await assert.rejects(
    runSemanticContractFollowupEvaluation({ live: true, apiKey: testKey, outputDirectory, execute: async () => { callsAfterRefusal += 1; } }),
    /output file already exists/
  );
  assert.equal(callsAfterRefusal, calls.length, 'existing output blocks a second capture before any request');
} finally {
  await rm(outputDirectory, { recursive: true, force: true });
}

const markdownOnlyDirectory = await mkdtemp(path.join(os.tmpdir(), 'semantic-contract-followup-markdown-'));
try {
  await writeFile(path.join(markdownOnlyDirectory, 'semantic-contract-followup-v2-live.md'), 'preserve');
  let callsWhenMdExists = 0;
  await assert.rejects(
    runSemanticContractFollowupEvaluation({
      live: true,
      apiKey: testKey,
      outputDirectory: markdownOnlyDirectory,
      execute: async () => { callsWhenMdExists += 1; }
    }),
    /output file already exists/
  );
  assert.equal(callsWhenMdExists, 0);
  assert.equal(await readFile(path.join(markdownOnlyDirectory, 'semantic-contract-followup-v2-live.md'), 'utf8'), 'preserve');
} finally {
  await rm(markdownOnlyDirectory, { recursive: true, force: true });
}

console.log('Semantic contract follow-up runner regression tests passed.');
