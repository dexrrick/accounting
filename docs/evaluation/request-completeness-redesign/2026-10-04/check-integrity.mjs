import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const git = process.env.REQUEST_COMPLETENESS_GIT ?? 'git';
const baseline = '9f7682a6ba32fd3b39ea84bec8391d1e1421db4f';
const run = (...args) => execFileSync(git, args, { cwd: root, maxBuffer: 32 * 1024 * 1024 });
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const planPath = 'docs/evaluation/multi-authority-workstreams/iras-first-live-2026-10-03-v9/iras-mapped-evidence-plan-v9.json';
const plan = JSON.parse(run('show', `${baseline}:${planPath}`).toString('utf8'));
const rows = [];
function collect(value) {
  if (Array.isArray(value)) return value.forEach(collect);
  if (!value || typeof value !== 'object') return;
  if (typeof value.path === 'string' && typeof value.sha256 === 'string') return rows.push(value);
  Object.values(value).forEach(collect);
}
collect(plan.preregistration.historicalFingerprints);
assert.equal(rows.length, 389);
const paths = [...new Set(rows.map(row => row.path))];
const originals = new Map();
const originalRoot = process.env.REQUEST_COMPLETENESS_ORIGINAL ?? 'D:/Accounting/';
const lf = bytes => Buffer.from(bytes.toString('utf8').replaceAll('\r\n', '\n'));
let originalToGitEolDifferences = 0;
const checkoutDifferences = [];
for (const path of paths) {
  const blob = run('show', `${baseline}:${path}`);
  const original = readFileSync(new URL(path, `file:///${originalRoot.replaceAll('\\', '/')}`));
  originals.set(path, digest(original));
  assert.equal(digest(lf(original)), digest(lf(blob)), `Stored content differs from original frozen material: ${path}`);
  if (digest(original) !== digest(blob)) originalToGitEolDifferences += 1;
  const checkout = readFileSync(new URL(path, `file:///${root.replaceAll('\\', '/')}`));
  if (digest(checkout) !== digest(blob)) {
    assert.equal(digest(Buffer.from(checkout.toString('utf8').replaceAll('\r\n', '\n'))), digest(blob), `Non-line-ending checkout change: ${path}`);
    checkoutDifferences.push(path);
  }
}
for (const row of rows) assert.equal(originals.get(row.path), row.sha256, `Original frozen bytes changed: ${row.path}`);
const allowed = ['docs/evaluation/request-completeness-redesign/2026-10-04/', 'tests/evaluation/request-completeness/'];
const changed = run('diff', '--name-only', baseline, '--').toString('utf8').trim().split(/\r?\n/).filter(Boolean);
const untracked = run('ls-files', '--others', '--exclude-standard').toString('utf8').trim().split(/\r?\n/).filter(Boolean);
for (const path of [...changed, ...untracked]) assert.ok(allowed.some(prefix => path.startsWith(prefix)), `Out-of-scope change: ${path}`);
assert.equal(run('rev-parse', 'refs/heads/codex/multi-authority-workstreams').toString('utf8').trim(), baseline, 'Original branch moved');
console.log(JSON.stringify({ baseline, frozenRows: rows.length, distinctPaths: paths.length, originalByteFingerprints: 'PASS', storedGitContent: 'PASS_WITH_EOL_ACCOUNTING', originalToGitEolDifferences, checkoutByteFingerprints: checkoutDifferences.length ? 'CRLF_CHECKOUT_DIFFERENCES' : 'PASS', crlfOnlyPaths: checkoutDifferences.length, protectedProductionV4AndHistoryDiff: 'UNCHANGED', diffScope: 'TRACKED_AND_NONIGNORED_UNTRACKED', originalBranch: 'UNCHANGED', permittedChanges: [...changed, ...untracked] }, null, 2));
