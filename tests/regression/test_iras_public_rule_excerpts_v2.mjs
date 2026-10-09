import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { IRAS_SOURCE_MAP_DEFINITIONS } from '../../src/standards/coverageRegistry.ts';
import { UNIFIED_SOURCE_REGISTRY } from '../../src/standards/unifiedSourceModel.ts';
import {
  CONSUMED_FILENAME,
  PLAN_FILENAME,
  REPORT_FILENAME,
  SOURCE_MAP_IDS,
  runIrasPublicRuleExcerptDiagnostic,
  selectPublicExcerptUnits
} from '../evaluation/singapore/iras-public-rule-excerpts-v2.mjs';

const htmlEsc = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const sourceBodies = {
  IRAS_CIT_FOREIGN_INCOME_SOURCE_MAP: 'Specified foreign-sourced income received in Singapore may qualify for exemption from tax if the statutory conditions are met. Foreign dividends may be included in this category.'
};

function syntheticPage(mapId) {
  const definition = IRAS_SOURCE_MAP_DEFINITIONS.find(item => item.id === mapId);
  const pointer = UNIFIED_SOURCE_REGISTRY[mapId];
  assert.ok(definition && pointer);
  const title = pointer.documentTitle;
  return `<html><head><title>${htmlEsc(title)}</title><script>RAW_HTML_SENTINEL</script></head><body><main><h1>${htmlEsc(title)}</h1><p>${htmlEsc(sourceBodies[mapId])}</p></main></body></html>`;
}

function response(body, headers = { 'content-type': 'text/html; charset=utf-8' }) {
  return new Response(body, { status: 200, headers });
}

