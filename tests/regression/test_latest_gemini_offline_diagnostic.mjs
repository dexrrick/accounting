import assert from 'node:assert/strict';
import { diagnoseLatestGeminiResults } from '../../scripts/diagnose_latest_gemini_results.mjs';

const report = await diagnoseLatestGeminiResults();
assert.equal(report.acceptanceProven, false);
assert.equal(report.newProviderCalls, 0);
assert.equal(report.newSourceRequests, 0);
assert.deepEqual(report.protectedInputSha256.before, report.protectedInputSha256.after);
assert.deepEqual(report.observedCounts, { passed: 3, failed: 6, interpretationsPassed: 4, interpretationsNotAssessed: 5 });
assert.equal(report.replayedUsableInterpretations, 4);
assert.equal(report.cpfCoverageInspection.requests.length, 1);
assert.ok(report.cpfCoverageInspection.coverageDecisions.some(decision =>
  decision.targetTopicIds.includes('iras-authority-query-concept-semantic-personal-income-tax-relief') &&
  decision.admissionTopicIds.includes('iras-individual-cpf-relief') && decision.eligibleRecordIds.length > 0 &&
  !decision.uncoveredTopicIds.includes('iras-authority-query-concept-semantic-personal-income-tax-relief')));
for (const row of report.replays) {
  assert.equal(row.inventoryHealthy, true, `${row.caseId} stays within the captured inventory`);
  assert.ok(Object.values(row.stageVerdicts).every(Boolean), `${row.caseId} passes the retained-response checks`);
}
const cpf = report.replays.find(row => row.caseId === 'A-paraphrase-2');
assert.equal(cpf.requests.length, 1);
assert.match(cpf.requests[0].url, /central-provident-fund\(cpf\)-relief-for-employees$/);
const iras = cpf.governed.workstreams.find(stream => stream.authority === 'IRAS').issues[0];
const employer = cpf.governed.workstreams.find(stream => stream.authority === 'CPF').issues[0];
assert.equal(iras.evidenceStatus, 'VERIFIED');
assert.equal(iras.applicationStatus, 'UNRESOLVED');
assert.equal(employer.evidenceStatus, 'INSUFFICIENT');
assert.equal(employer.applicationStatus, 'UNRESOLVED');
console.log('PASS | Latest retained Gemini interpretations replay without new calls or mutation of consumed runs');
