import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUTPUT_DIR = path.dirname(fileURLToPath(import.meta.url));
const BASELINE_PATH = path.join(OUTPUT_DIR, 'baseline-replay.json');
const REVIEW_PATH = path.join(OUTPUT_DIR, 'baseline-integrity-review.json');
const EXPECTED_BASELINE_SHA256 = 'a0f1f0a6ad8913895d61fc73cf706aa7de26d4d27e0ca2350310ae9de7229a37';

const baselineBytes = await readFile(BASELINE_PATH);
const baselineSha256 = createHash('sha256').update(baselineBytes).digest('hex');
if (baselineSha256 !== EXPECTED_BASELINE_SHA256) throw new Error('FROZEN_BASELINE_REPORT_HASH_MISMATCH');
const baseline = JSON.parse(baselineBytes.toString('utf8'));
const cases = baseline.cases.map(item => {
  const operationalIntegrity = item.terminalIntegrityFailure === null;
  const authoritativeStageVerdicts = {
    ...item.stageVerdicts,
    ...(operationalIntegrity ? {} : { INTEGRITY: false })
  };
  return {
    caseId: item.caseId,
    retainedResponseSha256: item.retainedResponseSha256,
    terminalIntegrityFailure: item.terminalIntegrityFailure,
    rawAdapterFirstFailure: item.firstFailure,
    rawAdapterStageVerdicts: item.stageVerdicts,
    operationalIntegrity,
    authoritativeFirstFailure: operationalIntegrity ? item.firstFailure : 'INTEGRITY',
    authoritativeStageVerdicts
  };
});
const review = {
  profile: 'IRAS_V4_PRE_REPAIR_BASELINE_INTEGRITY_OVERLAY_REVIEW',
  acceptanceResult: false,
  liveCallsMade: 0,
  capturesMade: 0,
  baselinePath: path.relative(path.resolve(OUTPUT_DIR, '../..'), BASELINE_PATH).replaceAll(path.sep, '/'),
  baselineSha256,
  cases
};
await writeFile(REVIEW_PATH, `${JSON.stringify(review, null, 2)}\n`, { flag: 'w' });
console.log(JSON.stringify({
  profile: review.profile,
  baselineSha256,
  cases: cases.map(item => ({
    caseId: item.caseId,
    operationalIntegrity: item.operationalIntegrity,
    rawAdapterFirstFailure: item.rawAdapterFirstFailure,
    authoritativeFirstFailure: item.authoritativeFirstFailure
  }))
}, null, 2));
