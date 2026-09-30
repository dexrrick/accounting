import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const tsxCli = path.join(root, 'node_modules/tsx/dist/cli.mjs');
const runner = path.join(root, 'tests/evaluation/singapore/multi-authority-workstreams-live-evaluation.mjs');
const originalReportPaths = [
  path.join(root, 'docs/evaluation/multi-authority-workstreams/live-semantic-evaluation.json'),
  path.join(root, 'docs/evaluation/multi-authority-workstreams/live-semantic-evaluation.md')
];
const originalReportHashes = await Promise.all(originalReportPaths.map(async reportPath =>
  createHash('sha256').update(await readFile(reportPath)).digest('hex')
));

function invokeRunner(args, extraEnv = {}) {
  return spawnSync(process.execPath, [tsxCli, runner, ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, ...extraEnv }
  });
}

const forbiddenPrefix = '--output-prefix=live-semantic-evaluation';
const alternateFixtureRun = invokeRunner([
  '--fixture=tests/evaluation/singapore/multi-authority-workstreams-corrected.json',
  forbiddenPrefix
]);
assert.notEqual(alternateFixtureRun.status, 0, 'alternate fixture must not be allowed to overwrite original live reports');
assert.match(`${alternateFixtureRun.stdout}\n${alternateFixtureRun.stderr}`, /reserved.*original live fixture|original live fixture.*reserved/i);

const alternateFixtureUppercaseRun = invokeRunner([
  '--fixture=tests/evaluation/singapore/multi-authority-workstreams-corrected.json',
  '--output-prefix=LIVE-SEMANTIC-EVALUATION'
]);
assert.notEqual(alternateFixtureUppercaseRun.status, 0, 'case variants of the reserved prefix must also be rejected');
assert.match(`${alternateFixtureUppercaseRun.stdout}\n${alternateFixtureUppercaseRun.stderr}`, /reserved.*original live fixture|original live fixture.*reserved/i);

const savedRescoreRun = invokeRunner([
  '--rescore-from=docs/evaluation/multi-authority-workstreams/corrected-saved-response-rescore.json',
  '--fixture=tests/evaluation/singapore/multi-authority-workstreams-corrected.json',
  forbiddenPrefix
]);
assert.notEqual(savedRescoreRun.status, 0, 'saved rescore must not be allowed to overwrite original live reports');
assert.match(`${savedRescoreRun.stdout}\n${savedRescoreRun.stderr}`, /reserved.*original live fixture|original live fixture.*reserved/i);

const savedRescoreUppercaseRun = invokeRunner([
  '--rescore-from=docs/evaluation/multi-authority-workstreams/corrected-saved-response-rescore.json',
  '--fixture=tests/evaluation/singapore/multi-authority-workstreams-corrected.json',
  '--output-prefix=LIVE-SEMANTIC-EVALUATION'
]);
assert.notEqual(savedRescoreUppercaseRun.status, 0, 'case variants of the reserved prefix must also be rejected during rescore');
assert.match(`${savedRescoreUppercaseRun.stdout}\n${savedRescoreUppercaseRun.stderr}`, /reserved.*original live fixture|original live fixture.*reserved/i);

