import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runOfflineRetainedReplay } from '../../artifacts/iras-v4-offline-repairs-2026-10-08/replay-retained-responses.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ARTIFACT_DIR = path.join(ROOT, 'artifacts/iras-v4-offline-repairs-2026-10-08');
const BASELINE_PATH = path.join(ARTIFACT_DIR, 'baseline-replay.json');
const INTEGRITY_REVIEW_PATH = path.join(ARTIFACT_DIR, 'baseline-integrity-review.json');
const REPLAY_REPORT_PATH = path.join(ARTIFACT_DIR, 'replay-after-fixes.json');
const EXPECTED_BASELINE_SHA256 = 'a0f1f0a6ad8913895d61fc73cf706aa7de26d4d27e0ca2350310ae9de7229a37';

const [baselineBytes, integrityReview] = await Promise.all([
  readFile(BASELINE_PATH), readFile(INTEGRITY_REVIEW_PATH, 'utf8').then(JSON.parse)
]);
assert.equal(createHash('sha256').update(baselineBytes).digest('hex'), EXPECTED_BASELINE_SHA256,
  'The immutable pre-repair baseline report remains byte-identical.');
const baseline = JSON.parse(baselineBytes.toString('utf8'));
assert.equal(integrityReview.baselineSha256, EXPECTED_BASELINE_SHA256);
const rawPrivateBaseline = baseline.cases.find(item => item.caseId === 'private-expense-treatment');
const reviewedPrivateBaseline = integrityReview.cases.find(item => item.caseId === 'private-expense-treatment');
assert.ok(rawPrivateBaseline && reviewedPrivateBaseline);
assert.equal(rawPrivateBaseline.stageVerdicts.INTEGRITY, true,
  'The frozen baseline preserves the original adapter output without rewriting history.');
assert.equal(rawPrivateBaseline.terminalIntegrityFailure, 'OFFLINE_REPLAY_REQUEST_OUTSIDE_CAPTURE_INVENTORY');
assert.equal(reviewedPrivateBaseline.operationalIntegrity, false);
assert.equal(reviewedPrivateBaseline.authoritativeStageVerdicts.INTEGRITY, false,
  'The separate baseline review reports the latched transport failure as an integrity failure.');
assert.equal(reviewedPrivateBaseline.authoritativeFirstFailure, 'INTEGRITY');

const report = await runOfflineRetainedReplay({ writeReport: true, reportPath: REPLAY_REPORT_PATH });
assert.equal(report.acceptanceResult, false, 'An offline diagnostic is never an acceptance result.');
assert.equal(report.liveCallsMade, 0);
assert.equal(report.capturesMade, 0);
assert.equal(report.consumedRunMutated, false);
assert.equal(report.verifiedSemanticResponseCount, 4);
assert.equal(report.capturedEntryCount, 15);
assert.equal(report.verifiedCapturedEntryCount, 15);
assert.equal(report.protectedInputCount, 30);
assert.equal(report.historicalProtectedInputCount, 21);
assert.equal(report.retryProtectedInputCount, 9);
assert.deepEqual(report.protectedInputSha256.before, report.protectedInputSha256.after,
  'All frozen historical and retry evidence inputs retain their original bytes.');
assert.deepEqual(report.semanticResponses, baseline.semanticResponses,
  'The same four retained semantic response hashes are replayed.');
assert.deepEqual(report.captureBodyHashes, baseline.captureBodyHashes,
  'All 15 captured response-body hashes match the immutable baseline.');

const expectedStageKeys = Object.keys(baseline.cases[0].stageVerdicts).sort();
assert.ok(expectedStageKeys.length > 0, 'The frozen replay contract contains expected stage keys.');
for (const item of report.cases) {
  assert.equal(item.operationalIntegrity, true, `${item.caseId} has no latched transport integrity failure.`);
  assert.equal(item.terminalIntegrityFailure, null, `${item.caseId} made no uncaptured request.`);
  assert.deepEqual(item.rejectedIdentities, [], `${item.caseId} has no rejected offline transport identities.`);
  assert.deepEqual(Object.keys(item.stageVerdicts).sort(), expectedStageKeys,
    `${item.caseId} reports every stage required by the frozen replay contract.`);
  for (const [stage, passed] of Object.entries(item.stageVerdicts)) {
    assert.equal(passed, true, `${item.caseId} passes ${stage}.`);
  }
}

const baselineParaphrase = baseline.cases.find(item => item.caseId === 'A-paraphrase-2');
const replayParaphrase = report.cases.find(item => item.caseId === 'A-paraphrase-2');
assert.ok(baselineParaphrase && replayParaphrase);
assert.equal(replayParaphrase.governedEvidence.status, baselineParaphrase.governedEvidence.status,
  'The paraphrase control keeps its frozen INSUFFICIENT outcome.');

const reliefAmountCase = report.cases.find(item => item.caseId === 'target-relief-amount');
assert.ok(reliefAmountCase);
assert.equal(reliefAmountCase.governedEvidence.status, 'CONDITIONAL');
const reliefAmountIssue = reliefAmountCase.governedEvidence.issues.find(item => item.authority === 'IRAS');
assert.ok(reliefAmountIssue);
assert.equal(reliefAmountIssue.evidenceStatus, 'VERIFIED');
assert.equal(reliefAmountIssue.applicationStatus, 'UNRESOLVED');

const privateCase = report.cases.find(item => item.caseId === 'private-expense-treatment');
assert.ok(privateCase);
assert.ok(privateCase.firstFailure == null);
assert.equal(privateCase.governedEvidence.status, 'CONDITIONAL');
const privateIssue = privateCase.governedEvidence.issues.find(item => item.authority === 'IRAS');
assert.ok(privateIssue);
assert.equal(privateIssue.evidenceStatus, 'VERIFIED');
assert.equal(privateIssue.applicationStatus, 'UNRESOLVED',
  'The source verifies the general rule while the transaction-specific application remains unresolved.');
assert.ok(privateIssue.verifiedQuotes.some(item => item.quote.includes('These include personal expenses')),
  'The retained IRAS body supports the private-expense rule quote.');
const privateCoverage = privateCase.governedEvidence.requestedConceptCoverage.find(item =>
  item.issueId === 'company-private-expense-tax-treatment'
);
assert.ok(privateCoverage);
assert.equal(privateCoverage.requestedConceptCoverage, true);
assert.equal(privateCoverage.providerError, false);
assert.ok(privateCoverage.verifiedClaims.some(item => item.quote.includes('These include personal expenses')));
assert.ok(privateIssue.retrievalAttempts.some(item => item.topicId === 'iras-cit-deductibility' && item.fetchStatus === 'SUCCESS'));
assert.ok(!privateCase.requestAttempts.some(item => /negotiable-certificates|property-tax/i.test(item.requestedUrl)),
  'Material topic and IRAS-area checks prevent the irrelevant NCD and property-tax URLs from being fetched.');

console.log('PASS | Four retained IRAS responses replay offline with immutable evidence and authoritative integrity checks');
