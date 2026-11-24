import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const regressionDirectory = path.dirname(fileURLToPath(import.meta.url));
const frozenSourcePath = path.join(regressionDirectory, 'test_iras_wht_overview_topic_binding.mjs');
const runTag = `${process.pid}-${Date.now()}`;
const adaptedPath = path.join(regressionDirectory,
  `.test_iras_wht_overview_topic_binding.current-scope-v2-${runTag}.mjs`);
const expectedFrozenSha256 = 'aa050c06eb19c3eeb312b6321345fee6a74201755fb3f6a536c1636bba1edf31';
const hash = value => createHash('sha256').update(value).digest('hex');
const temporaryPaths = [];

function replacePinnedAssertion(source, from, to, label) {
  const occurrences = source.split(from).length - 1;
  assert.equal(occurrences, 1, `${label}: expected exactly one frozen assertion.`);
  const adapted = source.replace(from, to);
  assert.equal(adapted.split(to).length - 1, 1, `${label}: adapted assertion must occur exactly once.`);
  return adapted;
}

try {
  const frozenBytes = await readFile(frozenSourcePath);
  assert.equal(hash(frozenBytes), expectedFrozenSha256,
    'Archived WHT test checksum changed; refusing to adapt the frozen source.');
  const newline = frozenBytes.includes(Buffer.from('\r\n')) ? '\r\n' : '\n';
  let adaptedSource = frozenBytes.toString('utf8');
  adaptedSource = replacePinnedAssertion(adaptedSource,
    "assert.equal(defaultPathControl.result.status, 'VERIFIED');",
    [
      "assert.equal(defaultPathControl.result.evidenceStatus, 'VERIFIED');",
      "assert.notEqual(defaultPathControl.result.requestCompletenessContext.evaluation.status, 'COMPLETE');",
      "assert.equal(defaultPathControl.result.status, 'CONDITIONAL');"
    ].join(newline), 'Default-retriever WHT control');
  adaptedSource = replacePinnedAssertion(adaptedSource,
    "assert.equal(positive.result.status, 'VERIFIED');",
    [
      "assert.equal(positive.result.evidenceStatus, 'VERIFIED');",
      "assert.notEqual(positive.result.requestCompletenessContext.evaluation.status, 'COMPLETE');",
      "assert.equal(positive.result.status, 'CONDITIONAL');"
    ].join(newline), 'Positive WHT control');

  await writeFile(adaptedPath, adaptedSource, { encoding: 'utf8', flag: 'wx' });
  temporaryPaths.push(adaptedPath);
  await import(`${pathToFileURL(adaptedPath).href}?current-scope-v2=${runTag}`);
} finally {
  await Promise.all(temporaryPaths.map(file => rm(file, { force: true })));
}

process.stdout.write('Current-scope WHT compatibility adapter passed; the frozen source remains unchanged.\n');
