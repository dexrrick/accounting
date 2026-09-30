import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { classifyQuestion } from '../../../src/classification/questionClassifier.ts';
import { planAuthorityWorkstreams, buildAuthorityWorkstreams } from '../../../src/services/authorityWorkstreams.ts';
import {
  interpretSemanticQuestion,
  reconcileQuestionUnderstanding,
  validateSemanticQuestionInterpretation
} from '../../../src/services/semanticQuestionUnderstanding.ts';
import { executeStructuredLlmCall } from '../../../src/services/aiTransport.ts';
import { matchIssues, scoreIssueDimensions } from './multi-authority-issue-scoring.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const DEFAULT_FIXTURE = 'tests/evaluation/singapore/multi-authority-workstreams-corrected.json';
export const EXPERIMENT_CASE_IDS = ['A-paraphrase-3', 'A-paraphrase-4', 'D-original', 'D-paraphrase-1'];
export const TIMEOUT_ARMS_MS = [8_000, 15_000];
export const MIN_REQUEST_START_INTERVAL_MS = 15_250;
export const EXPERIMENT_MODEL = 'gemini-3.5-flash-lite';
export const EXPERIMENT_TEMPERATURE = 0;
const MAX_RESPONSE_CHARS = 16_000;
const SOURCE_PATHS = {
  semanticQuestionUnderstanding: 'src/services/semanticQuestionUnderstanding.ts',
  aiTransport: 'src/services/aiTransport.ts'
};
const RESERVED_OUTPUT_PREFIXES = new Set([
  'live-semantic-evaluation',
  'corrected-live-semantic-evaluation',
  'heldout-live-semantic-evaluation',
  'corrected-saved-response-rescore',
  'corrected-saved-response-replay',
  'operation-reliability-audit',
  'operation-reliability-baseline-inspection',
  'operation-reliability-protected-hashes',
  'semantic-audit',
  'semantic-checkpoint',
  'semantic-live-adjudications',
  'semantic-live-audit'
]);

const AUTHORITY_BY_DOMAIN = {
  IRAS_INCOME_TAX: ['IRAS'], IRAS_GST: ['IRAS'], IRAS_PROPERTY_TAX: ['IRAS'], IRAS_STAMP_DUTY: ['IRAS'], IRAS_OTHER: ['IRAS'],
  CPF_PAYROLL: ['CPF'], MOM_EMPLOYMENT: ['MOM'], ACRA_CORPORATE: ['ACRA'], MAS_FUNDS: ['MAS']
};
const ACCOUNTING_AUTHORITIES = new Set(['ACCOUNTING_STANDARDS', 'IFRS_FOUNDATION', 'ACRA', 'SSO']);

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function ratio(correct, total) {
  return { correct, total, rate: total ? correct / total : null };
}

function sameSet(left, right) {
  return Array.isArray(left) && Array.isArray(right) && left.length === right.length &&
    [...left].sort().every((value, index) => value === [...right].sort()[index]);
}

function percentile(values, quantile) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1)];
}

export function experimentCasesFromFixture(fixture) {
  const cases = [];
  for (const id of EXPERIMENT_CASE_IDS) {
    const sourceCase = fixture.cases.find(item => item.id === id);
    if (!sourceCase) throw new Error(`The corrected fixture is missing experiment case ${id}.`);
    const contract = fixture.issueContracts?.[sourceCase.contract];
    if (!Array.isArray(contract)) throw new Error(`The corrected fixture is missing issue contract ${sourceCase.contract}.`);
    const expected = sourceCase.expectedIssueIds
      ? sourceCase.expectedIssueIds.map(issueId => contract.find(issue => issue.id === issueId))
      : contract;
    if (!expected.length || expected.some(issue => !issue)) throw new Error(`Case ${id} has an invalid expected issue selection.`);
    const expectedWorkstreams = sourceCase.expectedWorkstreams || fixture.expectedWorkstreams?.[sourceCase.contract] || [];
    cases.push({
      id: sourceCase.id,
      question: sourceCase.question,
      runGroup: sourceCase.runGroup,
      expected,
      expectedWorkstreams,
      expectedWorkstreamsAnyOf: sourceCase.expectedWorkstreamsAnyOf
    });
  }
  return cases;
}

