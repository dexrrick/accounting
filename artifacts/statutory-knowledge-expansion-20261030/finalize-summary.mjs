import { readFileSync, writeFileSync } from 'node:fs';
const dir = new URL('./', import.meta.url);
const read = file => JSON.parse(readFileSync(new URL(file, dir), 'utf8').replace(/^\uFEFF/, ''));
const review = read('independent-final-review.json');
const validation = read('validation-results.json');
if (validation.length !== 10) throw new Error('Validation is incomplete');
const suites = Object.fromEntries(['smoke', 'full'].map(name => {
  const log = readFileSync(new URL(name + '.log', dir), 'utf8');
  return [name, { passed: (log.match(/^✅ PASS \|/gm) || []).length,
    failed: (log.match(/^❌ FAIL \|/gm) || []).length,
    exitCode: validation.find(item => item.check === name).exitCode }];
}));
const summary = {
  scope: 'OFFLINE_RULES_ONLY_APPLICATION_AND_RETAINED_NATIVE_OFFICIAL_SOURCES',
  repository: 'https://github.com/dexrrick/accounting',
  branch: 'codex/statutory-knowledge-expansion-20261030',
  comparisonBase: review.baseCommit,
  completedAtUTC: new Date().toISOString(),
  changes: ['Conditional-wage CPF refund deadline uses only an unambiguous owned repayment date; ordinary payment-date rule remains separate',
    'Mixed CPF calculation/refund request preserves both asks and requests missing payroll facts without fabricated amount or journal',
    'Independent medical/van GST issues and Form25A/nil-misconduct/fund-scope issues retain their own exact-source proof',
    'Bounded new donations, CPF record rectifications, payslip records, registered-office and VCFM Form23A/Form7 guidance',
    'Project usage policy checks shared limits automatically and checkpoints before the greater-than-5-percent reserve'],
  independent75: { baseline: read('baseline-grades.json').counts, final: review.counts,
    perAuthority: review.perAuthority, newlyCorrect: review.newlyCorrect,
    previouslyCorrectPreserved: review.previouslyCorrectPreserved },
  targetedAcceptance: '6/6 independently correct; P2 reproductions 2 correct and QDC unsupported',
  previous60: 'Nine changed answers independently correct, including two newly correct; 51 byte-identical answers inherit prior grades and were not re-adjudicated',
  validation, suites,
  lintQualification: 'Root oxlint exits 1: diagnostic JSON identifies 34 parse errors in archived artifacts/fresh-acceptance-2026-10-24/prepare.mjs. Maintained src/scripts/tests lint passes. No lint gate or archived file changed.',
  runtime: 'Canonical Node 22.23.3; direct package-script equivalents because npm is unavailable; external network blocked during offline captures and replay',
  sourceIntegrity: read('source-integrity-report.json'),
  preservation: read('preservation-report.json').fixedCorpus,
  gaps: ['Unchanged acra-13 incorrect VCC assumption', '47 unsupported and 7 partial frozen questions remain; see per-question independent grades',
    'Precise VCFM QDC form, applicability and deadline unverified', 'Historical ACRA applicability and uncovered MAS transition variants remain bounded',
    'No live model, browser, CI or production acceptance; no PR, merge, deployment or source activation'],
  evidence: ['independent-final-review.json', 'baseline75.json', 'final75.json', 'acceptance.json', 'p2-after.json',
    'previous60-changed-review.json', 'preservation-report.json', 'source-integrity-report.json', 'validation-results.json', 'qdc-investigation.json']
};
writeFileSync(new URL('completion-summary.json', dir), JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify({ suites, counts: review.counts, fixedCorpusPassed: read('preservation-report.json').fixedCorpusPassed }));
