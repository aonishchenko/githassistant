import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AIProvider } from '../../src/types.js';
import { chunkText, summariseAuthorDiffs, SUMMARY_PROMPT } from '../../src/ai/summarise.js';

describe('chunkText', () => {
  it('returns single chunk when text is under maxChars', () => {
    expect(chunkText('hello', 100)).toEqual(['hello']);
  });

  it('splits text into chunks of maxChars', () => {
    const chunks = chunkText('abcdef', 2);
    expect(chunks).toEqual(['ab', 'cd', 'ef']);
  });

  it('handles text length exactly equal to maxChars', () => {
    expect(chunkText('abc', 3)).toEqual(['abc']);
  });
});

describe('summariseAuthorDiffs', () => {
  let mockProvider: AIProvider;

  beforeEach(() => {
    mockProvider = {
      summarise: vi.fn().mockResolvedValue('Summary text.'),
    };
  });

  it('calls provider once when combined diffs are under limit', async () => {
    const result = await summariseAuthorDiffs(mockProvider, ['small diff'], 'en', 'alice');
    expect(result).toBe('Summary text.');
    expect(mockProvider.summarise).toHaveBeenCalledTimes(1);
    expect(mockProvider.summarise).toHaveBeenCalledWith(
      expect.stringContaining('alice'),
      'small diff',
      undefined,
      undefined,
    );
  });

  it('chunks large diffs and consolidates', async () => {
    vi.mocked(mockProvider.summarise).mockResolvedValue('Chunk summary.');
    const largeDiff = 'x'.repeat(90_000);
    await summariseAuthorDiffs(mockProvider, [largeDiff], 'en', 'alice');
    expect(vi.mocked(mockProvider.summarise).mock.calls.length).toBeGreaterThan(1);
  });

  it('SUMMARY_PROMPT includes the language and author', () => {
    expect(SUMMARY_PROMPT('fr', 'bob')).toContain('fr');
    expect(SUMMARY_PROMPT('fr', 'bob')).toContain('@bob');
  });
});