export function buildExperimentSchedule(cases) {
  const schedule = [];
  for (const [caseIndex, testCase] of cases.entries()) {
    const firstObservationOrder = caseIndex % 2 === 0 ? TIMEOUT_ARMS_MS : [...TIMEOUT_ARMS_MS].reverse();
    const observationOrders = [firstObservationOrder, [...firstObservationOrder].reverse()];
    for (let observation = 1; observation <= 2; observation += 1) {
      for (const timeoutMs of observationOrders[observation - 1]) {
        schedule.push({
          callId: `${testCase.id}::observation-${observation}::timeout-${timeoutMs}`,
          caseId: testCase.id,
          observation,
          timeoutMs,
          scheduleIndex: schedule.length + 1
        });
      }
    }
  }
  return schedule;
}

export async function hashRelevantSources(root = ROOT) {
  const result = {};
  for (const [key, relativePath] of Object.entries(SOURCE_PATHS)) {
    result[key] = sha256(await readFile(path.join(root, relativePath)));
  }
  return result;
}

export function buildExperimentPlan({ fixtureSha256, sourceHashes, cases }) {
  const schedule = buildExperimentSchedule(cases);
  const plan = {
    protocol: 'semantic-reliability-timeout-v1',
    model: EXPERIMENT_MODEL,
    temperature: EXPERIMENT_TEMPERATURE,
    timeoutArmsMs: TIMEOUT_ARMS_MS,
    observationsPerCaseAndArm: 2,
    minRequestStartIntervalMs: MIN_REQUEST_START_INTERVAL_MS,
    retries: 0,
    fixtureSha256,
    sourceHashes,
    schedule
  };
  return { plan, schedule, planSha256: sha256(stableJson(plan)) };
}

export function assertResumeCompatible(report, expectedPlan) {
  if (!report || !report.summary || !Array.isArray(report.calls)) throw new Error('Resume source is not a semantic reliability report.');
  if (report.summary.planSha256 !== expectedPlan.planSha256 ||
      report.summary.fixtureSha256 !== expectedPlan.plan.fixtureSha256 ||
      stableJson(report.summary.sourceHashes) !== stableJson(expectedPlan.plan.sourceHashes) ||
      stableJson(report.summary.plan) !== stableJson(expectedPlan.plan)) {
    throw new Error('Resume report does not match the exact fixture, source hashes, model, timeout plan, order, and pacing.');
  }
  const allowed = new Set(expectedPlan.schedule.map(item => item.callId));
  const seen = new Set();
  for (const call of report.calls) {
    if (!call || !allowed.has(call.callId) || seen.has(call.callId)) throw new Error('Resume report contains an unknown or duplicate experiment outcome.');
    seen.add(call.callId);
  }
  return true;
}

function domainAuthorityContradiction(domain, authorities) {
  if (domain === 'UNKNOWN' || !Array.isArray(authorities)) return false;
  const expected = domain === 'ACCOUNTING' ? ACCOUNTING_AUTHORITIES : AUTHORITY_BY_DOMAIN[domain];
  return Boolean(expected && authorities.length > 0 && !authorities.some(authority =>
    expected instanceof Set ? expected.has(authority) : expected.includes(authority)));
}

export function hasObjectiveContractContradiction(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const top = value;
  if (typeof top.requestedOperation === 'string' && typeof top.calculationRequested === 'boolean' &&
      top.calculationRequested !== (top.requestedOperation === 'CALCULATE')) return true;
  if (top.requestedOperation === 'CALCULATE' && top.requiresUserSpecificFacts === false) return true;
  if (top.requestedOperation === 'PREPARE_JOURNAL' && top.domain !== 'ACCOUNTING') return true;
  if (domainAuthorityContradiction(top.domain, top.authorityCandidates)) return true;
  if (Array.isArray(top.issues)) {
    for (const issue of top.issues) {
      if (!issue || typeof issue !== 'object' || Array.isArray(issue)) continue;
      if (issue.operation === 'PREPARE_JOURNAL' && issue.domain !== 'ACCOUNTING') return true;
      if (domainAuthorityContradiction(issue.domain, issue.governingAuthorities)) return true;
      if (Array.isArray(issue.governingAuthorities) && Array.isArray(issue.contextualAuthorities) &&
          issue.governingAuthorities.some(authority => issue.contextualAuthorities.includes(authority))) return true;
    }
  }
  return false;
}

