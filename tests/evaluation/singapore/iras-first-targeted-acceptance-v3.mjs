import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, readdir, access, rename } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { classifyQuestion } from '../../../src/classification/questionClassifier.ts';
import { defaultQueryTopicResolver } from '../../../src/retrieval/queryTopicResolver.ts';
import { executeStructuredLlmCall } from '../../../src/services/aiTransport.ts';
import { buildAuthorityWorkstreams, planAuthorityWorkstreams } from '../../../src/services/authorityWorkstreams.ts';
import { interpretSemanticQuestion, reconcileQuestionUnderstanding, SEMANTIC_QUESTION_TIMEOUT_MS,
  SEMANTIC_QUESTION_V2_RESPONSE_JSON_SCHEMA } from '../../../src/services/semanticQuestionUnderstanding.ts';
import { loadIrasFirstV2TargetedCases, scoreAuthorityReliefCanonicalContract,
  assertIrasFirstV2HistoricalArtifactsUnchanged } from './semantic-contract-followup-evaluation.mjs';
import { buildPerIssueScopeDiagnostics, summarizeRuntimeIssueAssignments, evaluateIrasFirstCase,
  summarizeIrasFirstAcceptance } from './iras-first-release-contract.mjs';
import { matchIssues } from './multi-authority-issue-scoring.mjs';
import { diagnoseSemanticResponse } from './semantic-contract-diagnosis.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const OUTPUT = 'docs/evaluation/multi-authority-workstreams/iras-first-targeted-acceptance-2026-10-03-v3';
export const PROFILE = 'iras-first-targeted-acceptance-v3';
export const STARTING_SHA = 'f919dc90d76b439f35765ad9555f9b4701037675';
export const CASE_IDS = Object.freeze(['target-relief-entitlement', 'target-relief-amount', 'A-paraphrase-2',
  'private-expense-treatment', 'foreign-dividend-receipt-treatment', 'corporate-residency-general-rule',
  'wht-royalty-general-rule', 'gst-input-tax-general-rule', 'unsupported-sfrsi-6-exploration-evaluation']);
const MODEL = 'gemini-3.5-flash-lite';
const GAP_MS = 15_250;
const PLAN = 'preregistration-v3.json';
const MARKER = 'consumed-v3.json';
const REPORT = 'acceptance-v3.json';
const GIT = 'C:/Users/Admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/native/git/cmd/git.exe';
const TOPICS = Object.freeze({
  'personal-cpf-relief': ['iras-individual-cpf-relief'],
  'personal-cpf-relief-amount': ['iras-individual-cpf-relief'],
  'employer-cpf-contribution': ['cpf_contribution_rates'],
  'individual-cpf-tax-relief': ['iras-individual-cpf-relief'],
  'private-expense-treatment': ['iras-cit-disallowed-expenses', 'iras-cit-deductibility'],
  'foreign-dividend-receipt-treatment': ['iras-foreign-sourced-income'],
  'corporate-residency-general-rule': ['iras-corporate-tax-residency'],
  'wht-royalty-general-rule': ['iras-withholding-tax-interest-royalties'],
  'gst-input-tax-general-rule': ['iras-gst-input-tax'],
  'unsupported-sfrsi-6-exploration-evaluation': []
});
const CASE_OPS = new Set(['CALCULATE', 'PREPARE_JOURNAL', 'CHECK_ELIGIBILITY', 'DETERMINE_TREATMENT']);
const FAILURES = new Set(['NO_PROVIDER', 'INVALID_RESPONSE', 'LOW_CONFIDENCE', 'TIMEOUT', 'PROVIDER_ERROR', 'RATE_LIMITED', 'QUERY_TOO_LONG']);
const REJECTION_CODES = new Set(['NONE', 'WRONG_ROOT_TYPE', 'MISSING_KEY', 'UNEXPECTED_KEY', 'WRONG_TYPE', 'COUNT_LIMIT', 'INVALID_LABEL',
  'INVALID_AUTHORITY', 'INVALID_ENUM', 'INVALID_POPULATION', 'INVALID_DOMAIN', 'INVALID_OPERATION', 'INVALID_EVIDENCE_REQUIREMENT',
  'INVALID_CONCEPT_ROLE', 'INVALID_SCHEMA_VERSION', 'INVALID_TOPIC_ID', 'DUPLICATE_AUTHORITY', 'CONCEPT_STRUCTURE', 'EMPTY_ISSUES',
  'ISSUE_STRUCTURE', 'ISSUE_AUTHORITY_COUNT', 'AUTHORITY_OVERLAP', 'DOMAIN_AUTHORITY_MISMATCH', 'CALCULATION_FLAG_MISMATCH',
  'CASE_FLAG_CONTRADICTION', 'JOURNAL_DOMAIN_MISMATCH', 'UNKNOWN_AUTHORITY_MIX', 'ISSUE_COUNT_LIMIT', 'LOW_CONFIDENCE',
  'INVALID_CONFIDENCE', 'CONFIDENCE_OUT_OF_RANGE', 'CONTRADICTORY_FIELDS', 'SCHEMA_MISMATCH', 'MALFORMED_JSON',
  'RESPONSE_TOO_LARGE', 'UNCLASSIFIED_REJECTION']);
