import { describe, it, expect } from 'vitest';
import {
  formatNoteAppend,
  formatSummaryMessage,
  formatSquashCommitMessage,
} from '../../../src/messaging/telegram/formatter.js';
import type { GitHubCommit } from '../../../src/types.js';

describe('formatNoteAppend', () => {
  it('formats a timestamped HTML comment + text block', () => {
    const result = formatNoteAppend('Meeting recap.', 'alice', new Date('2025-04-25T14:32:00Z'));
    expect(result).toBe('\n<!-- note: 2025-04-25T14:32Z | @alice -->\nMeeting recap.\n');
  });
});

describe('formatSummaryMessage', () => {
  it('formats per-author summaries in Telegram Markdown', () => {
    const result = formatSummaryMessage('last 24h', [
      { authorLogin: 'alice', summary: 'Alice worked on auth.' },
      { authorLogin: 'bob', summary: 'Bob fixed the bug.' },
    ]);
    expect(result).toContain('📋 *Project summary — last 24h*');
    expect(result).toContain('👤 *@alice*');
    expect(result).toContain('Alice worked on auth.');
    expect(result).toContain('👤 *@bob*');
    expect(result).toContain('Bob fixed the bug.');
  });

  it('returns no-commits message when summaries array is empty', () => {
    const result = formatSummaryMessage('last 24h', []);
    expect(result).toBe('No commits found in the last 24h.');
  });
});

describe('formatSquashCommitMessage', () => {
  const commits: GitHubCommit[] = [
    { sha: 'aaa1111', shortSha: 'aaa1111', message: 'feat: add export', authorLogin: 'alice', date: '', treeSha: '', parentShas: [] },
    { sha: 'bbb2222', shortSha: 'bbb2222', message: 'fix: pagination', authorLogin: 'alice', date: '', treeSha: '', parentShas: [] },
  ];

  it('formats a squash commit message with bullet list', () => {
    const result = formatSquashCommitMessage('alice', '2025-04-24', commits);
    expect(result).toBe(
      'daily(@alice): 2 changes on 2025-04-24\n\n- feat: add export (aaa1111)\n- fix: pagination (bbb2222)',
    );
  });
});