export function classifyStructuredResponse(response) {
  if (typeof response !== 'string') return { category: 'NON_TEXT_RESPONSE', responseChars: null, responseUtf8Bytes: null };
  const responseChars = response.length;
  const responseUtf8Bytes = Buffer.byteLength(response, 'utf8');
  if (responseChars > MAX_RESPONSE_CHARS) return { category: 'RESPONSE_TOO_LARGE', responseChars, responseUtf8Bytes };
  let parsed;
  try {
    parsed = JSON.parse(response);
  } catch {
    return { category: response.length ? 'MALFORMED_JSON' : 'EMPTY_RESPONSE', responseChars, responseUtf8Bytes };
  }
  if (!validateSemanticQuestionInterpretation(parsed)) {
    return {
      category: hasObjectiveContractContradiction(parsed) ? 'CONTRADICTORY_FIELDS' : 'SCHEMA_REJECTION',
      responseChars,
      responseUtf8Bytes
    };
  }
  return { category: 'VALID_SCHEMA', responseChars, responseUtf8Bytes };
}

export function classifyTransportError(error) {
  const message = error instanceof Error ? error.message : '';
  const statusMatch = message.match(/HTTP\s+(\d{3})/i);
  if (statusMatch) return { category: Number(statusMatch[1]) === 429 ? 'HTTP_429' : 'HTTP_ERROR', providerStatus: Number(statusMatch[1]) };
  if (/abort|timed\s*out|timeout/i.test(message)) return { category: 'TRANSPORT_TIMEOUT' };
  if (/empty response/i.test(message)) return { category: 'EMPTY_RESPONSE' };
  if (/not configured|too short|no active ai provider/i.test(message)) return { category: 'CONFIGURATION_ERROR' };
  return { category: 'TRANSPORT_ERROR' };
}

function promptMetadata(prompt, systemInstruction) {
  return {
    promptSha256: sha256(prompt),
    promptChars: prompt.length,
    promptUtf8Bytes: Buffer.byteLength(prompt, 'utf8'),
    systemSha256: sha256(systemInstruction),
    systemChars: systemInstruction.length,
    systemUtf8Bytes: Buffer.byteLength(systemInstruction, 'utf8')
  };
}

function issueDimensionArray(issues) {
  return issues.map(issue => ({
    domain: issue.domain,
    population: issue.population,
    governingAuthorities: issue.governingAuthorities,
    contextualAuthorities: issue.contextualAuthorities,
    operation: issue.operation,
    mappedTopicIds: issue.mappedTopicIds
  }));
}

function scoreIssues(testCase, issues) {
  const { expectedByActual } = matchIssues(testCase.expected, issues);
  const matched = [...expectedByActual.entries()].map(([actualIndex, expectedIndex]) => {
    const dimensions = scoreIssueDimensions(issues[actualIndex], testCase.expected[expectedIndex]);
    return { expectedIssueId: testCase.expected[expectedIndex].id, modelIssueIndex: actualIndex, dimensions };
  });
  const dimensionKeys = ['governingAuthority', 'contextualAuthority', 'domain', 'population', 'operation'];
  const dimensionScores = Object.fromEntries(dimensionKeys.map(key => [key,
    ratio(matched.filter(item => item.dimensions[key]).length, matched.length)]));
  const actualIssueDimensions = issueDimensionArray(issues);
  const signatureContent = actualIssueDimensions.map(item => ({
    domain: item.domain,
    population: item.population,
    governingAuthorities: [...item.governingAuthorities].sort(),
    contextualAuthorities: [...item.contextualAuthorities].sort(),
    operation: item.operation,
    mappedTopicIds: [...item.mappedTopicIds].sort()
  }));
  return {
    matched,
    actualIssueCount: issues.length,
    expectedIssueCount: testCase.expected.length,
    matchedIssueCount: matched.length,
    issueRecall: ratio(matched.length, testCase.expected.length),
    issuePrecision: ratio(matched.length, issues.length),
    completeQuestionIssueCoverage: matched.length === testCase.expected.length && matched.length === issues.length,
    dimensionScores,
    actualIssueDimensions,
    semanticSignatureSha256: sha256(stableJson(signatureContent))
  };
}

function expectedWorkstreamSets(testCase) {
  return testCase.expectedWorkstreamsAnyOf || [testCase.expectedWorkstreams];
}

async function defaultBuildRuntime(testCase, issuePlan, understanding) {
  return buildAuthorityWorkstreams(testCase.question, issuePlan, { localOnly: true, questionUnderstanding: understanding });
}

