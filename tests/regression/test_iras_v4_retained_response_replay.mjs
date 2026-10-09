import assert from 'node:assert/strict';
import { runOfflineRetainedReplay } from '../../artifacts/iras-v4-offline-repairs-2026-10-06/replay-retained-responses.mjs';

const report = await runOfflineRetainedReplay();

assert.equal(report.profile, 'IRAS_V4_OFFLINE_RETAINED_DIAGNOSTIC_ONLY');
assert.equal(report.acceptanceResult, false, 'An offline retained replay must never be represented as acceptance.');
assert.equal(report.liveCallsMade, 0);
assert.equal(report.capturesMade, 0);
assert.equal(report.consumedRunMutated, false);
assert.deepEqual(report.protectedInputSha256.before, report.protectedInputSha256.after,
  'The retained runner, consumption marker, capture, and activation bytes are identical before and after replay.');
assert.deepEqual(Object.keys(report.protectedInputSha256.before).sort(),
  ['activationConfiguration', 'capturePayload', 'consumptionMarker', 'retainedRun']);
for (const hash of Object.values(report.protectedInputSha256.before)) assert.match(hash, /^[a-f0-9]{64}$/);
assert.equal(report.verifiedSemanticResponseCount, 6);
assert.equal(report.semanticResponses.length, 6);
assert.equal(report.verifiedCapturedEntryCount, report.capturedEntryCount);
assert.equal(report.cases.length, 6);
const reliefControls = report.cases.filter(result => result.family === 'relief');
assert.equal(reliefControls.length, 3);
for (const control of reliefControls) {
  assert.ok(Object.values(control.stageVerdicts).every(Boolean), `${control.caseId} remains a passing control`);
}

for (const result of report.cases) {
  assert.ok(result.stageVerdicts && Object.keys(result.stageVerdicts).length > 0, `${result.caseId} returned adapter stages`);
  for (const attempt of result.requestAttempts) {
    assert.equal(attempt.family, result.family, `${result.caseId} request stayed in its frozen family`);
    assert.ok(typeof attempt.requestedUrl === 'string' && attempt.requestedUrl.startsWith('https://www.iras.gov.sg/'),
      `${result.caseId} retains the requested URL for every transport attempt`);
  }
  for (const rejected of result.rejectedIdentities) {
    assert.equal(rejected.inventoryMatched, undefined);
    assert.equal(rejected.latched, true, 'An out-of-inventory request latches the case transport');
    assert.equal(rejected.requestIdentitySha256.length, 64);
    assert.ok(result.requestAttempts.some(attempt => attempt.requestIdentitySha256 === rejected.requestIdentitySha256 &&
      attempt.inventoryMatched === false), 'The exact rejected identity remains in the attempt trace');
  }
  if (result.rejectedIdentities.length > 0) {
    assert.equal(result.terminalIntegrityFailure, 'OFFLINE_REPLAY_REQUEST_OUTSIDE_CAPTURE_INVENTORY');
  }
}

const residency = report.cases.find(result => result.caseId === 'corporate-residency-general-rule');
assert.ok(residency, 'The captured residency semantic response was replayed.');
assert.equal(residency.interpretation.requestedOperation, 'EXPLAIN_RULE');
assert.equal(residency.interpretation.requiresUserSpecificFacts, false);
assert.equal(residency.interpretation.issues[0].operation, 'EXPLAIN_RULE');
assert.equal(residency.governedEvidence.status, 'VERIFIED');
assert.equal(residency.governedEvidence.applicationStatus, 'NOT_REQUIRED');
assert.deepEqual(residency.governedEvidence.topLevelGaps, []);
assert.deepEqual(residency.rejectedIdentities, [], 'Adequate mapped residency evidence prevents uncaptured retrieval.');
assert.equal(residency.requestAttempts.length, 1);
assert.doesNotMatch(residency.requestAttempts.map(attempt => attempt.requestedUrl).join('\n'), /sitemap|certificate-of-residence-tax-reclaim-form/i);
assert.ok(Object.values(residency.stageVerdicts).every(Boolean));

const privateExpense = report.cases.find(result => result.caseId === 'private-expense-treatment');
assert.ok(privateExpense, 'The retained private-expense semantic response was replayed.');
assert.equal(privateExpense.governedEvidence.status, 'CONDITIONAL',
  'Verified private-expense evidence with unresolved application aggregates as conditional.');
assert.equal(privateExpense.governedEvidence.evidenceStatus, 'VERIFIED');
assert.equal(privateExpense.governedEvidence.applicationStatus, 'UNRESOLVED');
assert.deepEqual(privateExpense.governedEvidence.topLevelGaps, [],
  'The generic corporate tax label is assigned to the sole matching income-tax issue.');
assert.equal(privateExpense.governedEvidence.issues.length, 1);
assert.equal(privateExpense.governedEvidence.issues[0].evidenceStatus, 'VERIFIED');
assert.equal(privateExpense.governedEvidence.issues[0].applicationStatus, 'UNRESOLVED');

const foreignDividend = report.cases.find(result => result.caseId === 'foreign-dividend-receipt-treatment');
assert.ok(foreignDividend, 'The retained foreign-dividend semantic response was replayed.');
assert.equal(foreignDividend.governedEvidence.status, 'CONDITIONAL');
assert.equal(foreignDividend.governedEvidence.evidenceStatus, 'VERIFIED');
assert.equal(foreignDividend.governedEvidence.applicationStatus, 'UNRESOLVED');
assert.equal(foreignDividend.governedEvidence.issues[0].evidenceStatus, 'VERIFIED');
assert.equal(foreignDividend.governedEvidence.issues[0].applicationStatus, 'UNRESOLVED');
assert.ok(foreignDividend.governedEvidence.issues[0].verifiedQuotes.some(({ quote }) =>
  quote === 'Foreign income refers to income derived from outside Singapore. Generally, such income is taxable in Singapore when remitted to and received in Singapore. Where the foreign income arises from a trade or business carried on in Singapore, it is taxable in Singapore upon accrual, regardless of whether it is received in Singapore.'),
'The verified claim is the full retained receipt rule with the trade/business accrual qualification.');
assert.ok(Object.values(foreignDividend.stageVerdicts).every(Boolean));

console.log('IRAS V4 retained-response replay regression passed (six retained responses, exact family identity checks, and diagnostic-only offline execution).');
