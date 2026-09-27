import assert from 'node:assert/strict';
import { resolveBuildMetadata } from '../../scripts/buildMetadata.ts';

const timestamp = new Date('2026-09-27T15:09:05.000Z');
const explicitSha = '9b135a2eb93a964209b0c13dcb71272e3182c509';
const githubSha = '2f77b4200e578621ff7438f80a984b20a4c09dd2';

const explicit = resolveBuildMetadata({
  env: { APP_GIT_COMMIT: explicitSha, GITHUB_SHA: githubSha },
  now: timestamp,
  readGitCommit: () => { throw new Error('Git should not be consulted for supplied metadata'); }
});
assert.deepEqual(explicit, {
  gitCommit: explicitSha,
  gitCommitShort: '9b135a2',
  buildTime: '2026-09-27T15:09:05.000Z'
});

const fromViteVariable = resolveBuildMetadata({
  env: { VITE_GIT_COMMIT: explicitSha },
  now: timestamp,
  readGitCommit: () => { throw new Error('Git should not be consulted for supplied metadata'); }
});
assert.equal(fromViteVariable.gitCommit, explicitSha);

const fromGitHub = resolveBuildMetadata({
  env: { GITHUB_SHA: githubSha },
  now: timestamp,
  readGitCommit: () => { throw new Error('Git should not be consulted for GitHub metadata'); }
});
assert.equal(fromGitHub.gitCommit, githubSha);
assert.equal(fromGitHub.gitCommitShort, githubSha.slice(0, 7));

let requestedGitRoot;
const fromLocalGit = resolveBuildMetadata({
  env: {},
  repositoryRoot: 'D:/accounting',
  now: timestamp,
  readGitCommit: (root) => { requestedGitRoot = root; return `${explicitSha}\n`; }
});
assert.equal(requestedGitRoot, 'D:/accounting');
assert.equal(fromLocalGit.gitCommit, explicitSha);

const secretMarker = 'environment-secret-must-not-leak';
const invalidInput = resolveBuildMetadata({
  env: { APP_GIT_COMMIT: 'GH_TOKEN=do-not-inject', GITHUB_SHA: 'also-not-a-sha', UNRELATED_BUILD_SECRET: secretMarker },
  now: timestamp,
  readGitCommit: () => 'credential=never-expose'
});
assert.deepEqual(invalidInput, {
  gitCommit: 'unknown',
  gitCommitShort: 'unknown',
  buildTime: '2026-09-27T15:09:05.000Z'
});
assert.deepEqual(Object.keys(invalidInput).sort(), ['buildTime', 'gitCommit', 'gitCommitShort']);
assert.equal(JSON.stringify(invalidInput).includes(secretMarker), false);

const unavailableGit = resolveBuildMetadata({
  env: {},
  now: timestamp,
  readGitCommit: () => { throw new Error('git unavailable'); }
});
assert.equal(unavailableGit.gitCommit, 'unknown');
assert.equal(unavailableGit.gitCommitShort, 'unknown');

globalThis.__APP_GIT_COMMIT__ = explicit.gitCommit;
globalThis.__APP_GIT_COMMIT_SHORT__ = explicit.gitCommitShort;
globalThis.__APP_BUILD_TIME__ = explicit.buildTime;
globalThis.window = {
  location: { href: 'https://example.test/feedback' },
  __LAST_REQUEST_TELEMETRY__: { durationMs: 123 }
};
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: { userAgent: 'metadata-regression-test' }
});
const { compileFeedbackReport } = await import('../../src/services/feedback.ts');

const previousSecret = process.env.FEEDBACK_TEST_SECRET;
process.env.FEEDBACK_TEST_SECRET = secretMarker;
const report = compileFeedbackReport({
  description: 'The app reported an unexpected result',
  messages: Array.from({ length: 13 }, (_, index) => ({
    id: `m${index}`,
    sender: index === 12 ? 'user' : 'assistant',
    timestamp: '27/09/2026',
    text: `Message ${index}`,
    ...(index === 12 ? {
      fullText: 'Full final message',
      images: [
        { id: 'img1', mimeType: 'image/png' },
        { id: 'img2', mimeType: 'image/png' },
        { id: 'img3', mimeType: 'image/jpeg' }
      ]
    } : {})
  })),
  contactEmail: ' support@example.test ',
  scenario: null,
  providerSettings: {
    activeProvider: 'gemini',
    gemini: { apiKey: 'provider-api-key-must-not-leak', model: 'gemini-3.5-flash-lite' },
    azure: { endpoint: '', apiKey: '', deploymentName: '', apiVersion: '' },
    openai: { apiKey: '', model: '' }
  },
  theme: 'dark',
  fontSize: 'large',
  outputPreference: { journal: false, statutory: false, shareStructure: false }
});
if (previousSecret === undefined) delete process.env.FEEDBACK_TEST_SECRET;
else process.env.FEEDBACK_TEST_SECRET = previousSecret;

assert.deepEqual(report.app, {
  version: '9b135a2',
  gitCommit: explicitSha,
  buildTime: '2026-09-27T15:09:05.000Z',
  theme: 'dark',
  fontSize: 'large',
  activeProvider: 'gemini',
  model: 'gemini-3.5-flash-lite',
  shareStructureEnabled: false
});
assert.equal(report.description, 'The app reported an unexpected result');
assert.equal(report.contactEmail, 'support@example.test');
assert.equal(report.userAgent, 'metadata-regression-test');
assert.equal(report.scenario, undefined);
assert.deepEqual(Object.keys(report), [
  'description', 'contactEmail', 'createdAt', 'pageUrl', 'userAgent', 'app', 'conversation', 'attachments', 'scenario', 'telemetry'
]);
assert.equal(report.conversation.length, 12);
assert.equal(report.conversation[0].text, 'Message 1');
assert.deepEqual(report.conversation.at(-1), { sender: 'user', timestamp: '27/09/2026', text: 'Full final message' });
assert.deepEqual(report.attachments, { imagesAttached: 3, imageTypes: ['image/png', 'image/jpeg'] });
assert.deepEqual(report.telemetry, { durationMs: 123 });
assert.equal(report.pageUrl, 'https://example.test/feedback');

const serialized = JSON.stringify(report);
assert.equal(serialized.includes('provider-api-key-must-not-leak'), false);
assert.equal(serialized.includes(secretMarker), false);
assert.equal(serialized.includes('credential=never-expose'), false);
assert.equal(serialized.includes('GH_TOKEN=do-not-inject'), false);

console.log('✓ Build metadata resolution and feedback payload safety passed.');
