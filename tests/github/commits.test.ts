import { describe, it, expect, vi } from 'vitest';
import type { Octokit } from '@octokit/rest';
import type { Config } from '../../src/types.js';
import { fetchCommits, fetchCommitDiff, createCommit, updateBranchRef } from '../../src/github/commits.js';

const config: Config = {
  telegram: { botToken: '', groupId: '', allowedUsers: [] },
  github: { token: 'tok', owner: 'owner', repo: 'repo', defaultBranch: 'main' },
  note: { allowedPaths: ['docs'], shortcuts: {}, allowedExtensions: ['md', 'txt'] },
  ai: { provider: 'anthropic', anthropicApiKey: '', anthropicModel: '' },
  scheduler: { nightlyCron: '', timezone: 'UTC' },
  behavior: { summaryMaxDays: 7, squashEnabled: true, summaryLanguage: 'en', logLevel: 'info', rateLimitPerMin: 10 },
};

function makeOctokit(overrides: Record<string, unknown> = {}): Octokit {
  return {
    paginate: vi.fn().mockResolvedValue([]),
    repos: {
      listCommits: vi.fn().mockResolvedValue({ data: [] }),
      ...(overrides.repos as object ?? {}),
    },
    git: {
      createCommit: vi.fn().mockResolvedValue({ data: { sha: 'newsha' } }),
      updateRef: vi.fn().mockResolvedValue({}),
      ...(overrides.git as object ?? {}),
    },
    request: vi.fn().mockResolvedValue({ data: 'diff content' }),
    ...(overrides as object),
  } as unknown as Octokit;
}

const RAW_COMMIT = {
  sha: 'abc1234567',
  commit: {
    message: 'feat: add login\n\nBody text',
    author: { date: '2025-04-24T10:00:00Z', name: 'Alice' },
    tree: { sha: 'tree123' },
  },
  author: { login: 'alice' },
  parents: [{ sha: 'parent1' }],
};

describe('fetchCommits', () => {
  it('maps raw API response to GitHubCommit', async () => {
    const octokit = makeOctokit({
      paginate: vi.fn().mockResolvedValue([RAW_COMMIT]),
    });
    const commits = await fetchCommits(octokit, config, new Date('2025-04-24T00:00:00Z'));
    expect(commits).toHaveLength(1);
    expect(commits[0]).toEqual({
      sha: 'abc1234567',
      shortSha: 'abc1234',
      message: 'feat: add login',
      authorLogin: 'alice',
      date: '2025-04-24T10:00:00Z',
      treeSha: 'tree123',
      parentShas: ['parent1'],
    });
  });

  it('returns empty array when no commits', async () => {
    const octokit = makeOctokit();
    const commits = await fetchCommits(octokit, config, new Date());
    expect(commits).toEqual([]);
  });
});

describe('fetchCommitDiff', () => {
  it('fetches diff via request with diff media type', async () => {
    const request = vi.fn().mockResolvedValue({ data: 'diff --git a/file.md' });
    const octokit = makeOctokit({ request });
    const diff = await fetchCommitDiff(octokit, config, 'abc123');
    expect(request).toHaveBeenCalledWith(
      'GET /repos/{owner}/{repo}/commits/{ref}',
      expect.objectContaining({ ref: 'abc123', headers: { accept: 'application/vnd.github.diff' } }),
    );
    expect(diff).toBe('diff --git a/file.md');
  });
});

describe('createCommit', () => {
  it('creates a commit and returns its sha', async () => {
    const createCommitMock = vi.fn().mockResolvedValue({ data: { sha: 'newsha123' } });
    const octokit = makeOctokit({ git: { createCommit: createCommitMock, updateRef: vi.fn() } });
    const sha = await createCommit(octokit, config, {
      message: 'daily(@alice): 2 changes on 2025-04-24',
      treeSha: 'tree999',
      parentSha: 'parent888',
    });
    expect(sha).toBe('newsha123');
    expect(createCommitMock).toHaveBeenCalledWith(expect.objectContaining({
      message: 'daily(@alice): 2 changes on 2025-04-24',
      tree: 'tree999',
      parents: ['parent888'],
    }));
  });
});

describe('updateBranchRef', () => {
  it('calls git.updateRef with force=true', async () => {
    const updateRef = vi.fn().mockResolvedValue({});
    const octokit = makeOctokit({ git: { createCommit: vi.fn(), updateRef } });
    await updateBranchRef(octokit, config, 'tipshaXYZ');
    expect(updateRef).toHaveBeenCalledWith(expect.objectContaining({
      ref: 'heads/main',
      sha: 'tipshaXYZ',
      force: true,
    }));
  });
});
