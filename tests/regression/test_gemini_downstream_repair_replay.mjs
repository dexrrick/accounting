import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { compactReplay, inspectRetainedCaseRecord, replayAllRetainedGeminiBatches, replayRetainedGeminiBatch }
  from '../../scripts/replay_gemini_downstream_repairs.mjs';

const invalidInventoryReplay = compactReplay('inventory-violation', { sha256: 'test', bytes: 1 }, { attempts: [] },
  undefined, 'capture inventory mismatch', false);
assert.equal(invalidInventoryReplay.stageVerdicts.INTEGRITY, false,
  'An inventory violation remains an explicit failed integrity verdict even when replay throws before producing a result.');
assert.equal(invalidInventoryReplay.firstFailure, 'INTEGRITY',
  'Capture inventory failure outranks the adapter error as the authoritative first failure.');
await assert.rejects(() => replayRetainedGeminiBatch('../live-run'), /Unsupported retained Gemini batch/,
  'Only supported retained run identifiers can be replayed.');

const unavailableFallback = {
  caseId: 'transport-unavailable',
  assessmentStatus: 'NOT_ASSESSED',
  semanticUnderstanding: { mode: 'DETERMINISTIC_FALLBACK', assessmentStatus: 'NOT_ASSESSED', failure: 'TIMEOUT' },
  failureDiagnostics: { failureChain: [{ stage: 'PROVIDER', outcome: 'TIMEOUT', code: 'TRANSPORT_ERROR' }] },
  providerAttempts: [{ attempt: 1, failureCategory: 'TIMEOUT' }],
  providerRequests: [{ caseId: 'transport-unavailable', attempt: 1, failureCategory: 'NETWORK_ERROR' }]
};
assert.equal(inspectRetainedCaseRecord(unavailableFallback).disposition, 'NOT_ASSESSED',
  'A missing body is retained as NOT_ASSESSED only with an explicit transport-fallback diagnostic.');
assert.throws(() => inspectRetainedCaseRecord({ ...unavailableFallback, assessmentStatus: 'PASSED' }),
  /RETAINED_RESPONSE_MISSING_FOR_ASSESSED_CASE/);
const responseBytes = Buffer.from('{"issues":[]}');
const responseHash = createHash('sha256').update(responseBytes).digest('hex');
const assessedRecord = { caseId: 'assessed', assessmentStatus: 'PASSED', providerAttempts: [], providerRequests: [],
  semanticResponse: { base64: responseBytes.toString('base64'), bytes: responseBytes.length, sha256: responseHash } };
assert.equal(inspectRetainedCaseRecord(assessedRecord).disposition, 'REPLAYED_RESPONSE');
assert.throws(() => inspectRetainedCaseRecord({ ...assessedRecord,
  semanticResponse: { ...assessedRecord.semanticResponse, base64: Buffer.from('{"issues":[]}!').toString('base64') } }),
  /RETAINED_RESPONSE_HASH_MISMATCH/);
assert.throws(() => inspectRetainedCaseRecord({ ...assessedRecord,
  providerRequests: [{ caseId: 'another-case', attempt: 1 }], providerAttempts: [{ attempt: 1 }] }),
  /RETAINED_PROVIDER_CASE_ID_MISMATCH/);

const combined = await replayAllRetainedGeminiBatches();
assert.equal(combined.profile, 'GEMINI_ALL_RETAINED_BATCHES_OFFLINE_REPLAY');
assert.equal(combined.retainedResponseReplayCount, 61, 'All 61 available retained provider responses are replayed.');
assert.equal(combined.retainedCaseRecordCount, 63, 'All 63 retained case records remain represented.');
assert.equal(combined.notAssessedCount, 2, 'The two transport-unavailable cases remain NOT_ASSESSED.');
assert.deepEqual(combined.reports.map(report => report.batchId), [
  'live-rerun-2026-10-09', 'live-rerun-downstream-2026-10-09', 'live-rerun-ownership-2026-10-09',
  'live-rerun-variants-2026-10-09', 'live-rerun-gst-binding-2026-10-09', 'live-rerun-primary-labels-2026-10-09',
  'live-rerun-isolated-final-2026-10-09'
]);
assert.equal(combined.newProviderCalls, 0);
assert.equal(combined.newSourceRequests, 0);
assert.equal(combined.protectedInputsUnchanged, true, 'The protected run, contract and capture inputs hash identically across both replays.');

