import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Octokit } from '@octokit/rest';
import type { Config, AdapterContext } from '../../src/types.js';
import { createNotePlugin } from '../../src/commands/note.js';

const config: Config = {
  telegram: { botToken: '', groupId: '', allowedUsers: ['alice'] },
  github: { token: '', owner: 'o', repo: 'r', defaultBranch: 'main' },
  note: {
    allowedPaths: ['docs'],
    shortcuts: { i: 'docs/ideas.md' },
    allowedExtensions: ['md', 'txt'],
  },
  ai: { provider: 'anthropic', anthropicApiKey: '', anthropicModel: '' },
  scheduler: { nightlyCron: '', timezone: 'UTC' },
  behavior: { summaryMaxDays: 7, squashEnabled: true, summaryLanguage: 'en', logLevel: 'info', rateLimitPerMin: 10 },
  meeting: { notesFolder: 'meetings' },
};

function makeCtx(text: string, overrides: Partial<AdapterContext> = {}): AdapterContext {
  return {
    userId: '42',
    username: 'alice',
    text,
    replyText: vi.fn(),
    showOptions: vi.fn(),
    setPendingNote: vi.fn(),
    getPendingNote: vi.fn().mockReturnValue(undefined),
    clearPendingNote: vi.fn(),
    ...overrides,
  };
}

function makeOctokit(getContentResult: unknown = null, createOrUpdateMock?: ReturnType<typeof vi.fn>): Octokit {
  const createOrUpdate = createOrUpdateMock ?? vi.fn().mockResolvedValue({});
  return {
    repos: {
      getContent: getContentResult === null
        ? vi.fn().mockRejectedValue(Object.assign(new Error('Not Found'), { status: 404 }))
        : vi.fn().mockResolvedValue({ data: getContentResult }),
      createOrUpdateFileContents: createOrUpdate,
    },
  } as unknown as Octokit;
}

describe('createNotePlugin', () => {
  it('registers as /note with auth required', () => {
    const { plugin } = createNotePlugin(makeOctokit(), config);
    expect(plugin.command).toBe('note');
    expect(plugin.requiresAuth).toBe(true);
  });
});

describe('/note Form A — full path', () => {
  it('appends note to existing file and confirms with checkmark', async () => {
    const existing = { type: 'file', content: Buffer.from('# Notes').toString('base64'), sha: 'sha1' };
    const createOrUpdate = vi.fn().mockResolvedValue({});
    const octokit = makeOctokit(existing, createOrUpdate);
    const { plugin } = createNotePlugin(octokit, config);
    const ctx = makeCtx('docs/notes.md Sprint recap.');
    await plugin.handler(ctx);
    expect(createOrUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'docs/notes.md', sha: 'sha1' }),
    );
    expect(ctx.replyText).toHaveBeenCalledWith(expect.stringContaining('✅'));
  });

  it('creates a new file when it does not exist (sha undefined)', async () => {
    const createOrUpdate = vi.fn().mockResolvedValue({});
    const octokit = makeOctokit(null, createOrUpdate);
    const { plugin } = createNotePlugin(octokit, config);
    const ctx = makeCtx('docs/new.md First note.');
    await plugin.handler(ctx);
    expect(createOrUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'docs/new.md', sha: undefined }),
    );
  });

  it('rejects path outside allowed paths', async () => {
    const { plugin } = createNotePlugin(makeOctokit(), config);
    const ctx = makeCtx('secrets/pw.md Bad path.');
    await plugin.handler(ctx);
    expect(ctx.replyText).toHaveBeenCalledWith(expect.stringContaining('not in an accessible folder'));
  });
});

describe('/note Form B — shortcut', () => {
  it('resolves shortcut and appends note to correct file', async () => {
    const existing = { type: 'file', content: Buffer.from('# Ideas').toString('base64'), sha: 'sha2' };
    const createOrUpdate = vi.fn().mockResolvedValue({});
    const octokit = makeOctokit(existing, createOrUpdate);
    const { plugin } = createNotePlugin(octokit, config);
    const ctx = makeCtx('i New logo idea.');
    await plugin.handler(ctx);
    expect(createOrUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'docs/ideas.md' }),
    );
    expect(ctx.replyText).toHaveBeenCalledWith(expect.stringContaining('✅'));
  });
});

describe('/note Form C — no path (inline keyboard)', () => {
  it('lists files and stores pending note text', async () => {
    const dirContent = [{ type: 'file', path: 'docs/notes.md' }];
    const octokit = makeOctokit(dirContent);
    const setPendingNote = vi.fn();
    const showOptions = vi.fn();
    const { plugin } = createNotePlugin(octokit, config);
    const ctx = makeCtx('We agreed to deprecate the API.', { setPendingNote, showOptions });
    await plugin.handler(ctx);
    expect(setPendingNote).toHaveBeenCalledWith('We agreed to deprecate the API.');
    expect(showOptions).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining([expect.objectContaining({ label: 'docs/notes.md' })]),
    );
  });
});

describe('/note callback handler', () => {
  it('appends note from pending state when callback received', async () => {
    const existing = { type: 'file', content: Buffer.from('# Notes').toString('base64'), sha: 'sha3' };
    const createOrUpdate = vi.fn().mockResolvedValue({});
    const octokit = makeOctokit(existing, createOrUpdate);
    const { callbackHandler } = createNotePlugin(octokit, config);
    const ctx = {
      userId: '42', username: 'alice',
      callbackData: 'note_file:docs/notes.md',
      replyText: vi.fn(),
      answerCallback: vi.fn(),
      getPendingNote: vi.fn().mockReturnValue('Pending note text.'),
      clearPendingNote: vi.fn(),
    };
    await callbackHandler(ctx);
    expect(ctx.answerCallback).toHaveBeenCalled();
    expect(createOrUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'docs/notes.md' }),
    );
    expect(ctx.replyText).toHaveBeenCalledWith(expect.stringContaining('✅'));
  });

  it('prompts for note text when pending note is empty', async () => {
    const { callbackHandler } = createNotePlugin(makeOctokit(), config);
    const ctx = {
      userId: '42', username: 'alice',
      callbackData: 'note_file:docs/notes.md',
      replyText: vi.fn(),
      answerCallback: vi.fn(),
      getPendingNote: vi.fn().mockReturnValue(undefined),
      clearPendingNote: vi.fn(),
    };
    await callbackHandler(ctx);
    expect(ctx.replyText).toHaveBeenCalledWith(expect.stringContaining('docs/notes.md'));
  });
});