async function evaluateRouting(testCase, understanding, buildRuntime = defaultBuildRuntime) {
  try {
    const classification = classifyQuestion(testCase.question);
    const reconciled = reconcileQuestionUnderstanding(testCase.question, classification, understanding);
    const issuePlan = reconciled.issuePlan;
    const planned = planAuthorityWorkstreams(issuePlan);
    const runtime = await buildRuntime(testCase, issuePlan, understanding);
    const finalKeys = runtime.workstreams.map(stream => `${stream.authority}/${stream.domain}`);
    const plannedKeys = planned.map(stream => `${stream.authority}/${stream.domain}`);
    const expectedSets = expectedWorkstreamSets(testCase);
    const sameFinal = expectedSets.some(expected => sameSet(finalKeys, expected));
    const semanticIssues = understanding.interpretation?.issues || [];
    const runtimeIssues = runtime.workstreams.flatMap(stream => stream.issues || []);
    const residuals = issuePlan.issues.filter(issue => issue.unresolvedReason === 'UNASSIGNED_QUERY_TOPIC');
    const incompletePlan = !issuePlan.coverageEstablished || issuePlan.hasUnmappedResidual || issuePlan.issues.some(issue => issue.status === 'UNRESOLVED');
    const residualNoRequestedWorkstream = residuals.every(residual => !runtimeIssues.some(item => item.issueId === residual.id));
    const incompletePlanNotVerified = !incompletePlan || runtime.status !== 'VERIFIED' && runtime.evidenceStatus !== 'VERIFIED';
    const reconciledIssues = issuePlan.issues.slice(0, semanticIssues.length);
    const operationsPreserved = semanticIssues.every((issue, index) => reconciledIssues[index]?.operation === issue.operation) &&
      runtimeIssues.every(item => {
        const source = reconciledIssues.find(issue => issue.id === item.issueId);
        return !source || source.operation === item.operation;
      });
    const caseSpecificOps = new Set(['CALCULATE', 'PREPARE_JOURNAL', 'CHECK_ELIGIBILITY']);
    const requiresCaseFacts = semanticIssues.every((issue, index) => issue.domain === 'UNKNOWN' || !caseSpecificOps.has(issue.operation) ||
      reconciledIssues[index]?.evidenceRequirement === 'AUTHORITATIVE_SOURCE_AND_CASE_FACTS');
    return {
      plannedWorkstreams: plannedKeys,
      finalWorkstreams: finalKeys,
      finalWorkstreamSetAccuracy: sameFinal,
      runtimeStatus: runtime.status,
      evidenceStatus: runtime.evidenceStatus,
      gapCodes: [...new Set(runtime.gaps.map(gap => gap.code))],
      routingEvidenceGuardCorrect: residualNoRequestedWorkstream && incompletePlanNotVerified && operationsPreserved && requiresCaseFacts
    };
  } catch {
    return { plannedWorkstreams: [], finalWorkstreams: [], finalWorkstreamSetAccuracy: null, routingDiagnostic: 'LOCAL_ROUTING_FAILURE' };
  }
}

function buildScheduleIndex(schedule) {
  const map = new Map();
  for (const item of schedule) {
    if (map.has(item.callId)) throw new Error(`Duplicate scheduled call ID ${item.callId}.`);
    map.set(item.callId, item);
  }
  return map;
}

function armSummary(calls, timeoutMs) {
  const arm = calls.filter(call => call.timeoutMs === timeoutMs);
  const metricKeys = ['governingAuthority', 'contextualAuthority', 'domain', 'population', 'operation'];
  const dimensionScores = Object.fromEntries(metricKeys.map(key => {
    const items = arm.flatMap(call => call.dimensionScores?.[key] ? [call.dimensionScores[key]] : []);
    return [key, ratio(items.reduce((sum, item) => sum + item.correct, 0), items.reduce((sum, item) => sum + item.total, 0))];
  }));
  const latencies = arm.map(call => call.latencyMs).filter(Number.isFinite);
  return {
    timeoutMs,
    requests: arm.length,
    validInterpretations: arm.filter(call => call.validInterpretation).length,
    timeoutCount: arm.filter(call => call.semanticFailure === 'TIMEOUT' || call.transportDiagnostic?.category === 'TRANSPORT_TIMEOUT').length,
    invalidResponseCount: arm.filter(call => call.semanticFailure === 'INVALID_RESPONSE' || call.semanticFailure === 'LOW_CONFIDENCE').length,
    diagnostics: Object.fromEntries([...new Set(arm.map(call => call.responseDiagnostic?.category || call.transportDiagnostic?.category || 'NO_RESPONSE'))]
      .map(category => [category, arm.filter(call => (call.responseDiagnostic?.category || call.transportDiagnostic?.category || 'NO_RESPONSE') === category).length])),
    latencyMs: {
      median: percentile(latencies, 0.5),
      p95: percentile(latencies, 0.95),
      max: latencies.length ? Math.max(...latencies) : null
    },
    operationDimensionAccuracy: dimensionScores.operation,
    dimensionScores
  };
}

