import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const regressionDirectory = path.dirname(fileURLToPath(import.meta.url));
const resolutionDirectory = path.join(repositoryRoot,
  'docs/evaluation/multi-authority-workstreams/iras-first-contract-resolution-2026-10-04');
const legacyV4Directory = path.join(repositoryRoot,
  'docs/evaluation/multi-authority-workstreams/iras-first-local-2026-10-02-v4');
const temporaryPaths = [];
const runTag = `${process.pid}-${Date.now()}`;
const hash = value => createHash('sha256').update(value).digest('hex');
const previousTraceOutput = process.env.EVIDENCE_TRACE_OUTPUT;

async function transformPinnedSibling(sourcePath, destinationPath, expectedSha256, replacements) {
  const source = await readFile(sourcePath);
  assert.equal(hash(source), expectedSha256,
    `Archived source checksum changed; refusing to adapt ${path.basename(sourcePath)}.`);
  let text = source.toString('utf8');
  for (const { from, to, label } of replacements) {
    const occurrences = text.split(from).length - 1;
    assert.equal(occurrences, 1, `${label}: expected exactly one pinned source fragment.`);
    text = text.replace(from, to);
    assert.equal(text.split(to).length - 1, 1, `${label}: adapted fragment must occur exactly once.`);
  }
  await writeFile(destinationPath, text, { encoding: 'utf8', flag: 'wx' });
  temporaryPaths.push(destinationPath);
  return destinationPath;
}

try {
const v4StageSource = path.join(legacyV4Directory, 'test-local-evidence-stages.mjs');
const v4StageName = `test-local-evidence-stages-current-scope-v2-${runTag}.mjs`;
const v4StageAdapted = path.join(resolutionDirectory, v4StageName);
const originalV4StageAssertion = "assert.equal(foreignNegative?.firstFailingStage, 'ISSUE_SUBJECT_CONCEPT_FILTER');";
const adaptedV4StageAssertion = [
  "assert.equal(foreignNegative?.firstFailingStage, 'EVIDENCE_ADMISSION', 'Current rule evidence rejects this no-dividend passage before claim selection.');",
  "assert.equal(foreignNegative?.finalIssueClaimCount, 0, 'The foreign-income-only negative still verifies no requested dividend claim.');",
  "assert.notEqual(foreignNegative?.issueEvidenceStatus, 'VERIFIED', 'The no-dividend control remains fail-closed.');"
].join('\n');

const v4FixtureSource = path.join(legacyV4Directory, 'local-evidence-fixtures.json');
const v4FixtureBytes = await readFile(v4FixtureSource);
await writeFile(path.join(resolutionDirectory, 'local-evidence-fixtures.json'), v4FixtureBytes, { flag: 'wx' });
temporaryPaths.push(path.join(resolutionDirectory, 'local-evidence-fixtures.json'));
await transformPinnedSibling(v4StageSource, v4StageAdapted,
  '68894d3c93bf9fb30c5f62c041128d0380bd6f5ce2d73a6b30e9fe58efb2d475', [
    { from: originalV4StageAssertion, to: adaptedV4StageAssertion, label: 'V4 local-stage ownership point' }
  ]);

const v4OuterSource = path.join(regressionDirectory, 'test_iras_multi_authority_evidence_v4.mjs');
const v4OuterAdapted = path.join(regressionDirectory, `.test_iras_multi_authority_evidence_v4.current-scope-v2-${runTag}.mjs`);
const originalV4Import = "await import('../../docs/evaluation/multi-authority-workstreams/iras-first-local-2026-10-02-v4/test-local-evidence-stages.mjs');";
const adaptedV4Import = `await import('../../docs/evaluation/multi-authority-workstreams/iras-first-contract-resolution-2026-10-04/${v4StageName}');`;
await transformPinnedSibling(v4OuterSource, v4OuterAdapted,
  '0edce3c96b63097fcbc38554310217b86f0b8e56ce431dfde3e21eb208f3cab9', [
    { from: originalV4Import, to: adaptedV4Import, label: 'V4 outer harness import' }
  ]);

const renderedAssertion = "assert.ok(privateRender.uncoveredConceptIds.includes(privateRequestedConceptId),\n      'Rendered evidence quality must report the requested private-expense concept as uncovered for generic synthetic text');";
const runtimeConceptAssertion = "assert.ok(privateRuntime.uncoveredConceptIds.includes(privateRequestedConceptId),\n      'Central issue coverage must expose only the known private-expense concept ID as uncovered');";
for (const version of ['v5', 'v8', 'v9']) {
  const sourcePath = path.join(regressionDirectory, `test_iras_mapped_evidence_diagnostic_${version}.mjs`);
  const adaptedPath = path.join(regressionDirectory,
    `.test_iras_mapped_evidence_diagnostic_${version}.current-scope-v2-${runTag}.mjs`);
  const expectedHashes = {
    v5: 'cabbfeb2ca25b832a594892a15ca0606ebb160533ff1062c58eeea30b0436597',
    v8: 'ee961d0e79fd2e8afe3d6ff9fe8c11e6bbc0e741581655284b958f38e56aff8b',
    v9: 'fd5112413a77ac868ea98c0e7114aee621410b5c16f8f5a404802bc65f14a401'
  };
  const assertion = `const { assertSec15Attribution } = await import('./current_scope_v2_mapped_compatibility_helper.mjs');\n    await assertSec15Attribution({ privateRender, privateRuntime, privateRequestedConceptId, version: '${version}' });`;
  await transformPinnedSibling(sourcePath, adaptedPath, expectedHashes[version], [
    { from: renderedAssertion, to: assertion, label: `${version.toUpperCase()} rendered source attribution` },
    {
      from: runtimeConceptAssertion,
      to: "assert.equal(privateRuntime.uncoveredConceptIds.includes(privateRequestedConceptId), false,\n      'The covered private-expense concept is not itself an uncovered runtime concept.');",
      label: `${version.toUpperCase()} runtime concept ownership`
    }
  ]);
}

delete process.env.EVIDENCE_TRACE_OUTPUT;
  await import(`${pathToFileURL(v4OuterAdapted).href}?current-scope-v2=${runTag}`);
  for (const version of ['v5', 'v8', 'v9']) {
    const adaptedPath = path.join(regressionDirectory,
      `.test_iras_mapped_evidence_diagnostic_${version}.current-scope-v2-${runTag}.mjs`);
    await import(`${pathToFileURL(adaptedPath).href}?current-scope-v2=${runTag}`);
  }
} finally {
  if (previousTraceOutput === undefined) delete process.env.EVIDENCE_TRACE_OUTPUT;
  else process.env.EVIDENCE_TRACE_OUTPUT = previousTraceOutput;
  await Promise.all(temporaryPaths.map(file => rm(file, { force: true })));
}

process.stdout.write('Current-scope V2 archived V4/V5/V8/V9 compatibility adapters passed.\n');
