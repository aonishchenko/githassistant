import { describe, it, expect, vi } from 'vitest';
import {
  RELEASE_NOTES_PROMPT,
  summariseReleaseNotes,
  generatePerAuthorReleaseNotes,
  stripEmptyReleaseNoteSections,
} from '../../src/ai/skills/releaseNotes.js';
import type { AIProvider } from '../../src/types.js';

const log = { error: vi.fn() };

describe('RELEASE_NOTES_PROMPT', () => {
  it('includes the author and period and the three section headers', () => {
    const p = RELEASE_NOTES_PROMPT('alice', 'last 1d');
    expect(p).toContain('@alice');
    expect(p).toContain('last 1d');
    expect(p).toContain('✨ New & Improved');
    expect(p).toContain('🐛 Fixes');
    expect(p).toContain('🔧 Behind the scenes');
  });
});

describe('stripEmptyReleaseNoteSections', () => {
  it('removes sections whose only content is a placeholder', () => {
    const input = [
      '✨ New & Improved',
      '* Added dark mode',
      '',
      '🐛 Fixes',
      '* (no notable fixes)',
      '',
      '🔧 Behind the scenes',
      '* (no notable changes)',
    ].join('\n');
    const out = stripEmptyReleaseNoteSections(input);
    expect(out).toContain('✨ New & Improved');
    expect(out).toContain('Added dark mode');
    expect(out).not.toContain('🐛 Fixes');
    expect(out).not.toContain('🔧 Behind the scenes');
    expect(out).not.toContain('no notable');
  });

  it('removes sections with sentence-form "nothing happened" placeholders', () => {
    const input = [
      '✨ New & Improved',
      '* Added dark mode',
      '',
      '🐛 Fixes',
      '* No bugs were fixed in this release.',
      '',
      '🔧 Behind the scenes',
      '* No major infrastructure, backend, or architecture changes were made in this release.',
    ].join('\n');
    const out = stripEmptyReleaseNoteSections(input);
    expect(out).toContain('Added dark mode');
    expect(out).not.toContain('🐛 Fixes');
    expect(out).not.toContain('Behind the scenes');
    expect(out).not.toContain('No bugs were fixed');
    expect(out).not.toContain('No major');
  });

  it('keeps sections that have real items', () => {
    const input = '🐛 Fixes\n* Login no longer crashes';
    expect(stripEmptyReleaseNoteSections(input)).toBe(input);
  });

  it('does not drop a genuine "No longer ..." fix', () => {
    const input = '🐛 Fixes\n* No longer crashes on startup when the cache is empty';
    expect(stripEmptyReleaseNoteSections(input)).toBe(input);
  });

  it('falls back to a single line when everything is empty', () => {
    const input = '🐛 Fixes\n* (no notable fixes)';
    expect(stripEmptyReleaseNoteSections(input)).toBe('(no notable changes)');
  });
});

describe('summariseReleaseNotes', () => {
  it('makes a single call for small input', async () => {
    const summarise = vi.fn().mockResolvedValue('✨ New & Improved\n- Added X');
    const provider: AIProvider = { summarise };
    const out = await summariseReleaseNotes(provider, 'alice', 'last 1d', ['commit: feat X\ndiff']);
    expect(out).toContain('Added X');
    expect(summarise).toHaveBeenCalledTimes(1);
  });

  it('chunks and consolidates when input exceeds the budget', async () => {
    const summarise = vi.fn()
      .mockResolvedValueOnce('extract A')
      .mockResolvedValueOnce('extract B')
      .mockResolvedValueOnce('final notes');
    const provider: AIProvider = { summarise };
    const huge = 'x'.repeat(45_000);
    const out = await summariseReleaseNotes(provider, 'alice', 'last 1d', [huge]);
    expect(out).toBe('final notes');
    // 2 chunk extractions + 1 consolidation
    expect(summarise).toHaveBeenCalledTimes(3);
  });
});

describe('generatePerAuthorReleaseNotes', () => {
  it('produces notes for each author in order', async () => {
    const summarise = vi.fn()
      .mockResolvedValueOnce('alice notes')
      .mockResolvedValueOnce('bob notes');
    const provider: AIProvider = { summarise };
    const blocks = new Map([
      ['alice', ['commit: a\ndiff']],
      ['bob', ['commit: b\ndiff']],
    ]);
    const result = await generatePerAuthorReleaseNotes(provider, 'last 1d', blocks, undefined, log);
    expect(result).toEqual([
      { authorLogin: 'alice', notes: 'alice notes' },
      { authorLogin: 'bob', notes: 'bob notes' },
    ]);
  });

  it('degrades to a placeholder when an author fails', async () => {
    const summarise = vi.fn().mockRejectedValue(new Error('context window exceeded'));
    const provider: AIProvider = { summarise };
    const blocks = new Map([['alice', ['commit: a\ndiff']]]);
    const result = await generatePerAuthorReleaseNotes(provider, 'last 1d', blocks, undefined, log);
    expect(result).toEqual([{ authorLogin: 'alice', notes: '(release notes unavailable)' }]);
    expect(log.error).toHaveBeenCalled();
  });
});
