import { describe, it, expect, vi } from 'vitest';
import type { AIProvider } from '../../../src/types.js';
import { summariseMeeting } from '../../../src/ai/skills/meeting.js';

describe('summariseMeeting', () => {
  it('calls provider.summarise with skill content and transcript', async () => {
    const mockProvider: AIProvider = {
      summarise: vi.fn().mockResolvedValue('Generated summary'),
    };
    const result = await summariseMeeting(mockProvider, 'Transcript text here');
    expect(mockProvider.summarise).toHaveBeenCalledWith(
      expect.stringContaining('Executive Summary'),
      'Transcript text here',
      8192,
    );
    expect(result).toBe('Generated summary');
  });

  it('propagates AI errors to the caller', async () => {
    const mockProvider: AIProvider = {
      summarise: vi.fn().mockRejectedValue(new Error('AI timeout')),
    };
    await expect(summariseMeeting(mockProvider, 'transcript')).rejects.toThrow('AI timeout');
  });
});