const correctedFixturePath = 'tests/evaluation/singapore/multi-authority-workstreams-corrected.json';
const correctedFixture = JSON.parse(await readFile(path.join(root, correctedFixturePath), 'utf8'));
const pendingCase = correctedFixture.cases.find(item => item.id === 'A-original');
assert.ok(pendingCase, 'corrected fixture provides a local-finalization test case');
const pendingInterpretation = {
  jurisdiction: ['Singapore'],
  authorityCandidates: ['CPF'],
  contextualAuthorities: [],
  domain: 'CPF_PAYROLL',
  population: 'EMPLOYER',
  primarySubject: 'employer CPF contribution obligation and amount',
  concepts: [],
  requestedOperation: 'CALCULATE',
  requiresUserSpecificFacts: true,
  calculationRequested: true,
  factsExplicitlyProvided: ['SGD 6,000 monthly salary'],
  confidence: 0.96,
  issues: [{
    subject: 'employer CPF contribution obligation/calculation',
    population: 'EMPLOYER',
    domain: 'CPF_PAYROLL',
    governingAuthorities: ['CPF'],
    contextualAuthorities: [],
    operation: 'CALCULATE',
    mappedTopicIds: [],
    evidenceRequirement: 'AUTHORITATIVE_SOURCE_AND_CASE_FACTS',
    confidence: 0.96
  }]
};
const pendingPrefix = `pending-checkpoint-regression-${process.pid}`;
const pendingOutputDirectory = path.join(root, 'docs/evaluation/multi-authority-workstreams');
const pendingJsonPath = path.join(pendingOutputDirectory, `${pendingPrefix}.json`);
const pendingMarkdownPath = path.join(pendingOutputDirectory, `${pendingPrefix}.md`);
const pendingSnapshotPrefix = `${pendingPrefix}-snapshot`;
const pendingSnapshotJsonPath = path.join(pendingOutputDirectory, `${pendingSnapshotPrefix}.json`);
const pendingSnapshotMarkdownPath = path.join(pendingOutputDirectory, `${pendingSnapshotPrefix}.md`);
const pendingSnapshotFixturePath = path.join(pendingOutputDirectory, `${pendingSnapshotPrefix}-fixture.json`);
const pendingRequestStartedAt = new Date().toISOString();
const pendingReport = {
  summary: { expectedModel: correctedFixture.expectedModel, runtime: process.version, initialEvaluationRuntime: process.version },
  calls: [{
    runId: 'originalABCD-1',
    runGroup: pendingCase.runGroup,
    caseId: pendingCase.id,
    model: correctedFixture.expectedModel,
    question: pendingCase.question,
    callAttempted: true,
    requestStartedAt: pendingRequestStartedAt,
    interpretationValid: true,
    providerResponseReceived: true,
    finalWorkstreams: ['STALE/ROUTE'],
    metrics: {
      issueRecall: { correct: 9, total: 9, rate: 1 },
      issuePrecision: { correct: 9, total: 9, rate: 1 },
      finalWorkstreamSetAccuracy: true,
      completeQuestionIssueCoverage: true
    },
    failureTaxonomies: ['MODEL_OMISSION'],
    downstreamBehavioralChecks: {
      residualNoRequestedWorkstream: true,
      incompletePlanNotVerified: true,
      operationsPreserved: true,
      requiresCaseFacts: true,
      correct: true
    },
    attempts: [],
    pendingEvaluation: {
      status: 'PROVIDER_RESPONSE_RECEIVED',
      mode: 'SEMANTIC_INTERPRETATION',
      failure: null,
      providerStatus: 200,
      providerCategory: 'HTTP_200',
      interpretation: pendingInterpretation,
      completedAt: pendingRequestStartedAt,
      rateLimitFailureCount: 0,
      nextRetryAt: null,
      attempt: {
        attempt: 1,
        requestStartedAt: pendingRequestStartedAt,
        providerRequestAttempted: true,
        outcome: 'VALID_INTERPRETATION',
        latencyMs: 1,
        runtime: process.version,
        providerStatus: 200,
        providerCategory: 'HTTP_200'
      }
    }
  }]
};
try {
  const pendingSnapshotFixture = {
    ...correctedFixture,
    runs: { originalABCD: 2, paraphrasesAndAdversarial: 0 },
    cases: [pendingCase]
  };
  await writeFile(pendingSnapshotFixturePath, `${JSON.stringify(pendingSnapshotFixture, null, 2)}\n`, 'utf8');
  const unknownPendingReport = {
    ...pendingReport,
    calls: [
      {
        ...pendingReport.calls[0],
        runId: 'originalABCD-1',
        caseId: 'unknown-pending-case-1',
        question: 'Unknown case used to stop after pending snapshot persistence.'
      },
      {
        ...pendingReport.calls[0],
        runId: 'originalABCD-2',
        caseId: 'unknown-pending-case-2',
        question: 'Retry case with a saved response followed by a pending provider failure.',
        attempts: [pendingReport.calls[0].pendingEvaluation.attempt],
        pendingEvaluation: {
          ...pendingReport.calls[0].pendingEvaluation,
          status: 'NO_PROVIDER_RESPONSE',
          mode: 'DETERMINISTIC_FALLBACK',
          failure: 'PROVIDER_ERROR',
          providerStatus: null,
          providerCategory: 'STATUS_UNAVAILABLE',
          interpretation: null,
          attempt: {
            ...pendingReport.calls[0].pendingEvaluation.attempt,
            attempt: 2,
            outcome: 'PROVIDER_ERROR',
            providerStatus: null,
            providerCategory: 'STATUS_UNAVAILABLE'
          }
        }
      }
    ]
  };
  await writeFile(pendingSnapshotJsonPath, `${JSON.stringify(unknownPendingReport, null, 2)}\n`, 'utf8');
  const pendingSnapshotRun = invokeRunner([
    `--fixture=${path.relative(root, pendingSnapshotFixturePath).replaceAll('\\', '/')}`,
    `--output-prefix=${pendingSnapshotPrefix}`,
    '--live',
    '--resume',
    '--report-only'
  ], { GEMINI_API_KEY: 'test-only-pending-checkpoint-key' });
  assert.notEqual(pendingSnapshotRun.status, 0, 'unknown pending case should stop after safely writing its report snapshot');
  assert.match(`${pendingSnapshotRun.stderr}\n${pendingSnapshotRun.stdout}`, /unknown case/);
  assert.match(pendingSnapshotRun.stdout, /pending checkpoint snapshot persisted/);
  const checkpointSnapshot = JSON.parse(await readFile(pendingSnapshotJsonPath, 'utf8'));
  assert.equal(checkpointSnapshot.summary.pendingLocalFinalizationCalls, 2);
  assert.equal(checkpointSnapshot.summary.providerRequestAttempts, 3);
  assert.equal(checkpointSnapshot.summary.providerResponseAttempts, 2,
    'provider response attempts include the earlier response but exclude the pending provider failure');
  assert.equal(checkpointSnapshot.summary.providerComplete, false,
    'logical-call completeness follows the pending retry’s latest provider failure');
  assert.equal(checkpointSnapshot.summary.validInterpretations, 0, 'pending provider output is not counted as finalized');
  assert.equal(checkpointSnapshot.summary.semanticMetrics.qualityCallDenominator, 0);
  assert.deepEqual(checkpointSnapshot.summary.semanticMetrics.completeQuestionIssueCoverage, { correct: 0, total: 2, rate: 0 },
    'stale complete-coverage metrics from a prior attempt receive no credit while pending');
  assert.equal(checkpointSnapshot.summary.taxonomyFailureCounts.MODEL_OMISSION, 0);
  assert.equal(checkpointSnapshot.summary.downstreamBehavioralDenominator, 0);
  assert.equal(checkpointSnapshot.summary.suiteComplete, false);
  assert.equal(checkpointSnapshot.calls[0].metrics, undefined, 'pending checkpoint strips prior finalized metrics');
  assert.equal(checkpointSnapshot.calls[0].failureTaxonomies, undefined);
  assert.equal(checkpointSnapshot.calls[0].finalWorkstreams, undefined);
  assert.equal(checkpointSnapshot.calls[1].metrics, undefined);
  const checkpointMarkdown = await readFile(pendingSnapshotMarkdownPath, 'utf8');
  assert.match(checkpointMarkdown, /Pending local finalization: 2 call/);
  assert.match(checkpointMarkdown, /PENDING: PROVIDER_RESPONSE_RECEIVED/);
  assert.match(checkpointMarkdown, /\| n\/a \| n\/a \| PENDING \| pending finalization \|/);

  await writeFile(pendingJsonPath, `${JSON.stringify(pendingReport, null, 2)}\n`, 'utf8');
  const resumedPendingRun = invokeRunner([
    `--fixture=${correctedFixturePath}`,
    `--output-prefix=${pendingPrefix}`,
    '--live',
    '--resume',
    '--report-only'
  ], { GEMINI_API_KEY: 'test-only-pending-checkpoint-key' });
  assert.equal(resumedPendingRun.status, 0,
    `pending checkpoint should be reportable and finalized locally: ${resumedPendingRun.stderr || resumedPendingRun.stdout}`);
  assert.match(resumedPendingRun.stdout, /finalized saved provider result locally; no Gemini call was made/);
  assert.match(resumedPendingRun.stdout, /No provider call was made/);
  const finalizedReport = JSON.parse(await readFile(pendingJsonPath, 'utf8'));
  const finalizedCall = finalizedReport.calls.find(row => row.caseId === pendingCase.id);
  assert.ok(finalizedCall, 'resumed report retains the checkpointed logical call');
  assert.equal(finalizedCall.pendingEvaluation, undefined, 'local resume clears pending state after finalization');
  assert.equal(finalizedCall.providerResponseReceived, true);
  assert.equal(finalizedCall.attempts.length, 1, 'the pending provider attempt is preserved exactly once');
  assert.ok(finalizedCall.metrics, 'metrics appear after local finalization');
  assert.equal(finalizedReport.summary.providerRequestAttempts, 1);
  assert.equal(finalizedReport.summary.providerResponseAttempts, 1);
  assert.equal(finalizedReport.summary.pendingLocalFinalizationCalls, 0);
  assert.equal(finalizedReport.summary.suiteComplete, false, 'a one-row checkpoint cannot claim full-suite completion');
  const finalizedMarkdown = await readFile(pendingMarkdownPath, 'utf8');
  assert.match(finalizedMarkdown, /Checkpoint: FINALIZED/);
} finally {
  for (const filePath of [
    pendingJsonPath,
    pendingMarkdownPath,
    `${pendingJsonPath}.${process.pid}.tmp`,
    `${pendingMarkdownPath}.${process.pid}.tmp`,
    pendingSnapshotJsonPath,
    pendingSnapshotMarkdownPath,
    pendingSnapshotFixturePath,
    `${pendingSnapshotJsonPath}.${process.pid}.tmp`,
    `${pendingSnapshotMarkdownPath}.${process.pid}.tmp`
  ]) await unlink(filePath).catch(error => { if (error?.code !== 'ENOENT') throw error; });
}

const finalHashes = await Promise.all(originalReportPaths.map(async reportPath =>
  createHash('sha256').update(await readFile(reportPath)).digest('hex')
));
assert.deepEqual(finalHashes, originalReportHashes, 'rejected CLI invocations must leave original JSON and Markdown reports unchanged');

console.log('Multi-authority evaluation runner preserves pending checkpoint state, finalizes locally, and protects saved live reports.');
