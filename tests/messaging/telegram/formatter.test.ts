import { describe, it, expect } from 'vitest';
import {
  formatNoteAppend,
  formatSummaryMessage,
  formatReleaseNotesMessage,
} from '../../../src/messaging/telegram/formatter.js';

describe('formatNoteAppend', () => {
  it('formats a timestamped HTML comment + text block', () => {
    const result = formatNoteAppend('Meeting recap.', 'alice', new Date('2025-04-25T14:32:00Z'));
    expect(result).toBe('\n<!-- note: 2025-04-25T14:32Z | @alice -->\nMeeting recap.\n');
  });
});

describe('formatSummaryMessage', () => {
  it('formats per-author summaries in Telegram HTML', () => {
    const result = formatSummaryMessage('last 24h', [
      { authorLogin: 'alice', summary: 'Alice worked on auth.', files: [] },
      { authorLogin: 'bob', summary: 'Bob fixed the bug.', files: ['src/fix.ts'] },
    ]);
    expect(result).toContain('📋 <b>Project summary — last 24h</b>');
    expect(result).toContain('<b>@alice</b>');
    expect(result).toContain('Alice worked on auth.');
    expect(result).toContain('<b>@bob</b>');
    expect(result).toContain('Bob fixed the bug.');
    expect(result).toContain('<code>src/fix.ts</code>');
  });

  it('returns no-commits message when summaries array is empty', () => {
    const result = formatSummaryMessage('last 24h', []);
    expect(result).toBe('No commits found in the last 24h.');
  });
});

describe('formatReleaseNotesMessage', () => {
  it('formats per-author release notes in Telegram HTML', () => {
    const result = formatReleaseNotesMessage('last 1d', [
      { authorLogin: 'alice', notes: '✨ New & Improved\n- Added dark mode' },
      { authorLogin: 'bob', notes: '🐛 Fixes\n- Login no longer crashes' },
    ]);
    expect(result).toContain('🚀 <b>Release notes — last 1d</b>');
    expect(result).toContain('<b>@alice</b>');
    expect(result).toContain('Added dark mode');
    expect(result).toContain('<b>@bob</b>');
    expect(result).toContain('Login no longer crashes');
  });

  it('escapes HTML in the notes body', () => {
    const result = formatReleaseNotesMessage('last 1d', [
      { authorLogin: 'alice', notes: 'fixed <Foo> & <Bar>' },
    ]);
    expect(result).toContain('fixed &lt;Foo&gt; &amp; &lt;Bar&gt;');
  });

  it('returns no-commits message when empty', () => {
    expect(formatReleaseNotesMessage('last 1d', [])).toBe('No commits found in the last 1d.');
  });
});

