import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const plan = JSON.parse(await readFile(path.join(root, 'docs/evaluation/multi-authority-workstreams/iras-first-live-2026-10-03-v9/iras-mapped-evidence-plan-v9.json'), 'utf8'));
const rows = [];
function collect(value) {
  if (Array.isArray(value)) { value.forEach(collect); return; }
  if (!value || typeof value !== 'object') return;
  if (typeof value.path === 'string' && typeof value.sha256 === 'string') { rows.push(value); return; }
  Object.values(value).forEach(collect);
}
collect(plan.preregistration.historicalFingerprints);
assert.equal(rows.length, 389, 'Retain the complete frozen V9 historical row inventory, including duplicates.');
for (const row of rows) {
  assert.equal(createHash('sha256').update(await readFile(path.join(root, row.path))).digest('hex'), row.sha256, `Historical artifact changed: ${row.path}`);
}
console.log(`PASS: ${rows.length} frozen V9 historical fingerprint rows (${new Set(rows.map(row=>row.path)).size} distinct paths).`);
