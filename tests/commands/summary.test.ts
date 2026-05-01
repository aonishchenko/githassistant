import { describe, it, expect, vi } from 'vitest';
import type { Octokit } from '@octokit/rest';
import type { Config, AIProvider, AdapterContext } from '../../src/types.js';
import { parsePeriod, createSummaryPlugin } from '../../src/commands/summary.js';

const config: Config = {
  telegram: { botToken: '', groupId: '', allowedUsers: [] },
  github: { token: '', owner: 'o', repo: 'r', defaultBranch: 'main' },
  note: { allowedPaths: ['docs'], shortcuts: {}, allowedExtensions: ['md'] },
  ai: { provider: 'anthropic', anthropicApiKey: '', anthropicModel: '' },
  scheduler: { nightlyCron: '', timezone: 'UTC' },
  behavior: { summaryMaxDays: 7, squashEnabled: true, summaryLanguage: 'en', logLevel: 'info', rateLimitPerMin: 10 },
  meeting: { notesFolder: 'meetings' },
};

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

describe('parsePeriod', () => {
  const now = new Date('2025-04-25T12:00:00Z');

  it('defaults to last 24 hours when arg is empty', () => {
    const { since, label } = parsePeriod('', 7, now);
    expect(since.toISOString()).toBe(new Date('2025-04-24T12:00:00Z').toISOString());
    expect(label).toBe('last 24h');
  });

  it('parses "3d" as 3 days back', () => {
    const { since } = parsePeriod('3d', 7, now);
    expect(since.toISOString()).toBe(new Date('2025-04-22T12:00:00Z').toISOString());
  });

  it('parses "1w" as 7 days back', () => {
    const { since } = parsePeriod('1w', 7, now);
    expect(since.toISOString()).toBe(new Date('2025-04-18T12:00:00Z').toISOString());
  });

  it('parses ISO date string', () => {
    const { since, label } = parsePeriod('2025-04-20', 7, now);
    expect(since.toISOString()).toBe(new Date('2025-04-20T00:00:00Z').toISOString());
    expect(label).toBe('since 2025-04-20');
  });

  it('throws when period exceeds maxDays', () => {
    expect(() => parsePeriod('10d', 7, now)).toThrow('Maximum summary window is 7 days');
  });

  it('throws for invalid period format', () => {
    expect(() => parsePeriod('banana', 7, now)).toThrow();
  });
});

describe('createSummaryPlugin', () => {
  it('registers as /summary with no auth required', () => {
    const octokit = {} as Octokit;
    const ai: AIProvider = { summarise: vi.fn() };
    const { plugin } = createSummaryPlugin(octokit, config, ai);
    expect(plugin.command).toBe('summary');
    expect(plugin.requiresAuth).toBe(false);
  });

  it('replies with no-commits message when no commits found', async () => {
    const octokit = {
      paginate: vi.fn().mockResolvedValue([]),
      repos: { listCommits: vi.fn().mockResolvedValue({ data: [] }) },
      request: vi.fn(),
    } as unknown as Octokit;
    const ai: AIProvider = { summarise: vi.fn() };
    const { plugin } = createSummaryPlugin(octokit, config, ai);
    const ctx = makeCtx('');
    await plugin.handler(ctx);
    expect(ctx.replyText).toHaveBeenCalledWith(expect.stringContaining('No commits found'));
  });

  it('replies with error for invalid period', async () => {
    const octokit = {} as Octokit;
    const ai: AIProvider = { summarise: vi.fn() };
    const { plugin } = createSummaryPlugin(octokit, config, ai);
    const ctx = makeCtx('100d');
    await plugin.handler(ctx);
    expect(ctx.replyText).toHaveBeenCalledWith(expect.stringContaining('Maximum summary window'));
  });
});
