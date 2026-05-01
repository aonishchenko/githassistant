# Meeting Summary Feature — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/meeting-summary` Telegram command that reads meeting transcript files from a GitHub folder, generates structured AI summaries using a skill file, and stores the results back to GitHub — skipping files that already have summaries.

**Architecture:** The skill prompt lives in `.claude/skills/meeting-transcription-summarizer.md`; `src/ai/skills/meeting.ts` reads it at runtime and calls the existing `AIProvider.summarise()` with a higher token limit. The command plugin (`src/commands/meeting-summary.ts`) handles three modes — file picker (no args), single file, or period — and reuses existing GitHub helpers for reading/writing files.

**Tech Stack:** TypeScript strict, Octokit, AIProvider interface (Anthropic), Telegraf callbacks, vitest

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `.claude/skills/meeting-transcription-summarizer.md` | Verbatim SKILL.md — AI prompt source |
| Create | `src/ai/skills/meeting.ts` | Read skill file, expose `summariseMeeting()` |
| Create | `tests/ai/skills/meeting.test.ts` | Unit tests for meeting skill |
| Create | `src/commands/meeting-summary.ts` | `/meeting-summary` command + callback handler |
| Create | `tests/commands/meeting-summary.test.ts` | Unit tests for the command |
| Modify | `src/types.ts` | Add `meeting` to `Config`; add optional `maxTokens` to `AIProvider.summarise` |
| Modify | `src/ai/anthropic.ts` | Accept optional `maxTokens` param, default 1024 |
| Modify | `src/config.ts` | Read `MEETING_NOTES_FOLDER` env var |
| Modify | `src/github/files.ts` | Add `getFileCreationDate()` helper |
| Modify | `src/commands/registry.ts` | Register the new plugin + callback |
| Modify | `tests/github/files.test.ts` | Add test for `getFileCreationDate`; add `meeting` to config fixture |
| Modify | `tests/commands/summary.test.ts` | Add `meeting` to config fixture |
| Modify | `tests/commands/note.test.ts` | Add `meeting` to config fixture |
| Modify | `tests/commands/help.test.ts` | Add `meeting` to config fixture |
| Modify | `tests/config.test.ts` | Add `meeting` to expected config; test new env var |
| Modify | `tests/messaging/telegram/auth.test.ts` | Add `meeting` to config fixture |
| Modify | `tests/github/commits.test.ts` | Add `meeting` to config fixture |
| Modify | `tests/jobs/squash.test.ts` | Add `meeting` to config fixture |

---

## Task 1: Copy skill file

**Files:**
- Create: `.claude/skills/meeting-transcription-summarizer.md`

- [ ] **Step 1: Create the skills directory and copy SKILL.md verbatim**

Create `.claude/skills/meeting-transcription-summarizer.md` with the exact contents of `SKILL.md` (the file already exists at the repo root — copy it exactly, do not modify).

```bash
cp SKILL.md .claude/skills/meeting-transcription-summarizer.md
```

- [ ] **Step 2: Verify the file exists with correct content**

```bash
head -5 .claude/skills/meeting-transcription-summarizer.md
```

Expected: frontmatter starting with `---` and `name: meeting-transcription-summarizer`.

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/meeting-transcription-summarizer.md
git commit -m "feat: add meeting transcription summarizer skill"
```

---

## Task 2: Extend Config type, update AIProvider interface, update Anthropic provider, update config loader

**Files:**
- Modify: `src/types.ts`
- Modify: `src/ai/anthropic.ts`
- Modify: `src/config.ts`

- [ ] **Step 1: Add `meeting` section to `Config` and optional `maxTokens` to `AIProvider` in `src/types.ts`**

In `src/types.ts`, add `meeting` to the `Config` interface (after the `note` block):

```typescript
  meeting: {
    notesFolder: string;
  };
```

Change the `AIProvider` interface's `summarise` signature to:

```typescript
export interface AIProvider {
  summarise(prompt: string, content: string, maxTokens?: number): Promise<string>;
}
```

- [ ] **Step 2: Update `AnthropicProvider.summarise` in `src/ai/anthropic.ts`**

Replace the current `summarise` method:

```typescript
  async summarise(prompt: string, content: string, maxTokens = 1024): Promise<string> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: `${prompt}\n\n${content}` }],
    });
    const block = response.content[0];
    if (block.type !== 'text') throw new Error('Unexpected non-text response from Anthropic');
    return block.text;
  }
