import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseActionItems, autoIssueFromSummary } from '../../src/github/autoIssue.js';
import type { Config } from '../../src/types.js';

vi.mock('../../src/github/issues.js', () => ({
  listLabels: vi.fn().mockResolvedValue([]),
  listOpenIssues: vi.fn().mockResolvedValue([]),
  createIssue: vi.fn(),
  findRepoProject: vi.fn().mockResolvedValue(null),
  addIssueToProject: vi.fn(),
}));

const SUMMARY_WITH_ITEMS = `
## Executive Summary
The team met to discuss Q2 priorities.

## Action Items

| # | Owner | Action | Deadline |
|---|-------|--------|----------|
| 1 | Potros Abrahim | Reach out to his network and introduce the platform | ASAP |
| 2 | TBD | Review the proposal | — |
| 3 | Amanda Pousette | Write the onboarding guide | 2026-06-01 |

## Discussion Topics

### Q2 Priorities
Some discussion here.
`;

const SUMMARY_NO_SECTION = `
## Executive Summary
No action items section here.

## Discussion Topics
Nothing to do.
`;

const SUMMARY_EMPTY_SECTION = `
## Action Items

No table provided.

## Discussion Topics
Done.
`;

describe('parseActionItems', () => {
  it('extracts all action items from a well-formed table', () => {
    const items = parseActionItems(SUMMARY_WITH_ITEMS);
    expect(items).toEqual([
      { owner: 'Potros Abrahim', action: 'Reach out to his network and introduce the platform' },
      { owner: 'TBD', action: 'Review the proposal' },
      { owner: 'Amanda Pousette', action: 'Write the onboarding guide' },
    ]);
  });

  it('returns empty array when no Action Items section exists', () => {
    expect(parseActionItems(SUMMARY_NO_SECTION)).toEqual([]);
  });

  it('returns empty array when Action Items section has no table', () => {
    expect(parseActionItems(SUMMARY_EMPTY_SECTION)).toEqual([]);
  });

  it('stops at the next ## section', () => {
    const items = parseActionItems(SUMMARY_WITH_ITEMS);
    expect(items.every(i => i.owner !== 'Q2 Priorities')).toBe(true);
  });
});

describe('autoIssueFromSummary', () => {
  const baseConfig: Config = {
    telegram: { botToken: '', groupId: '', allowedUsers: [] },
    github: { token: '', owner: 'org', repo: 'repo', defaultBranch: 'main' },
    note: { allowedPaths: [], excludedPaths: [], shortcuts: {}, allowedExtensions: [] },
    meeting: {
      notesFolder: 'meetings',
      autoIssueOwners: [
        { name: 'Potros Abrahim', login: 'potros-bridge' },
      ],
    },
    ai: { provider: 'cloudflare', anthropicApiKey: '', anthropicModel: '', openaiApiKey: '', openaiModel: '', cfAiModel: '' },
    scheduler: { nightlyCron: '', timezone: 'UTC' },
    behavior: { summaryMaxDays: 7, summaryLanguage: 'en', logLevel: 'info', rateLimitPerMin: 10, aiInputTruncateChars: null, aiCallDelayMs: 0, dailySummaryMaxCommits: 25 },
  };

  const mockOctokit = {} as any;
  const mockAiProvider = { summarise: vi.fn().mockResolvedValue('bug') } as any;
  const mockLog = { error: vi.fn(), warn: vi.fn(), info: vi.fn() } as any;
  const mockUsageCtx = { trigger: 'test', username: 'cron' };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty array when autoIssueOwners is empty', async () => {
    const config = { ...baseConfig, meeting: { ...baseConfig.meeting, autoIssueOwners: [] } };
    const result = await autoIssueFromSummary(SUMMARY_WITH_ITEMS, config, mockOctokit, mockAiProvider, mockLog, mockUsageCtx);
    expect(result).toEqual([]);
  });

  it('returns empty array when no action items match configured owners', async () => {
    const config = {
      ...baseConfig,
      meeting: { ...baseConfig.meeting, autoIssueOwners: [{ name: 'Unknown Person', login: 'unknown' }] },
    };
    const result = await autoIssueFromSummary(SUMMARY_WITH_ITEMS, config, mockOctokit, mockAiProvider, mockLog, mockUsageCtx);
    expect(result).toEqual([]);
  });

  it('is case-insensitive when matching owner names', () => {
    const items = parseActionItems(SUMMARY_WITH_ITEMS);
    const ownerMap = new Map([['potros abrahim', 'potros-bridge']]);
    const matched = items.filter(i => ownerMap.has(i.owner.toLowerCase().trim()));
    expect(matched).toHaveLength(1);
    expect(matched[0].action).toBe('Reach out to his network and introduce the platform');
  });
});
