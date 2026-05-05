import { describe, it, expect, vi } from 'vitest';
import type { Octokit } from '@octokit/rest';
import type { Config, AIProvider, AdapterContext } from '../../src/types.js';
import {
  buildSummaryFilename,
  extractDateFromFilename,
  isTranscriptFile,
  createMeetingSummaryPlugin,
} from '../../src/commands/meeting-summary.js';

const config: Config = {
  telegram: { botToken: '', groupId: '', allowedUsers: [] },
  github: { token: '', owner: 'o', repo: 'r', defaultBranch: 'main' },
  note: { allowedPaths: ['docs'], shortcuts: {}, allowedExtensions: ['md'] },
  ai: { provider: 'anthropic', anthropicApiKey: '', anthropicModel: '', openaiApiKey: '', openaiModel: '' },
  scheduler: { nightlyCron: '', timezone: 'UTC' },
  behavior: { summaryMaxDays: 30, squashEnabled: true, summaryLanguage: 'en', logLevel: 'info', rateLimitPerMin: 10 },
  meeting: { notesFolder: 'meetings' },
};

function makeCtx(text: string, overrides: Partial<AdapterContext> = {}): AdapterContext {
  return {
    userId: '42', username: 'alice', text,
    replyText: vi.fn(),
    showOptions: vi.fn(),
    setPendingNote: vi.fn(),
    getPendingNote: vi.fn().mockReturnValue(undefined),
    clearPendingNote: vi.fn(),
    ...overrides,
  };
}

function makeOctokit(
  getContentMock: ReturnType<typeof vi.fn> = vi.fn().mockRejectedValue(Object.assign(new Error('Not Found'), { status: 404 })),
  createOrUpdateMock: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue({}),
  paginateMock: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue([]),
): Octokit {
  return {
    repos: {
      getContent: getContentMock,
      createOrUpdateFileContents: createOrUpdateMock,
      listCommits: vi.fn(),
    },
    paginate: paginateMock,
  } as unknown as Octokit;
}

const mockAI: AIProvider = { summarise: vi.fn().mockResolvedValue('AI summary output') };
const log = { error: vi.fn(), info: vi.fn(), warn: vi.fn() } as any;

describe('buildSummaryFilename', () => {
  it('replaces "transcript" with "summary" in basename', () => {
    expect(buildSummaryFilename('meetings/2026-04-28-standup-transcript.md'))
      .toBe('meetings/2026-04-28-standup-summary.md');
  });

  it('appends "-summary" when "transcript" is not in the name', () => {
    expect(buildSummaryFilename('meetings/kickoff-notes.md'))
      .toBe('meetings/kickoff-notes-summary.md');
  });

  it('handles files without a directory prefix', () => {
    expect(buildSummaryFilename('transcript.md')).toBe('summary.md');
  });

  it('handles txt extension', () => {
    expect(buildSummaryFilename('meetings/call-transcript.txt'))
      .toBe('meetings/call-summary.txt');
  });
});

describe('extractDateFromFilename', () => {
  it('extracts YYYY-MM-DD date from filename', () => {
    const d = extractDateFromFilename('meetings/2026-04-28-standup-transcript.md');
    expect(d?.toISOString().startsWith('2026-04-28')).toBe(true);
  });

  it('returns null when no date in filename', () => {
    expect(extractDateFromFilename('meetings/standup-notes.md')).toBeNull();
  });
});

describe('isTranscriptFile', () => {
  it('returns true for .md files that are not summaries', () => {
    expect(isTranscriptFile('meetings/standup-transcript.md')).toBe(true);
    expect(isTranscriptFile('meetings/2026-04-28-notes.md')).toBe(true);
  });

  it('returns false for summary files', () => {
    expect(isTranscriptFile('meetings/standup-summary.md')).toBe(false);
    expect(isTranscriptFile('meetings/2026-04-28-summary.md')).toBe(false);
  });

  it('returns false for non-.md/.txt files', () => {
    expect(isTranscriptFile('meetings/notes.pdf')).toBe(false);
  });

  it('returns true for .txt transcript files', () => {
    expect(isTranscriptFile('meetings/call.txt')).toBe(true);
  });
});

describe('createMeetingSummaryPlugin', () => {
  it('registers as /meeting-summary with auth required', () => {
    const { plugin } = createMeetingSummaryPlugin(makeOctokit(), config, mockAI, log);
    expect(plugin.command).toBe('meeting-summary');
    expect(plugin.requiresAuth).toBe(true);
  });
});

describe('/meeting-summary no args — file picker', () => {
  it('shows inline keyboard with transcript files when no arg given', async () => {
    const getContent = vi.fn().mockResolvedValue({
      data: [
        { type: 'file', path: 'meetings/2026-04-28-transcript.md' },
        { type: 'file', path: 'meetings/2026-04-28-summary.md' },
      ],
    });
    const { plugin } = createMeetingSummaryPlugin(makeOctokit(getContent), config, mockAI, log);
    const showOptions = vi.fn();
    const ctx = makeCtx('', { showOptions });
    await plugin.handler(ctx);
    expect(showOptions).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining([
        expect.objectContaining({ label: 'meetings/2026-04-28-transcript.md' }),
      ]),
    );
    const [, options] = vi.mocked(showOptions).mock.calls[0];
    expect(options.some((o: any) => o.label.includes('summary'))).toBe(false);
  });

  it('replies with no-files message when folder is empty', async () => {
    const getContent = vi.fn().mockRejectedValue(Object.assign(new Error('Not Found'), { status: 404 }));
    const { plugin } = createMeetingSummaryPlugin(makeOctokit(getContent), config, mockAI, log);
    const ctx = makeCtx('');
    await plugin.handler(ctx);
    expect(ctx.replyText).toHaveBeenCalledWith(expect.stringContaining('No transcript files found'));
  });
});