```

- [ ] **Step 3: Add `MEETING_NOTES_FOLDER` to `src/config.ts`**

In the `loadConfig()` return object, add the `meeting` section after the `note` section:

```typescript
    meeting: {
      notesFolder: process.env.MEETING_NOTES_FOLDER ?? 'meetings',
    },
```

- [ ] **Step 4: Run TypeScript check to verify no compile errors**

```bash
npx tsc --noEmit
```

Expected: no errors (existing code unchanged, new field added).

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/ai/anthropic.ts src/config.ts
git commit -m "feat: extend Config with meeting.notesFolder, add maxTokens to AIProvider"
```

---

## Task 3: Update existing test fixtures to include `meeting` field

**Files:**
- Modify: `tests/commands/summary.test.ts`
- Modify: `tests/commands/note.test.ts`
- Modify: `tests/commands/help.test.ts`
- Modify: `tests/github/files.test.ts`
- Modify: `tests/github/commits.test.ts`
- Modify: `tests/messaging/telegram/auth.test.ts`
- Modify: `tests/jobs/squash.test.ts`
- Modify: `tests/config.test.ts`

In every test file that constructs a `Config` object, add `meeting: { notesFolder: 'meetings' }` to the object literal. Each file has a pattern like:

```typescript
const config: Config = {
  telegram: { ... },
  github: { ... },
  note: { ... },
  ai: { ... },
  scheduler: { ... },
  behavior: { ... },
  // ADD THIS:
  meeting: { notesFolder: 'meetings' },
};
```

For `tests/config.test.ts`, also verify the new env var is tested.

- [ ] **Step 1: Update `tests/commands/summary.test.ts`** — add `meeting: { notesFolder: 'meetings' }` to the config fixture.

- [ ] **Step 2: Update `tests/commands/note.test.ts`** — add `meeting: { notesFolder: 'meetings' }` to the config fixture.

- [ ] **Step 3: Update `tests/commands/help.test.ts`** — open the file; if it has a `Config` fixture, add `meeting: { notesFolder: 'meetings' }`.

- [ ] **Step 4: Update `tests/github/files.test.ts`** — add `meeting: { notesFolder: 'meetings' }` to the config fixture.

- [ ] **Step 5: Update `tests/github/commits.test.ts`** — open the file; if it has a `Config` fixture, add `meeting: { notesFolder: 'meetings' }`.

- [ ] **Step 6: Update `tests/messaging/telegram/auth.test.ts`** — open the file; if it has a `Config` fixture, add `meeting: { notesFolder: 'meetings' }`.

- [ ] **Step 7: Update `tests/jobs/squash.test.ts`** — open the file; if it has a `Config` fixture, add `meeting: { notesFolder: 'meetings' }`.

- [ ] **Step 8: Update `tests/config.test.ts`** — add `meeting: { notesFolder: 'meetings' }` to expected config. Also add a test case that `MEETING_NOTES_FOLDER` env var is read:

```typescript
it('reads MEETING_NOTES_FOLDER env var', () => {
  process.env.MEETING_NOTES_FOLDER = 'custom/meetings';
  // ... call loadConfig with required vars set, assert config.meeting.notesFolder === 'custom/meetings'
  delete process.env.MEETING_NOTES_FOLDER;
});
```

- [ ] **Step 9: Run tests and verify all pass**

```bash
npm test
```

Expected: all existing tests pass.

- [ ] **Step 10: Commit**

```bash
git add tests/
git commit -m "test: add meeting config field to all test fixtures"
```

---

## Task 4: Add `getFileCreationDate` to GitHub files helper

**Files:**
- Modify: `src/github/files.ts`
- Modify: `tests/github/files.test.ts`

- [ ] **Step 1: Write the failing test in `tests/github/files.test.ts`**

Add this describe block at the end of the file:

```typescript
describe('getFileCreationDate', () => {
  it('returns the date of the oldest commit for a file', async () => {
    const octokit = {
      paginate: vi.fn().mockResolvedValue([
        { commit: { author: { date: '2026-04-01T10:00:00Z' } } },
        { commit: { author: { date: '2026-03-15T08:00:00Z' } } },
      ]),
      repos: { listCommits: vi.fn() },
    } as unknown as Octokit;
    // import getFileCreationDate at the top of the test file
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
```