async function exists(target) {
  try { await stat(target); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

const scratch = await mkdtemp(path.join(os.tmpdir(), 'iras-public-excerpts-v2-'));
const originalFetch = globalThis.fetch;
let ambientCalls = 0;
globalThis.fetch = async () => { ambientCalls += 1; throw new Error('AMBIENT_NETWORK_FORBIDDEN'); };
try {
  const selection = selectPublicExcerptUnits('IRAS_CIT_FOREIGN_INCOME_SOURCE_MAP',
    'Foreign Income Received in Singapore:\n\n• Foreign-sourced dividends may qualify for exemption from tax if the statutory conditions are met.');
  assert.equal(selection.excerpts.length, 1);
  assert.equal(selection.excerpts[0].unitKind, 'HEADING_WITH_COMPLETE_LIST');
  assert.match(selection.excerpts[0].text, /^Foreign Income Received in Singapore:/);
  assert.equal(selection.excerpts[0].truncated, false);
  const oversize = selectPublicExcerptUnits('IRAS_CIT_FOREIGN_INCOME_SOURCE_MAP',
    `Foreign-sourced dividends received in Singapore may qualify for exemption from tax ${'x'.repeat(3100)} if the conditions are met.`);
  assert.equal(oversize.excerpts.length, 0);
  assert.equal(oversize.skipped.OVERSIZE_COMPLETE_UNIT, 1);
  assert.equal(oversize.truncated, false, 'Oversized complete units are skipped explicitly, never text-truncated.');
  const oversizeFirstEight = selectPublicExcerptUnits('IRAS_CIT_FOREIGN_INCOME_SOURCE_MAP', [
    ...Array.from({ length: 8 }, (_, index) => `Foreign-sourced dividends received in Singapore may qualify for exemption from tax ${'x'.repeat(3100)} in example ${index}.`),
    'Foreign-sourced dividends received in Singapore may qualify for exemption from tax if the listed conditions are met.'
  ].join('\n\n'));
  assert.equal(oversizeFirstEight.excerpts.length, 1);
  assert.match(oversizeFirstEight.excerpts[0].text, /listed conditions/,
    'Eight oversized high-priority units do not hide a later complete target unit.');
  assert.equal(oversizeFirstEight.skipped.OVERSIZE_COMPLETE_UNIT, 8);
  const pageOversize = selectPublicExcerptUnits('IRAS_CIT_FOREIGN_INCOME_SOURCE_MAP', 'x'.repeat(200001));
  assert.equal(pageOversize.truncated, true);
  assert.deepEqual(pageOversize.skipped, { PAGE_CHARACTER_LIMIT: 1 });
  const blockOversize = selectPublicExcerptUnits('IRAS_CIT_FOREIGN_INCOME_SOURCE_MAP',
    Array.from({ length: 10001 }, (_, index) => `block ${index}`).join('\n\n'));
  assert.equal(blockOversize.truncated, true);
  assert.deepEqual(blockOversize.skipped, { PAGE_BLOCK_LIMIT: 1 });
  const lateTarget = selectPublicExcerptUnits('IRAS_CIT_FOREIGN_INCOME_SOURCE_MAP', [
    'Foreign Income Received in Singapore:',
    ...Array.from({ length: 8 }, (_, index) => `Foreign income categories are listed in fragment ${index}.`),
    'Foreign Income Received in Singapore:',
    '• Foreign-sourced dividends may qualify for exemption from tax if the statutory conditions are met.'
  ].join('\n\n'));
  assert.equal(lateTarget.excerpts.length, 8);
  assert.ok(lateTarget.excerpts.some(unit => unit.text.includes('Foreign-sourced dividends') && unit.text.includes('Foreign Income Received in Singapore')),
    'The late complete governing dividend unit outranks eight earlier foreign-income fragments.');
  assert.equal(lateTarget.excerpts.some(unit => unit.text.trim() === 'Foreign Income Received in Singapore:'), false,
    'An orphan heading does not outrank substantive foreign-income fragments.');
  assert.deepEqual(lateTarget.excerpts.map(unit => unit.blockIndex), [...lateTarget.excerpts.map(unit => unit.blockIndex)].sort((a, b) => a - b),
    'Selected excerpts remain in source order after lexical priority selection.');
  const lateGeneralRule = selectPublicExcerptUnits('IRAS_CIT_FOREIGN_INCOME_SOURCE_MAP', [
    ...Array.from({ length: 8 }, (_, index) => `Retain records of tax exemption for foreign dividends received in Singapore in documentary file ${index}.`),
    'Foreign income received in Singapore is taxable, unless an exemption applies.'
  ].join('\n\n'));
  assert.equal(lateGeneralRule.excerpts.length, 8);
  assert.ok(lateGeneralRule.excerpts.some(unit => unit.text ===
    'Foreign income received in Singapore is taxable, unless an exemption applies.'),
  'A governing foreign-income receipt and tax paragraph outranks eight documentary retention fragments, even without a dividend mention.');
  assert.ok(lateTarget.excerpts.length <= 8 && lateTarget.excerpts.every(unit => unit.text.length <= 3000) &&
    lateTarget.excerpts.reduce((sum, unit) => sum + unit.text.length, 0) <= 12000,
  'Selected units stay within the registered per-page excerpt, unit, and character limits.');
  const attachedQualification = selectPublicExcerptUnits('IRAS_CIT_FOREIGN_INCOME_SOURCE_MAP',
    'Foreign-sourced dividends received in Singapore may qualify for exemption from tax under the general rule.\n\nHowever, an applicable exception may change that treatment when the statutory conditions are met.');
  assert.equal(attachedQualification.excerpts.length, 1);
  assert.match(attachedQualification.excerpts[0].text, /\n\nHowever, an applicable exception/,
    'An immediate attached qualification remains with the complete selected paragraph.');

  const successDir = path.join(scratch, 'success');
  const successPlan = await runIrasPublicRuleExcerptDiagnostic({ mode: 'plan', outputDirectory: successDir });
  const fingerprintPaths = successPlan.preregistration.codeFingerprints.map(item => item.path);
  assert.ok(fingerprintPaths.includes('src/verification/claimEvidenceVerifier.ts'));
  assert.ok(fingerprintPaths.includes('src/standards/unifiedSourceModel.ts'));
  const v1Pins = successPlan.preregistration.v1Integrity.fingerprints.map(item => item.path);
  assert.ok(v1Pins.includes('tests/evaluation/singapore/iras-public-rule-excerpts-v1.mjs'));
  assert.ok(v1Pins.includes('tests/regression/test_iras_public_rule_excerpts_v1.mjs'));
  assert.ok(v1Pins.includes('docs/evaluation/multi-authority-workstreams/iras-public-excerpts-2026-10-03-v1/iras-public-rule-excerpts-plan-v1.json'));
  assert.ok(v1Pins.includes('docs/evaluation/multi-authority-workstreams/iras-public-excerpts-2026-10-03-v1/iras-public-rule-excerpts-report-v1.json'));
  assert.ok(v1Pins.includes('docs/evaluation/multi-authority-workstreams/iras-public-excerpts-2026-10-03-v1/iras-public-rule-excerpts-live-consumed-v1.json'));
  assert.ok(v1Pins.includes('docs/evaluation/multi-authority-workstreams/iras-public-excerpts-2026-10-03-v1/supervisor-observations.md'));
  assert.ok(successPlan.preregistration.v6Integrity.v1v2Fingerprints.length > 0,
    'Frozen preregistration includes the existing V1/V2 protected-artifact fingerprint set.');
  let calls = 0;
  const successfulFetch = async url => {
    calls += 1;
    assert.equal(await exists(path.join(successDir, CONSUMED_FILENAME)), true,
      'Permanent consumed marker must exist before any request starts.');
    const selected = SOURCE_MAP_IDS.find(mapId => IRAS_SOURCE_MAP_DEFINITIONS.find(item => item.id === mapId)?.canonicalSourceUrl === String(url));
    assert.ok(selected, 'Synthetic transport only serves a preregistered canonical map URL.');
    return response(syntheticPage(selected));
  };
  const report = await runIrasPublicRuleExcerptDiagnostic({ mode: 'live-source', outputDirectory: successDir,
    fetchImpl: successfulFetch, now: () => '2026-10-03T00:00:00.000Z' });
  assert.equal(calls, 1, 'One synthetic fetch is made for the sole selected page.');
  assert.equal(report.actualGetCount, 1);
  assert.equal(report.maximumActualGets, 2);
  assert.deepEqual(report.results.map(row => row.mapId), [...SOURCE_MAP_IDS]);
  assert.ok(report.results.every(row => row.status === 'VALIDATED' && row.excerptCount > 0),
    JSON.stringify(report.results.map(row => ({ mapId: row.mapId, status: row.status, validationCode: row.validationCode, excerptCount: row.excerptCount }))));
  const serialized = JSON.stringify(report);
  assert.equal(serialized.includes('RAW_HTML_SENTINEL'), false);
  assert.equal(serialized.includes('<html'), false);
  assert.equal(serialized.includes('question'), false);
  assert.equal(ambientCalls, 0);

  const redirectDir = path.join(scratch, 'peer-redirect');
  await runIrasPublicRuleExcerptDiagnostic({ mode: 'plan', outputDirectory: redirectDir });
  const redirectPage = IRAS_SOURCE_MAP_DEFINITIONS.find(item => item.id === SOURCE_MAP_IDS[0]);
  const redirectUrl = new URL(redirectPage.canonicalSourceUrl);
  redirectUrl.hostname = redirectUrl.hostname.toLowerCase() === 'www.iras.gov.sg' ? 'iras.gov.sg' : 'www.iras.gov.sg';
  let redirectCalls = 0;
  const redirectReport = await runIrasPublicRuleExcerptDiagnostic({ mode: 'live-source', outputDirectory: redirectDir,
    fetchImpl: async url => {
      redirectCalls += 1;
      assert.equal(await exists(path.join(redirectDir, CONSUMED_FILENAME)), true,
        'The consumed marker is created before the first canonical or redirect request.');
      if (redirectCalls === 1) return new Response('', { status: 302, headers: { location: redirectUrl.toString() } });
      assert.equal(String(url), redirectUrl.toString());
      return response(syntheticPage(SOURCE_MAP_IDS[0]));
    } });
  assert.equal(redirectCalls, 2, 'A same-path peer-host redirect uses exactly two actual GETs.');
  assert.equal(redirectReport.actualGetCount, 2);
  assert.equal(redirectReport.results[0].status, 'VALIDATED');

  const collisionDir = path.join(scratch, 'output-collision');
  await runIrasPublicRuleExcerptDiagnostic({ mode: 'plan', outputDirectory: collisionDir });
  await writeFile(path.join(collisionDir, REPORT_FILENAME), '{}\n');
  let collisionCalls = 0;
  await assert.rejects(runIrasPublicRuleExcerptDiagnostic({ mode: 'live-source', outputDirectory: collisionDir,
    fetchImpl: async () => { collisionCalls += 1; return response(''); } }), /exists|EEXIST/);
  assert.equal(collisionCalls, 0, 'Output collision refuses the run before any request.');
  assert.equal(await exists(path.join(collisionDir, CONSUMED_FILENAME)), false);

  const tamperDir = path.join(scratch, 'tampered-plan');
  await runIrasPublicRuleExcerptDiagnostic({ mode: 'plan', outputDirectory: tamperDir });
  const tamperedPath = path.join(tamperDir, PLAN_FILENAME);
  const envelope = JSON.parse(await readFile(tamperedPath, 'utf8'));
  envelope.preregistration.sourceMaps[0].canonicalUrl = 'https://example.invalid/changed';
  await writeFile(tamperedPath, `${JSON.stringify(envelope)}\n`);
  let tamperedCalls = 0;
  await assert.rejects(runIrasPublicRuleExcerptDiagnostic({ mode: 'live-source', outputDirectory: tamperDir,
    fetchImpl: async () => { tamperedCalls += 1; return response(''); } }), /PREREGISTRATION_MISMATCH/);
  assert.equal(tamperedCalls, 0, 'A changed preregistration refuses every request.');
  assert.equal(await exists(path.join(tamperDir, CONSUMED_FILENAME)), false);

  const fingerprintDir = path.join(scratch, 'fingerprint-drift');
  await runIrasPublicRuleExcerptDiagnostic({ mode: 'plan', outputDirectory: fingerprintDir,
    readCodeFingerprints: async () => [{ path: 'synthetic-code', sha256: 'before' }] });
  let driftCalls = 0;
  await assert.rejects(runIrasPublicRuleExcerptDiagnostic({ mode: 'live-source', outputDirectory: fingerprintDir,
    readCodeFingerprints: async () => [{ path: 'synthetic-code', sha256: 'after' }],
    fetchImpl: async () => { driftCalls += 1; return response(''); } }), /PREREGISTRATION_MISMATCH/);
  assert.equal(driftCalls, 0, 'Source/code fingerprint drift refuses every request.');
  assert.equal(await exists(path.join(fingerprintDir, CONSUMED_FILENAME)), false);

  const v1ArtifactDriftDir = path.join(scratch, 'v1-artifact-drift');
  await runIrasPublicRuleExcerptDiagnostic({ mode: 'plan', outputDirectory: v1ArtifactDriftDir });
  let v1ArtifactDriftCalls = 0;
  const driftedV1Observation = async filePath => {
    if (String(filePath).replaceAll('\\', '/').endsWith('/iras-public-excerpts-2026-10-03-v1/supervisor-observations.md')) {
      return Buffer.from('synthetic historical V1 observation drift');
    }
    return readFile(filePath);
  };
  await assert.rejects(runIrasPublicRuleExcerptDiagnostic({ mode: 'live-source', outputDirectory: v1ArtifactDriftDir,
    readFileImpl: driftedV1Observation,
    fetchImpl: async () => { v1ArtifactDriftCalls += 1; return response(''); } }), /PREREGISTRATION_MISMATCH/);
  assert.equal(v1ArtifactDriftCalls, 0, 'V1 public artifact drift refuses requests before marker reservation.');
  assert.equal(await exists(path.join(v1ArtifactDriftDir, CONSUMED_FILENAME)), false);

  const postHistoryDir = path.join(scratch, 'post-history-drift');
  await runIrasPublicRuleExcerptDiagnostic({ mode: 'plan', outputDirectory: postHistoryDir });
  let protectedChecks = 0;
  let postHistoryCalls = 0;
  await assert.rejects(runIrasPublicRuleExcerptDiagnostic({ mode: 'live-source', outputDirectory: postHistoryDir,
    checkV1V2History: async () => {
      protectedChecks += 1;
      if (protectedChecks === 2) throw new Error('synthetic post-run V1/V2 historical mismatch');
    },
    fetchImpl: async url => {
      postHistoryCalls += 1;
      const selected = SOURCE_MAP_IDS.find(mapId => IRAS_SOURCE_MAP_DEFINITIONS.find(item => item.id === mapId)?.canonicalSourceUrl === String(url));
      return response(syntheticPage(selected));
    } }));
  assert.equal(postHistoryCalls, 1, 'Post-run history change is detected only after the single bounded synthetic read.');
  assert.equal(await exists(path.join(postHistoryDir, CONSUMED_FILENAME)), true,
    'A post-reservation historical-integrity failure keeps the permanent consumed marker.');
  assert.equal(await exists(path.join(postHistoryDir, REPORT_FILENAME)), false,
    'A post-reservation integrity failure does not publish a report.');

  const historyDir = path.join(scratch, 'history-drift');
  await runIrasPublicRuleExcerptDiagnostic({ mode: 'plan', outputDirectory: historyDir });
  let historyCalls = 0;
  await assert.rejects(runIrasPublicRuleExcerptDiagnostic({ mode: 'live-source', outputDirectory: historyDir,
    checkV1V2History: async () => { throw new Error('synthetic V1/V2 history mismatch'); },
    fetchImpl: async () => { historyCalls += 1; return response(''); } }));
  assert.equal(historyCalls, 0, 'Historical-integrity failure refuses every request.');
  assert.equal(await exists(path.join(historyDir, CONSUMED_FILENAME)), false);

  const consumedDir = path.join(scratch, 'consumed-on-failure');
  await runIrasPublicRuleExcerptDiagnostic({ mode: 'plan', outputDirectory: consumedDir });
  let failedCalls = 0;
  const failedReport = await runIrasPublicRuleExcerptDiagnostic({ mode: 'live-source', outputDirectory: consumedDir,
    fetchImpl: async () => { failedCalls += 1; throw new Error('PRIVATE_URL_CREDENTIAL_SENTINEL'); } });
  assert.equal(failedCalls, 1, 'A provider failure is requested once for the sole mapped page and never retried.');
  assert.ok(failedReport.results.every(row => row.status === 'HTTP_ERROR'));
  assert.equal(await exists(path.join(consumedDir, CONSUMED_FILENAME)), true);
  assert.equal(JSON.stringify(failedReport).includes('PRIVATE_URL_CREDENTIAL_SENTINEL'), false);
  await rm(path.join(consumedDir, REPORT_FILENAME));
  let reuseCalls = 0;
  await assert.rejects(runIrasPublicRuleExcerptDiagnostic({ mode: 'live-source', outputDirectory: consumedDir,
    fetchImpl: async () => { reuseCalls += 1; return response(''); } }), /RUN_CONSUMED/);
  assert.equal(reuseCalls, 0, 'A consumed run cannot be reused after provider failure.');

  console.log('IRAS public rule excerpt diagnostic regressions passed.');
} finally {
  globalThis.fetch = originalFetch;
  await rm(scratch, { recursive: true, force: true });
}