const STAGES = ['mapped', 'retrievalAttempted', 'evidenceFound', 'admitted', 'verified', 'covered'];
export const sha256 = value => createHash('sha256').update(value).digest('hex');
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sameSet = (a, b) => a.length === b.length && [...a].sort().every((v, i) => v === [...b].sort()[i]);
const git = args => execFileSync(GIT, args, { cwd: ROOT, encoding: 'utf8' }).trim();
const readJson = async p => JSON.parse(await readFile(p, 'utf8'));
async function fresh(p) { try { await access(p); } catch (e) { if (e.code === 'ENOENT') return; throw e; } throw new Error('RUN_CONSUMED'); }
async function filesUnder(relative) {
  const entries = await readdir(path.join(ROOT, relative), { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    const p = `${relative}/${entry.name}`;
    if (p === OUTPUT) continue;
    if (entry.isDirectory()) result.push(...await filesUnder(p));
    else if (/\.(?:mjs|json|ts|tsx|md)$/.test(p)) result.push(p);
  }
  return result.sort();
}
async function hashes(paths) { return Promise.all(paths.map(async p => ({ path: p, sha256: sha256(await readFile(path.join(ROOT, p))) }))); }
function historyRows(value, rows = []) {
  if (!value || typeof value !== 'object') return rows;
  if (typeof value.path === 'string' && typeof value.sha256 === 'string') rows.push(value);
  else for (const v of Object.values(value)) historyRows(v, rows);
  return rows;
}
async function historicIntegrity() {
  const old = await assertIrasFirstV2HistoricalArtifactsUnchanged();
  const v9 = await readJson(path.join(ROOT, 'docs/evaluation/multi-authority-workstreams/iras-first-live-2026-10-03-v9/iras-mapped-evidence-plan-v9.json'));
  const rows = historyRows(v9.preregistration.historicalFingerprints);
  assert.equal(rows.length, 389, 'HISTORICAL_INTEGRITY_FAILURE');
  for (const r of rows) assert.equal(sha256(await readFile(path.join(ROOT, r.path))), r.sha256, 'HISTORICAL_INTEGRITY_FAILURE');
  return { legacyArtifacts: old.artifactCount, v9HistoricalRows: rows.length, verified: true };
}
function inventory(question) {
  const d = defaultQueryTopicResolver.decomposeQuery(question);
  const classification = classifyQuestion(question);
  const ids = [...new Set([...d.topics.map(t => t.id), ...classification.topicIds])];
  return { topicIds: defaultQueryTopicResolver.resolveTopicIds(ids).filter(t => /^(ACCOUNTING|IRAS|CPF|MOM|ACRA|MAS)_/.test(t.domainId)).map(t => t.id).sort(),
    residualCount: d.unresolvedTopics.length };
}
function requiredTopics(testCase, issue) {
  return TOPICS[issue.id] ?? TOPICS[testCase.id];
}
async function promptFingerprint(question) {
  let fingerprint;
  await interpretSemanticQuestion(question, 'preregistration-api-free-template-projection', async (prompt, system, _provider, options) => {
    assert.equal(fingerprint, undefined, 'TEMPLATE_EXTRA_CALL');
    fingerprint = { promptSha256: sha256(prompt), systemSha256: sha256(system),
      schemaSha256: sha256(JSON.stringify(options.responseJsonSchema)), promptChars: prompt.length, systemChars: system.length };
    return '{}';
  });
  assert.ok(fingerprint, 'TEMPLATE_MISSING_CALL');
  return fingerprint;
}
async function currentSnapshot() {
  assert.equal(process.versions.node.split('.')[0], '22', 'NODE_22_REQUIRED');
  assert.equal(SEMANTIC_QUESTION_TIMEOUT_MS, 8000, 'TIMEOUT_CHANGED');
  const cases = await loadIrasFirstV2TargetedCases();
  assert.deepEqual(cases.map(c => c.id), CASE_IDS, 'CASE_INVENTORY_CHANGED');
  const sourcePaths = [...await filesUnder('src'), ...await filesUnder('tests/evaluation/singapore'),
    ...await filesUnder('tests/fixtures'), 'package.json', 'package-lock.json', 'AGENTS.md',
    'tests/regression/test_iras_first_targeted_acceptance_v3.mjs', `${OUTPUT}/supervisor-preregistration.md`];
  const protectedPaths = [...await filesUnder('docs/evaluation/multi-authority-workstreams')];
  const promptFingerprints = await Promise.all(cases.map(c => promptFingerprint(c.question)));
  return { profile: PROFILE, startingSha: STARTING_SHA, model: MODEL, timeoutMs: 8000, minimumStartGapMs: GAP_MS,
    expectedProviderCalls: 9, retries: 0, evidenceMode: 'localOnly', nodeVersion: process.versions.node,
    nodeExecutableSha256: sha256(await readFile(process.execPath)), schemaSha256: sha256(JSON.stringify(SEMANTIC_QUESTION_V2_RESPONSE_JSON_SCHEMA)),
    templateProjectionMode: 'API_FREE_PRODUCTION_PROMPT_SCHEMA_PROJECTION',
    cases: cases.map((c, index) => ({ caseId: c.id, caseSha256: sha256(JSON.stringify(c)), promptFingerprint: promptFingerprints[index], expectedIssueIds: c.expected.map(i => i.id),
      expectedIssueTopics: c.expected.map(i => { const ids = requiredTopics(c, i); assert.ok(Array.isArray(ids), 'EXPECTED_TOPIC_MISSING'); return { issueId: i.id, topicIds: ids }; }),
      independentInventory: inventory(c.question), requiresUserSpecificFacts: c.expectedRequiresUserSpecificFacts,
      allowedOverallStatuses: c.id === 'A-paraphrase-2' ? ['CONDITIONAL', 'INSUFFICIENT'] : c.expectedCoverageOutcome === 'UNSUPPORTED'
        ? ['INSUFFICIENT'] : c.expectedRequiresUserSpecificFacts ? ['CONDITIONAL'] : ['VERIFIED'] })),
    sourceFingerprints: await hashes([...new Set(sourcePaths)].sort()), historicalFingerprints: await hashes(protectedPaths),
    protectedHistory: await historicIntegrity() };
}
export async function writePlan({ outputDirectory = path.join(ROOT, OUTPUT) } = {}) {
  await mkdir(outputDirectory, { recursive: true });
  for (const name of [PLAN, MARKER, REPORT]) await fresh(path.join(outputDirectory, name));
  assert.equal(git(['rev-parse', 'HEAD']), STARTING_SHA, 'STARTING_CHECKPOINT_CHANGED');
  assert.equal(git(['branch', '--show-current']), 'codex/multi-authority-workstreams', 'BRANCH_CHANGED');
  assert.equal(git(['diff', '--name-only', STARTING_SHA]), '', 'TRACKED_FILES_CHANGED');
  const preregistration = await currentSnapshot();
  const envelope = { preregistration, preregistrationSha256: sha256(JSON.stringify(preregistration)) };
  await writeFile(path.join(outputDirectory, PLAN), json(envelope), { flag: 'wx' });
  return envelope;
}
function requiresFacts(i) { return ['CASE_FACTS', 'AUTHORITATIVE_SOURCE_AND_CASE_FACTS'].includes(i.evidenceRequirement)
  || i.evidenceRequirement === 'UNRESOLVED' && CASE_OPS.has(i.operation); }
export function routingProjection(semantic, issuePlan, runtime, expectedSets) {
  const streams = runtime.workstreams;
  const runtimeIssues = streams.flatMap(s => s.issues || []);
  const requested = issuePlan.issues.slice(0, semantic.issues.length);
  const planned = planAuthorityWorkstreams(issuePlan);
  const required = issuePlan.issues.filter(requiresFacts);
  const plannedIds = new Set(planned.flatMap(s => s.issueIds));
  const routedRequired = required.filter(i => plannedIds.has(i.id));
  const requiredUnresolved = routedRequired.every(i => runtimeIssues.find(r => r.issueId === i.id)?.applicationStatus === 'UNRESOLVED');
  const incomplete = !issuePlan.coverageEstablished || issuePlan.hasUnmappedResidual || issuePlan.issues.some(i => i.status === 'UNRESOLVED');
  const governing = new Set(semantic.issues.flatMap(i => i.governingAuthorities));
  const contextualOnly = new Set(semantic.issues.flatMap(i => i.contextualAuthorities).filter(a => !governing.has(a)));
  return { plannedWorkstreamCount: planned.length, finalWorkstreamCount: streams.length,
    finalWorkstreamSetAccuracy: expectedSets.some(set => sameSet(streams.map(s => `${s.authority}/${s.domain}`), set)),
    status: runtime.status, evidenceStatus: runtime.evidenceStatus, applicationStatus: runtime.applicationStatus,
    runtimeTimedOut: runtime.timedOut === true || runtime.timeout === true || runtime.status === 'TIMEOUT',
    guardChecks: {
      operationsPreserved: semantic.issues.every((i, n) => requested[n]?.operation === i.operation) && runtimeIssues.every(r => !requested.find(i => i.id === r.issueId) || requested.find(i => i.id === r.issueId).operation === r.operation),
      caseFactsRequired: semantic.issues.every((i, n) => i.domain === 'UNKNOWN' || !CASE_OPS.has(i.operation) || requested[n]?.evidenceRequirement === 'AUTHORITATIVE_SOURCE_AND_CASE_FACTS'),
      incompletePlanNotVerified: !incomplete || runtime.status !== 'VERIFIED' && runtime.evidenceStatus !== 'VERIFIED',
      contextualAuthorityNotRouted: streams.every(s => !contextualOnly.has(s.authority)),
      residualHasNoWorkstream: issuePlan.issues.filter(i => i.unresolvedReason === 'UNASSIGNED_QUERY_TOPIC').every(i => !runtimeIssues.some(r => r.issueId === i.id)),
      caseSpecificApplicationsUnresolved: runtimeIssues.filter(i => CASE_OPS.has(i.operation)).every(i => i.applicationStatus === 'UNRESOLVED'),
      requiredApplicationStatusesUnresolved: requiredUnresolved,
      unresolvedApplicationNotVerified: routedRequired.length === 0 || runtime.applicationStatus === 'UNRESOLVED' && runtime.status !== 'VERIFIED' && requiredUnresolved
    },
    applicationStatusCounts: { NOT_REQUIRED: runtimeIssues.filter(i => i.applicationStatus === 'NOT_REQUIRED').length,
      UNRESOLVED: runtimeIssues.filter(i => i.applicationStatus === 'UNRESOLVED').length,
      UNKNOWN: runtimeIssues.filter(i => !['NOT_REQUIRED', 'UNRESOLVED'].includes(i.applicationStatus)).length,
      requiredPlanIssues: required.length, routedRequiredIssues: routedRequired.length },
    runtimeIssueScopeDiagnostics: buildPerIssueScopeDiagnostics(semantic.issues, issuePlan, runtime),
    ...summarizeRuntimeIssueAssignments(semantic.issues, issuePlan, streams, runtime.gaps || []) };
}
export function additionalGates(testCase, semantic, issuePlan, runtime, contract) {
  const { expectedByActual } = matchIssues(testCase.expected, semantic.issues);
  const topicRows = [...expectedByActual.entries()].map(([actualIndex, expectedIndex]) => {
    const expected = contract.expectedIssueTopics[expectedIndex];
    const planned = issuePlan.issues[actualIndex];
    const actual = planned?.mappedTopicIds || [];
    return { issueId: expected.issueId, expectedTopicIds: expected.topicIds, actualTopicIds: actual,
      passed: expected.topicIds.every(id => actual.includes(id)) && (expected.topicIds.length > 0 || actual.length === 0) };
  });
  const actualInventory = inventory(testCase.question);
  const mapped = new Set(issuePlan.issues.slice(0, semantic.issues.length).flatMap(i => i.mappedTopicIds));
  const unsupported = testCase.expectedCoverageOutcome === 'UNSUPPORTED';
  const independentCoveragePassed = equal(actualInventory, contract.independentInventory) &&
    actualInventory.topicIds.every(id => mapped.has(id)) && (unsupported || actualInventory.residualCount === 0);
  const diagnostics = buildPerIssueScopeDiagnostics(semantic.issues, issuePlan, runtime);
  const fullIrasLifecycle = diagnostics.filter(d => d.governingAuthorities.includes('IRAS')).every(d =>
    d.runtimeIssueCount > 0 && STAGES.every(stage => d.lifecycleCounts[stage] === d.runtimeIssueCount) && d.evidenceStatusCounts.VERIFIED === d.runtimeIssueCount);
  const irasRuntimeIssues = runtime.workstreams.filter(s => s.authority === 'IRAS').flatMap(s => s.issues || []);
  const requestedLifecyclePassed = diagnostics.every(d => !d.governingAuthorities.includes('IRAS') || d.runtimeIssueCount > 0) &&
    irasRuntimeIssues.every(i => i.lifecycle?.requested === true);
  const applicationPassed = unsupported || runtime.applicationStatus === (testCase.expectedRequiresUserSpecificFacts ? 'UNRESOLVED' : 'NOT_REQUIRED');
  const overallPassed = contract.allowedOverallStatuses.includes(runtime.status);
  return { topicRows, independentInventory: actualInventory, independentCoveragePassed, fullIrasLifecycle, requestedLifecyclePassed, applicationPassed, overallPassed,
    passed: topicRows.length === testCase.expected.length && topicRows.every(r => r.passed) && independentCoveragePassed && fullIrasLifecycle && requestedLifecyclePassed && applicationPassed && overallPassed };
}
async function persist(directory, document) {
  const dest = path.join(directory, REPORT);
  const temporary = `${dest}.tmp`;
  await writeFile(temporary, json(document));
  await rename(temporary, dest);
}
function firstFailure(row) {
  if (row.extraCallAttempts > 0) return 'UNEXPECTED_EXTRA_CALL_ATTEMPT';
  if (row.capture?.preTransportFailureCode) return row.capture.preTransportFailureCode;
  if (row.capture?.requestCount !== 1) return 'MISSING_PROVIDER_CALL';
  if (!row.validInterpretation) return ['TIMEOUT', 'PROVIDER_ERROR', 'RATE_LIMITED'].includes(row.production.failure)
    ? `SEMANTIC_${row.production.failure}` : 'SEMANTIC_VALIDATION';
  if (!row.scoring.completeQuestionIssueCoverage) return 'SEMANTIC_ISSUE_RECALL_PRECISION';
  if (Object.values(row.scoring.dimensionsCorrect).some(n => n !== row.scoring.matchedIssueCount)) return 'SEMANTIC_DIMENSIONS';
  if (!row.irasFirstAcceptance.caseSpecificityCorrect) return 'SEMANTIC_CASE_SPECIFICITY';
  if (row.localFailure) return row.localFailureStage;
  if (!row.additionalGates?.topicRows.every(r => r.passed) || !row.additionalGates.independentCoveragePassed) return 'TOPIC_MAPPING_COVERAGE';
  const required = row.routing.runtimeIssueScopeDiagnostics.filter(d => d.governingAuthorities.includes('IRAS'));
  if (required.some(d => !d.canonicalWorkstreams.some(s => s.authority === 'IRAS')) ||
    row.irasFirstAcceptance.perIssueResults.some(i => i.releaseRequired && !i.canonicalWorkstreamCorrect)) return 'CANONICAL_ROUTING';
  if (required.some(d => d.lifecycleCounts.retrievalAttempted === 0)) return 'RETRIEVAL_ATTEMPT';
  if (required.some(d => d.admittedRecordCount === 0)) return 'EVIDENCE_ADMISSION';
  if (required.some(d => d.verifiedClaimCount === 0)) return 'CLAIM_VERIFICATION';
  if (!row.additionalGates.fullIrasLifecycle || !row.additionalGates.requestedLifecyclePassed) return 'RULE_EVIDENCE_LIFECYCLE';
  if (row.irasFirstAcceptance.perIssueResults.some(i => i.releaseRequired && i.blockingGapCount > 0)) return 'BLOCKING_ROUTING_EVIDENCE_GAPS';
  if (!row.additionalGates.applicationPassed || row.irasFirstAcceptance.perIssueResults.some(i => !i.issueApplicationStatusCorrect)) return 'APPLICATION_GATE';
  if (!row.additionalGates.overallPassed) return 'OVERALL_STATUS_GATE';
  return row.passed ? undefined : 'GENERIC_SEMANTIC_ROUTING_EVIDENCE_GUARD';
}
export async function runAcceptance({ outputDirectory = path.join(ROOT, OUTPUT), apiKey = process.env.GEMINI_API_KEY,
  execute = executeStructuredLlmCall, interpret = interpretSemanticQuestion, buildRuntime = buildAuthorityWorkstreams,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), requireCommittedPlan = true } = {}) {
  const planBytes = await readFile(path.join(outputDirectory, PLAN));
  const envelope = JSON.parse(planBytes);
  assert.equal(sha256(JSON.stringify(envelope.preregistration)), envelope.preregistrationSha256, 'PLAN_HASH_CHANGED');
  assert.deepEqual(await currentSnapshot(), envelope.preregistration, 'FINGERPRINT_CHANGED');
  if (requireCommittedPlan) {
    assert.equal(path.resolve(outputDirectory), path.join(ROOT, OUTPUT), 'OUTPUT_NAMESPACE_CHANGED');
    const committed = execFileSync(GIT, ['show', `HEAD:${OUTPUT}/${PLAN}`], { cwd: ROOT });
    assert.equal(sha256(committed), sha256(planBytes), 'PLAN_NOT_COMMITTED');
    assert.equal(git(['diff', '--name-only', 'HEAD']), '', 'TRACKED_FILES_CHANGED');
    assert.equal(git(['branch', '--show-current']), 'codex/multi-authority-workstreams', 'BRANCH_CHANGED');
    execFileSync(GIT, ['merge-base', '--is-ancestor', STARTING_SHA, 'HEAD'], { cwd: ROOT });
  }
  assert.ok(typeof apiKey === 'string' && apiKey.trim().length > 10, 'KEY_NOT_CONFIGURED');
  await fresh(path.join(outputDirectory, REPORT));
  const reservedAt = new Date().toISOString();
  const markerBytes = json({ profile: PROFILE, preregistrationSha256: envelope.preregistrationSha256,
    preregistrationFileSha256: sha256(planBytes), reservedAt, status: 'CONSUMED_NO_RETRY' });
  await writeFile(path.join(outputDirectory, MARKER), markerBytes, { flag: 'wx' });
  const document = { profile: PROFILE, startingSha: STARTING_SHA, invocationCommit: git(['rev-parse', 'HEAD']),
    preregistrationSha256: envelope.preregistrationSha256, preregistrationFileSha256: sha256(planBytes), reservedAt,
    evidenceMode: 'localOnly', model: MODEL, timeoutMs: 8000, minimumStartGapMs: GAP_MS,
    sourceHashesConsistent: true, fixtureHashesConsistent: true, protectedHistoryVerified: true,
    requestCount: 0, extraCallAttempts: 0, minimumObservedStartGapMs: null, cases: [], status: 'FAIL/HOLD' };
  const cases = await loadIrasFirstV2TargetedCases();
  let previousStart;
  const checkIntegrity = async () => {
    assert.equal(sha256(await readFile(path.join(outputDirectory, PLAN))), document.preregistrationFileSha256, 'PLAN_CHANGED');
    assert.equal(sha256(await readFile(path.join(outputDirectory, MARKER))), sha256(markerBytes), 'MARKER_CHANGED');
    assert.deepEqual(await currentSnapshot(), envelope.preregistration, 'FINGERPRINT_CHANGED');
  };
  await persist(outputDirectory, document);
  try {
    for (let index = 0; index < cases.length; index++) {
      if (index > 0) await sleep(GAP_MS);
      await checkIntegrity();
      const testCase = cases[index];
      let calls = 0, extraCallAttempts = 0, raw, capture, result, diagnostic;
      const captureCall = async (prompt, system, _provider, options = {}) => {
        if (calls > 0) { document.extraCallAttempts++; extraCallAttempts++; throw new Error('EXTRA_CALL_BLOCKED'); }
        calls++;
        const start = performance.now();
        const gap = previousStart === undefined ? null : Math.round(start - previousStart);
        previousStart = start;
        if (gap !== null) document.minimumObservedStartGapMs = document.minimumObservedStartGapMs === null ? gap : Math.min(gap, document.minimumObservedStartGapMs);
        capture = { promptSha256: sha256(prompt), systemSha256: sha256(system), schemaSha256: sha256(JSON.stringify(options.responseJsonSchema)),
          promptChars: prompt.length, systemChars: system.length,
          model: MODEL, timeoutMs: 8000, temperature: 0, jsonMode: true, requestCount: 0, startGapMs: gap };
        const expected = envelope.preregistration.cases[index].promptFingerprint;
        if (!Object.entries(expected).every(([key, value]) => capture[key] === value)) {
          capture.preTransportFailureCode = 'PROMPT_SCHEMA_CHANGED';
          throw new Error('PROMPT_SCHEMA_CHANGED');
        }
        if (!(options.timeoutMs === 8000 && options.temperature === 0 && options.jsonMode === true)) {
          capture.preTransportFailureCode = 'PROVIDER_OPTIONS_CHANGED';
          throw new Error('PROVIDER_OPTIONS_CHANGED');
        }
        try {
          capture.requestCount = 1;
          capture.requestedAt = new Date().toISOString();
          document.requestCount++;
          raw = await execute(prompt, system, { activeProvider: 'gemini', gemini: { apiKey: apiKey.trim(), model: MODEL },
            azure: { endpoint: '', apiKey: '', deploymentName: 'gpt-4o', apiVersion: '2024-08-01-preview' }, openai: { apiKey: '', model: 'gpt-4o', baseUrl: '' } },
          { ...options, model: MODEL, timeoutMs: 8000, temperature: 0, jsonMode: true });
          capture.responseReceived = typeof raw === 'string';
          capture.responseChars = typeof raw === 'string' ? raw.length : 0;
          return raw;
        } catch (e) {
          capture.transportCategory = /HTTP\s+429/i.test(e?.message || '') ? 'RATE_LIMITED' : /abort|timeout|timed\s*out/i.test(e?.message || '') ? 'TIMEOUT' : 'PROVIDER_ERROR';
          capture.responseReceived = false;
          throw e;
        } finally { capture.latencyMs = Math.round((performance.now() - start) * 100) / 100; }
      };
      const provider = { activeProvider: 'gemini', gemini: { apiKey: apiKey.trim(), model: MODEL },
        azure: { endpoint: '', apiKey: '', deploymentName: 'gpt-4o', apiVersion: '2024-08-01-preview' }, openai: { apiKey: '', model: 'gpt-4o', baseUrl: '' } };
      try { result = await interpret(testCase.question, provider, captureCall); }
      catch { result = { mode: 'DETERMINISTIC_FALLBACK', failure: 'PROVIDER_ERROR' }; }
      try { diagnostic = typeof raw === 'string' ? diagnoseSemanticResponse(raw, testCase.question) : undefined; } catch { diagnostic = undefined; }
      raw = undefined;
      const valid = result.mode === 'SEMANTIC_INTERPRETATION' && result.failure === undefined && Boolean(result.interpretation) && diagnostic?.interpreted === true;
      let routing, extra, localFailure = false, localFailureStage;
      const scoring = scoreAuthorityReliefCanonicalContract(testCase, valid ? result.interpretation : { issues: [] });
      if (valid) {
        try {
          localFailureStage = 'RECONCILIATION';
          const reconciled = reconcileQuestionUnderstanding(testCase.question, classifyQuestion(testCase.question), result);
          localFailureStage = 'RUNTIME_EVIDENCE';
          const runtime = await buildRuntime(testCase.question, reconciled.issuePlan, { localOnly: true, questionUnderstanding: result });
          localFailureStage = 'ROUTING_PROJECTION';
          routing = routingProjection(result.interpretation, reconciled.issuePlan, runtime, testCase.expectedWorkstreamsAnyOf);
          localFailureStage = 'ADDITIONAL_GATES';
          extra = additionalGates(testCase, result.interpretation, reconciled.issuePlan, runtime, envelope.preregistration.cases[index]);
          localFailureStage = undefined;
        } catch { localFailure = true; }
      }
      const generic = evaluateIrasFirstCase({ testCase, validInterpretation: valid, scoring, interpretation: result.interpretation,
        routing, production: result, capture, requestCount: calls, sourceHashesConsistent: true, fixtureHashesConsistent: true });
      const row = { caseId: testCase.id, expectedIssueIds: testCase.expected.map(i => i.id), validInterpretation: valid,
        production: { mode: result.mode === 'SEMANTIC_INTERPRETATION' ? result.mode : 'DETERMINISTIC_FALLBACK',
          ...(result.failure ? { failure: FAILURES.has(result.failure) ? result.failure : 'PROVIDER_ERROR' } : {}) },
        responseDiagnostic: diagnostic ? { interpreted: diagnostic.interpreted === true, validatorAccepted: diagnostic.validatorAccepted === true,
          rejectionCode: REJECTION_CODES.has(diagnostic.rejectionCode) ? diagnostic.rejectionCode : 'UNCLASSIFIED_REJECTION',
          rejectionFieldGroup: diagnostic.rejectionPath === '$' ? 'ROOT' : diagnostic.rejectionPath?.startsWith('issues') ? 'ISSUES'
            : diagnostic.rejectionPath?.startsWith('concepts') ? 'CONCEPTS' : diagnostic.rejectionPath === 'confidence' ? 'CONFIDENCE' : 'SCHEMA_FIELD' } : undefined,
        capture, extraCallAttempts, scoring, routing, additionalGates: extra, localFailure, localFailureStage, irasFirstAcceptance: generic,
        passed: generic.passed && extra?.passed === true && calls === 1 && !localFailure && extraCallAttempts === 0 };
      row.firstFailingStage = firstFailure(row);
      document.cases.push(row);
      await persist(outputDirectory, document);
      await checkIntegrity();
    }
    document.irasFirstAcceptance = summarizeIrasFirstAcceptance(document, 9);
    document.pacingPassed = document.minimumObservedStartGapMs >= GAP_MS;
    document.status = document.irasFirstAcceptance.passed && document.cases.every(r => r.passed) && document.pacingPassed && document.extraCallAttempts === 0 ? 'PASS' : 'FAIL/HOLD';
  } catch (e) {
    const code = ['PLAN_CHANGED', 'MARKER_CHANGED', 'FINGERPRINT_CHANGED', 'HISTORICAL_INTEGRITY_FAILURE'].find(c => e?.message?.includes(c));
    document.failureCode = code || 'RUNTIME_FAILURE';
    if (code) { document.sourceHashesConsistent = false; document.fixtureHashesConsistent = false; document.protectedHistoryVerified = false; }
    document.status = 'FAIL/HOLD';
  }
  document.completedAt = new Date().toISOString();
  document.timeoutCount = document.cases.filter(r => r.production.failure === 'TIMEOUT' || r.capture?.transportCategory === 'TIMEOUT').length;
  document.providerErrorCount = document.cases.filter(r => !r.capture?.preTransportFailureCode &&
    (['PROVIDER_ERROR', 'RATE_LIMITED', 'NO_PROVIDER'].includes(r.production.failure) || ['PROVIDER_ERROR', 'RATE_LIMITED'].includes(r.capture?.transportCategory))).length;
  document.preTransportFailureCount = document.cases.filter(r => r.capture?.preTransportFailureCode).length;
  document.invalidResponseCount = document.cases.filter(r => r.capture?.responseReceived && !r.validInterpretation).length;
  await persist(outputDirectory, document);
  return document;
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const args = process.argv.slice(2);
  try {
    assert.ok(args.length === 1 && ['--plan', '--live'].includes(args[0]), 'TARGETED_ONLY_ARGUMENT_REQUIRED');
    const result = args[0] === '--plan' ? await writePlan() : await runAcceptance();
    console.log(JSON.stringify(args[0] === '--plan' ? { profile: PROFILE, preregistrationSha256: result.preregistrationSha256 } :
      { profile: PROFILE, status: result.status, requestCount: result.requestCount, timeoutCount: result.timeoutCount, providerErrorCount: result.providerErrorCount, invalidResponseCount: result.invalidResponseCount }));
    if (args[0] === '--live' && result.status !== 'PASS') process.exitCode = 1;
  } catch { console.error('TARGETED_ACCEPTANCE_PREFLIGHT_REJECTED_NO_RETRY'); process.exitCode = 1; }
}
