import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { classifyQuestion } from '../../../src/classification/questionClassifier.ts';
import { planAuthorityWorkstreams, buildAuthorityWorkstreams } from '../../../src/services/authorityWorkstreams.ts';
import { interpretSemanticQuestion, reconcileQuestionUnderstanding, validateSemanticQuestionInterpretation } from '../../../src/services/semanticQuestionUnderstanding.ts';
import { matchIssues, scoreIssueDimensions } from './multi-authority-issue-scoring.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
function optionValue(name) {
  const prefix = `${name}=`;
  const inline = process.argv.find(argument => argument.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const fixtureArgument = optionValue('--fixture');
const fixturePath = fixtureArgument
  ? path.resolve(root, fixtureArgument)
  : path.join(root, 'tests/evaluation/singapore/multi-authority-workstreams-live.json');
const outputDirectory = path.join(root, 'docs/evaluation/multi-authority-workstreams');
const outputPrefix = optionValue('--output-prefix') || 'live-semantic-evaluation';
if (!outputPrefix.trim() || path.basename(outputPrefix) !== outputPrefix) throw new Error('--output-prefix must be a filename prefix without directory separators.');
const jsonPath = path.join(outputDirectory, `${outputPrefix}.json`);
const markdownPath = path.join(outputDirectory, `${outputPrefix}.md`);
const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
const interpreterSourcePath = path.join(root, 'src/services/semanticQuestionUnderstanding.ts');
const MODEL = fixture.expectedModel;
const rescoreFrom = optionValue('--rescore-from');
const reconcileSaved = process.argv.includes('--reconcile-saved');
const defaultFixturePath = path.join(root, 'tests/evaluation/singapore/multi-authority-workstreams-live.json');
const normalizeFilesystemPath = value => process.platform === 'win32' ? value.toLocaleLowerCase('en-US') : value;
const isAlternateFixture = normalizeFilesystemPath(path.resolve(fixturePath)) !== normalizeFilesystemPath(path.resolve(defaultFixturePath));
if (outputPrefix.toLocaleLowerCase('en-US') === 'live-semantic-evaluation' && (isAlternateFixture || Boolean(rescoreFrom))) {
  throw new Error('--output-prefix=live-semantic-evaluation is reserved for the original live fixture and cannot be used with alternate fixtures or saved-response rescoring.');
}
if (fixtureArgument && !optionValue('--output-prefix') && !rescoreFrom) {
  throw new Error('--fixture requires --output-prefix so alternate fixture runs cannot replace the original live report.');
}
const FAILURE_TAXONOMY = [
  'MODEL_OMISSION', 'MODEL_FALSE_ISSUE', 'MODEL_WRONG_AUTHORITY', 'MODEL_WRONG_DOMAIN',
  'MODEL_WRONG_POPULATION', 'MODEL_WRONG_OPERATION', 'MODEL_INVALID_SCHEMA', 'MODEL_TIMEOUT',
  'RECONCILIATION_REJECTION', 'TAXONOMY_MAPPING_GAP', 'RUNTIME_ROUTING_FAILURE'
];
const NO_RESPONSE_FAILURES = new Set(['NO_PROVIDER', 'PROVIDER_ERROR', 'RATE_LIMITED', 'TIMEOUT', 'QUERY_TOO_LONG']);
const RETRYABLE_PROVIDER_FAILURES = new Set(['PROVIDER_ERROR', 'RATE_LIMITED']);
const MIN_GEMINI_INTERVAL_MS = 8_000;
const REQUEST_START_GUARD_MS = 250;
const MAX_ATTEMPTS_PER_CASE = 5;

function requestedMinimumInterval() {
  const index = process.argv.indexOf('--min-interval-ms');
  const inline = process.argv.find(argument => argument.startsWith('--min-interval-ms='));
  if (index < 0 && !inline) return MIN_GEMINI_INTERVAL_MS;
  const raw = inline ? inline.slice('--min-interval-ms='.length) : process.argv[index + 1];
  const value = Number(raw);
  if (!Number.isInteger(value) || value < MIN_GEMINI_INTERVAL_MS) {
    throw new Error(`--min-interval-ms must be an integer of at least ${MIN_GEMINI_INTERVAL_MS}.`);
  }
  return value;
}

const minimumIntervalMs = requestedMinimumInterval();
const resumeRequested = process.argv.includes('--resume');
const retryProviderErrorsOnly = process.argv.includes('--retry-provider-errors');
const retryInvalidResponsesOnly = process.argv.includes('--retry-invalid-response');
if (retryProviderErrorsOnly && !resumeRequested) {
  throw new Error('--retry-provider-errors requires --resume. No model call was made.');
}
if (retryInvalidResponsesOnly && !resumeRequested) {
  throw new Error('--retry-invalid-response requires --resume. No model call was made.');
}
if (retryProviderErrorsOnly && retryInvalidResponsesOnly) {
  throw new Error('--retry-invalid-response and --retry-provider-errors are mutually exclusive. No model call was made.');
}
if (retryProviderErrorsOnly && process.argv.includes('--report-only')) {
  throw new Error('--retry-provider-errors cannot be combined with --report-only. No model call was made.');
}
if (retryInvalidResponsesOnly && process.argv.includes('--report-only')) {
  throw new Error('--retry-invalid-response cannot be combined with --report-only. No model call was made.');
}

if (process.argv.includes('--oracle') || process.argv.includes('--replay-from')) {
  throw new Error('This runner measures live production-path model understanding only; oracle/replay input is not accepted.');
}
if (rescoreFrom && (!optionValue('--output-prefix') || process.argv.includes('--live'))) {
  throw new Error('--rescore-from requires --output-prefix and cannot be combined with --live.');
}
if (reconcileSaved && !rescoreFrom) throw new Error('--reconcile-saved requires --rescore-from.');
if (!rescoreFrom && !process.argv.includes('--live')) {
  throw new Error('Explicit --live is required. No model call was made; oracle/default evaluation is not supported here.');
}
if (!rescoreFrom && process.argv.includes('--report-only') && !process.argv.includes('--resume')) {
  throw new Error('--report-only requires --resume to read an existing live report. No model call was made.');
}

function emptySummary(status, note) {
  return {
    suite: fixture.suite,
    mode: status === 'MEASURED' ? 'LIVE_GEMINI_SEMANTIC_AND_LOCAL_AUTHORITY_WORKSTREAMS' : 'LIVE_SEMANTIC_NOT_MEASURED',
    modelUnderstandingMeasured: status === 'MEASURED',
    measurementStatus: status,
    model: status === 'MEASURED' ? MODEL : 'NOT_MEASURED',
    expectedModel: MODEL,
    runPlan: fixture.runs,
    liveCalls: 0,
    logicalCaseCalls: 0,
    providerRequestAttempts: 0,
    providerResponseAttempts: 0,
    totalCaseCalls: 0,
    semanticMetrics: null,
    taxonomyFailureCounts: {},
    latencyMs: null,
    repeatedOriginalCaseStability: null,
    note,
    limitations: [
      'This report measures calls to interpretSemanticQuestion(query, GEMINI_API_KEY) and uses only the production prompt, schema, validation, and timeout.',
      'The caller must load repository .env/.env.local values through Node --env-file options; the runner does not read environment files itself.',
      'Authority workstream evidence retrieval is local-only; this evaluation measures semantic interpretation, reconciliation, and planned/final scope, not source freshness or evidence sufficiency.',
      'Issue identity matching uses deterministic phrase anchors in the held-out contract. Ambiguous subject matches require review.',
      'Topic hints from the model are recorded separately and never supply deterministic mapped topic IDs.'
    ]
  };
}

function markdownReport(report) {
  const summary = report.summary;
  const lines = [
    '# Live semantic evaluation: multi-authority workstreams',
    '',
    `**Model understanding measured: ${summary.modelUnderstandingMeasured ? 'YES' : 'NOT MEASURED'}**`,
    '',
    `Measurement status: ${summary.measurementStatus}. Model: ${summary.model}. Mode: ${summary.mode}.`,
    ''
  ];
  if (summary.pendingLocalFinalizationCalls) {
    lines.push(`Pending local finalization: ${summary.pendingLocalFinalizationCalls} call(s). These checkpoints include provider-attempt data but do not yet have finalized interpretation metrics or workstreams.`, '');
  }
  if (!summary.modelUnderstandingMeasured) {
    const outcomes = summary.callOutcomes;
    if (summary.mode?.startsWith('SAVED_RESPONSE_')) {
      const metrics = summary.semanticMetrics || {};
      lines.push(
        `**Saved-response rescore; no provider call was made.** Source report: ${summary.sourceReport || 'unknown'}; source measurement: ${summary.sourceMeasurementStatus || 'unknown'}.`,
        `Saved logical case rows: ${summary.logicalCaseCalls || 0}; preserved provider request attempts: ${summary.providerRequestAttempts || 0}; preserved provider response attempts: ${summary.providerResponseAttempts || 0}.`,
        `Issue recall: ${fmtRatio(metrics.issueRecall)}; issue precision: ${fmtRatio(metrics.issuePrecision)}; complete-question issue coverage: ${fmtRatio(metrics.completeQuestionIssueCoverage)}; saved downstream workstream routing: ${fmtRatio(metrics.workstreamRoutingAccuracy)}.`,
        `Runtime routing/evidence-guard correctness: ${fmtRatio(summary.downstreamRoutingEvidenceGuardCorrectness)} (n=${summary.downstreamBehavioralDenominator || 0}); this does not score substantive answer correctness.`,
        ''
      );
      if (summary.note) lines.push(`**${summary.note}**`, '');
      lines.push('## Rescored calls', '', '| Run | Case | Attempts | Issue recall | Issue precision | Complete issues | Workstream set |', '|---|---|---:|---:|---:|---|---|');
      for (const row of report.calls) {
        lines.push(`| ${row.runId} | ${row.caseId} | ${row.attempts?.length || 0} | ${fmtRatio(row.metrics?.issueRecall)} | ${fmtRatio(row.metrics?.issuePrecision)} | ${row.metrics?.completeQuestionIssueCoverage ? 'PASS' : row.metrics ? 'FAIL' : 'N/A'} | ${row.metrics ? row.metrics.finalWorkstreamSetAccuracy ? 'PASS' : 'FAIL' : 'N/A'} |`);
      }
      lines.push('', '## Limits', '', ...summary.limitations.map(item => `- ${item}`), '');
      return `${lines.join('\n').trimEnd()}\n`;
    }
    lines.push(
      `**${summary.note || 'LIVE GEMINI NOT MEASURED — live calls have not been run.'}**`,
      `Logical case calls: ${outcomes?.logicalCaseCalls || 0}; provider request attempts: ${outcomes?.providerRequestAttempts || 0}; provider response attempts: ${outcomes?.providerResponseAttempts || 0}; no-response rate: ${fmtRatio(outcomes?.providerNoResponseRate)}.`,
      ''
    );
  } else {
    const metrics = summary.semanticMetrics;
    lines.push(
      `Unique cases: ${summary.uniqueCaseCount}; logical case calls: ${summary.logicalCaseCalls}; provider request attempts: ${summary.providerRequestAttempts}; provider response attempts: ${summary.providerResponseAttempts}; final valid interpretations: ${summary.validInterpretations}.`,
      `Provider attempt failures: ${summary.providerFailures}; rate limited (429): ${summary.rateLimitedAttempts}; final provider-error cases: ${summary.finalProviderErrorCases}; final rate-limited cases: ${summary.finalRateLimitedCases}.`,
      `Provider request attempts by runtime: ${Object.entries(summary.providerAttemptCountsByRuntime || {}).map(([runtime, count]) => `${runtime}: ${count}`).join('; ') || 'n/a'}.`,
      `Issue recall: ${fmtRatio(metrics.issueRecall)}; issue precision: ${fmtRatio(metrics.issuePrecision)}; omission rate: ${fmtRatio(metrics.omissionRate)}.`,
      `Authority: ${fmtRatio(metrics.governingAuthorityAccuracy)}; contextual authority: ${fmtRatio(metrics.contextualAuthorityAccuracy)}; domain: ${fmtRatio(metrics.domainAccuracy)}; population: ${fmtRatio(metrics.populationAccuracy)}; operation: ${fmtRatio(metrics.operationAccuracy)}.`,
      `Complete-question issue coverage: ${fmtRatio(metrics.completeQuestionIssueCoverage)}; final workstream-set accuracy: ${fmtRatio(metrics.finalWorkstreamSetAccuracy)}; valid interpretation rate: ${fmtRatio(metrics.validInterpretationRate)}; invalid/timeout/fallback rate: ${fmtRatio(metrics.invalidTimeoutFallbackRate)}.`,
      `Runtime routing/evidence-guard correctness: ${fmtRatio(summary.downstreamRoutingEvidenceGuardCorrectness)} (n=${summary.downstreamBehavioralDenominator || 0}); this does not score substantive answer correctness.`,
      `Semantic latency (ms): median ${summary.latencyMs.median}, p95 ${summary.latencyMs.p95}, max ${summary.latencyMs.max}; timeouts ${summary.latencyMs.timeouts}.`,
      ''
    );
    if (summary.note) lines.push(`**${summary.note}**`, '');
    lines.push('## Failure taxonomy', '', ...FAILURE_TAXONOMY.map(code => `- ${code}: ${summary.taxonomyFailureCounts[code] || 0}`), '');
    lines.push('## Provider attempt outcomes', '', ...Object.entries(summary.providerAttemptOutcomeCounts || {}).map(([outcome, count]) => `- ${outcome}: ${count}`), '');
    lines.push('## Per-call results', '', '| Run | Case | Checkpoint | Attempts | Last provider status | Issue recall | Issue precision | Workstream set | Taxonomy |', '|---|---|---|---:|---|---:|---:|---|---|');
    for (const row of report.calls) {
      const pending = row.pendingEvaluation;
      const metrics = pending ? undefined : row.metrics;
      const attemptCount = (row.attempts?.length || 0) + Number(Boolean(pending?.attempt));
      const checkpoint = pending ? `PENDING: ${pending.status}` : 'FINALIZED';
      const providerStatus = pending?.attempt?.providerStatus ?? (pending ? '—' : row.providerStatus ?? '—');
      const workstreamResult = pending ? 'PENDING' : metrics ? metrics.finalWorkstreamSetAccuracy ? 'PASS' : 'FAIL' : 'N/A';
      const taxonomy = pending ? 'pending finalization' : row.failureTaxonomies?.join(', ') || '—';
      lines.push(`| ${row.runId} | ${row.caseId} | ${checkpoint} | ${attemptCount} | ${providerStatus} | ${fmtRatio(metrics?.issueRecall)} | ${fmtRatio(metrics?.issuePrecision)} | ${workstreamResult} | ${taxonomy} |`);
    }
    lines.push('', '## Repeated A–D workstream stability', '');
    const stability = summary.repeatedOriginalCaseStability;
    lines.push(`Observed/planned valid outputs: ${stability.observedTotal}/${stability.plannedTotal}; assessed cases: ${stability.assessedCases}/${stability.cases}; stable: ${stability.stableCases}; changed: ${stability.changedCases.map(item => item.caseId).join(', ') || 'none'}.`, '');
    if (stability.unassessedCases.length) lines.push(`Unassessed cases: ${stability.unassessedCases.map(item => `${item.caseId} (${item.observedCount}/${item.plannedCount})`).join(', ')}.`, '');
    for (const item of stability.changedCases) lines.push(`- ${item.caseId}: ${item.runSets.map(set => `${set.runId}=[${set.workstreams.join(', ')}]`).join('; ')}`);
    if (stability.changedCases.length) lines.push('');
    lines.push('## Per-call detail', '');
    for (const row of report.calls) {
      const pending = row.pendingEvaluation;
      const attemptHistory = [...(row.attempts || []), ...(pending?.attempt ? [pending.attempt] : [])];
      const status = pending ? `PENDING_LOCAL_FINALIZATION (${pending.status})` : 'FINALIZED';
      const providerCategory = pending ? pending.providerCategory || 'pending finalization' : row.providerCategory || 'none';
      const providerStatus = pending ? pending.attempt?.providerStatus ?? 'n/a' : row.providerStatus ?? 'n/a';
      const latency = pending ? pending.attempt?.latencyMs ?? 'n/a' : row.latencyMs ?? 'n/a';
      lines.push(`### ${row.runId} — ${row.caseId}`, '', `Question: ${row.question}`, '',
        `Checkpoint: ${status}; valid: ${pending ? 'not finalized' : row.interpretationValid}; final outcome: ${pending ? 'not finalized' : row.semanticFailure || 'PROVIDER_RESPONSE'}; provider category: ${providerCategory}; HTTP status: ${providerStatus}; attempts: ${attemptHistory.length}; latency: ${latency} ms.`,
        `Workstreams: ${pending ? 'not finalized' : row.finalWorkstreams?.join(', ') || 'none'}.`,
        `Attempt history: ${attemptHistory.map(attempt => `#${attempt.attempt} ${attempt.outcome}${attempt.providerStatus ? ` (HTTP ${attempt.providerStatus})` : ''}`).join('; ') || 'not recorded'}.`,
        `Failures: ${pending ? 'pending finalization' : row.failureTaxonomies?.join(', ') || 'none'}.`, '');
    }
  }
  if (summary.testedCommit || summary.semanticInterpreterSha256) {
    lines.push('## Tested source', '');
    if (summary.testedCommit) lines.push(`Commit: ${summary.testedCommit}.`);
    if (summary.semanticInterpreterSha256) lines.push(`Interpreter SHA-256: ${summary.semanticInterpreterSha256}.`);
    if (summary.initialEvaluationRuntime) lines.push(`Initial evaluation runtime: ${summary.initialEvaluationRuntime}.`);
    if (summary.runtime) lines.push(`Report-generation runtime: ${summary.runtime}.`);
    if (summary.providerAttemptCountsByRuntime) {
      lines.push(`Provider request attempts by runtime: ${Object.entries(summary.providerAttemptCountsByRuntime).map(([runtime, count]) => `${runtime}: ${count}`).join('; ') || 'none'}.`);
    }
    if (summary.promptChange) lines.push(`Prompt change: ${summary.promptChange}`);
    lines.push('');
  }
  lines.push('## Limits', '', ...summary.limitations.map(item => `- ${item}`), '');
  return `${lines.join('\n').trimEnd()}\n`;
}

function fmtRatio(value) {
  if (!value || typeof value !== 'object' || !Number.isFinite(value.rate)) return 'n/a';
  return `${value.correct}/${value.total} (${(value.rate * 100).toFixed(1)}%)`;
}

async function saveReport(report) {
  await mkdir(outputDirectory, { recursive: true });
  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (apiKey && json.includes(apiKey)) throw new Error('Refusing to persist output containing the configured credential.');
  const jsonTempPath = `${jsonPath}.${process.pid}.tmp`;
  const markdownTempPath = `${markdownPath}.${process.pid}.tmp`;
  await writeFile(jsonTempPath, json, 'utf8');
  await rename(jsonTempPath, jsonPath);
  await writeFile(markdownTempPath, markdownReport(report), 'utf8');
  await rename(markdownTempPath, markdownPath);
}

const apiKey = process.env.GEMINI_API_KEY?.trim();
if (!rescoreFrom && (!apiKey || apiKey.length <= 10)) {
  if (resumeRequested) {
    throw new Error('Cannot resume without a configured Gemini API key. Existing evaluation data was left unchanged.');
  }
  const note = !apiKey
    ? 'LIVE GEMINI NOT MEASURED — API key unavailable.'
    : 'LIVE GEMINI NOT MEASURED — configured API key is too short for the production interpreter; no call was attempted.';
  const report = { summary: emptySummary('NOT_MEASURED', note), calls: [] };
  await saveReport(report);
  console.log(report.summary.note);
  console.log(`Wrote ${path.relative(root, jsonPath)} and ${path.relative(root, markdownPath)}. No provider call was made.`);
  process.exit(0);
}

const contracts = fixture.issueContracts;
const cases = fixture.cases.map(item => {
  const contract = contracts[item.contract];
  const expected = item.expectedIssueIds
    ? item.expectedIssueIds.map(id => contract?.find(issue => issue.id === id))
    : contract;
  if (!contract || !expected || expected.some(issue => !issue)) throw new Error(`The case ${item.id} references a missing issue contract.`);
  const expectedWorkstreams = item.expectedWorkstreams || fixture.expectedWorkstreams?.[item.contract] || [];
  return { ...item, expected, expectedWorkstreams };
});
let calls = [];
let preservedSummaryMetadata = {};
let priorReportRuntime;
let initialEvaluationRuntime = process.version;
if (resumeRequested) {
  try {
    const priorReport = JSON.parse(await readFile(jsonPath, 'utf8'));
    if (priorReport.summary?.expectedModel !== MODEL || !Array.isArray(priorReport.calls)) {
      throw new Error('Existing report does not match this model and live case suite.');
    }
    calls = priorReport.calls;
    priorReportRuntime = priorReport.summary.runtime;
    initialEvaluationRuntime = priorReport.summary.initialEvaluationRuntime || priorReport.summary.runtime || process.version;
    for (const key of ['testedCommit', 'promptChange']) {
      if (priorReport.summary?.[key] !== undefined) preservedSummaryMetadata[key] = priorReport.summary[key];
    }
    preservedSummaryMetadata.initialEvaluationRuntime = initialEvaluationRuntime;
  } catch (error) {
    throw new Error(`Cannot resume the live evaluation report: ${error instanceof Error ? error.message : 'invalid report'}`);
  }
}
const completedCallKeys = new Set(calls.map(row => `${row.runId}\u0000${row.caseId}`));

const FINALIZED_RESULT_FIELDS = [
  'requestStartedAt', 'interpretationValid', 'providerResponseReceived', 'semanticFailure', 'providerStatus', 'providerCategory', 'latencyMs',
  'topLevel', 'issues', 'validatedInterpretation', 'deterministicReconciliation', 'plannedWorkstreams', 'finalWorkstreams', 'metrics',
  'semanticUnderstandingCorrect', 'downstreamBehavioralChecks', 'expectedIssueMatches', 'unmatchedModelIssueIndexes', 'runtimeFailure',
  'failureTaxonomies', 'providerFailure'
];

function clearFinalizedResultFields(row) {
  for (const field of FINALIZED_RESULT_FIELDS) delete row[field];
}

function ensureAttemptHistory(row) {
  if (Array.isArray(row.attempts)) {
    for (const attempt of row.attempts) {
      if (!attempt.runtime) attempt.runtime = attempt.attempt === 1 ? initialEvaluationRuntime : priorReportRuntime || initialEvaluationRuntime;
    }
    if (row.pendingEvaluation?.attempt && !row.pendingEvaluation.attempt.runtime) {
      const attempt = row.pendingEvaluation.attempt;
      attempt.runtime = attempt.attempt === 1 ? initialEvaluationRuntime : priorReportRuntime || initialEvaluationRuntime;
    }
    return row.attempts;
  }
  if (row.pendingEvaluation) {
    row.attempts = [];
    return row.attempts;
  }
  const failure = row.semanticFailure;
  const outcome = row.providerResponseReceived
    ? (row.interpretationValid ? 'VALID_INTERPRETATION' : failure || 'INVALID_RESPONSE')
    : failure || 'PROVIDER_ERROR';
  row.attempts = [{
    attempt: 1,
    requestStartedAt: row.requestStartedAt || null,
    providerRequestAttempted: row.callAttempted !== false,
    outcome,
    providerStatus: Number.isInteger(row.providerStatus) ? row.providerStatus : null,
    providerCategory: row.providerCategory || (failure === 'PROVIDER_ERROR' ? 'STATUS_UNAVAILABLE' : null),
    runtime: initialEvaluationRuntime
  }];
  return row.attempts;
}

for (const row of calls) {
  ensureAttemptHistory(row);
  if (row.pendingEvaluation) clearFinalizedResultFields(row);
}
let coldStartGuardPending = calls.length > 0 && !calls.some(row => [
  ...ensureAttemptHistory(row),
  ...(row.pendingEvaluation?.attempt ? [row.pendingEvaluation.attempt] : [])
].some(attempt => Number.isFinite(Date.parse(attempt.requestStartedAt || ''))));

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function lastProviderRequestStart() {
  let latest = 0;
  for (const row of calls) {
    for (const attempt of [
      ...ensureAttemptHistory(row),
      ...(row.pendingEvaluation?.attempt ? [row.pendingEvaluation.attempt] : [])
    ]) {
      const timestamp = Date.parse(attempt.requestStartedAt || '');
      if (Number.isFinite(timestamp)) latest = Math.max(latest, timestamp);
    }
  }
  return latest;
}

async function waitForRequestSlot(eligibleAt = 0) {
  const now = Date.now();
  const lastStart = lastProviderRequestStart();
  const waitMs = Math.max(eligibleAt - now, lastStart ? lastStart + minimumIntervalMs + REQUEST_START_GUARD_MS - now : 0);
  if (waitMs > 0) await delay(waitMs);
}

function outcomeForAttempt(understanding, valid, providerResponseReceived) {
  if (understanding?.failure === 'RATE_LIMITED') return 'RATE_LIMITED';
  if (understanding?.failure === 'PROVIDER_ERROR') return 'PROVIDER_ERROR';
  if (understanding?.failure) return understanding.failure;
  return providerResponseReceived && valid ? 'VALID_INTERPRETATION' : 'PROVIDER_RESPONSE';
}

function providerCategoryFor(understanding) {
  if (Number.isInteger(understanding?.providerStatus)) {
    return understanding.providerStatus === 429 ? 'HTTP_429_RATE_LIMITED' : `HTTP_${understanding.providerStatus}`;
  }
  if (understanding?.failure === 'RATE_LIMITED') return 'RATE_LIMIT_STATUS_UNAVAILABLE';
  if (understanding?.failure === 'PROVIDER_ERROR') return 'STATUS_UNAVAILABLE';
  return undefined;
}

function sameSet(actual, expected) {
  return Array.isArray(actual) && Array.isArray(expected) && actual.length === expected.length &&
    [...actual].sort().every((item, index) => item === [...expected].sort()[index]);
}

function ratio(correct, total) {
  return { correct, total, rate: total ? correct / total : null };
}

function scoreCall(testCase, semanticIssues, expectedByActual, issuePlan, finalWorkstreams) {
  const expectedIssues = testCase.expected;
  let authorityCorrect = 0, contextualCorrect = 0, domainCorrect = 0, populationCorrect = 0, operationCorrect = 0;
  const matched = [];
  const statuses = issuePlan.issues;
  for (const [actualIndex, expectedIndex] of expectedByActual) {
    const actual = semanticIssues[actualIndex];
    const expected = expectedIssues[expectedIndex];
    const { governingAuthority: authority, contextualAuthority: contextual, domain, population, operation } = scoreIssueDimensions(actual, expected);
    const deterministic = statuses[actualIndex];
    authorityCorrect += Number(authority);
    contextualCorrect += Number(contextual);
    domainCorrect += Number(domain);
    populationCorrect += Number(population);
    operationCorrect += Number(operation);
    matched.push({
      expectedIssueId: expected.id,
      modelIssueIndex: actualIndex,
      subject: actual.subject,
      semanticDimensions: { governingAuthority: authority, contextualAuthority: contextual, domain, population, operation },
      modelTopicHints: actual.mappedTopicIds,
      deterministicMappedTopicIds: deterministic?.mappedTopicIds || [],
      reconciliationStatus: deterministic?.status || 'NOT_RECONCILED',
      unresolvedReason: deterministic?.unresolvedReason
    });
  }
  const matchedCount = expectedByActual.size;
  const expectedCount = expectedIssues.length;
  const actualCount = semanticIssues.length;
  const plannedKeys = finalWorkstreams.map(stream => `${stream.authority}/${stream.domain}`).sort();
  const expectedWorkstreamSets = testCase.expectedWorkstreamsAnyOf || [testCase.expectedWorkstreams];
  const exactWorkstreams = expectedWorkstreamSets.some(expected => sameSet(plannedKeys, expected));
  const expectedKeys = expectedWorkstreamSets[0].slice().sort();
  const completeQuestionIssueCoverage = matchedCount === expectedCount && matchedCount === actualCount;
  const metrics = {
    issueRecall: ratio(matchedCount, expectedCount),
    issuePrecision: ratio(matchedCount, actualCount),
    governingAuthorityAccuracy: ratio(authorityCorrect, matchedCount),
    contextualAuthorityAccuracy: ratio(contextualCorrect, matchedCount),
    domainAccuracy: ratio(domainCorrect, matchedCount),
    populationAccuracy: ratio(populationCorrect, matchedCount),
    operationAccuracy: ratio(operationCorrect, matchedCount),
    finalWorkstreamSetAccuracy: exactWorkstreams,
    completeQuestionIssueCoverage,
    omissionRate: ratio(expectedCount - matchedCount, expectedCount)
  };
  const semanticCorrect = matchedCount === expectedCount && matchedCount === actualCount &&
    authorityCorrect === matchedCount && contextualCorrect === matchedCount && domainCorrect === matchedCount &&
    populationCorrect === matchedCount && operationCorrect === matchedCount;
  return { metrics, matched, semanticCorrect, expectedWorkstreamKeys: expectedKeys, actualWorkstreamKeys: plannedKeys };
}

function downstreamBehavioralChecks(semanticIssues, issuePlan, runtime) {
  if (!runtime || !issuePlan) return undefined;
  const residuals = issuePlan.issues.filter(issue => issue.unresolvedReason === 'UNASSIGNED_QUERY_TOPIC');
  const incompletePlan = !issuePlan.coverageEstablished || issuePlan.hasUnmappedResidual ||
    issuePlan.issues.some(issue => issue.status === 'UNRESOLVED');
  const runtimeIssues = runtime.workstreams.flatMap(stream => stream.issues);
  const residualNoRequestedWorkstream = residuals.every(residual =>
    !runtimeIssues.some(issue => issue.issueId === residual.id));
  const incompletePlanNotVerified = !incompletePlan || runtime.status !== 'VERIFIED' && runtime.evidenceStatus !== 'VERIFIED';
  const reconciledIssues = issuePlan.issues.slice(0, semanticIssues.length);
  const operationsPreserved = semanticIssues.every((issue, index) => reconciledIssues[index]?.operation === issue.operation) &&
    runtimeIssues.every(runtimeIssue => {
      const source = reconciledIssues.find(issue => issue.id === runtimeIssue.issueId);
      return !source || source.operation === runtimeIssue.operation;
    });
  const caseSpecificOperations = new Set(['CALCULATE', 'PREPARE_JOURNAL', 'CHECK_ELIGIBILITY']);
  const requiresCaseFacts = semanticIssues.every((issue, index) => {
    if (!caseSpecificOperations.has(issue.operation) || issue.domain === 'UNKNOWN') return true;
    return reconciledIssues[index]?.evidenceRequirement === 'AUTHORITATIVE_SOURCE_AND_CASE_FACTS';
  });
  return {
    residualNoRequestedWorkstream,
    incompletePlanNotVerified,
    operationsPreserved,
    requiresCaseFacts,
    correct: residualNoRequestedWorkstream && incompletePlanNotVerified && operationsPreserved && requiresCaseFacts
  };
}

function taxonomyFor(testCase, understanding, interpretation, semanticIssues, issuePlan, score, runtimeFailed) {
  const taxonomy = new Set();
  if (!interpretation) {
    if (understanding?.failure === 'TIMEOUT') taxonomy.add('MODEL_TIMEOUT');
    else if (understanding?.failure === 'INVALID_RESPONSE' || understanding?.failure === 'LOW_CONFIDENCE') taxonomy.add('MODEL_INVALID_SCHEMA');
    return [...taxonomy];
  }
  if (score.metrics.issueRecall.total > 0 && score.metrics.issueRecall.rate < 1) taxonomy.add('MODEL_OMISSION');
  if (score.metrics.issuePrecision.total > 0 && score.metrics.issuePrecision.rate < 1) taxonomy.add('MODEL_FALSE_ISSUE');
  if ((score.metrics.governingAuthorityAccuracy.total > 0 && score.metrics.governingAuthorityAccuracy.rate < 1) ||
      (score.metrics.contextualAuthorityAccuracy.total > 0 && score.metrics.contextualAuthorityAccuracy.rate < 1)) taxonomy.add('MODEL_WRONG_AUTHORITY');
  if (score.metrics.domainAccuracy.total > 0 && score.metrics.domainAccuracy.rate < 1) taxonomy.add('MODEL_WRONG_DOMAIN');
  if (score.metrics.populationAccuracy.total > 0 && score.metrics.populationAccuracy.rate < 1) taxonomy.add('MODEL_WRONG_POPULATION');
  if (score.metrics.operationAccuracy.total > 0 && score.metrics.operationAccuracy.rate < 1) taxonomy.add('MODEL_WRONG_OPERATION');
  for (const [actualIndex, expectedIndex] of score.matched.map(item => [item.modelIssueIndex, testCase.expected.findIndex(contract => contract.id === item.expectedIssueId)])) {
    const expected = testCase.expected[expectedIndex];
    const reconciled = issuePlan.issues[actualIndex];
    if (!reconciled || !sameSet(reconciled.governingAuthorities, expected.governingAuthorities) ||
        !expected.domain.includes(reconciled.domain) || !expected.population.includes(reconciled.population)) {
      taxonomy.add('RECONCILIATION_REJECTION');
    } else if (reconciled.status === 'UNRESOLVED' && reconciled.unresolvedReason === 'NO_COVERAGE_TOPIC' &&
        score.matched.find(item => item.modelIssueIndex === actualIndex)?.semanticDimensions.governingAuthority &&
        score.matched.find(item => item.modelIssueIndex === actualIndex)?.semanticDimensions.domain &&
        score.matched.find(item => item.modelIssueIndex === actualIndex)?.semanticDimensions.population) {
      taxonomy.add('TAXONOMY_MAPPING_GAP');
    }
  }
  const semanticsAndReconciliationMatch = score.semanticCorrect && issuePlan.issues.every((issue, index) => {
    const matched = score.matched.find(item => item.modelIssueIndex === index);
    if (!matched) return issue.unresolvedReason === 'UNASSIGNED_QUERY_TOPIC';
    const expected = testCase.expected.find(contract => contract.id === matched.expectedIssueId);
    return sameSet(issue.governingAuthorities, expected.governingAuthorities) && expected.domain.includes(issue.domain) &&
      expected.population.includes(issue.population);
  });
  if (semanticsAndReconciliationMatch && (runtimeFailed || !score.metrics.finalWorkstreamSetAccuracy)) taxonomy.add('RUNTIME_ROUTING_FAILURE');
  for (const code of [...taxonomy]) if (!FAILURE_TAXONOMY.includes(code)) taxonomy.delete(code);
  return [...taxonomy];
}

function plainIssue(issue, reconciled, index) {
  return {
    index,
    subject: issue.subject,
    population: issue.population,
    domain: issue.domain,
    governingAuthorities: issue.governingAuthorities,
    contextualAuthorities: issue.contextualAuthorities,
    operation: issue.operation,
    modelTopicHints: issue.mappedTopicIds,
    deterministicMappedTopicIds: reconciled?.mappedTopicIds || [],
    reconciliationStatus: reconciled?.status || 'NOT_RECONCILED',
    unresolvedReason: reconciled?.unresolvedReason,
    evidenceRequirement: issue.evidenceRequirement,
    confidence: issue.confidence
  };
}

function summarizeAll(rows) {
  const finalizedRows = rows.filter(row => !row.pendingEvaluation);
  const metricRows = finalizedRows.filter(row => row.metrics);
  const averageRatio = key => {
    const correct = metricRows.reduce((sum, row) => sum + (row.metrics[key]?.correct || 0), 0);
    const total = metricRows.reduce((sum, row) => sum + (row.metrics[key]?.total || 0), 0);
    return ratio(correct, total);
  };
  const exactRate = key => ratio(metricRows.filter(row => row.metrics[key] === true).length, metricRows.length);
  const calls = rows.length;
  const pendingLocalFinalizationCalls = rows.filter(row => Boolean(row.pendingEvaluation)).length;
  const attempts = rows.flatMap(row => [
    ...ensureAttemptHistory(row),
    ...(row.pendingEvaluation?.attempt ? [row.pendingEvaluation.attempt] : [])
  ]);
  const requestAttempts = attempts.filter(attempt => attempt.providerRequestAttempted !== false);
  const providerAttemptCountsByRuntime = Object.fromEntries([...new Set(requestAttempts.map(attempt => attempt.runtime || 'UNKNOWN'))]
    .map(runtime => [runtime, requestAttempts.filter(attempt => (attempt.runtime || 'UNKNOWN') === runtime).length]));
  const outcomeCounts = Object.fromEntries([...new Set(attempts.map(attempt => attempt.outcome || 'UNKNOWN'))]
    .map(outcome => [outcome, attempts.filter(attempt => attempt.outcome === outcome).length]));
  const responseAttempts = attempts.filter(attempt => !NO_RESPONSE_FAILURES.has(attempt.outcome));
  // Logical-call completeness follows the latest provider outcome; historical responses remain in attempt counts.
  const responseRows = rows.filter(row => row.pendingEvaluation
    ? row.pendingEvaluation.status === 'PROVIDER_RESPONSE_RECEIVED'
    : row.providerResponseReceived);
  const validRows = finalizedRows.filter(row => row.interpretationValid && row.metrics);
  const durations = attempts.filter(attempt => !NO_RESPONSE_FAILURES.has(attempt.outcome))
    .map(attempt => attempt.latencyMs).filter(Number.isFinite).sort((a, b) => a - b);
  const originalCases = fixture.cases.filter(item => item.runGroup === 'originalABCD');
  const assessedOriginals = originalCases.map(testCase => {
    const repeated = rows.filter(row => row.caseId === testCase.id && row.runGroup === 'originalABCD');
    const observations = repeated.filter(row => !row.pendingEvaluation && row.interpretationValid && row.metrics);
    const plannedCount = fixture.runs.originalABCD;
    const assessed = observations.length === plannedCount;
    const sets = [...new Set(observations.map(row => row.finalWorkstreams.slice().sort().join('|')))];
    return {
      caseId: testCase.id,
      observedCount: observations.length,
      attemptedCount: repeated.length,
      plannedCount,
      assessed,
      ...(assessed && sets.length > 1 ? { runSets: observations.map(row => ({ runId: row.runId, workstreams: row.finalWorkstreams })) } : {})
    };
  });
  const changedCases = assessedOriginals.filter(item => item.assessed && item.runSets);
  const unassessedCases = assessedOriginals.filter(item => !item.assessed).map(({ caseId, observedCount, plannedCount, attemptedCount }) => ({ caseId, observedCount, plannedCount, attemptedCount }));
  const failureCounts = Object.fromEntries(FAILURE_TAXONOMY.map(code => [code, finalizedRows.filter(row => row.failureTaxonomies?.includes(code)).length]));
  const semanticFallbackOutcomes = new Set(['INVALID_RESPONSE', 'LOW_CONFIDENCE', 'TIMEOUT']);
  const fallbackCount = attempts.filter(attempt => semanticFallbackOutcomes.has(attempt.outcome)).length;
  const timeouts = attempts.filter(attempt => attempt.outcome === 'TIMEOUT').length;
  const providerFailureCounts = Object.fromEntries(['PROVIDER_ERROR', 'RATE_LIMITED', 'NO_PROVIDER', 'TIMEOUT', 'QUERY_TOO_LONG']
    .map(failure => [failure, outcomeCounts[failure] || 0]));
  const finalProviderErrorCases = finalizedRows.filter(row => row.semanticFailure === 'PROVIDER_ERROR').length;
  const finalRateLimitedCases = finalizedRows.filter(row => row.semanticFailure === 'RATE_LIMITED').length;
  const noResponseAttempts = requestAttempts.filter(attempt => NO_RESPONSE_FAILURES.has(attempt.outcome)).length;
  const plannedCalls = fixture.runs.originalABCD * fixture.cases.filter(item => item.runGroup === 'originalABCD').length +
    fixture.runs.paraphrasesAndAdversarial * fixture.cases.filter(item => item.runGroup === 'expanded').length;
  const complete = rows.length === plannedCalls;
  const measured = responseAttempts.length > 0;
  const providerComplete = responseRows.length === plannedCalls;
  const summary = emptySummary(measured ? 'MEASURED' : 'NOT_MEASURED', measured
    ? pendingLocalFinalizationCalls
      ? `Live measurement is partial: ${pendingLocalFinalizationCalls} provider result(s) are checkpointed and await local finalization.`
      : !providerComplete ? `Live measurement is partial: ${responseRows.length}/${plannedCalls} logical case calls have a provider response; request-attempt failures are reported separately.` : undefined
    : 'LIVE GEMINI NOT MEASURED — no provider response was obtained; logical case calls and request attempts are recorded.');
  summary.measurementStatus = measured ? (complete && providerComplete && pendingLocalFinalizationCalls === 0 ? 'COMPLETE' : 'PARTIAL') : 'NOT_MEASURED';
  summary.mode = measured
    ? (complete && providerComplete && pendingLocalFinalizationCalls === 0 ? 'LIVE_GEMINI_SEMANTIC_AND_LOCAL_AUTHORITY_WORKSTREAMS' : 'LIVE_GEMINI_SEMANTIC_AND_LOCAL_AUTHORITY_WORKSTREAMS_PARTIAL')
    : 'LIVE_SEMANTIC_NOT_MEASURED';
  summary.liveCalls = calls;
  summary.logicalCaseCalls = calls;
  summary.providerRequestAttempts = requestAttempts.length;
  summary.providerResponseAttempts = responseAttempts.length;
  summary.initialEvaluationRuntime = initialEvaluationRuntime;
  summary.providerAttemptCountsByRuntime = providerAttemptCountsByRuntime;
  summary.uniqueCaseCount = fixture.cases.length;
  summary.modelResponses = responseAttempts.length;
  summary.validInterpretations = validRows.length;
  summary.providerFailures = providerFailureCounts.PROVIDER_ERROR;
  summary.rateLimitedAttempts = providerFailureCounts.RATE_LIMITED;
  summary.finalProviderErrorCases = finalProviderErrorCases;
  summary.finalRateLimitedCases = finalRateLimitedCases;
  summary.noResponseCalls = noResponseAttempts;
  summary.invalidResponseCount = finalizedRows.filter(row => row.semanticFailure === 'INVALID_RESPONSE' || row.semanticFailure === 'LOW_CONFIDENCE').length;
  summary.totalCaseCalls = rows.length;
  summary.pendingLocalFinalizationCalls = pendingLocalFinalizationCalls;
  summary.plannedCaseCalls = plannedCalls;
  summary.allCallsAttempted = complete;
  summary.suiteComplete = complete && providerComplete && pendingLocalFinalizationCalls === 0;
  summary.providerComplete = providerComplete;
  summary.callOutcomes = {
    logicalCaseCalls: calls,
    providerRequestAttempts: requestAttempts.length,
    providerResponseAttempts: responseAttempts.length,
    validInterpretations: validRows.length,
    noResponseAttempts,
    invalidTimeoutFallbackCalls: fallbackCount,
    providerFailureCounts,
    providerAttemptOutcomeCounts: outcomeCounts,
    providerAttemptCountsByRuntime,
    providerNoResponseRate: ratio(noResponseAttempts, requestAttempts.length),
    invalidTimeoutFallbackRate: ratio(fallbackCount, requestAttempts.length)
  };
  summary.semanticMetrics = measured ? {
      issueRecall: averageRatio('issueRecall'),
      issuePrecision: averageRatio('issuePrecision'),
      governingAuthorityAccuracy: averageRatio('governingAuthorityAccuracy'),
      contextualAuthorityAccuracy: averageRatio('contextualAuthorityAccuracy'),
      domainAccuracy: averageRatio('domainAccuracy'),
      populationAccuracy: averageRatio('populationAccuracy'),
      operationAccuracy: averageRatio('operationAccuracy'),
      finalWorkstreamSetAccuracy: exactRate('finalWorkstreamSetAccuracy'),
      completeQuestionIssueCoverage: ratio(finalizedRows.filter(row => row.metrics?.completeQuestionIssueCoverage).length, calls),
      omissionRate: averageRatio('omissionRate'),
      workstreamRoutingAccuracy: exactRate('finalWorkstreamSetAccuracy'),
      qualityCallDenominator: metricRows.length,
      validInterpretationRate: ratio(validRows.length, calls),
      invalidTimeoutFallbackRate: ratio(fallbackCount, requestAttempts.length),
      semanticUnderstandingCorrect: ratio(validRows.filter(row => row.semanticUnderstandingCorrect).length, validRows.length)
    } : null;
  const behavioralRows = finalizedRows.filter(row => row.downstreamBehavioralChecks);
  summary.downstreamBehavioralDenominator = behavioralRows.length;
  summary.downstreamRoutingEvidenceGuardCorrectness = behavioralRows.length
    ? ratio(behavioralRows.filter(row => row.downstreamBehavioralChecks.correct).length, behavioralRows.length)
    : null;
  summary.taxonomyFailureCounts = failureCounts;
  summary.providerFailureCounts = providerFailureCounts;
  summary.providerAttemptOutcomeCounts = outcomeCounts;
  summary.latencyMs = durations.length ? {
    median: durations[Math.floor(durations.length / 2)],
    p95: durations[Math.min(durations.length - 1, Math.ceil(durations.length * 0.95) - 1)],
    max: durations.at(-1),
    timeouts
  } : { median: null, p95: null, max: null, timeouts };
  summary.repeatedOriginalCaseStability = {
    cases: originalCases.length,
    observedTotal: assessedOriginals.reduce((sum, item) => sum + item.observedCount, 0),
    plannedTotal: originalCases.length * fixture.runs.originalABCD,
    assessedCases: assessedOriginals.filter(item => item.assessed).length,
    stableCases: assessedOriginals.filter(item => item.assessed).length - changedCases.length,
    changedCases,
    unassessedCases
  };
  summary.evaluatedAt = new Date().toISOString();
  return summary;
}

async function writeMeasuredReport() {
  const source = await readFile(interpreterSourcePath);
  const summary = {
    ...summarizeAll(calls),
    ...preservedSummaryMetadata,
    initialEvaluationRuntime: preservedSummaryMetadata.initialEvaluationRuntime || initialEvaluationRuntime,
    semanticInterpreterSha256: createHash('sha256').update(source).digest('hex'),
    runtime: process.version
  };
  const report = { summary, calls };
  await saveReport(report);
  return report;
}

function replaceCallRow(row) {
  const key = `${row.runId}\u0000${row.caseId}`;
  const existingIndex = calls.findIndex(item => `${item.runId}\u0000${item.caseId}` === key);
  if (existingIndex >= 0) calls[existingIndex] = row;
  else calls.push(row);
  completedCallKeys.add(key);
}

async function finalizePendingEvaluation(checkpointRow, testCase) {
  const pending = checkpointRow.pendingEvaluation;
  if (!pending) return checkpointRow;
  const understanding = {
    mode: pending.mode,
    ...(pending.failure ? { failure: pending.failure } : {}),
    ...(Number.isInteger(pending.providerStatus) ? { providerStatus: pending.providerStatus } : {}),
    ...(pending.interpretation ? { interpretation: pending.interpretation } : {})
  };
  const interpretation = understanding.interpretation;
  const semanticIssues = interpretation?.issues || [];
  let reconciled;
  let planned = [];
  let built = [];
  let runtime;
  let runtimeFailure;
  try {
    reconciled = reconcileQuestionUnderstanding(testCase.question, classifyQuestion(testCase.question), understanding);
    planned = planAuthorityWorkstreams(reconciled.issuePlan).map(stream => `${stream.authority}/${stream.domain}`);
    runtime = await buildAuthorityWorkstreams(testCase.question, reconciled.issuePlan, {
      localOnly: true,
      questionUnderstanding: understanding
    });
    built = runtime.workstreams.map(stream => `${stream.authority}/${stream.domain}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown runtime failure.';
    runtimeFailure = apiKey ? message.replaceAll(apiKey, '[REDACTED]') : message;
  }
  const issuePlan = reconciled?.issuePlan || { issues: [] };
  const providerResponseReceived = pending.status === 'PROVIDER_RESPONSE_RECEIVED';
  const valid = Boolean(interpretation) && understanding.mode === 'SEMANTIC_INTERPRETATION' && !understanding.failure;
  const { expectedByActual } = matchIssues(testCase.expected, semanticIssues);
  const scoredCase = scoreCall(testCase, semanticIssues, expectedByActual, issuePlan, built.map(key => {
    const [authority, domain] = key.split('/'); return { authority, domain };
  }));
  const attemptHistory = ensureAttemptHistory(checkpointRow).slice();
  const attempt = pending.attempt;
  const semanticFailure = pending.failure;
  const providerCategory = pending.providerCategory || undefined;
  const finalRow = {
    runId: checkpointRow.runId,
    runGroup: testCase.runGroup,
    caseId: testCase.id,
    model: MODEL,
    question: testCase.question,
    interpretationValid: valid,
    providerResponseReceived,
    callAttempted: true,
    requestStartedAt: attempt.requestStartedAt,
    semanticFailure,
    rateLimitFailureCount: pending.rateLimitFailureCount,
    nextRetryAt: pending.nextRetryAt,
    ...(checkpointRow.retryReason ? { retryReason: checkpointRow.retryReason } : {}),
    providerStatus: attempt.providerStatus || undefined,
    providerCategory,
    latencyMs: attempt.latencyMs,
    topLevel: interpretation ? {
      jurisdiction: interpretation.jurisdiction,
      domain: interpretation.domain,
      population: interpretation.population,
      authorityCandidates: interpretation.authorityCandidates,
      contextualAuthorities: interpretation.contextualAuthorities,
      primarySubject: interpretation.primarySubject,
      requestedOperation: interpretation.requestedOperation,
      requiresUserSpecificFacts: interpretation.requiresUserSpecificFacts,
      calculationRequested: interpretation.calculationRequested
    } : null,
    issues: semanticIssues.map((issue, index) => plainIssue(issue, issuePlan.issues[index], index)),
    validatedInterpretation: interpretation || null,
    deterministicReconciliation: {
      source: issuePlan.source,
      coverageEstablished: issuePlan.coverageEstablished,
      hasUnmappedResidual: issuePlan.hasUnmappedResidual,
      issues: issuePlan.issues.map(issue => ({
        id: issue.id,
        subject: issue.subject,
        population: issue.population,
        domain: issue.domain,
        governingAuthorities: issue.governingAuthorities,
        contextualAuthorities: issue.contextualAuthorities,
        operation: issue.operation,
        deterministicMappedTopicIds: issue.mappedTopicIds,
        reconciliationStatus: issue.status,
        unresolvedReason: issue.unresolvedReason
      }))
    },
    plannedWorkstreams: planned,
    finalWorkstreams: built,
    metrics: valid ? scoredCase.metrics : null,
    semanticUnderstandingCorrect: valid && scoredCase.semanticCorrect,
    downstreamBehavioralChecks: downstreamBehavioralChecks(semanticIssues, issuePlan, runtime),
    expectedIssueMatches: scoredCase.matched,
    unmatchedModelIssueIndexes: semanticIssues.map((_, index) => index).filter(index => !expectedByActual.has(index)),
    runtimeFailure,
    failureTaxonomies: taxonomyFor(testCase, understanding, interpretation, semanticIssues, issuePlan, scoredCase, Boolean(runtimeFailure)),
    attempts: [...attemptHistory, attempt]
  };
  if (NO_RESPONSE_FAILURES.has(semanticFailure)) {
    finalRow.providerFailure = semanticFailure === 'RATE_LIMITED'
      ? 'Gemini rate limit (HTTP 429); response body withheld.'
      : 'No provider interpretation was received; response body withheld.';
  }
  return finalRow;
}

function validatedInterpretationFromSavedRow(row) {
  const persisted = validateSemanticQuestionInterpretation(row.validatedInterpretation);
  if (persisted) return { interpretation: persisted, reconstructed: false };
  if (!row.interpretationValid || !row.topLevel || !Array.isArray(row.issues)) return { reconstructed: false };
  const top = row.topLevel;
  const reconstructed = validateSemanticQuestionInterpretation({
    jurisdiction: ['Singapore'],
    authorityCandidates: top.authorityCandidates,
    contextualAuthorities: top.contextualAuthorities,
    domain: top.domain,
    population: top.population,
    primarySubject: top.primarySubject,
    concepts: [],
    requestedOperation: top.requestedOperation,
    requiresUserSpecificFacts: top.requiresUserSpecificFacts,
    calculationRequested: top.calculationRequested,
    factsExplicitlyProvided: [],
    confidence: 1,
    issues: row.issues.map(issue => ({
      subject: issue.subject,
      population: issue.population,
      domain: issue.domain,
      governingAuthorities: issue.governingAuthorities,
      contextualAuthorities: issue.contextualAuthorities || [],
      operation: issue.operation,
      mappedTopicIds: issue.modelTopicHints || [],
      evidenceRequirement: issue.evidenceRequirement || 'UNRESOLVED',
      confidence: issue.confidence
    }))
  });
  return reconstructed ? { interpretation: reconstructed, reconstructed: true } : { reconstructed: true };
}

function issuePlanFromSavedRow(row) {
  const saved = row.deterministicReconciliation;
  if (!saved || !Array.isArray(saved.issues)) return undefined;
  return {
    source: saved.source,
    coverageEstablished: Boolean(saved.coverageEstablished),
    hasUnmappedResidual: Boolean(saved.hasUnmappedResidual),
    issues: saved.issues.map(issue => ({
      ...issue,
      mappedTopicIds: issue.deterministicMappedTopicIds || [],
      status: issue.reconciliationStatus || 'UNRESOLVED'
    }))
  };
}

function ratioFromRows(rows, key) {
  const scored = rows.map(row => row.metrics?.[key]).filter(value => value && Number.isFinite(value.correct) && Number.isFinite(value.total));
  return ratio(scored.reduce((sum, value) => sum + value.correct, 0), scored.reduce((sum, value) => sum + value.total, 0));
}

async function rescoreSavedReport() {
  const savedPath = path.resolve(root, rescoreFrom);
  if (path.resolve(savedPath) === path.resolve(jsonPath)) throw new Error('Rescore output must not overwrite the saved source report.');
  const sourceReport = JSON.parse(await readFile(savedPath, 'utf8'));
  if (!Array.isArray(sourceReport.calls)) throw new Error('--rescore-from must point to a saved evaluation report with calls[].');
  const casesById = new Map(cases.map(testCase => [testCase.id, testCase]));
  let reconstructedCount = 0;
  const rescoredCalls = [];

  for (const row of sourceReport.calls) {
    const testCase = casesById.get(row.caseId);
    if (!testCase) {
      rescoredCalls.push({ ...row, rescoringNote: 'Case is absent from the selected fixture; saved scoring retained.' });
      continue;
    }
    const savedInterpretation = validatedInterpretationFromSavedRow(row);
    if (savedInterpretation.reconstructed) reconstructedCount += 1;
    const interpretation = savedInterpretation.interpretation;
    const semanticIssues = interpretation?.issues || [];
    let issuePlan = issuePlanFromSavedRow(row);
    let scoredWorkstreams = row.finalWorkstreams || [];
    let replayed = undefined;
    let behaviorChecks;

    if (reconcileSaved && interpretation) {
      const understanding = { mode: 'SEMANTIC_INTERPRETATION', interpretation };
      const reconciled = reconcileQuestionUnderstanding(testCase.question, classifyQuestion(testCase.question), understanding);
      issuePlan = reconciled.issuePlan;
      const planned = planAuthorityWorkstreams(issuePlan).map(stream => `${stream.authority}/${stream.domain}`);
      const runtime = await buildAuthorityWorkstreams(testCase.question, issuePlan, {
        localOnly: true,
        questionUnderstanding: understanding
      });
      scoredWorkstreams = runtime.workstreams.map(stream => `${stream.authority}/${stream.domain}`);
      behaviorChecks = downstreamBehavioralChecks(semanticIssues, issuePlan, runtime);
      replayed = {
        source: savedInterpretation.reconstructed ? 'RECONSTRUCTED_SAVED_VALIDATED_INTERPRETATION' : 'PERSISTED_VALIDATED_INTERPRETATION',
        coverageEstablished: issuePlan.coverageEstablished,
        hasUnmappedResidual: issuePlan.hasUnmappedResidual,
        plannedWorkstreams: planned,
        finalWorkstreams: scoredWorkstreams,
        evidenceStatus: runtime.evidenceStatus,
        status: runtime.status,
        gapCodes: [...new Set(runtime.gaps.map(gap => gap.code))]
      };
    }

    if (!issuePlan) issuePlan = { issues: [] };
    const { expectedByActual } = matchIssues(testCase.expected, semanticIssues);
    const scoredCase = scoreCall(testCase, semanticIssues, expectedByActual, issuePlan, scoredWorkstreams.map(key => {
      const [authority, domain] = key.split('/');
      return { authority, domain };
    }));
    const valid = Boolean(interpretation) && row.interpretationValid;
    const understandingForTaxonomy = interpretation
      ? { mode: 'SEMANTIC_INTERPRETATION', interpretation }
      : { mode: 'DETERMINISTIC_FALLBACK', ...(row.semanticFailure ? { failure: row.semanticFailure } : {}) };
    const correctedFailureTaxonomies = taxonomyFor(testCase, understandingForTaxonomy, interpretation,
      semanticIssues, issuePlan, scoredCase, Boolean(row.runtimeFailure));
    const nextRow = {
      ...row,
      originalScoring: {
        metrics: row.metrics || null,
        semanticUnderstandingCorrect: row.semanticUnderstandingCorrect,
        expectedIssueMatches: row.expectedIssueMatches,
        failureTaxonomies: row.failureTaxonomies || []
      },
      scoringFixture: path.relative(root, fixturePath),
      metrics: valid ? scoredCase.metrics : null,
      semanticUnderstandingCorrect: valid && scoredCase.semanticCorrect,
      failureTaxonomies: correctedFailureTaxonomies,
      expectedIssueMatches: scoredCase.matched,
      unmatchedModelIssueIndexes: semanticIssues.map((_, index) => index).filter(index => !expectedByActual.has(index)),
      expectedWorkstreamKeys: scoredCase.expectedWorkstreamKeys,
      scoredWorkstreams,
      ...(replayed ? { deterministicReplay: replayed } : {}),
      downstreamBehavioralChecks: behaviorChecks || null,
      ...(savedInterpretation.reconstructed ? { interpretationReconstructedForScoring: true } : {})
    };
    rescoredCalls.push(nextRow);
  }

  const rowsWithMetrics = rescoredCalls.filter(row => row.metrics);
  const attempts = sourceReport.calls.flatMap(row => row.attempts || []);
  const noResponseAttempts = attempts.filter(attempt => NO_RESPONSE_FAILURES.has(attempt.outcome)).length;
  const providerRequestAttempts = attempts.filter(attempt => attempt.providerRequestAttempted !== false).length;
  const providerResponseAttempts = attempts.filter(attempt => attempt.providerRequestAttempted !== false && !NO_RESPONSE_FAILURES.has(attempt.outcome)).length;
  const completeRows = rescoredCalls.filter(row => row.metrics?.completeQuestionIssueCoverage).length;
  const behavioralRows = rescoredCalls.filter(row => row.downstreamBehavioralChecks);
  const failureTaxonomyCounts = Object.fromEntries(FAILURE_TAXONOMY.map(code =>
    [code, rescoredCalls.filter(row => row.failureTaxonomies?.includes(code)).length]));
  const summary = {
    suite: fixture.suite,
    mode: reconcileSaved ? 'SAVED_RESPONSE_DETERMINISTIC_REPLAY' : 'SAVED_RESPONSE_RESCORE',
    modelUnderstandingMeasured: false,
    measurementStatus: 'RESCORED',
    model: sourceReport.summary?.model || sourceReport.summary?.expectedModel || MODEL,
    expectedModel: MODEL,
    sourceReport: path.relative(root, savedPath),
    sourceMeasurementStatus: sourceReport.summary?.measurementStatus || 'UNKNOWN',
    scoringFixture: path.relative(root, fixturePath),
    logicalCaseCalls: sourceReport.calls.length,
    providerRequestAttempts,
    providerResponseAttempts,
    validInterpretations: rowsWithMetrics.length,
    completeQuestionIssueCoverageCount: completeRows,
    reconstructedInterpretationCount: reconstructedCount,
    taxonomyFailureCounts: failureTaxonomyCounts,
    semanticMetrics: {
      issueRecall: ratioFromRows(rowsWithMetrics, 'issueRecall'),
      issuePrecision: ratioFromRows(rowsWithMetrics, 'issuePrecision'),
      governingAuthorityAccuracy: ratioFromRows(rowsWithMetrics, 'governingAuthorityAccuracy'),
      contextualAuthorityAccuracy: ratioFromRows(rowsWithMetrics, 'contextualAuthorityAccuracy'),
      domainAccuracy: ratioFromRows(rowsWithMetrics, 'domainAccuracy'),
      populationAccuracy: ratioFromRows(rowsWithMetrics, 'populationAccuracy'),
      operationAccuracy: ratioFromRows(rowsWithMetrics, 'operationAccuracy'),
      completeQuestionIssueCoverage: ratio(completeRows, rescoredCalls.length),
      workstreamRoutingAccuracy: ratio(rowsWithMetrics.filter(row => row.metrics.finalWorkstreamSetAccuracy).length, rowsWithMetrics.length),
      qualityCallDenominator: rowsWithMetrics.length
    },
    downstreamRoutingEvidenceGuardCorrectness: behavioralRows.length
      ? ratio(behavioralRows.filter(row => row.downstreamBehavioralChecks.correct).length, behavioralRows.length)
      : null,
    downstreamBehavioralDenominator: behavioralRows.length,
    callOutcomes: {
      logicalCaseCalls: sourceReport.calls.length,
      providerRequestAttempts,
      providerResponseAttempts,
      noResponseAttempts,
      providerNoResponseRate: ratio(noResponseAttempts, providerRequestAttempts)
    },
    note: reconcileSaved
      ? 'Deterministic replay uses saved validated interpretations. It is not a new model measurement or raw-provider replay.'
      : 'This report rescored saved validated interpretations and retained saved reconciliation, workstreams, and provider attempts. No model call was made.',
    limitations: [
      'This is a rescore of saved validated interpretations; raw model response bodies and schema failures are not reconstructed.',
      ...(reconstructedCount ? ['The source report did not persist the full validated JSON for every row; missing fields were reconstructed from saved top-level labels and issue records, so this is not a raw-model replay.'] : []),
      ...(reconcileSaved ? ['The optional deterministic replay reruns current reconciliation and local-only routing against saved interpretations; its outputs are separate from original saved workstreams.'] : ['Saved deterministic reconciliation and workstream outcomes were retained; this mode does not replay current routing code.']),
      'Workstream and evidence status measure routing and evidence guards only; they do not establish that an accounting or tax answer is substantively correct.'
    ]
  };
  await saveReport({ summary, calls: rescoredCalls });
  console.log(`Rescored ${sourceReport.calls.length} saved rows into ${path.relative(root, jsonPath)} and ${path.relative(root, markdownPath)}. No model call was made.`);
}

if (rescoreFrom) {
  await rescoreSavedReport();
  process.exit(0);
}

async function runCaseAttempt(testCase, runId, priorRow, eligibleAt = 0, retryReason) {
  await waitForRequestSlot(eligibleAt);
  if (coldStartGuardPending) {
    await delay(minimumIntervalMs + REQUEST_START_GUARD_MS);
    coldStartGuardPending = false;
  }
  const requestStartedAt = new Date().toISOString();
  let understanding;
  const interpreterStarted = performance.now();
  try {
    understanding = await interpretSemanticQuestion(testCase.question, apiKey);
  } catch {
    understanding = { mode: 'DETERMINISTIC_FALLBACK', failure: 'PROVIDER_ERROR' };
  }
  const completedAt = new Date();
  const interpreterDurationMs = Math.round(performance.now() - interpreterStarted);
  const attemptHistory = priorRow ? ensureAttemptHistory(priorRow).slice() : [];
  const providerResponseReceived = !NO_RESPONSE_FAILURES.has(understanding?.failure);
  const valid = Boolean(understanding?.interpretation) && understanding.mode === 'SEMANTIC_INTERPRETATION' && !understanding.failure;
  const semanticFailure = understanding?.failure;
  const providerCategory = providerCategoryFor(understanding);
  const attempt = {
    attempt: attemptHistory.length + 1,
    requestStartedAt,
    providerRequestAttempted: true,
    outcome: outcomeForAttempt(understanding, valid, providerResponseReceived),
    latencyMs: interpreterDurationMs,
    runtime: process.version,
    providerStatus: Number.isInteger(understanding?.providerStatus) ? understanding.providerStatus : null,
    providerCategory: providerCategory || null
  };
  const previousRateLimitCount = Math.max(
    priorRow?.rateLimitFailureCount || 0,
    attemptHistory.filter(previousAttempt => previousAttempt.outcome === 'RATE_LIMITED').length
  );
  const rateLimitFailureCount = semanticFailure === 'RATE_LIMITED' ? previousRateLimitCount + 1 : previousRateLimitCount;
  const nextRetryDelayMs = semanticFailure === 'RATE_LIMITED' && attemptHistory.length + 1 < MAX_ATTEMPTS_PER_CASE
    ? Math.min(MIN_GEMINI_INTERVAL_MS * 2 ** (rateLimitFailureCount - 1), 128_000)
    : null;
  const pendingEvaluation = {
    status: providerResponseReceived ? 'PROVIDER_RESPONSE_RECEIVED' : 'NO_PROVIDER_RESPONSE',
    mode: understanding?.mode || 'DETERMINISTIC_FALLBACK',
    failure: semanticFailure || null,
    providerStatus: Number.isInteger(understanding?.providerStatus) ? understanding.providerStatus : null,
    providerCategory: providerCategory || null,
    interpretation: understanding?.interpretation || null,
    completedAt: completedAt.toISOString(),
    rateLimitFailureCount,
    nextRetryAt: nextRetryDelayMs === null ? null : new Date(completedAt.getTime() + nextRetryDelayMs).toISOString(),
    attempt
  };
  const checkpointRow = priorRow
    ? {
      ...priorRow,
      callAttempted: true,
      requestStartedAt,
      rateLimitFailureCount,
      nextRetryAt: pendingEvaluation.nextRetryAt,
      ...(retryReason ? { retryReason } : {}),
      pendingEvaluation
    }
    : { runId, runGroup: testCase.runGroup, caseId: testCase.id, model: MODEL, question: testCase.question, callAttempted: true, ...(retryReason ? { retryReason } : {}), attempts: attemptHistory, pendingEvaluation };
  if (priorRow) {
    clearFinalizedResultFields(checkpointRow);
  }
  replaceCallRow(checkpointRow);
  await writeMeasuredReport();

  const finalRow = await finalizePendingEvaluation(checkpointRow, testCase);
  replaceCallRow(finalRow);
  await writeMeasuredReport();
  console.log(`[${runId} ${testCase.id} attempt=${attempt.attempt}] outcome=${attempt.outcome} status=${attempt.providerStatus ?? 'n/a'} valid=${finalRow.interpretationValid} recall=${finalRow.metrics?.issueRecall.rate ?? 'n/a'}`);
  return finalRow;
}

async function drainProviderRetryQueue(pending) {
  while (pending.length) {
    const now = Date.now();
    const index = pending.findIndex(item => item.eligibleAt <= now);
    if (index < 0) {
      await waitForRequestSlot(Math.min(...pending.map(item => item.eligibleAt)));
      continue;
    }
    const item = pending.splice(index, 1)[0];
    if (ensureAttemptHistory(item.row).length >= MAX_ATTEMPTS_PER_CASE) continue;
    const updated = await runCaseAttempt(item.testCase, item.row.runId, item.row, item.eligibleAt);
    if (updated.semanticFailure === 'RATE_LIMITED' && updated.attempts.length < MAX_ATTEMPTS_PER_CASE) {
      item.row = updated;
      item.eligibleAt = Date.parse(updated.nextRetryAt || '') || Date.now() + MIN_GEMINI_INTERVAL_MS;
      pending.push(item);
      console.log(`[${updated.runId} ${updated.caseId}] deferred after HTTP 429; sanitized category=${updated.providerCategory}; next retry=${updated.nextRetryAt}.`);
    }
  }
}

const pendingCheckpointRows = [...calls].filter(row => row.pendingEvaluation);
if (resumeRequested && pendingCheckpointRows.length) {
  // Re-persist the checkpoint safely before local finalization so an interrupted resume
  // remains inspectable and recoverable without replaying the provider request.
  const pendingSnapshot = await writeMeasuredReport();
  console.log(`[resume] pending checkpoint snapshot persisted: pending=${pendingSnapshot.summary.pendingLocalFinalizationCalls}; finalized quality rows=${pendingSnapshot.summary.semanticMetrics?.qualityCallDenominator ?? 0}; complete issue coverage=${fmtRatio(pendingSnapshot.summary.semanticMetrics?.completeQuestionIssueCoverage)}.`);
}
for (const checkpointRow of pendingCheckpointRows) {
  const testCase = cases.find(item => item.id === checkpointRow.caseId);
  if (!testCase) throw new Error(`Cannot locally finalize pending checkpoint for unknown case ${checkpointRow.caseId}.`);
  const finalRow = await finalizePendingEvaluation(checkpointRow, testCase);
  replaceCallRow(finalRow);
  await writeMeasuredReport();
  console.log(`[${checkpointRow.runId} ${checkpointRow.caseId}] finalized saved provider result locally; no Gemini call was made.`);
}

if (process.argv.includes('--report-only')) {
  await writeMeasuredReport();
  console.log(`Rebuilt ${path.relative(root, jsonPath)} and ${path.relative(root, markdownPath)} from saved calls. No provider call was made.`);
  process.exit(0);
}

if (retryInvalidResponsesOnly) {
  const pendingInvalidResponses = calls
    .filter(row => (
      row.semanticFailure === 'INVALID_RESPONSE' &&
      !row.retryReason &&
      ensureAttemptHistory(row).length === 1
    ) || (
      row.semanticFailure === 'RATE_LIMITED' &&
      row.retryReason === 'INVALID_RESPONSE_STABILITY' &&
      ensureAttemptHistory(row).length < MAX_ATTEMPTS_PER_CASE
    ))
    .map(row => ({ row, testCase: cases.find(testCase => testCase.id === row.caseId), eligibleAt: Date.parse(row.nextRetryAt || '') || 0 }))
    .filter(item => item.testCase);
  const pendingRateLimits = [];
  if (!pendingInvalidResponses.length) console.log('No initial INVALID_RESPONSE rows or deferred invalid-response 429 retries are eligible.');
  for (const item of pendingInvalidResponses) {
    const updated = await runCaseAttempt(item.testCase, item.row.runId, item.row, item.eligibleAt, 'INVALID_RESPONSE_STABILITY');
    if (updated.semanticFailure === 'RATE_LIMITED' && updated.attempts.length < MAX_ATTEMPTS_PER_CASE) {
      pendingRateLimits.push({
        row: updated,
        testCase: item.testCase,
        eligibleAt: Date.parse(updated.nextRetryAt || '') || Date.now() + MIN_GEMINI_INTERVAL_MS
      });
      console.log(`[${updated.runId} ${updated.caseId}] deferred after HTTP 429; sanitized category=${updated.providerCategory}; next retry=${updated.nextRetryAt}.`);
    }
  }
  await drainProviderRetryQueue(pendingRateLimits);
} else if (retryProviderErrorsOnly) {
  const pending = calls
    .filter(row => RETRYABLE_PROVIDER_FAILURES.has(row.semanticFailure) && ensureAttemptHistory(row).length < MAX_ATTEMPTS_PER_CASE)
    .map(row => ({
      row,
      testCase: cases.find(testCase => testCase.id === row.caseId),
      eligibleAt: Date.parse(row.nextRetryAt || '') || 0
    }))
    .filter(item => item.testCase);
  if (!pending.length) console.log('No PROVIDER_ERROR or RATE_LIMITED case rows are eligible for retry.');
  await drainProviderRetryQueue(pending);
} else {
  const pendingRateLimits = calls
    .filter(row => row.semanticFailure === 'RATE_LIMITED' && ensureAttemptHistory(row).length < MAX_ATTEMPTS_PER_CASE)
    .map(row => ({ row, testCase: cases.find(testCase => testCase.id === row.caseId), eligibleAt: Date.parse(row.nextRetryAt || '') || 0 }))
    .filter(item => item.testCase);
  for (const runGroup of ['originalABCD', 'expanded']) {
    const runCount = runGroup === 'originalABCD' ? fixture.runs.originalABCD : fixture.runs.paraphrasesAndAdversarial;
    const selected = cases.filter(testCase => testCase.runGroup === runGroup);
    for (let run = 1; run <= runCount; run += 1) {
      const runId = `${runGroup}-${run}`;
      for (const testCase of selected) {
        if (completedCallKeys.has(`${runId}\u0000${testCase.id}`)) continue;
        const row = await runCaseAttempt(testCase, runId);
        if (row.semanticFailure === 'RATE_LIMITED' && row.attempts.length < MAX_ATTEMPTS_PER_CASE) {
          pendingRateLimits.push({
            row,
            testCase,
            eligibleAt: Date.parse(row.nextRetryAt || '') || Date.now() + MIN_GEMINI_INTERVAL_MS
          });
          console.log(`[${runId} ${testCase.id}] deferred after HTTP 429; sanitized category=${row.providerCategory}; next retry=${row.nextRetryAt}.`);
        }
      }
    }
  }
  await drainProviderRetryQueue(pendingRateLimits);
}

console.log(`Wrote ${path.relative(root, jsonPath)} and ${path.relative(root, markdownPath)}.`);
