import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { access, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { assertNewAuthorizationEnvelope, assertRawSha256 } from './launch.mjs';

const ROOT = 'D:/Accounting';
const EXECUTION = 'artifacts/iras-v4-acceptance-repaired-2026-10-06/post-repair-2026-10-08/execution';
const LAUNCHER = path.join(ROOT, EXECUTION, 'launch.mjs');
const NODE = process.execPath;
const missingAuthorizationCode = 'NEW_EXPLICIT_AUTHORIZATION_REQUIRED';

function safeEnvironment() {
  const env = { GEMINI_API_KEY: 'MUST_NOT_BE_READ_FOR_PENDING_AUTHORIZATION' };
  for (const name of ['PATH', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP']) {
    if (process.env[name]) env[name] = process.env[name];
  }
  return env;
}

function runLauncher(...args) {
  return spawnSync(NODE, [LAUNCHER, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    windowsHide: true,
    env: safeEnvironment()
  });
}

async function exists(target) {
  try { await access(target); return true; }
  catch (error) { if (error?.code === 'ENOENT') return false; throw error; }
}

test('live modes reject missing authorization before any side effect', async () => {
  const executionPath = path.join(ROOT, EXECUTION);
  const capturePath = path.join(ROOT,
    'artifacts/iras-v4-acceptance-repaired-2026-10-06/post-repair-2026-10-08/official-capture');
  const semanticPath = path.join(ROOT,
    'artifacts/iras-v4-acceptance-repaired-2026-10-06/semantic-run-v4-post-repair-2026-10-08');
  assert.equal(await exists(path.join(executionPath, 'authorization.json')), false,
    'offline regression requires the live authorization to remain absent');
  const before = (await readdir(executionPath)).sort();
  assert.equal(await exists(capturePath), false);
  assert.equal(await exists(semanticPath), false);

  for (const mode of ['--capture', '--semantic']) {
    const result = runLauncher(mode);
    assert.equal(result.status, 1, `${mode} unexpectedly succeeded: ${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout + result.stderr, new RegExp(missingAuthorizationCode));
    assert.equal(await exists(capturePath), false, `${mode} created the capture directory`);
    assert.equal(await exists(semanticPath), false, `${mode} created the semantic namespace`);
    assert.deepEqual((await readdir(executionPath)).sort(), before, `${mode} changed execution files`);
  }
});

test('unknown or extra launch arguments fail closed', () => {
  const invalidMode = runLauncher('--network');
  assert.equal(invalidMode.status, 1);
  assert.match(invalidMode.stdout + invalidMode.stderr, /INVALID_LAUNCH_ARGUMENTS/);

  const extraMode = runLauncher('--capture', '--semantic');
  assert.equal(extraMode.status, 1);
  assert.match(extraMode.stdout + extraMode.stderr, /INVALID_LAUNCH_ARGUMENTS/);
});

test('the false-only authorization template cannot pass the live authorization gate', async () => {
  const templatePath = path.join(ROOT, EXECUTION, 'authorization-template.json');
  const template = JSON.parse(await readFile(templatePath, 'utf8'));
  assert.equal(template.priorAuthorizationReusable, false);
  assert.throws(() => assertNewAuthorizationEnvelope(template),
    error => error?.code === 'NEW_EXPLICIT_AUTHORIZATION_REQUIRED');
  const reviewTemplatePath = path.join(ROOT, EXECUTION, 'resource-authorization-review-template.json');
  const reviewTemplate = JSON.parse(await readFile(reviewTemplatePath, 'utf8'));
  assert.equal(reviewTemplate.reviewer, null);
  assert.deepEqual(reviewTemplate.verifiedBindingSha256, {
    'artifacts/iras-v4-acceptance-repaired-2026-10-06/post-repair-2026-10-08/preparation/runner-configuration.json': 'f7712ede781edb10e6057d17d1d3a373d48b2f6825c7793377ccbcaf85f69852',
    'artifacts/iras-v4-acceptance-repaired-2026-10-06/post-repair-2026-10-08/preparation/preregistration.json': 'feafc2a67e0cf56da4f71d3d6424b1ef23b0b4344a4e27e39d403eec62451aeb',
    'artifacts/iras-v4-acceptance-repaired-2026-10-06/post-repair-2026-10-08/preparation/activation-configuration.json': '9e0f55d7d4e72555f51cf9f280cf5e959b8cadd1245c2e08a8e515f772c1b1fc'
  });
});

test('altered bytes fail the same raw hash check used for frozen inputs', () => {
  const frozen = Buffer.from('pinned frozen input');
  const expected = createHash('sha256').update(frozen).digest('hex');
  const altered = Buffer.from('altered frozen input');
  assert.throws(() => assertRawSha256(altered, expected, 'FROZEN_BOUND_FILE_HASH_MISMATCH'),
    error => error?.code === 'ERR_ASSERTION' && error?.message.startsWith('FROZEN_BOUND_FILE_HASH_MISMATCH'));
});
