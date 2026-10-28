import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const temporary = mkdtempSync(path.join(tmpdir(), 'iras-wht-filing-production-'));
try {
  const corpusPath = path.join(temporary, 'cases.json');
  const outputPath = path.join(temporary, 'answers.json');
  writeFileSync(corpusPath, JSON.stringify({ cases: [
    {
      id: 'wht-zero-treaty-filing', authority: 'IRAS', domain: 'IRAS_INCOME_TAX',
      question: 'If a treaty reduces withholding tax to zero, can we omit the WHT filing?',
      subject: 'Withholding tax filing requirement when treaty rate is zero',
      expectedScope: 'GENERAL_RULE',
      expected: ['Filing remains required despite zero rate under DTA/ARI; distinguish payment amount from filing duty'],
      forbidden: ['Zero WHT automatically removes filing duty']
    }
  ] }, null, 2));

  execFileSync(process.execPath, [
    path.join(root, 'node_modules/tsx/dist/cli.mjs'),
    path.join(root, 'scripts/evaluate_statutory_natural_20261027.mjs'),
    `--corpus=${corpusPath}`,
    `--source-manifests=${path.join(root, 'tests/fixtures/statutoryKnowledge20261027b')}`,
    `--out=${outputPath}`
  ], { cwd: root, stdio: 'pipe', timeout: 90_000 });

  const report = JSON.parse(readFileSync(outputPath, 'utf8'));
  assert.equal(report.outcomes.length, 1);
  assert.equal(report.networkRequests, 0);
  assert.equal(report.modelRequests, 0);
  const byId = id => report.outcomes.find(row => row.id === id);
  const issueFor = row => row.result.workstreams.flatMap(stream => stream.issues)
    .find(issue => issue.subject === row.subject);
  const treaty = byId('wht-zero-treaty-filing');
  const treatyIssue = issueFor(treaty);
  assert.equal(treaty.evidenceStatuses.find(stream => stream.authority === 'IRAS').evidenceStatus, 'VERIFIED');
  assert.match(treaty.answer, /IRAS rule explanation:[\s\S]*WHT still must be filed when a DTA or ARI makes the rate zero/i);
  const dueUrl = 'https://www.iras.gov.sg/taxes/withholding-tax/withholding-tax-filing/withholding-tax-filing-and-payment-due-date';
  const dueSource = treatyIssue.sources.find(source => source.canonicalSourceUrl === dueUrl);
  assert.ok(dueSource, 'the filing conclusion cites the native IRAS due-date page');
  const dueClaims = treatyIssue.verifiedClaims.filter(claim => claim.recordId === dueSource.id);
  assert.equal(dueClaims.length, 6, 'all six source-backed WHT filing passages remain in one verified source group');
  assert.ok(dueClaims.some(claim => /WHT must be filed even if.*DTA.*ARI/i.test(claim.quote)));
  assert.ok(dueClaims.some(claim => /director's fees approved in arrears[\s\S]*director's fees approved in advance/i.test(claim.quote)));

  console.log('WHT filing/treaty production replay passed; unrelated service-treatment source control is covered by the focused source test.');
} finally {
  assert.equal(path.dirname(temporary), path.resolve(tmpdir()));
  rmSync(temporary, { recursive: true, force: true });
}