Also add `getFileCreationDate` to the import at the top of the test file:

```typescript
import { getFile, writeFile, listFiles, getFileCreationDate } from '../../src/github/files.js';
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test -- --reporter=verbose tests/github/files.test.ts
```

Expected: FAIL — `getFileCreationDate is not a function`.

- [ ] **Step 3: Implement `getFileCreationDate` in `src/github/files.ts`**

Add this export at the end of the file:

```typescript
export async function getFileCreationDate(
  octokit: Octokit,
  config: Config,
  filePath: string,
): Promise<Date | null> {
  try {
    const commits = await octokit.paginate(octokit.repos.listCommits, {
      owner: config.github.owner,
      repo: config.github.repo,
      path: filePath,
      per_page: 100,
    });
    if (commits.length === 0) return null;
    const oldest = commits[commits.length - 1] as { commit: { author?: { date?: string }; committer?: { date?: string } } };
    const dateStr = oldest.commit.author?.date ?? oldest.commit.committer?.date;
    if (!dateStr) return null;
    return new Date(dateStr);
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npm test -- --reporter=verbose tests/github/files.test.ts
```

Expected: all tests in this file PASS.

- [ ] **Step 5: Commit**

```bash
git add src/github/files.ts tests/github/files.test.ts
git commit -m "feat: add getFileCreationDate helper to github files module"
```

---

## Task 5: AI skill module

**Files:**
- Create: `src/ai/skills/meeting.ts`
- Create: `tests/ai/skills/meeting.test.ts`

- [ ] **Step 1: Write the failing test in `tests/ai/skills/meeting.test.ts`**

```typescript
import { describe, it, expect, vi } from 'vitest';
import type { AIProvider } from '../../src/types.js';
import { summariseMeeting } from '../../src/ai/skills/meeting.js';

describe('summariseMeeting', () => {
  it('calls provider.summarise with skill content and transcript', async () => {
    const mockProvider: AIProvider = {
      summarise: vi.fn().mockResolvedValue('Generated summary'),
    };
    const result = await summariseMeeting(mockProvider, 'Transcript text here');
    expect(mockProvider.summarise).toHaveBeenCalledWith(
      expect.stringContaining('Executive Summary'),
      'Transcript text here',
      4096,
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
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test -- --reporter=verbose tests/ai/skills/meeting.test.ts
```

Expected: FAIL — `summariseMeeting is not a function` or module not found.

- [ ] **Step 3: Create `src/ai/skills/meeting.ts`**

```typescript
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import type { AIProvider } from '../../types.js';

const MEETING_SUMMARY_MAX_TOKENS = 4096;

function loadSkill(): string {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const skillPath = resolve(__dirname, '../../../.claude/skills/meeting-transcription-summarizer.md');
  return readFileSync(skillPath, 'utf-8');
}

let cachedSkill: string | undefined;

function getSkill(): string {
  if (!cachedSkill) cachedSkill = loadSkill();
  return cachedSkill;
}

export async function summariseMeeting(
  provider: AIProvider,
  transcript: string,
): Promise<string> {
  return provider.summarise(getSkill(), transcript, MEETING_SUMMARY_MAX_TOKENS);
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npm test -- --reporter=verbose tests/ai/skills/meeting.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ai/skills/meeting.ts tests/ai/skills/meeting.test.ts
git commit -m "feat: add meeting summarisation skill module"
```

---

## Task 6: Meeting summary command

**Files:**
- Create: `src/commands/meeting-summary.ts`
- Create: `tests/commands/meeting-summary.test.ts`

