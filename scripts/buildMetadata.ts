import { execFileSync } from 'node:child_process';

const COMMIT_SHA_PATTERN = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i;

export interface BuildMetadata {
  gitCommit: string;
  gitCommitShort: string;
  buildTime: string;
}

export interface BuildMetadataOptions {
  env?: Record<string, string | undefined>;
  repositoryRoot?: string;
  now?: Date;
  readGitCommit?: (cwd: string) => string;
}

const validCommitSha = (value: string | undefined): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const sha = value.trim();
  return COMMIT_SHA_PATTERN.test(sha) ? sha.toLowerCase() : undefined;
};

export const resolveBuildMetadata = ({
  env = process.env,
  repositoryRoot = process.cwd(),
  now = new Date(),
  readGitCommit = (cwd) => execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore']
  })
}: BuildMetadataOptions = {}): BuildMetadata => {
  const suppliedCommit = [env.APP_GIT_COMMIT, env.VITE_GIT_COMMIT, env.GITHUB_SHA]
    .map(validCommitSha)
    .find((commit): commit is string => Boolean(commit));
  let gitCommit = suppliedCommit;

  if (!gitCommit) {
    try {
      gitCommit = validCommitSha(readGitCommit(repositoryRoot));
    } catch {
      // Git metadata is optional for exported source archives and non-Git builds.
    }
  }

  gitCommit ||= 'unknown';

  return {
    gitCommit,
    gitCommitShort: gitCommit === 'unknown' ? 'unknown' : gitCommit.slice(0, 7),
    buildTime: now.toISOString()
  };
};
