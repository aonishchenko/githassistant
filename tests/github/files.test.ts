import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Octokit } from '@octokit/rest';
import type { Config } from '../../src/types.js';
import { getFile, writeFile, listFiles, getFileCreationDate } from '../../src/github/files.js';

const config: Config = {
  telegram: { botToken: '', groupId: '', allowedUsers: [] },
  github: { token: 'tok', owner: 'owner', repo: 'repo', defaultBranch: 'main' },
  note: { allowedPaths: ['docs'], shortcuts: {}, allowedExtensions: ['md', 'txt'] },
  ai: { provider: 'anthropic', anthropicApiKey: '', anthropicModel: '', openaiApiKey: '', openaiModel: '' },
  scheduler: { nightlyCron: '', timezone: 'UTC' },
  behavior: { summaryMaxDays: 7, squashEnabled: true, summaryLanguage: 'en', logLevel: 'info', rateLimitPerMin: 10 },
  meeting: { notesFolder: 'meetings' },
};

function makeOctokit(getContentImpl: ReturnType<typeof vi.fn>, createOrUpdateImpl?: ReturnType<typeof vi.fn>): Octokit {
  return {
    repos: {
      getContent: getContentImpl,
      createOrUpdateFileContents: createOrUpdateImpl ?? vi.fn().mockResolvedValue({}),
    },
  } as unknown as Octokit;
}

describe('getFile', () => {
  it('returns content and sha for an existing file', async () => {
    const octokit = makeOctokit(vi.fn().mockResolvedValue({
      data: { type: 'file', content: Buffer.from('# Hello').toString('base64'), sha: 'abc123' },
    }));
    const result = await getFile(octokit, config, 'docs/notes.md');
    expect(result).toEqual({ content: '# Hello', sha: 'abc123' });
  });

  it('returns null when file does not exist (404)', async () => {
    const err = Object.assign(new Error('Not Found'), { status: 404 });
    const octokit = makeOctokit(vi.fn().mockRejectedValue(err));
    const result = await getFile(octokit, config, 'docs/missing.md');
    expect(result).toBeNull();
  });

  it('propagates non-404 errors', async () => {
    const err = Object.assign(new Error('Server Error'), { status: 500 });
    const octokit = makeOctokit(vi.fn().mockRejectedValue(err));
    await expect(getFile(octokit, config, 'docs/x.md')).rejects.toThrow('Server Error');
  });
});

describe('writeFile', () => {
  it('calls createOrUpdateFileContents with base64 content', async () => {
    const createOrUpdate = vi.fn().mockResolvedValue({});
    const octokit = makeOctokit(vi.fn(), createOrUpdate);
    await writeFile(octokit, config, 'docs/notes.md', '# New content', 'note(@alice): docs/notes.md', 'sha123');
    expect(createOrUpdate).toHaveBeenCalledWith(expect.objectContaining({
      path: 'docs/notes.md',
      message: 'note(@alice): docs/notes.md',
      content: Buffer.from('# New content').toString('base64'),
      sha: 'sha123',
      branch: 'main',
    }));
  });

  it('calls createOrUpdateFileContents without sha for new files', async () => {
    const createOrUpdate = vi.fn().mockResolvedValue({});
    const octokit = makeOctokit(vi.fn(), createOrUpdate);
    await writeFile(octokit, config, 'docs/new.md', '# New', 'note(@alice): docs/new.md');
    expect(createOrUpdate).toHaveBeenCalledWith(expect.objectContaining({ sha: undefined }));
  });
});

describe('listFiles', () => {
  it('returns file paths recursively', async () => {
    const getContent = vi.fn()
      .mockResolvedValueOnce({ data: [
        { type: 'file', path: 'docs/a.md' },
        { type: 'dir', path: 'docs/sub' },
      ]})
      .mockResolvedValueOnce({ data: [
        { type: 'file', path: 'docs/sub/b.md' },
      ]});
    const octokit = makeOctokit(getContent);
    const files = await listFiles(octokit, config, ['docs']);
    expect(files.sort()).toEqual(['docs/a.md', 'docs/sub/b.md']);
  });

  it('returns empty array when directory does not exist', async () => {
    const err = Object.assign(new Error('Not Found'), { status: 404 });
    const octokit = makeOctokit(vi.fn().mockRejectedValue(err));
    const files = await listFiles(octokit, config, ['docs']);
    expect(files).toEqual([]);
  });
});

describe('getFileCreationDate', () => {
  it('returns the date of the oldest commit for a file', async () => {
    const octokit = {
      paginate: vi.fn().mockResolvedValue([
        { commit: { author: { date: '2026-04-01T10:00:00Z' } } },
        { commit: { author: { date: '2026-03-15T08:00:00Z' } } },
      ]),
      repos: { listCommits: vi.fn() },
    } as unknown as Octokit;
    const result = await getFileCreationDate(octokit, config, 'meetings/standup.md');
    expect(result).toEqual(new Date('2026-03-15T08:00:00Z'));
  });

  it('returns null when no commits found for the file', async () => {
    const octokit = {
      paginate: vi.fn().mockResolvedValue([]),
      repos: { listCommits: vi.fn() },
    } as unknown as Octokit;
    const result = await getFileCreationDate(octokit, config, 'meetings/missing.md');
    expect(result).toBeNull();
  });

  it('returns null on API error', async () => {
    const octokit = {
      paginate: vi.fn().mockRejectedValue(new Error('API error')),
      repos: { listCommits: vi.fn() },
    } as unknown as Octokit;
    const result = await getFileCreationDate(octokit, config, 'meetings/error.md');
    expect(result).toBeNull();
  });
});
