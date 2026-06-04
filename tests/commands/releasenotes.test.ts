import { describe, it, expect, vi } from 'vitest';
import type { Octokit } from '@octokit/rest';
import type { Config, AIProvider, AdapterContext } from '../../src/types.js';
import { createReleaseNotesPlugin } from '../../src/commands/releasenotes.js';

const config: Config = {
  telegram: { botToken: '', groupId: '', allowedUsers: [] },
  github: { token: '', owner: 'o', repo: 'r', defaultBranch: 'main' },
  note: { allowedPaths: ['docs'], shortcuts: {}, allowedExtensions: ['md'] },
  ai: { provider: 'anthropic', anthropicApiKey: '', anthropicModel: '', openaiApiKey: '', openaiModel: '' },
  scheduler: { nightlyCron: '', timezone: 'UTC' },
  behavior: { summaryMaxDays: 7, summaryLanguage: 'en', logLevel: 'info', rateLimitPerMin: 10, aiInputTruncateChars: null, aiCallDelayMs: 0, dailySummaryMaxCommits: 25 },
  meeting: { notesFolder: 'meetings', autoIssueOwners: [] },
};

const log = { error: vi.fn(), info: vi.fn(), warn: vi.fn() } as any;

function makeCtx(text: string): AdapterContext {
  return {
    userId: '1', username: 'alice', text,
    replyText: vi.fn(),
    showOptions: vi.fn(),
    setPendingNote: vi.fn(),
    getPendingNote: vi.fn(),
    clearPendingNote: vi.fn(),
  };
}

describe('createReleaseNotesPlugin', () => {
  it('registers as /releasenotes requiring auth', () => {
    const plugin = createReleaseNotesPlugin({} as Octokit, config, { summarise: vi.fn() }, log);
    expect(plugin.command).toBe('releasenotes');
    expect(plugin.requiresAuth).toBe(true);
  });

  it('replies when no commits are found', async () => {
    const octokit = { paginate: vi.fn().mockResolvedValue([]), repos: { listCommits: vi.fn() } } as unknown as Octokit;
    const plugin = createReleaseNotesPlugin(octokit, config, { summarise: vi.fn() }, log);
    const ctx = makeCtx('');
    await plugin.handler(ctx);
    expect(ctx.replyText).toHaveBeenCalledWith(expect.stringContaining('No commits found'));
  });

  it('generates per-author release notes from commit diffs', async () => {
    const commits = [
      { sha: 'sha_a', author: { login: 'alice' }, commit: { message: 'feat: dark mode', author: { date: '2026-06-04T01:00:00Z' }, tree: { sha: 't' } }, parents: [] },
      { sha: 'sha_b', author: { login: 'bob' }, commit: { message: 'fix: login crash', author: { date: '2026-06-04T01:00:00Z' }, tree: { sha: 't' } }, parents: [] },
    ];
    const summarise = vi.fn()
      .mockResolvedValueOnce('✨ New & Improved\n- Dark mode')   // alice
      .mockResolvedValueOnce('🐛 Fixes\n- Login fixed');          // bob
    const octokit = {
      paginate: vi.fn().mockResolvedValue(commits),
      repos: { listCommits: vi.fn() },
      request: vi.fn().mockResolvedValue({ data: 'diff --git a/x b/x\n+code' }),
    } as unknown as Octokit;
    const provider: AIProvider = { summarise };
    const plugin = createReleaseNotesPlugin(octokit, config, provider, log);
    const ctx = makeCtx('1d');
    await plugin.handler(ctx);

    expect(summarise).toHaveBeenCalledTimes(2);
    const sent = vi.mocked(ctx.replyText).mock.calls.map(c => c[0]).join('\n');
    expect(sent).toContain('🚀 <b>Release notes — last 1d</b>');
    expect(sent).toContain('<b>@alice</b>');
    expect(sent).toContain('Dark mode');
    expect(sent).toContain('<b>@bob</b>');
    expect(sent).toContain('Login fixed');
  });
});
