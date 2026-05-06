import { describe, it, expect, vi } from 'vitest';
import { groupByAuthor, groupConsecutiveRuns, buildYesterdayWindow, buildWindowUntilNow, buildSquashMessage } from '../../src/jobs/squash.js';
import type { GitHubCommit } from '../../src/types.js';

const makeCommit = (sha: string, authorLogin: string, date: string, treeSha = 'tree', parentShas = ['p']): GitHubCommit => ({
  sha, shortSha: sha.slice(0, 7), message: `feat: ${sha}`, authorLogin, date, treeSha, parentShas,
});

describe('groupByAuthor', () => {
  it('groups commits by authorLogin', () => {
    const commits = [
      makeCommit('aaa', 'alice', '2025-04-24T10:00:00Z'),
      makeCommit('bbb', 'bob', '2025-04-24T10:30:00Z'),
      makeCommit('ccc', 'alice', '2025-04-24T11:00:00Z'),
    ];
    const groups = groupByAuthor(commits);
    expect(groups).toHaveLength(2);
    const alice = groups.find(g => g.authorLogin === 'alice')!;
    expect(alice.commits).toHaveLength(2);
  });

  it('returns one group per unique author', () => {
    const commits = [
      makeCommit('aaa', 'alice', '2025-04-24T10:00:00Z'),
      makeCommit('bbb', 'alice', '2025-04-24T11:00:00Z'),
    ];
    const groups = groupByAuthor(commits);
    expect(groups).toHaveLength(1);
  });
});

describe('groupConsecutiveRuns', () => {
  it('keeps interleaved authors as separate runs', () => {
    const commits = [
      makeCommit('a1', 'alice', '2025-04-24T10:00:00Z'),
      makeCommit('b1', 'bob',   '2025-04-24T10:30:00Z'),
      makeCommit('a2', 'alice', '2025-04-24T11:00:00Z'),
    ];
    const runs = groupConsecutiveRuns(commits);
    expect(runs).toHaveLength(3);
    expect(runs[0]).toEqual({ authorLogin: 'alice', commits: [commits[0]] });
    expect(runs[1]).toEqual({ authorLogin: 'bob',   commits: [commits[1]] });
    expect(runs[2]).toEqual({ authorLogin: 'alice', commits: [commits[2]] });
  });

  it('merges consecutive same-author commits into one run', () => {
    const commits = [
      makeCommit('a1', 'alice', '2025-04-24T10:00:00Z'),
      makeCommit('a2', 'alice', '2025-04-24T10:30:00Z'),
      makeCommit('b1', 'bob',   '2025-04-24T11:00:00Z'),
    ];
    const runs = groupConsecutiveRuns(commits);
    expect(runs).toHaveLength(2);
    expect(runs[0].commits).toHaveLength(2);
    expect(runs[1].commits).toHaveLength(1);
  });

  it('returns empty array for empty input', () => {
    expect(groupConsecutiveRuns([])).toEqual([]);
  });
});

describe('buildYesterdayWindow', () => {
  it('returns midnight-to-midnight UTC window for yesterday', () => {
    const now = new Date('2025-04-25T02:00:00Z');
    const { since, until, dateStr } = buildYesterdayWindow('UTC', now);
    expect(since.toISOString()).toBe('2025-04-24T00:00:00.000Z');
    expect(until.toISOString()).toBe('2025-04-25T00:00:00.000Z');
    expect(dateStr).toBe('2025-04-24');
  });
});

describe('buildWindowUntilNow', () => {
  it('uses provided since and now as until', () => {
    const since = new Date('2026-04-20T00:00:00.000Z');
    const now = new Date('2026-04-26T09:00:00.000Z');
    const { since: s, until, dateStr } = buildWindowUntilNow(since, now);
    expect(s).toBe(since);
    expect(until).toBe(now);
    expect(dateStr).toBe('2026-04-20 → now');
  });
});

describe('buildSquashMessage', () => {
  it('formats squash commit message correctly', () => {
    const commits = [
      makeCommit('abc1234', 'alice', '2025-04-24T10:00:00Z'),
      makeCommit('def5678', 'alice', '2025-04-24T11:00:00Z'),
    ];
    const msg = buildSquashMessage('alice', '2025-04-24', commits);
    expect(msg).toContain('daily(@alice): 2 changes on 2025-04-24');
    expect(msg).toContain('feat: abc1234 (abc1234)');
    expect(msg).toContain('feat: def5678 (def5678)');
  });
});
