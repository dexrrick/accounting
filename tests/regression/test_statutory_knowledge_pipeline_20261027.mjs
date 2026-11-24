import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const temporary = mkdtempSync(path.join(tmpdir(), 'statutory-knowledge-'));
try {
  const output = path.join(temporary, 'answers.json');
  execFileSync(process.execPath, [path.join(root, 'node_modules/tsx/dist/cli.mjs'),
    path.join(root, 'scripts/evaluate_statutory_natural_20261027.mjs'), `--out=${output}`],
  { cwd: root, stdio: 'pipe', timeout: 90_000 });
  const report = JSON.parse(readFileSync(output, 'utf8'));
  assert.equal(report.outcomes.length, 30, 'Independent corpus remains separate and complete.');
  const row = id => report.outcomes.find(item => item.id === id);
  for (const id of ['natural-iras-01', 'natural-iras-02', 'natural-cpf-01', 'natural-cpf-02',
    'natural-mom-02', 'natural-acra-01', 'natural-acra-02', 'natural-acra-04']) {
    assert.match(row(id).answer, /rule explanation/, `${id}: a usable general explanation reaches the rendered production path`);
  }
  assert.match(row('natural-iras-01').answer, /GST-registered[\s\S]*Missing Trader Fraud/);
  assert.match(row('natural-iras-02').answer, /three months[\s\S]*(?:waiver|not required)/);
  assert.match(row('natural-cpf-02').answer, /14th[\s\S]*Additional Wages/);
  for (const id of ['natural-cpf-03', 'natural-cpf-04', 'natural-cpf-05', 'natural-mas-01', 'natural-mas-02', 'natural-mas-03']) {
    assert.match(row(id).answer, /rule explanation/, `${id}: the new family renders through real source admission and verification`);
  }
  const nativePdfHash = createHash('sha256').update(readFileSync(path.join(root,
    'tests/fixtures/statutoryDevelopment20261027/mas-lfmc-toolkit.pdf'))).digest('hex');
  assert.ok(row('natural-mas-01').result.workstreams.flatMap(stream => stream.issues).flatMap(issue => issue.sources)
    .some(source => source.documentHash === nativePdfHash && source.sourceLocator?.sourceType === 'PDF'
      && source.sourceLocator.pageCount === 17), 'MAS evidence retains its genuine native PDF hash and locator.');
  for (const id of ['natural-iras-03', 'natural-cpf-02', 'natural-mom-03', 'natural-acra-05']) {
    assert.ok(row(id).evidenceStatuses.every(stream => stream.applicationStatus !== 'VERIFIED'),
      `${id}: a general criteria question or unresolved application never becomes a verified case conclusion`);
  }
  for (const item of report.outcomes.filter(item => item.expectedScope === 'HISTORICAL_UNRESOLVED')) {
    assert.doesNotMatch(item.answer, /rule explanation/, `${item.id}: no current rule is presented as historical proof`);
    assert.ok(item.evidenceStatuses.every(stream => stream.evidenceStatus !== 'VERIFIED'));
  }
  assert.equal(report.networkRequests, 0);
  assert.equal(report.modelRequests, 0);
  console.log('Statutory knowledge production-path regressions passed (natural wording, unresolved applications and historical controls).');
} finally {
  assert.equal(path.dirname(temporary), path.resolve(tmpdir()), 'Only the generated test directory in the temporary folder may be cleaned up.');
  rmSync(temporary, { recursive: true, force: true });
}