for (const report of combined.reports) {
  assert.equal(report.profile, 'GEMINI_DOWNSTREAM_REPAIR_OFFLINE_REPLAY');
  assert.equal(report.diagnosticOnly, true);
  assert.equal(report.acceptanceProven, false);
  assert.equal(report.retainedCaseRecordCount, 9);
  const latestBatch = report.batchId === 'live-rerun-primary-labels-2026-10-09';
  assert.equal(report.retainedResponseReplayCount, latestBatch ? 7 : 9);
  assert.equal(report.notAssessedCount, latestBatch ? 2 : 0);
  assert.equal(report.semanticReplayInvocations, latestBatch ? 7 : 9,
    'Only retained responses are replayed through the production parser.');
  assert.equal(report.newProviderCalls, 0);
  assert.equal(report.newSourceRequests, 0);
  assert.equal(report.blockedNetworkAttemptCount, 0);
  assert.equal(report.captureInventoryHealthy, true);
  assert.equal(report.protectedInputsUnchanged, true);
  assert.deepEqual(report.protectedInputSha256.before, report.protectedInputSha256.after);
  assert.equal(report.replays.length, 9);
  const replayedResponses = report.replays.filter(row => row.disposition === 'REPLAYED_RESPONSE');
  assert.equal(replayedResponses.every(row => !row.replayError && !row.firstFailure && row.inventoryHealthy), true,
    `Every available response in ${report.batchId} passes downstream stages and exact captured inventory checks.`);
  assert.equal(report.replays.filter(row => row.disposition === 'NOT_ASSESSED').every(row =>
    row.assessmentStatus === 'NOT_ASSESSED' && row.transportUnavailable && !row.semanticReplayInvoked &&
    row.offlineCaptureLookups === 0 && row.firstFailure === undefined), true,
  'Transport-unavailable records are preserved without fabricating a response, replay, or pass.');

  const wht = report.replays.find(row => row.caseId === 'wht-royalty-general-rule');
  assert.ok(wht, `The retained WHT response is present in ${report.batchId}.`);
  if (wht.disposition === 'NOT_ASSESSED') {
    assert.equal(wht.transportFailureCode, 'V4_PACING_GAP_NOT_MET');
    assert.deepEqual(wht.offlineRequests, []);
  } else {
    const whtUrls = wht.offlineRequests.map(item => item.url);
    assert.ok(whtUrls.includes('https://www.iras.gov.sg/taxes/withholding-tax/basics-of-withholding-tax/types-of-payment-and-withholding-tax-rates'),
      'The registered payment-specific WHT rates page is selected from the capture.');
    assert.ok(whtUrls.includes('https://www.iras.gov.sg/taxes/withholding-tax/payments-to-non-resident-company/payments-that-are-subject-to-withholding-tax'),
      'The registered payment-scope page is selected from the capture.');
    assert.equal(whtUrls.some(url => url === 'https://www.iras.gov.sg/sitemap' ||
      url === 'https://www.iras.gov.sg/taxes/withholding-tax/payments-to-non-resident-company'), false,
    'The mapped payment-specific sources cover the replay without sitemap or uncaptured parent-page discovery.');
  }

  const gst = report.replays.find(row => row.caseId === 'gst-input-tax-general-rule');
  assert.ok(gst.stageVerdicts?.GOVERNED_RETRIEVAL && gst.stageVerdicts.REQUESTED_CONCEPT_COVERAGE && gst.stageVerdicts.OVERALL_STATUS,
    'The registered-company GST input-tax answer closes the complete governed retrieval path.');
  assert.equal(gst.governed?.issues?.every(issue => issue.requestedConceptCoverage === true), true,
    'The captured GST source still covers requested concepts, including PRIMARY input tax.');
}

const latest = combined.reports.at(-1);
const primaryLabelsBatch = combined.reports.find(report => report.batchId === 'live-rerun-primary-labels-2026-10-09');
assert.deepEqual(primaryLabelsBatch.replays.filter(row => row.disposition === 'NOT_ASSESSED').map(row => row.caseId),
  ['A-paraphrase-2', 'wht-royalty-general-rule']);
assert.equal(primaryLabelsBatch.replays.find(row => row.caseId === 'gst-input-tax-general-rule').stageVerdicts.OVERALL_STATUS, true,
  'The shortened GST issue passes downstream replay from its retained response.');
const foreignDividend = latest.replays.find(row => row.caseId === 'foreign-dividend-receipt-treatment');
assert.equal(foreignDividend.stageVerdicts.OVERALL_STATUS, true,
  'The latest retained foreign-dividend response passes with its RELATED subsidiary descriptor owned.');
assert.equal(foreignDividend.governed?.issues?.every(issue => issue.requestedConceptCoverage === true), true,
  'The foreign-dividend source requirements remain covered in the latest retained response.');
process.stdout.write('All 61 available responses across seven retained Gemini batches replayed; two transport-unavailable cases remain NOT_ASSESSED.\n');
