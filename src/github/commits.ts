import type { Octokit } from '@octokit/rest';
import type { Config, GitHubCommit } from '../types.js';

export async function fetchCommits(
  octokit: Octokit,
  config: Config,
  since: Date,
  until?: Date,
): Promise<GitHubCommit[]> {
  const params: Record<string, unknown> = {
    owner: config.github.owner,
    repo: config.github.repo,
    sha: config.github.defaultBranch,
    since: since.toISOString(),
    per_page: 100,
  };
  if (until) params.until = until.toISOString();

  const data = await octokit.paginate(
    octokit.repos.listCommits,
    params as Parameters<typeof octokit.repos.listCommits>[0],
  );

  return data.map(c => ({
    sha: c.sha,
    shortSha: c.sha.slice(0, 7),
    message: (c.commit.message ?? '').split('\n')[0],
    authorLogin: c.author?.login ?? c.commit.author?.name ?? 'unknown',
    date: c.commit.author?.date ?? new Date().toISOString(),
    treeSha: c.commit.tree.sha,
    parentShas: c.parents.map(p => p.sha),
  }));
}

export async function fetchCommitDiff(
  octokit: Octokit,
  config: Config,
  sha: string,
): Promise<string> {
  const { data } = await octokit.request('GET /repos/{owner}/{repo}/commits/{ref}', {
    owner: config.github.owner,
    repo: config.github.repo,
    ref: sha,
    headers: { accept: 'application/vnd.github.diff' },
  });
  return data as unknown as string;
}

export async function createCommit(
  octokit: Octokit,
  config: Config,
  params: { message: string; treeSha: string; parentSha: string },
): Promise<string> {
  const { data } = await octokit.git.createCommit({
    owner: config.github.owner,
    repo: config.github.repo,
    message: params.message,
    tree: params.treeSha,
    parents: [params.parentSha],
  });
  return data.sha;
}

export async function updateBranchRef(
  octokit: Octokit,
  config: Config,
  sha: string,
): Promise<void> {
  await octokit.git.updateRef({
    owner: config.github.owner,
    repo: config.github.repo,
    ref: `heads/${config.github.defaultBranch}`,
    sha,
    force: true,
  });
}