- [ ] **Step 1: Write the failing tests in `tests/commands/meeting-summary.test.ts`**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
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
  ai: { provider: 'anthropic', anthropicApiKey: '', anthropicModel: '' },
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
    // Summary files should not be in the picker
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
      .mockResolvedValueOnce({ data: { type: 'file', content: transcriptContent, sha: 'sha1' } }) // transcript
      .mockRejectedValueOnce(Object.assign(new Error('Not Found'), { status: 404 })); // summary does not exist
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
    const now = new Date('2026-05-01T12:00:00Z');
    const getContent = vi.fn()
      // listFiles: directory listing for meetings folder
      .mockResolvedValueOnce({ data: [
        { type: 'file', path: 'meetings/2026-04-28-standup-transcript.md' },
        { type: 'file', path: 'meetings/2026-03-01-old-transcript.md' },
      ]})
      // transcript content for 2026-04-28 file
      .mockResolvedValueOnce({ data: { type: 'file', content: Buffer.from('transcript').toString('base64'), sha: 'sha1' } })
      // summary does not exist for 2026-04-28
      .mockRejectedValueOnce(Object.assign(new Error('Not Found'), { status: 404 }));
    const createOrUpdate = vi.fn().mockResolvedValue({});
    const { plugin } = createMeetingSummaryPlugin(
      makeOctokit(getContent, createOrUpdate), config, mockAI, log,
    );
    // Use parsePeriod to get a period that covers 2026-04-28 but not 2026-03-01
    // "7d" from 2026-05-01 = since 2026-04-24 — covers 04-28 but not 03-01
    // We mock Date.now() is not needed — parsePeriod takes now as param internally,
    // but we pass the text directly; the real parsePeriod will use current date.
    // Instead test with explicit ISO date that clearly covers one file:
    const ctx = makeCtx('2026-04-24');
    await plugin.handler(ctx);
    // 2026-04-28 is after 2026-04-24 → included; 2026-03-01 is before → excluded
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
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test -- --reporter=verbose tests/commands/meeting-summary.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/commands/meeting-summary.ts`**

```typescript
import path from 'path';
import type { Octokit } from '@octokit/rest';
import type { Logger } from 'pino';
import type { Config, AIProvider, CommandPlugin, CallbackHandler } from '../types.js';
import { getFile, writeFile, listFiles, getFileCreationDate } from '../github/files.js';
import { summariseMeeting } from '../ai/skills/meeting.js';
import { parsePeriod } from './summary.js';

export function buildSummaryFilename(transcriptPath: string): string {
  const ext = path.extname(transcriptPath);
  const base = path.basename(transcriptPath, ext);
  const dir = path.dirname(transcriptPath);
  const newBase = /transcript/i.test(base)
    ? base.replace(/transcript/gi, 'summary')
    : `${base}-summary`;
  const result = `${newBase}${ext}`;
  return dir === '.' ? result : `${dir}/${result}`;
}

export function extractDateFromFilename(filePath: string): Date | null {
  const name = path.basename(filePath);
  const match = name.match(/(\d{4}-\d{2}-\d{2})/);
  if (!match) return null;
  const d = new Date(`${match[1]}T00:00:00Z`);
  return isNaN(d.getTime()) ? null : d;
}

export function isTranscriptFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase().slice(1);
  if (!['md', 'txt'].includes(ext)) return false;
  const base = path.basename(filePath, path.extname(filePath)).toLowerCase();
  return !base.endsWith('-summary') && base !== 'summary';
}

async function getTranscriptDate(
  octokit: Octokit,
  config: Config,
  filePath: string,
): Promise<Date | null> {
  const fromName = extractDateFromFilename(filePath);
  if (fromName) return fromName;
  return getFileCreationDate(octokit, config, filePath);
}

async function processFile(
  octokit: Octokit,
  config: Config,
  aiProvider: AIProvider,
  transcriptPath: string,
  username: string,
  replyText: (text: string) => Promise<void>,
  log: Logger,
): Promise<void> {
  const transcript = await getFile(octokit, config, transcriptPath);
  if (!transcript) {
    await replyText(`File not found: \`${transcriptPath}\`.`);
    return;
  }

  const summaryPath = buildSummaryFilename(transcriptPath);
  const existing = await getFile(octokit, config, summaryPath);
  if (existing) {
    await replyText(`Summary already exists: \`${summaryPath}\`. No changes made.`);
    return;
  }

  let summary: string;
  try {
    summary = await summariseMeeting(aiProvider, transcript.content);
  } catch (err) {
    log.error({ err, transcriptPath }, 'meeting summarisation failed');
    await replyText(`Failed to generate summary for \`${transcriptPath}\`. Please try again.`);
    return;
  }

  const commitMsg = `summary(@${username}): ${summaryPath}`;
  await writeFile(octokit, config, summaryPath, summary, commitMsg);
  await replyText(`*${path.basename(summaryPath)}*\n\n${summary}`);
}

