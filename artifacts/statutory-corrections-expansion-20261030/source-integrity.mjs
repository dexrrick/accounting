import { readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const directories = ['tests/fixtures/statutoryKnowledge20261027b', 'tests/fixtures/statutoryWorkflows20261029', 'tests/fixtures/statutoryDevelopment20261027'];
const sources = [];
for (const directory of directories) {
  for (const filename of await readdir(directory)) {
    if (!filename.endsWith('source-manifest.json')) continue;
    const manifest = JSON.parse(await readFile(directory + '/' + filename, 'utf8'));
    for (const source of manifest.sources) {
      const fixture = source.nativePdfFixture || source.fixture || source.file;
      const expected = source.nativePdfFixture
        ? source.nativePdfSha256 || source.sourceResponseSha256 || source.sourceDocumentSha256 || source.sha256
        : source.fixtureSha256 || source.sha256;
      const actual = createHash('sha256').update(await readFile(directory + '/' + fixture)).digest('hex');
      if (!expected || actual !== expected) throw new Error('Fixture integrity mismatch: ' + fixture);
      let excerptSha256;
      if (source.nativePdfFixture && source.fixture && source.fixture !== source.nativePdfFixture) {
        excerptSha256 = createHash('sha256').update(await readFile(directory + '/' + source.fixture)).digest('hex');
        if (excerptSha256 !== (source.excerptSha256 || source.fixtureSha256 || source.sha256)) throw new Error('Excerpt integrity mismatch: ' + source.fixture);
      }
      sources.push({ directory, fixture, manifest: filename, officialUrl: source.url || source.officialUrl,
        fixtureKind: source.fixtureKind || source.kind, fixtureSha256: actual, excerptSha256,
        excerpt: excerptSha256 ? source.fixture : undefined,
        adaptation: /EXCERPT|EXTRACT|VISIBLE_TEXT/.test(source.fixtureKind || '') ? 'Text excerpts receive a declared HTML identity envelope in offline replay; native PDF bytes remain native.' : 'Native response retained.' });
    }
  }
}
const report = { status: 'PASS', capturedFixturesVerified: sources.length, sources,
  limits: 'Retained bytes and declared digests verified. Text excerpt envelopes are explicitly identified. Unit and application regressions separately test exact URL, missing premises, reversed requirements, issue binding and single revision. No fixture retrieval date is used as a legal effective date. Public CPF/IRAS pages and MAS toolkit rows were checked read-only; no live application/model/browser acceptance or source activation occurred.' };
await writeFile(new URL('source-integrity.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ status: report.status, verified: sources.length }));