function caseArmSignatureComparisons(calls) {
  const results = [];
  for (const caseId of EXPERIMENT_CASE_IDS) {
    const arms = {};
    for (const timeoutMs of TIMEOUT_ARMS_MS) {
      const observations = calls.filter(call => call.caseId === caseId && call.timeoutMs === timeoutMs)
        .sort((left, right) => left.observation - right.observation);
      const signatures = observations.map(call => call.semanticSignatureSha256 || null);
      const assessed = signatures.length === 2 && signatures.every(Boolean);
      arms[String(timeoutMs)] = { signatures, stable: assessed ? signatures[0] === signatures[1] : null, assessed };
    }
    const pairedSignatures = [String(TIMEOUT_ARMS_MS[0]), String(TIMEOUT_ARMS_MS[1])]
      .map(timeout => arms[timeout].signatures);
    const crossArmAssessed = pairedSignatures.every(signatures => signatures.length === 2 && signatures.every(Boolean));
    results.push({
      caseId,
      arms,
      timeoutArmsDiffer: crossArmAssessed
        ? pairedSignatures[0].some((signature, index) => signature !== pairedSignatures[1][index])
        : null,
      timeoutArmsDifferAssessed: crossArmAssessed
    });
  }
  return results;
}

export function summarizeExperiment(calls, metadata) {
  const completedCalls = calls.length;
  const allScheduled = metadata.schedule.length;
  return {
    schemaVersion: 1,
    experiment: 'semantic-question-timeout-reliability',
    mode: 'LIVE_SEMANTIC_RELIABILITY_EXPERIMENT',
    model: EXPERIMENT_MODEL,
    temperature: EXPERIMENT_TEMPERATURE,
    minRequestStartIntervalMs: MIN_REQUEST_START_INTERVAL_MS,
    retries: 0,
    fixtureSha256: metadata.fixtureSha256,
    sourceHashes: metadata.sourceHashes,
    plan: metadata.plan,
    planSha256: metadata.planSha256,
    scheduledRequests: allScheduled,
    completedRequests: completedCalls,
    validInterpretations: calls.filter(call => call.validInterpretation).length,
    timeoutCount: calls.filter(call => call.semanticFailure === 'TIMEOUT' || call.transportDiagnostic?.category === 'TRANSPORT_TIMEOUT').length,
    invalidResponseCount: calls.filter(call => call.semanticFailure === 'INVALID_RESPONSE' || call.semanticFailure === 'LOW_CONFIDENCE').length,
    armResults: TIMEOUT_ARMS_MS.map(timeoutMs => armSummary(calls, timeoutMs)),
    caseArmSignatureComparisons: caseArmSignatureComparisons(calls),
    note: 'Descriptive 4-case comparison; two observations per timeout arm and case. This is not a statistical causal guarantee.',
    startedAt: metadata.startedAt,
    updatedAt: new Date().toISOString(),
    complete: completedCalls === allScheduled
  };
}

