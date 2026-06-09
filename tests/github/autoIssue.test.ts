import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseActionItems, autoIssueFromSummary, canonicaliseActionItemOwners } from '../../src/github/autoIssue.js';
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
| 1 | John First | Reach out to his network and introduce the platform | ASAP |
| 2 | TBD | Review the proposal | — |
| 3 | Joanna Second | Write the onboarding guide | 2026-06-01 |

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
      { owner: 'John First', action: 'Reach out to his network and introduce the platform' },
      { owner: 'TBD', action: 'Review the proposal' },
      { owner: 'Joanna Second', action: 'Write the onboarding guide' },
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

describe('canonicaliseActionItemOwners', () => {
  const summary = [
    '## Action Items',
    '',
    '| # | Owner | Action | Deadline |',
    '|---|-------|--------|----------|',
    '| 1 | John | Review terms and conditions | ASAP |',
    '| 2 | Sam | Finalize the app setup | ASAP |',
    '| 3 | Joanna | Finish the design review | ASAP |',
    '| 4 | Team | Review the FAQ | ASAP |',
    '| 5 | TBD | Decide later | — |',
  ].join('\n');

  const transcript = 'Sam Third led the call with John First and Joanna Second.';
  const configOwners = [
    { name: 'John First', login: 'john-gh' },
    { name: 'Joanna Second', login: 'joanna-gh' },
  ];

  it('expands short names to full names from config and transcript', () => {
    const out = canonicaliseActionItemOwners(summary, transcript, configOwners);
    expect(out).toContain('| 1 | John First | Review terms and conditions | ASAP |');
    expect(out).toContain('| 2 | Sam Third | Finalize the app setup | ASAP |');
    expect(out).toContain('| 3 | Joanna Second | Finish the design review | ASAP |');
  });

  it('leaves role/placeholder owners untouched', () => {
    const out = canonicaliseActionItemOwners(summary, transcript, configOwners);
    expect(out).toContain('| 4 | Team | Review the FAQ | ASAP |');
    expect(out).toContain('| 5 | TBD | Decide later | — |');
  });

  it('makes auto-issue owner matching work after expansion', () => {
    const out = canonicaliseActionItemOwners(summary, transcript, configOwners);
    const items = parseActionItems(out);
    expect(items.find(i => i.action.startsWith('Review terms'))?.owner).toBe('John First');
  });

  it('leaves names already full unchanged', () => {
    const full = '## Action Items\n| # | Owner | Action | Deadline |\n|---|---|---|---|\n| 1 | John First | X | ASAP |';
    expect(canonicaliseActionItemOwners(full, transcript, configOwners)).toBe(full);
  });

  it('does not expand an ambiguous transcript name', () => {
    // "Sam Smith" and "Sam Jones" both appear -> ambiguous, leave "Sam" as-is
    const s = '## Action Items\n| # | Owner | Action | Deadline |\n|---|---|---|---|\n| 1 | Sam | Do X | ASAP |';
    const t = 'Sam Smith and Sam Jones disagreed.';
    expect(canonicaliseActionItemOwners(s, t, [])).toContain('| 1 | Sam | Do X | ASAP |');
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
        { name: 'John First', login: 'john-gh' },
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
    const ownerMap = new Map([['john first', 'john-gh']]);
    const matched = items.filter(i => ownerMap.has(i.owner.toLowerCase().trim()));
    expect(matched).toHaveLength(1);
    expect(matched[0].action).toBe('Reach out to his network and introduce the platform');
  });
});