describe('/meeting-summary <filename> — single file', () => {
  it('generates and saves summary when summary does not exist', async () => {
    const transcriptContent = Buffer.from('# Meeting\nWe discussed things.').toString('base64');
    const getContent = vi.fn()
      .mockResolvedValueOnce({ data: { type: 'file', content: transcriptContent, sha: 'sha1' } })
      .mockRejectedValueOnce(Object.assign(new Error('Not Found'), { status: 404 }));
    const createOrUpdate = vi.fn().mockResolvedValue({});
    const { plugin } = createMeetingSummaryPlugin(
      makeOctokit(getContent, createOrUpdate), config, mockAI, log,
    );
    const ctx = makeCtx('2026-04-28-transcript.md');
    await plugin.handler(ctx);
    expect(createOrUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'meetings/2026-04-28-summary.md' }),
    );
    expect(ctx.replyText).toHaveBeenCalledWith(expect.stringContaining('AI summary output'));
  });

  it('replies with "already exists" message when summary file exists', async () => {
    const transcriptContent = Buffer.from('transcript').toString('base64');
    const summaryContent = Buffer.from('existing summary').toString('base64');
    const getContent = vi.fn()
      .mockResolvedValueOnce({ data: { type: 'file', content: transcriptContent, sha: 'sha1' } })
      .mockResolvedValueOnce({ data: { type: 'file', content: summaryContent, sha: 'sha2' } });
    const createOrUpdate = vi.fn();
    const { plugin } = createMeetingSummaryPlugin(
      makeOctokit(getContent, createOrUpdate), config, mockAI, log,
    );
    const ctx = makeCtx('2026-04-28-transcript.md');
    await plugin.handler(ctx);
    expect(createOrUpdate).not.toHaveBeenCalled();
    expect(ctx.replyText).toHaveBeenCalledWith(expect.stringContaining('already exists'));
  });

  it('replies with file-not-found message when transcript does not exist', async () => {
    const getContent = vi.fn().mockRejectedValue(Object.assign(new Error('Not Found'), { status: 404 }));
    const { plugin } = createMeetingSummaryPlugin(makeOctokit(getContent), config, mockAI, log);
    const ctx = makeCtx('nonexistent.md');
    await plugin.handler(ctx);
    expect(ctx.replyText).toHaveBeenCalledWith(expect.stringContaining('File not found'));
  });
});

describe('/meeting-summary <period>', () => {
  it('processes files whose filename date falls within the period', async () => {
    const getContent = vi.fn()
      .mockResolvedValueOnce({ data: [
        { type: 'file', path: 'meetings/2026-04-28-standup-transcript.md' },
        { type: 'file', path: 'meetings/2026-03-01-old-transcript.md' },
      ]})
      .mockResolvedValueOnce({ data: { type: 'file', content: Buffer.from('transcript').toString('base64'), sha: 'sha1' } })
      .mockRejectedValueOnce(Object.assign(new Error('Not Found'), { status: 404 }));
    const createOrUpdate = vi.fn().mockResolvedValue({});
    const { plugin } = createMeetingSummaryPlugin(
      makeOctokit(getContent, createOrUpdate), config, mockAI, log,
    );
    const ctx = makeCtx('2026-04-24');
    await plugin.handler(ctx);
    expect(createOrUpdate).toHaveBeenCalledTimes(1);
    expect(createOrUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'meetings/2026-04-28-standup-summary.md' }),
    );
  });
});

describe('/meeting-summary callback handler', () => {
  it('summarizes selected file on callback', async () => {
    const transcriptContent = Buffer.from('transcript').toString('base64');
    const getContent = vi.fn()
      .mockResolvedValueOnce({ data: { type: 'file', content: transcriptContent, sha: 'sha1' } })
      .mockRejectedValueOnce(Object.assign(new Error('Not Found'), { status: 404 }));
    const createOrUpdate = vi.fn().mockResolvedValue({});
    const { callbackHandler } = createMeetingSummaryPlugin(
      makeOctokit(getContent, createOrUpdate), config, mockAI, log,
    );
    const ctx = {
      userId: '42', username: 'alice',
      callbackData: 'meeting_file:meetings/2026-04-28-transcript.md',
      replyText: vi.fn(),
      answerCallback: vi.fn(),
      getPendingNote: vi.fn().mockReturnValue(undefined),
      clearPendingNote: vi.fn(),
    };
    await callbackHandler(ctx);
    expect(ctx.answerCallback).toHaveBeenCalled();
    expect(createOrUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'meetings/2026-04-28-summary.md' }),
    );
  });
});