export function createMeetingSummaryPlugin(
  octokit: Octokit,
  config: Config,
  aiProvider: AIProvider,
  log: Logger,
): { plugin: CommandPlugin; callbackHandler: CallbackHandler } {
  const plugin: CommandPlugin = {
    command: 'meeting-summary',
    description: 'Summarise a meeting transcript from the meetings folder',
    requiresAuth: true,
    handler: async (ctx) => {
      const arg = ctx.text.trim();

      // No arg — show file picker
      if (!arg) {
        const allFiles = await listFiles(octokit, config, [config.meeting.notesFolder]);
        const transcripts = allFiles.filter(isTranscriptFile).sort();
        if (transcripts.length === 0) {
          await ctx.replyText(`No transcript files found in \`${config.meeting.notesFolder}\`.`);
          return;
        }
        await ctx.showOptions(
          'Choose a transcript to summarise:',
          transcripts.slice(0, 20).map(f => ({ label: f, callbackData: `meeting_file:${f}` })),
        );
        return;
      }

      // Try period first, fall back to filename
      let isPeriod = false;
      let since: Date | undefined;
      try {
        const parsed = parsePeriod(arg, config.behavior.summaryMaxDays);
        isPeriod = true;
        since = parsed.since;
      } catch {
        // not a period — treat as filename
      }

      if (isPeriod && since) {
        const allFiles = await listFiles(octokit, config, [config.meeting.notesFolder]);
        const transcripts = allFiles.filter(isTranscriptFile);
        const inPeriod: string[] = [];
        for (const f of transcripts) {
          const d = await getTranscriptDate(octokit, config, f);
          if (d && d >= since) inPeriod.push(f);
        }
        if (inPeriod.length === 0) {
          await ctx.replyText(`No transcript files found in the requested period.`);
          return;
        }
        for (const f of inPeriod) {
          await processFile(octokit, config, aiProvider, f, ctx.username, ctx.replyText.bind(ctx), log);
        }
        return;
      }

      // Single filename
      const filePath = arg.includes('/')
        ? arg
        : `${config.meeting.notesFolder}/${arg}`;
      await processFile(octokit, config, aiProvider, filePath, ctx.username, ctx.replyText.bind(ctx), log);
    },
  };

  const callbackHandler: CallbackHandler = async (ctx) => {
    await ctx.answerCallback();
    const filePath = ctx.callbackData.replace(/^meeting_file:/, '');
    await processFile(octokit, config, aiProvider, filePath, ctx.username, ctx.replyText.bind(ctx), log);
  };

  return { plugin, callbackHandler };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npm test -- --reporter=verbose tests/commands/meeting-summary.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Run full test suite to verify no regressions**

```bash
npm test
```

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/commands/meeting-summary.ts tests/commands/meeting-summary.test.ts
git commit -m "feat: add meeting-summary command plugin"
```

---

## Task 7: Register command in registry

**Files:**
- Modify: `src/commands/registry.ts`

- [ ] **Step 1: Add the import and registration to `src/commands/registry.ts`**

Add import at the top:

```typescript
import { createMeetingSummaryPlugin } from './meeting-summary.js';
```

Add registration inside `registerCommands`, after the squash plugin registration:

```typescript
  const { plugin: meetingPlugin, callbackHandler: meetingCallback } =
    createMeetingSummaryPlugin(octokit, config, aiProvider, log);
  adapter.onCommand(meetingPlugin.command, withAuth(meetingPlugin, adapter));
  adapter.onCallback('meeting_file', meetingCallback);
```

- [ ] **Step 2: Run TypeScript check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Run full test suite**

```bash
npm test
```

Expected: all tests PASS.

- [ ] **Step 4: Commit**

```bash
git add src/commands/registry.ts
git commit -m "feat: register meeting-summary command in registry"
```

---

## Task 8: Update help command

**Files:**
- Modify: `src/commands/help.ts`

- [ ] **Step 1: Open `src/commands/help.ts` and verify `/meeting-summary` will appear automatically**

The help command dynamically lists all registered command plugins. If it reads descriptions from the plugin objects, `/meeting-summary` will appear automatically with its description `"Summarise a meeting transcript from the meetings folder"`. Verify this is the case — if help is hardcoded, add the new command.

- [ ] **Step 2: Run full test suite one final time**

```bash
npm test
```

Expected: all tests PASS.

- [ ] **Step 3: Run TypeScript build to verify production build works**

```bash
npm run build
```

Expected: no errors, `dist/` populated.

- [ ] **Step 4: Final commit if any changes were needed**

```bash
git add src/commands/help.ts
git commit -m "docs: ensure /meeting-summary appears in /help"
```
