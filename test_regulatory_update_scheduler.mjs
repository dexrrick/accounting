import assert from 'node:assert/strict';
import { getDueAuthorities } from './src/retrieval/regulatoryUpdateScheduler.ts';

const now = Date.UTC(2026, 8, 12, 0, 0, 0);
assert.deepEqual(getDueAuthorities({}, now).sort(), ['ACRA', 'AGC', 'CPF', 'IRAS', 'MOM']);
assert.deepEqual(getDueAuthorities({ IRAS: now - 23 * 60 * 60 * 1000, CPF: now - 23 * 60 * 60 * 1000, MOM: now - 23 * 60 * 60 * 1000, AGC: now - 6 * 24 * 60 * 60 * 1000, ACRA: now - 6 * 24 * 60 * 60 * 1000 }, now), []);
assert.deepEqual(getDueAuthorities({ IRAS: now - 24 * 60 * 60 * 1000, CPF: now, MOM: now, AGC: now, ACRA: now }, now), ['IRAS']);
assert.deepEqual(getDueAuthorities({ IRAS: now, CPF: now, MOM: now, AGC: now - 7 * 24 * 60 * 60 * 1000, ACRA: now }, now), ['AGC']);
console.log('PASS | Regulatory update scheduler cadence: daily, weekly, and duplicate suppression');
