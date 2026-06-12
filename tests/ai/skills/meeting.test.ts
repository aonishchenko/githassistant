import { describe, it, expect, vi } from 'vitest';
import type { AIProvider } from '../../../src/types.js';
import { summariseMeeting } from '../../../src/ai/skills/meeting.js';

describe('summariseMeeting', () => {
  it('calls provider.summarise with skill content and transcript (single call under limit)', async () => {
    const mockProvider: AIProvider = {
      summarise: vi.fn().mockResolvedValue('Generated summary'),
    };
    const result = await summariseMeeting(mockProvider, 'Transcript text here');
    expect(mockProvider.summarise).toHaveBeenCalledWith(
      expect.stringContaining('Executive Summary'),
      'Transcript text here',
      4096,
      undefined,
    );
    expect(result).toBe('Generated summary');
  });

  it('propagates AI errors to the caller', async () => {
    const mockProvider: AIProvider = {
      summarise: vi.fn().mockRejectedValue(new Error('AI timeout')),
    };
    await expect(summariseMeeting(mockProvider, 'transcript')).rejects.toThrow('AI timeout');
  });

  it('bounds the consolidation input so a large transcript fits the context window', async () => {
    const calls: Array<{ maxTokens: number; contentLen: number }> = [];
    const mockProvider: AIProvider = {
      summarise: vi.fn().mockImplementation((_p: string, content: string, maxTokens: number) => {
        calls.push({ maxTokens, contentLen: content.length });
        // each extraction returns ~maxTokens*4 chars of text
        return Promise.resolve('x'.repeat(maxTokens * 4));
      }),
    };
    // ~280k chars -> 7 chunks of 40k
    const transcript = 'a'.repeat(280_000);
    await summariseMeeting(mockProvider, transcript);

    const chunkCalls = calls.slice(0, -1);
    const consolidation = calls[calls.length - 1];
    expect(chunkCalls.length).toBe(7);
    // per-chunk budget distributed: 12000/7 ~= 1714, under the 2048 cap
    expect(chunkCalls.every(c => c.maxTokens <= 2048 && c.maxTokens >= 384)).toBe(true);
    // consolidation input is hard-capped and its output cap is small enough to fit 24k
    expect(consolidation.contentLen).toBeLessThanOrEqual(45_000);
    expect(consolidation.maxTokens).toBe(4096);
  });
});