function reportMarkdown(report) {
  const summary = report.summary;
  const lines = [
    '# Semantic reliability timeout experiment',
    '',
    `Status: ${summary.complete ? 'COMPLETE' : 'PARTIAL'}; model: ${summary.model}; temperature: ${summary.temperature}; request-start interval: ${summary.minRequestStartIntervalMs} ms; retries: ${summary.retries}.`,
    `Requests: ${summary.completedRequests}/${summary.scheduledRequests}; valid interpretations: ${summary.validInterpretations}; timeouts: ${summary.timeoutCount}; invalid structured responses: ${summary.invalidResponseCount}.`,
    '',
    summary.note,
    '',
    'Prompt text, system text, user questions, response bodies, credentials, and arbitrary provider error messages are not persisted.',
    '',
    '## Timeout arms',
    '',
    '| Timeout | Requests | Valid | Timeouts | Invalid | Median ms | P95 ms | Operation dimension |',
    '|---:|---:|---:|---:|---:|---:|---:|---:|'
  ];
  for (const arm of summary.armResults) {
    lines.push(`| ${arm.timeoutMs} | ${arm.requests} | ${arm.validInterpretations} | ${arm.timeoutCount} | ${arm.invalidResponseCount} | ${arm.latencyMs.median ?? 'n/a'} | ${arm.latencyMs.p95 ?? 'n/a'} | ${arm.operationDimensionAccuracy.correct}/${arm.operationDimensionAccuracy.total} |`);
  }
  lines.push('', '## Signature comparison by case', '', '| Case | 8s observations | 15s observations | 8s stable | 15s stable | Arm signatures differ |', '|---|---|---|---|---|---|');
  for (const item of summary.caseArmSignatureComparisons) {
    const eight = item.arms['8000'].signatures.map(value => value ? value.slice(0, 12) : 'no-valid-signature').join(', ');
    const fifteen = item.arms['15000'].signatures.map(value => value ? value.slice(0, 12) : 'no-valid-signature').join(', ');
    lines.push(`| ${item.caseId} | ${eight} | ${fifteen} | ${item.arms['8000'].stable ?? 'unassessed'} | ${item.arms['15000'].stable ?? 'unassessed'} | ${item.timeoutArmsDiffer ?? 'unassessed'} |`);
  }
  lines.push('', '## Request outcomes', '', '| Call | Case | Observation | Timeout | Outcome | Diagnostic | Latency ms | Response chars | Response bytes | Issue recall | Complete issues | Workstream set |', '|---|---|---:|---:|---|---|---:|---:|---:|---:|---|---|');
  for (const call of report.calls) {
    lines.push(`| ${call.callId} | ${call.caseId} | ${call.observation} | ${call.timeoutMs} | ${call.semanticFailure || 'VALID_INTERPRETATION'} | ${call.responseDiagnostic?.category || call.transportDiagnostic?.category || 'NO_RESPONSE'} | ${call.latencyMs} | ${call.responseDiagnostic?.responseChars ?? 'n/a'} | ${call.responseDiagnostic?.responseUtf8Bytes ?? 'n/a'} | ${call.issueRecall.correct}/${call.issueRecall.total} | ${call.completeQuestionIssueCoverage} | ${call.finalWorkstreamSetAccuracy ?? 'n/a'} |`);
  }
  lines.push('', '## Source and prompt fingerprints', '', `Fixture SHA-256: ${summary.fixtureSha256}.`,
    ...Object.entries(summary.sourceHashes).map(([name, value]) => `${name} SHA-256: ${value}.`), '');
  for (const call of report.calls) {
    lines.push(`- ${call.callId}: prompt ${call.promptSha256} (${call.promptChars} chars/${call.promptUtf8Bytes} bytes); system ${call.systemSha256} (${call.systemChars} chars/${call.systemUtf8Bytes} bytes); transport ${call.model}, ${call.timeoutMs} ms, ${call.temperature}.`);
  }
  lines.push('');
  return `${lines.join('\n').trimEnd()}\n`;
}

