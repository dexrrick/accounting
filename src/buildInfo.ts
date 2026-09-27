const gitCommit = typeof __APP_GIT_COMMIT__ === 'string' ? __APP_GIT_COMMIT__ : 'unknown';
const gitCommitShort = typeof __APP_GIT_COMMIT_SHORT__ === 'string' ? __APP_GIT_COMMIT_SHORT__ : 'unknown';
const buildTime = typeof __APP_BUILD_TIME__ === 'string' ? __APP_BUILD_TIME__ : 'unknown';

export const appBuildInfo = Object.freeze({
  version: gitCommitShort,
  gitCommit,
  gitCommitShort,
  buildTime
});
