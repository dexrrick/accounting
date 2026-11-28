import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const temporary = mkdtempSync(path.join(tmpdir(), 'statutory-native-knowledge-'));
try {
  const output = path.join(temporary, 'answers.json');
  execFileSync(process.execPath, [path.join(root, 'node_modules/tsx/dist/cli.mjs'),
    path.join(root, 'scripts/evaluate_statutory_natural_20261027.mjs'),
    `--corpus=${path.join(root, 'tests/evaluation/statutory_knowledge_development_20261027b.json')}`,
    `--source-manifests=${path.join(root, 'tests/fixtures/statutoryKnowledge20261027b')}`, `--out=${output}`],
  { cwd: root, stdio: 'pipe', timeout: 90_000 });
  const report = JSON.parse(readFileSync(output, 'utf8'));
  assert.equal(report.outcomes.length, 17);
  for (const row of report.outcomes.filter(row => row.id !== 'dev-mas-17')) {
    assert.match(row.answer, /rule explanation/, `${row.id}: a substantive explanation reaches the production renderer`);
    assert.ok(row.evidenceStatuses.some(stream => stream.evidenceStatus === 'VERIFIED'),
      `${row.id}: the explanation is backed by verified issue evidence`);
    assert.deepEqual(row.semanticFixture.mappedTopicIds, [], 'Evaluation supplies no topic mapping hints.');
  }
  const row = id => report.outcomes.find(item => item.id === id);
  assert.match(row('dev-acra-01').answer, /20 October 2026[\s\S]*auditors/i);
  assert.match(row('dev-acra-03').answer, /19 October 2026/);
  assert.match(row('dev-iras-09').answer, /connected person[\s\S]*recover/i);
  assert.match(row('dev-cpf-13').answer, /12\.5%[\s\S]*12\.5%/);
  const cpfSources = row('dev-cpf-13').result.workstreams.flatMap(stream => stream.issues).flatMap(issue => issue.sources);
  assert.ok(cpfSources.some(source => source.sourceLocator?.sourceType === 'PDF'
    && source.documentHash === '7ab21a34bd830be773b5bf39020f590d61e744fb7df6c91922352cef82789496'),
  'The rate-table answer retains the genuine CPF PDF hash and PDF locator.');
  assert.match(row('dev-mas-16').answer, /1 January 2027[\s\S]*21 calendar days/);
  assert.doesNotMatch(row('dev-mas-17').answer, /rule explanation/);
  assert.ok(row('dev-mas-17').evidenceStatuses.every(stream => stream.evidenceStatus === 'INSUFFICIENT'),
    'A generic MAS financial-return document cannot establish the QDC specification.');
  assert.equal(report.networkRequests, 0);
  assert.equal(report.modelRequests, 0);

  const momCorpusPath = path.join(temporary, 'mom-annual-leave-unknown-population.json');
  const momOutputPath = path.join(temporary, 'mom-annual-leave-unknown-population-output.json');
  writeFileSync(momCorpusPath, JSON.stringify({ cases: [{
    id: 'mom-annual-leave-unknown-population', authority: 'MOM', domain: 'MOM_EMPLOYMENT',
    population: 'UNKNOWN', operation: 'CHECK_ELIGIBILITY',
    question: 'What is the minimum annual leave entitlement and how does it increase?',
    subject: 'Employment Act annual leave eligibility, entitlement, and proration',
    expectedScope: 'GENERAL_WITH_MISSING_FACTS'
  }] }, null, 2));
  execFileSync(process.execPath, [path.join(root, 'node_modules/tsx/dist/cli.mjs'),
    path.join(root, 'scripts/evaluate_statutory_natural_20261027.mjs'),
    `--corpus=${momCorpusPath}`,
    `--source-manifests=${path.join(root, 'tests/fixtures/statutoryKnowledge20261027b')}`,
    `--out=${momOutputPath}`],
  { cwd: root, stdio: 'pipe', timeout: 90_000 });
  const momReport = JSON.parse(readFileSync(momOutputPath, 'utf8'));
  const momLeave = momReport.outcomes[0];
  assert.match(momLeave.answer, /MOM rule explanation[\s\S]*Employment Act-covered employee[\s\S]*7 days[\s\S]*14 days/i);
  assert.match(momLeave.answer, /completed months[\s\S]*probation/i,
    'The production-rendered annual-leave explanation preserves the source-backed probation qualification.');
  assert.equal(momLeave.evidenceStatuses[0].issues[0].evidenceStatus, 'VERIFIED',
    'The source-backed conditional general rule is verified for an unknown requester population.');
  assert.equal(momLeave.evidenceStatuses[0].issues[0].applicationStatus, 'UNRESOLVED',
    'The production path leaves the employee-specific eligibility question unresolved.');
  assert.match(momLeave.answer, /party in scope: Not established[\s\S]*Application unresolved/i);
  assert.equal(momReport.networkRequests, 0);
  assert.equal(momReport.modelRequests, 0);
  console.log('Statutory knowledge production-path checks passed (16 source-backed cases, QDC gap and unresolved MOM eligibility preserved).');
} finally {
  assert.equal(path.dirname(temporary), path.resolve(tmpdir()));
  rmSync(temporary, { recursive: true, force: true });
}