export async function writeReportAtomically(directory, prefix, report) {
  await mkdir(directory, { recursive: true });
  const jsonPath = path.join(directory, `${prefix}.json`);
  const markdownPath = path.join(directory, `${prefix}.md`);
  const jsonTempPath = `${jsonPath}.${process.pid}.tmp`;
  const markdownTempPath = `${markdownPath}.${process.pid}.tmp`;
  await writeFile(jsonTempPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await rename(jsonTempPath, jsonPath);
  await writeFile(markdownTempPath, reportMarkdown(report), 'utf8');
  await rename(markdownTempPath, markdownPath);
  return { jsonPath, markdownPath };
}

export function validateOutputPrefix(prefix) {
  if (typeof prefix !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(prefix) || prefix === '.' || prefix === '..') {
    throw new Error('Output prefix must be a short filename label using letters, numbers, dot, underscore, or hyphen.');
  }
  if (RESERVED_OUTPUT_PREFIXES.has(prefix.toLowerCase())) throw new Error('Output prefix is reserved for a historical evaluation artifact.');
  return prefix;
}

export async function assertFreshOutputPaths(directory, prefix) {
  for (const extension of ['json', 'md']) {
    const target = path.join(directory, `${prefix}.${extension}`);
    try {
      await access(target);
      throw new Error(`Refusing to overwrite existing experiment artifact ${path.basename(target)}; choose a new prefix or use --resume.`);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
}

function makeClock(overrides = {}) {
  return {
    nowEpochMs: overrides.nowEpochMs || (() => Date.now()),
    monotonicNowMs: overrides.monotonicNowMs || (() => performance.now()),
    nowIso: overrides.nowIso || (() => new Date().toISOString()),
    sleep: overrides.sleep || (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)))
  };
}

export async function runReliabilityExperiment({
  fixture,
  provider,
  fixtureSha256,
  sourceHashes,
  plan,
  planSha256,
  schedule = buildExperimentSchedule(experimentCasesFromFixture(fixture)),
  savedCalls = [],
  startedAt: providedStartedAt,
  structuredCall = executeStructuredLlmCall,
  interpret = interpretSemanticQuestion,
  readCurrentSourceHashes = () => hashRelevantSources(ROOT),
  clock: clockOverrides,
  minimumRequestStartIntervalMs = MIN_REQUEST_START_INTERVAL_MS,
  buildRuntime = defaultBuildRuntime,
  onOutcome = async () => {}
}) {
  if (!Array.isArray(schedule) || !schedule.length) throw new Error('Reliability experiment schedule is empty.');
  const clock = makeClock(clockOverrides);
  const cases = experimentCasesFromFixture(fixture);
  const caseById = new Map(cases.map(item => [item.id, item]));
  const scheduleIndex = buildScheduleIndex(schedule);
  const calls = [...savedCalls];
  const completed = new Set(calls.map(call => call.callId));
  if (completed.size !== calls.length) throw new Error('Saved outcomes contain duplicate call IDs.');
  for (const id of completed) if (!scheduleIndex.has(id)) throw new Error('Saved outcome does not belong to this experiment schedule.');
  let lastStartMs = calls.reduce((latest, call) => Math.max(latest, Date.parse(call.requestStartedAt || '') || 0), 0) || null;
  const metadata = { fixtureSha256, sourceHashes, plan, planSha256, schedule, startedAt: providedStartedAt || clock.nowIso() };

  for (const scheduled of schedule) {
    if (completed.has(scheduled.callId)) continue;
    const testCase = caseById.get(scheduled.caseId);
    if (!testCase) throw new Error(`Scheduled case ${scheduled.caseId} is absent from fixture.`);
    const currentBefore = await readCurrentSourceHashes();
    if (stableJson(currentBefore) !== stableJson(sourceHashes)) throw new Error('Semantic or transport source changed before the next experiment request.');
    if (lastStartMs !== null) {
      const waitMs = Math.max(0, minimumRequestStartIntervalMs - (clock.nowEpochMs() - lastStartMs));
      if (waitMs) await clock.sleep(waitMs);
    }
    const requestStartedAt = clock.nowIso();
    lastStartMs = clock.nowEpochMs();
    const started = clock.monotonicNowMs();
    let requestMetadata;
    let responseDiagnostic;
    let transportDiagnostic;
    let understanding;
    const callStructured = async (prompt, systemInstruction, callProvider, options) => {
      requestMetadata = promptMetadata(prompt, systemInstruction);
      try {
        const response = await structuredCall(prompt, systemInstruction, callProvider, {
          ...options,
          model: EXPERIMENT_MODEL,
          timeoutMs: scheduled.timeoutMs,
          temperature: EXPERIMENT_TEMPERATURE
        });
        responseDiagnostic = classifyStructuredResponse(response);
        return response;
      } catch (error) {
        transportDiagnostic = classifyTransportError(error);
        throw error;
      }
    };
    understanding = await interpret(testCase.question, provider, callStructured);
    const latencyMs = Math.max(0, Math.round(clock.monotonicNowMs() - started));
    if (understanding.failure === 'LOW_CONFIDENCE' && responseDiagnostic?.category === 'VALID_SCHEMA') {
      responseDiagnostic = { ...responseDiagnostic, category: 'LOW_CONFIDENCE' };
    }
    const currentAfter = await readCurrentSourceHashes();
    const sourceHashStable = stableJson(currentAfter) === stableJson(sourceHashes);
    const issues = understanding.interpretation?.issues || [];
    const scored = scoreIssues(testCase, issues);
    const routing = await evaluateRouting(testCase, understanding, buildRuntime);
    const validInterpretation = understanding.mode === 'SEMANTIC_INTERPRETATION' && !understanding.failure && Boolean(understanding.interpretation);
    const call = {
      callId: scheduled.callId,
      caseId: scheduled.caseId,
      observation: scheduled.observation,
      scheduleIndex: scheduled.scheduleIndex,
      timeoutMs: scheduled.timeoutMs,
      model: EXPERIMENT_MODEL,
      temperature: EXPERIMENT_TEMPERATURE,
      minRequestStartIntervalMs: minimumRequestStartIntervalMs,
      requestStartedAt,
      latencyMs,
      validInterpretation,
      semanticFailure: understanding.failure || null,
      providerStatus: Number.isInteger(understanding.providerStatus) ? understanding.providerStatus : null,
      transportDiagnostic: transportDiagnostic || null,
      responseDiagnostic: responseDiagnostic || null,
      ...requestMetadata,
      issueRecall: scored.issueRecall,
      issuePrecision: scored.issuePrecision,
      completeQuestionIssueCoverage: scored.completeQuestionIssueCoverage,
      dimensionScores: scored.dimensionScores,
      expectedIssueMatches: scored.matched,
      actualIssueCount: scored.actualIssueCount,
      expectedIssueCount: scored.expectedIssueCount,
      actualIssueDimensions: scored.actualIssueDimensions,
      semanticSignatureSha256: validInterpretation ? scored.semanticSignatureSha256 : null,
      plannedWorkstreams: routing.plannedWorkstreams,
      finalWorkstreams: routing.finalWorkstreams,
      finalWorkstreamSetAccuracy: routing.finalWorkstreamSetAccuracy,
      runtimeStatus: routing.runtimeStatus || null,
      evidenceStatus: routing.evidenceStatus || null,
      gapCodes: routing.gapCodes || [],
      routingEvidenceGuardCorrect: routing.routingEvidenceGuardCorrect ?? null,
      routingDiagnostic: routing.routingDiagnostic || null,
      sourceHashStable
    };
    calls.push(call);
    completed.add(scheduled.callId);
    const report = { summary: summarizeExperiment(calls, metadata), calls };
    await onOutcome(report);
    if (!sourceHashStable) throw new Error('Semantic or transport source changed during the experiment; outcome was saved and no further request was made.');
  }
  return { summary: summarizeExperiment(calls, metadata), calls };
}

function parseOption(argv, name) {
  const inline = argv.find(argument => argument.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

function isMainModule() {
  return Boolean(process.argv[1]) && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
}

async function fileExists(filePath) {
  try { await access(filePath); return true; } catch (error) { if (error?.code === 'ENOENT') return false; throw error; }
}

async function main(argv = process.argv.slice(2)) {
  if (!argv.includes('--live')) throw new Error('Explicit --live is required; no experiment request was made.');
  const prefix = validateOutputPrefix(parseOption(argv, '--output-prefix'));
  const resume = argv.includes('--resume');
  const root = ROOT;
  const outputDirectory = path.join(root, 'docs/evaluation/multi-authority-workstreams');
  const jsonPath = path.join(outputDirectory, `${prefix}.json`);
  const markdownPath = path.join(outputDirectory, `${prefix}.md`);
  const fixturePath = path.join(root, DEFAULT_FIXTURE);
  const fixtureBytes = await readFile(fixturePath);
  const fixture = JSON.parse(fixtureBytes.toString('utf8'));
  const cases = experimentCasesFromFixture(fixture);
  const fixtureSha256 = sha256(fixtureBytes);
  const sourceHashes = await hashRelevantSources(root);
  const experimentPlan = buildExperimentPlan({ fixtureSha256, sourceHashes, cases });
  const provider = process.env.GEMINI_API_KEY?.trim();
  if (!provider || provider.length <= 10) throw new Error('GEMINI_API_KEY is unavailable or too short; no experiment request was made.');

  let savedCalls = [];
  let startedAt = new Date().toISOString();
  if (resume) {
    if (!(await fileExists(jsonPath))) throw new Error('--resume requires an existing JSON checkpoint.');
    const savedReport = JSON.parse(await readFile(jsonPath, 'utf8'));
    assertResumeCompatible(savedReport, experimentPlan);
    savedCalls = savedReport.calls;
    startedAt = savedReport.summary.startedAt || startedAt;
  } else {
    await assertFreshOutputPaths(outputDirectory, prefix);
  }

  const metadata = {
    fixtureSha256,
    sourceHashes,
    plan: experimentPlan.plan,
    planSha256: experimentPlan.planSha256,
    schedule: experimentPlan.schedule,
    startedAt
  };
  const persist = async report => {
    if (!resume && savedCalls.length === 0) {
      await assertFreshOutputPaths(outputDirectory, prefix);
    }
    await writeReportAtomically(outputDirectory, prefix, report);
    savedCalls = report.calls;
  };
  const report = await runReliabilityExperiment({
    fixture,
    provider,
    ...metadata,
    savedCalls,
    onOutcome: persist
  });
  await persist(report);
  console.log(`Experiment ${report.summary.complete ? 'completed' : 'saved partially'}: ${report.summary.completedRequests}/${report.summary.scheduledRequests} requests; ${report.summary.validInterpretations} valid interpretations; no retries.`);
  console.log(`Wrote ${path.relative(root, jsonPath)} and ${path.relative(root, markdownPath)}.`);
}

if (isMainModule()) {
  main().catch(error => {
    const message = error instanceof Error ? error.message : 'Experiment failed.';
    console.error(message);
    process.exitCode = 1;
  });
}
