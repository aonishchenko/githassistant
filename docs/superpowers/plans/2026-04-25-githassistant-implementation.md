# GitHAssistant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Node.js Telegram bot that responds to slash commands and runs nightly GitHub maintenance jobs (commit squash + AI digest).

**Architecture:** Three subsystems wired at startup: Config (env validation) → Messaging adapter (Telegraf wrapper) → Commands + Scheduler (plugin registries). All command/job logic receives the adapter and Octokit via dependency injection; no Telegraf Context leaks into business logic.

**Tech Stack:** Node.js 20, TypeScript strict ESM, Telegraf v4, @octokit/rest v21, @anthropic-ai/sdk, node-cron, pino, vitest, nock.

---

## File Map

```
src/
  index.ts               # Entry point — wires everything, starts bot + cron
  types.ts               # All shared TypeScript interfaces and types
  config.ts              # Env var loader + validator
  messaging/
    adapter.ts           # Re-exports messaging interfaces from types.ts
    telegram/
      index.ts           # TelegramAdapter (implements MessagingAdapter)
      auth.ts            # isAllowed helper (allowlist + group admin check)
      formatter.ts       # formatNoteAppend, formatSummaryMessage, formatSquashMessage
  commands/
    registry.ts          # Registers all CommandPlugins + callback handlers
    help.ts              # createHelpPlugin
    note-resolver.ts     # parseNoteArgs, resolveNotePath (pure, testable)
    note.ts              # createNotePlugin (command + callback handler factory)
    summary.ts           # createSummaryPlugin + parsePeriod
  jobs/
    squash.ts            # createSquashJob + squash algorithm
    dailySummary.ts      # createDailySummaryJob
    scheduler.ts         # startScheduler (node-cron setup)
  github/
    client.ts            # getOctokit singleton
    files.ts             # getFile, writeFile, listFiles
    commits.ts           # fetchCommits, fetchCommitDiff, createCommit, updateBranchRef
  ai/
    provider.ts          # createAIProvider factory
    anthropic.ts         # AnthropicProvider class
    summarise.ts         # summariseAuthorDiffs, chunkText
tests/
  config.test.ts
  messaging/telegram/
    formatter.test.ts
    auth.test.ts
  commands/
    note-resolver.test.ts
    note.test.ts
    summary.test.ts
    help.test.ts
  github/
    files.test.ts
    commits.test.ts
  ai/
    summarise.test.ts
  jobs/
    squash.test.ts
.env.example
package.json
tsconfig.json
vitest.config.ts
```

---

## Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `.env.example`
- Create: `.gitignore`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "githassistant",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "build": "tsc",
    "dev": "tsx watch src/index.ts",
    "start": "node dist/index.js",
    "test": "vitest run",
    "test:watch": "vitest",
    "job:squash": "tsx src/jobs/squash.ts",
    "job:summary": "tsx src/jobs/dailySummary.ts"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.39.0",
    "@octokit/rest": "^21.0.2",
    "dotenv": "^16.4.7",
    "node-cron": "^3.0.3",
    "pino": "^9.5.0",
    "telegraf": "^4.16.3"
  },
  "devDependencies": {
    "@types/node": "^20.17.0",
    "@types/node-cron": "^3.0.11",
    "nock": "^14.0.0",
    "tsx": "^4.19.2",
    "typescript": "^5.7.2",
    "vitest": "^2.1.8"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "sourceMap": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

- [ ] **Step 3: Create vitest.config.ts**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globals: false,
  },
});
```

- [ ] **Step 4: Create .env.example**

```dotenv
# === Telegram ===
TELEGRAM_BOT_TOKEN=
TELEGRAM_GROUP_ID=
TELEGRAM_ALLOWED_USERS=alice,bob

# === GitHub ===
GITHUB_TOKEN=
GITHUB_OWNER=
GITHUB_REPO=
GITHUB_DEFAULT_BRANCH=main

# === Notes ===
NOTE_ALLOWED_PATHS=docs
NOTE_SHORTCUTS=
NOTE_ALLOWED_EXTENSIONS=md,txt

# === AI ===
AI_PROVIDER=anthropic
ANTHROPIC_API_KEY=
ANTHROPIC_MODEL=claude-sonnet-4-5

# === Scheduler ===
NIGHTLY_CRON=0 2 * * *
TIMEZONE=UTC

# === Behaviour ===
SUMMARY_MAX_DAYS=7
SQUASH_ENABLED=true
SUMMARY_LANGUAGE=en
LOG_LEVEL=info
RATE_LIMIT_PER_MIN=10
```

- [ ] **Step 5: Create .gitignore**

```
node_modules/
dist/
.env
*.js.map
```

- [ ] **Step 6: Install dependencies**

Run: `npm install`
Expected: `node_modules/` created, no errors.

- [ ] **Step 7: Commit**

```bash
git add package.json tsconfig.json vitest.config.ts .env.example .gitignore
git commit -m "chore: project scaffolding"
```

---

## Task 2: Shared Types

**Files:**
- Create: `src/types.ts`

- [ ] **Step 1: Write src/types.ts**

```typescript
export interface Config {
  telegram: {
    botToken: string;
    groupId: string;
    allowedUsers: string[];
  };
  github: {
    token: string;
    owner: string;
    repo: string;
    defaultBranch: string;
  };
  note: {
    allowedPaths: string[];
    shortcuts: Record<string, string>;
    allowedExtensions: string[];
  };
  ai: {
    provider: string;
    anthropicApiKey: string;
    anthropicModel: string;
  };
  scheduler: {
    nightlyCron: string;
    timezone: string;
  };
  behavior: {
    summaryMaxDays: number;
    squashEnabled: boolean;
    summaryLanguage: string;
    logLevel: string;
    rateLimitPerMin: number;
  };
}

export interface SendOptions {
  parseMode?: 'Markdown' | 'HTML';
}

export interface InlineOption {
  label: string;
  callbackData: string;
}

export interface AdapterContext {
  userId: string;
  username: string;
  text: string;
  replyText(text: string, options?: SendOptions): Promise<void>;
  showOptions(text: string, options: InlineOption[]): Promise<void>;
  setPendingNote(text: string): void;
  getPendingNote(): string | undefined;
  clearPendingNote(): void;
}

export interface CallbackContext {
  userId: string;
  username: string;
  callbackData: string;
  replyText(text: string, options?: SendOptions): Promise<void>;
  answerCallback(): Promise<void>;
  getPendingNote(): string | undefined;
  clearPendingNote(): void;
}

export type CommandHandler = (ctx: AdapterContext) => Promise<void>;
export type CallbackHandler = (ctx: CallbackContext) => Promise<void>;

export interface MessagingAdapter {
  sendMessage(text: string, options?: SendOptions): Promise<void>;
  sendDocument(filename: string, content: Buffer, caption?: string): Promise<void>;
  onCommand(command: string, handler: CommandHandler): void;
  onCallback(action: string, handler: CallbackHandler): void;
  isAuthorized(userId: string, username: string): Promise<boolean>;
  start(): Promise<void>;
}

export interface CommandPlugin {
  command: string;
  description: string;
  requiresAuth: boolean;
  handler: CommandHandler;
}

export interface JobPlugin {
  name: string;
  cronExpression?: string;
  handler: () => Promise<void>;
}

export interface AIProvider {
  summarise(prompt: string, content: string): Promise<string>;
}

export interface GitHubCommit {
  sha: string;
  shortSha: string;
  message: string;
  authorLogin: string;
  date: string;
  treeSha: string;
  parentShas: string[];
}

export interface AuthorCommitGroup {
  authorLogin: string;
  commits: GitHubCommit[];
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat: shared TypeScript types"
```

---

## Task 3: Config Module

**Files:**
- Create: `src/config.ts`
- Create: `tests/config.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/config.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfig } from '../src/config.js';

const REQUIRED = {
  TELEGRAM_BOT_TOKEN: 'token123',
  TELEGRAM_GROUP_ID: '-100123456',
  GITHUB_TOKEN: 'ghp_abc',
  GITHUB_OWNER: 'acme',
  GITHUB_REPO: 'repo',
};

function setEnv(vars: Record<string, string>) {
  for (const [k, v] of Object.entries(vars)) process.env[k] = v;
}

function clearEnv() {
  for (const k of Object.keys(REQUIRED)) delete process.env[k];
  delete process.env.TELEGRAM_ALLOWED_USERS;
  delete process.env.NOTE_ALLOWED_PATHS;
  delete process.env.NOTE_SHORTCUTS;
  delete process.env.ANTHROPIC_API_KEY;
}

describe('loadConfig', () => {
  beforeEach(clearEnv);
  afterEach(clearEnv);

  it('throws listing all missing required vars', () => {
    expect(() => loadConfig()).toThrow(/TELEGRAM_BOT_TOKEN.*TELEGRAM_GROUP_ID.*GITHUB_TOKEN.*GITHUB_OWNER.*GITHUB_REPO/s);
  });

  it('throws listing only missing vars when some are set', () => {
    setEnv({ TELEGRAM_BOT_TOKEN: 'x', TELEGRAM_GROUP_ID: 'y', GITHUB_TOKEN: 'z' });
    expect(() => loadConfig()).toThrow(/GITHUB_OWNER/);
    expect(() => loadConfig()).not.toThrow(/TELEGRAM_BOT_TOKEN/);
  });

  it('returns config when all required vars are set', () => {
    setEnv(REQUIRED);
    const config = loadConfig();
    expect(config.telegram.botToken).toBe('token123');
    expect(config.telegram.groupId).toBe('-100123456');
    expect(config.github.owner).toBe('acme');
    expect(config.github.defaultBranch).toBe('main');
  });

  it('parses TELEGRAM_ALLOWED_USERS as trimmed array', () => {
    setEnv({ ...REQUIRED, TELEGRAM_ALLOWED_USERS: 'alice, bob ,charlie' });
    const config = loadConfig();
    expect(config.telegram.allowedUsers).toEqual(['alice', 'bob', 'charlie']);
  });

  it('parses NOTE_SHORTCUTS into a record', () => {
    setEnv({ ...REQUIRED, NOTE_SHORTCUTS: 'i=docs/brand_ideas.md,m=docs/meeting-notes.md' });
    const config = loadConfig();
    expect(config.note.shortcuts).toEqual({
      i: 'docs/brand_ideas.md',
      m: 'docs/meeting-notes.md',
    });
  });

  it('applies defaults for optional vars', () => {
    setEnv(REQUIRED);
    const config = loadConfig();
    expect(config.note.allowedPaths).toEqual(['docs']);
    expect(config.note.allowedExtensions).toEqual(['md', 'txt']);
    expect(config.behavior.summaryMaxDays).toBe(7);
    expect(config.behavior.squashEnabled).toBe(true);
    expect(config.ai.anthropicModel).toBe('claude-sonnet-4-5');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/config.test.ts`
Expected: FAIL — "Cannot find module '../src/config.js'"

- [ ] **Step 3: Write src/config.ts**

```typescript
import 'dotenv/config';
import type { Config } from './types.js';

function collect(name: string, value: string | undefined, missing: string[]): string {
  if (!value) missing.push(name);
  return value ?? '';
}

function parseShortcuts(raw: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const entry of raw.split(',')) {
    const eq = entry.indexOf('=');
    if (eq < 1) continue;
    const key = entry.slice(0, eq).trim();
    const val = entry.slice(eq + 1).trim();
    if (key && val) result[key] = val;
  }
  return result;
}

export function loadConfig(): Config {
  const missing: string[] = [];

  const botToken = collect('TELEGRAM_BOT_TOKEN', process.env.TELEGRAM_BOT_TOKEN, missing);
  const groupId = collect('TELEGRAM_GROUP_ID', process.env.TELEGRAM_GROUP_ID, missing);
  const githubToken = collect('GITHUB_TOKEN', process.env.GITHUB_TOKEN, missing);
  const githubOwner = collect('GITHUB_OWNER', process.env.GITHUB_OWNER, missing);
  const githubRepo = collect('GITHUB_REPO', process.env.GITHUB_REPO, missing);

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  return {
    telegram: {
      botToken,
      groupId,
      allowedUsers: (process.env.TELEGRAM_ALLOWED_USERS ?? '')
        .split(',').map(s => s.trim()).filter(Boolean),
    },
    github: {
      token: githubToken,
      owner: githubOwner,
      repo: githubRepo,
      defaultBranch: process.env.GITHUB_DEFAULT_BRANCH ?? 'main',
    },
    note: {
      allowedPaths: (process.env.NOTE_ALLOWED_PATHS ?? 'docs')
        .split(',').map(s => s.trim()).filter(Boolean),
      shortcuts: parseShortcuts(process.env.NOTE_SHORTCUTS ?? ''),
      allowedExtensions: (process.env.NOTE_ALLOWED_EXTENSIONS ?? 'md,txt')
        .split(',').map(s => s.trim()).filter(Boolean),
    },
    ai: {
      provider: process.env.AI_PROVIDER ?? 'anthropic',
      anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? '',
      anthropicModel: process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-5',
    },
    scheduler: {
      nightlyCron: process.env.NIGHTLY_CRON ?? '0 2 * * *',
      timezone: process.env.TIMEZONE ?? 'UTC',
    },
    behavior: {
      summaryMaxDays: parseInt(process.env.SUMMARY_MAX_DAYS ?? '7', 10),
      squashEnabled: process.env.SQUASH_ENABLED !== 'false',
      summaryLanguage: process.env.SUMMARY_LANGUAGE ?? 'en',
      logLevel: process.env.LOG_LEVEL ?? 'info',
      rateLimitPerMin: parseInt(process.env.RATE_LIMIT_PER_MIN ?? '10', 10),
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/config.test.ts`
Expected: all 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/config.ts tests/config.test.ts
git commit -m "feat: config module with env validation"
```

---

## Task 4: GitHub Client

**Files:**
- Create: `src/github/client.ts`

- [ ] **Step 1: Write src/github/client.ts**

```typescript
import { Octokit } from '@octokit/rest';
import type { Config } from '../types.js';

let _instance: Octokit | null = null;

export function getOctokit(config: Config): Octokit {
  if (!_instance) {
    _instance = new Octokit({ auth: config.github.token });
  }
  return _instance;
}

export function resetOctokit(): void {
  _instance = null;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/github/client.ts
git commit -m "feat: GitHub Octokit singleton"
```

---

## Task 5: GitHub Files Module

**Files:**
- Create: `src/github/files.ts`
- Create: `tests/github/files.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/github/files.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Octokit } from '@octokit/rest';
import type { Config } from '../../src/types.js';
import { getFile, writeFile, listFiles } from '../../src/github/files.js';

const config: Config = {
  telegram: { botToken: '', groupId: '', allowedUsers: [] },
  github: { token: 'tok', owner: 'owner', repo: 'repo', defaultBranch: 'main' },
  note: { allowedPaths: ['docs'], shortcuts: {}, allowedExtensions: ['md', 'txt'] },
  ai: { provider: 'anthropic', anthropicApiKey: '', anthropicModel: '' },
  scheduler: { nightlyCron: '', timezone: 'UTC' },
  behavior: { summaryMaxDays: 7, squashEnabled: true, summaryLanguage: 'en', logLevel: 'info', rateLimitPerMin: 10 },
};

function makeOctokit(getContentImpl: any, createOrUpdateImpl?: any): Octokit {
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/github/files.test.ts`
Expected: FAIL — "Cannot find module '../../src/github/files.js'"

- [ ] **Step 3: Write src/github/files.ts**

```typescript
import type { Octokit } from '@octokit/rest';
import type { Config } from '../types.js';

export interface FileContent {
  content: string;
  sha: string;
}

export async function getFile(
  octokit: Octokit,
  config: Config,
  path: string,
): Promise<FileContent | null> {
  try {
    const { data } = await octokit.repos.getContent({
      owner: config.github.owner,
      repo: config.github.repo,
      path,
      ref: config.github.defaultBranch,
    });
    const file = data as { type: string; content: string; sha: string };
    if (file.type !== 'file') return null;
    return {
      content: Buffer.from(file.content, 'base64').toString('utf-8'),
      sha: file.sha,
    };
  } catch (err: unknown) {
    if (typeof err === 'object' && err !== null && 'status' in err && (err as { status: number }).status === 404) {
      return null;
    }
    throw err;
  }
}

export async function writeFile(
  octokit: Octokit,
  config: Config,
  path: string,
  content: string,
  message: string,
  existingSha?: string,
): Promise<void> {
  await octokit.repos.createOrUpdateFileContents({
    owner: config.github.owner,
    repo: config.github.repo,
    path,
    message,
    content: Buffer.from(content, 'utf-8').toString('base64'),
    sha: existingSha,
    branch: config.github.defaultBranch,
  });
}

export async function listFiles(
  octokit: Octokit,
  config: Config,
  allowedPaths: string[],
): Promise<string[]> {
  const results: string[] = [];
  for (const dir of allowedPaths) {
    await collectFiles(octokit, config, dir, results);
  }
  return results;
}

async function collectFiles(
  octokit: Octokit,
  config: Config,
  path: string,
  results: string[],
): Promise<void> {
  try {
    const { data } = await octokit.repos.getContent({
      owner: config.github.owner,
      repo: config.github.repo,
      path,
      ref: config.github.defaultBranch,
    });
    const items = Array.isArray(data) ? data : [data];
    for (const item of items as Array<{ type: string; path: string }>) {
      if (item.type === 'file') {
        results.push(item.path);
      } else if (item.type === 'dir') {
        await collectFiles(octokit, config, item.path, results);
      }
    }
  } catch {
    // directory not found — skip
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/github/files.test.ts`
Expected: all 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/github/files.ts tests/github/files.test.ts
git commit -m "feat: GitHub file read/write helpers"
```

---

## Task 6: GitHub Commits Module

**Files:**
- Create: `src/github/commits.ts`
- Create: `tests/github/commits.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/github/commits.test.ts
import { describe, it, expect, vi } from 'vitest';
import type { Octokit } from '@octokit/rest';
import type { Config } from '../../src/types.js';
import { fetchCommits, fetchCommitDiff, createCommit, updateBranchRef } from '../../src/github/commits.js';

const config: Config = {
  telegram: { botToken: '', groupId: '', allowedUsers: [] },
  github: { token: 'tok', owner: 'owner', repo: 'repo', defaultBranch: 'main' },
  note: { allowedPaths: ['docs'], shortcuts: {}, allowedExtensions: ['md', 'txt'] },
  ai: { provider: 'anthropic', anthropicApiKey: '', anthropicModel: '' },
  scheduler: { nightlyCron: '', timezone: 'UTC' },
  behavior: { summaryMaxDays: 7, squashEnabled: true, summaryLanguage: 'en', logLevel: 'info', rateLimitPerMin: 10 },
};

function makeOctokit(overrides: Record<string, unknown> = {}): Octokit {
  return {
    repos: {
      listCommits: vi.fn().mockResolvedValue({ data: [] }),
      getCommit: vi.fn().mockResolvedValue({ data: '' }),
      ...overrides.repos,
    },
    git: {
      createCommit: vi.fn().mockResolvedValue({ data: { sha: 'newsha' } }),
      updateRef: vi.fn().mockResolvedValue({}),
      ...overrides.git,
    },
    request: vi.fn().mockResolvedValue({ data: 'diff content' }),
    ...overrides,
  } as unknown as Octokit;
}

const RAW_COMMIT = {
  sha: 'abc1234567',
  commit: {
    message: 'feat: add login\n\nBody text',
    author: { date: '2025-04-24T10:00:00Z', name: 'Alice' },
    tree: { sha: 'tree123' },
  },
  author: { login: 'alice' },
  parents: [{ sha: 'parent1' }],
};

describe('fetchCommits', () => {
  it('maps raw API response to GitHubCommit', async () => {
    const octokit = makeOctokit({
      repos: { listCommits: vi.fn().mockResolvedValue({ data: [RAW_COMMIT] }) },
    });
    const commits = await fetchCommits(octokit, config, new Date('2025-04-24T00:00:00Z'));
    expect(commits).toHaveLength(1);
    expect(commits[0]).toEqual({
      sha: 'abc1234567',
      shortSha: 'abc1234',
      message: 'feat: add login',
      authorLogin: 'alice',
      date: '2025-04-24T10:00:00Z',
      treeSha: 'tree123',
      parentShas: ['parent1'],
    });
  });

  it('returns empty array when no commits', async () => {
    const octokit = makeOctokit();
    const commits = await fetchCommits(octokit, config, new Date());
    expect(commits).toEqual([]);
  });
});

describe('fetchCommitDiff', () => {
  it('fetches diff via request with diff media type', async () => {
    const request = vi.fn().mockResolvedValue({ data: 'diff --git a/file.md' });
    const octokit = makeOctokit({ request });
    const diff = await fetchCommitDiff(octokit, config, 'abc123');
    expect(request).toHaveBeenCalledWith(
      'GET /repos/{owner}/{repo}/commits/{ref}',
      expect.objectContaining({ ref: 'abc123', headers: { accept: 'application/vnd.github.diff' } }),
    );
    expect(diff).toBe('diff --git a/file.md');
  });
});

describe('createCommit', () => {
  it('creates a commit and returns its sha', async () => {
    const createCommitMock = vi.fn().mockResolvedValue({ data: { sha: 'newsha123' } });
    const octokit = makeOctokit({ git: { createCommit: createCommitMock, updateRef: vi.fn() } });
    const sha = await createCommit(octokit, config, {
      message: 'daily(@alice): 2 changes on 2025-04-24',
      treeSha: 'tree999',
      parentSha: 'parent888',
    });
    expect(sha).toBe('newsha123');
    expect(createCommitMock).toHaveBeenCalledWith(expect.objectContaining({
      message: 'daily(@alice): 2 changes on 2025-04-24',
      tree: 'tree999',
      parents: ['parent888'],
    }));
  });
});

describe('updateBranchRef', () => {
  it('calls git.updateRef with force=true', async () => {
    const updateRef = vi.fn().mockResolvedValue({});
    const octokit = makeOctokit({ git: { createCommit: vi.fn(), updateRef } });
    await updateBranchRef(octokit, config, 'tipshaXYZ');
    expect(updateRef).toHaveBeenCalledWith(expect.objectContaining({
      ref: 'heads/main',
      sha: 'tipshaXYZ',
      force: true,
    }));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/github/commits.test.ts`
Expected: FAIL — "Cannot find module '../../src/github/commits.js'"

- [ ] **Step 3: Write src/github/commits.ts**

```typescript
import type { Octokit } from '@octokit/rest';
import type { Config, GitHubCommit } from '../types.js';

export async function fetchCommits(
  octokit: Octokit,
  config: Config,
  since: Date,
  until?: Date,
): Promise<GitHubCommit[]> {
  const params: Record<string, unknown> = {
    owner: config.github.owner,
    repo: config.github.repo,
    sha: config.github.defaultBranch,
    since: since.toISOString(),
    per_page: 100,
  };
  if (until) params.until = until.toISOString();

  const { data } = await octokit.repos.listCommits(params as Parameters<typeof octokit.repos.listCommits>[0]);

  return data.map(c => ({
    sha: c.sha,
    shortSha: c.sha.slice(0, 7),
    message: (c.commit.message ?? '').split('\n')[0],
    authorLogin: c.author?.login ?? c.commit.author?.name ?? 'unknown',
    date: c.commit.author?.date ?? new Date().toISOString(),
    treeSha: c.commit.tree.sha,
    parentShas: c.parents.map(p => p.sha),
  }));
}

export async function fetchCommitDiff(
  octokit: Octokit,
  config: Config,
  sha: string,
): Promise<string> {
  const { data } = await octokit.request('GET /repos/{owner}/{repo}/commits/{ref}', {
    owner: config.github.owner,
    repo: config.github.repo,
    ref: sha,
    headers: { accept: 'application/vnd.github.diff' },
  });
  return data as unknown as string;
}

export async function createCommit(
  octokit: Octokit,
  config: Config,
  params: { message: string; treeSha: string; parentSha: string },
): Promise<string> {
  const { data } = await octokit.git.createCommit({
    owner: config.github.owner,
    repo: config.github.repo,
    message: params.message,
    tree: params.treeSha,
    parents: [params.parentSha],
  });
  return data.sha;
}

export async function updateBranchRef(
  octokit: Octokit,
  config: Config,
  sha: string,
): Promise<void> {
  await octokit.git.updateRef({
    owner: config.github.owner,
    repo: config.github.repo,
    ref: `heads/${config.github.defaultBranch}`,
    sha,
    force: true,
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/github/commits.test.ts`
Expected: all 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/github/commits.ts tests/github/commits.test.ts
git commit -m "feat: GitHub commit read/write helpers"
```

---

## Task 7: AI Provider

**Files:**
- Create: `src/ai/provider.ts`
- Create: `src/ai/anthropic.ts`

- [ ] **Step 1: Write src/ai/anthropic.ts**

```typescript
import Anthropic from '@anthropic-ai/sdk';
import type { Config, AIProvider } from '../types.js';

export class AnthropicProvider implements AIProvider {
  private client: Anthropic;
  private model: string;

  constructor(config: Config) {
    this.client = new Anthropic({ apiKey: config.ai.anthropicApiKey });
    this.model = config.ai.anthropicModel;
  }

  async summarise(prompt: string, content: string): Promise<string> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 1024,
      messages: [{ role: 'user', content: `${prompt}\n\n${content}` }],
    });
    const block = response.content[0];
    if (block.type !== 'text') throw new Error('Unexpected non-text response from Anthropic');
    return block.text;
  }
}
```

- [ ] **Step 2: Write src/ai/provider.ts**

```typescript
import type { Config, AIProvider } from '../types.js';
import { AnthropicProvider } from './anthropic.js';

export function createAIProvider(config: Config): AIProvider {
  switch (config.ai.provider) {
    case 'anthropic':
      return new AnthropicProvider(config);
    default:
      throw new Error(`Unknown AI provider: "${config.ai.provider}". Supported: anthropic`);
  }
}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/ai/provider.ts src/ai/anthropic.ts
git commit -m "feat: AI provider abstraction + Anthropic implementation"
```

---

## Task 8: AI Summarise Logic

**Files:**
- Create: `src/ai/summarise.ts`
- Create: `tests/ai/summarise.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/ai/summarise.test.ts
import { describe, it, expect, vi } from 'vitest';
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
  const mockProvider: AIProvider = {
    summarise: vi.fn().mockResolvedValue('Summary text.'),
  };

  it('calls provider once when combined diffs are under limit', async () => {
    const result = await summariseAuthorDiffs(mockProvider, ['small diff'], 'en');
    expect(result).toBe('Summary text.');
    expect(mockProvider.summarise).toHaveBeenCalledTimes(1);
    expect(mockProvider.summarise).toHaveBeenCalledWith(
      expect.stringContaining('en'),
      'small diff',
    );
  });

  it('chunks large diffs and consolidates', async () => {
    vi.mocked(mockProvider.summarise).mockResolvedValue('Chunk summary.');
    const largeDiff = 'x'.repeat(90_000);
    await summariseAuthorDiffs(mockProvider, [largeDiff], 'en');
    // Should be called >1 times: chunks + consolidation
    expect(vi.mocked(mockProvider.summarise).mock.calls.length).toBeGreaterThan(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/ai/summarise.test.ts`
Expected: FAIL — "Cannot find module '../../src/ai/summarise.js'"

- [ ] **Step 3: Write src/ai/summarise.ts**

```typescript
import type { AIProvider } from '../types.js';

const MAX_DIFF_CHARS = 80_000;

export const SUMMARY_PROMPT = (language: string): string =>
  `Summarise the following git changes made by one person in plain language, as if explaining to a colleague. Focus on what changed and why it matters. Do not list file names or statistics. Keep it to 3–5 sentences. Respond in ${language}.`;

export function chunkText(text: string, maxChars: number): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    chunks.push(text.slice(start, start + maxChars));
    start += maxChars;
  }
  return chunks;
}

export async function summariseAuthorDiffs(
  provider: AIProvider,
  diffs: string[],
  language: string,
): Promise<string> {
  const combined = diffs.join('\n\n---\n\n');

  if (combined.length <= MAX_DIFF_CHARS) {
    return provider.summarise(SUMMARY_PROMPT(language), combined);
  }

  const chunks = chunkText(combined, MAX_DIFF_CHARS);
  const chunkSummaries = await Promise.all(
    chunks.map(chunk => provider.summarise(SUMMARY_PROMPT(language), chunk)),
  );

  if (chunkSummaries.length === 1) return chunkSummaries[0];

  const consolidationPrompt = `Consolidate the following partial summaries into a single cohesive summary of 3–5 sentences. Respond in ${language}.`;
  return provider.summarise(consolidationPrompt, chunkSummaries.join('\n\n'));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/ai/summarise.test.ts`
Expected: all 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ai/summarise.ts tests/ai/summarise.test.ts
git commit -m "feat: AI diff chunking and summarisation logic"
```

---

## Task 9: Messaging Adapter Interface

**Files:**
- Create: `src/messaging/adapter.ts`

- [ ] **Step 1: Write src/messaging/adapter.ts**

```typescript
export type {
  MessagingAdapter,
  AdapterContext,
  CallbackContext,
  CommandHandler,
  CallbackHandler,
  SendOptions,
  InlineOption,
} from '../types.js';
```

- [ ] **Step 2: Commit**

```bash
git add src/messaging/adapter.ts
git commit -m "feat: messaging adapter interface module"
```

---

## Task 10: Telegram Formatter

**Files:**
- Create: `src/messaging/telegram/formatter.ts`
- Create: `tests/messaging/telegram/formatter.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/messaging/telegram/formatter.test.ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/messaging/telegram/formatter.test.ts`
Expected: FAIL — "Cannot find module '../../../src/messaging/telegram/formatter.js'"

- [ ] **Step 3: Write src/messaging/telegram/formatter.ts**

```typescript
import type { GitHubCommit } from '../../types.js';

export function formatNoteAppend(text: string, username: string, date: Date = new Date()): string {
  const iso = date.toISOString().replace(/:\d{2}\.\d{3}Z$/, 'Z');
  return `\n<!-- note: ${iso} | @${username} -->\n${text}\n`;
}

export interface AuthorSummary {
  authorLogin: string;
  summary: string;
}

export function formatSummaryMessage(period: string, summaries: AuthorSummary[]): string {
  if (summaries.length === 0) return `No commits found in the ${period}.`;

  const lines = [`📋 *Project summary — ${period}*`];
  for (const { authorLogin, summary } of summaries) {
    lines.push('', `👤 *@${authorLogin}*`, summary);
  }
  return lines.join('\n');
}

export function formatSquashCommitMessage(
  authorLogin: string,
  dateStr: string,
  commits: GitHubCommit[],
): string {
  const bullets = commits.map(c => `- ${c.message} (${c.shortSha})`).join('\n');
  return `daily(@${authorLogin}): ${commits.length} changes on ${dateStr}\n\n${bullets}`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/messaging/telegram/formatter.test.ts`
Expected: all 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/messaging/telegram/formatter.ts tests/messaging/telegram/formatter.test.ts
git commit -m "feat: Telegram message formatting helpers"
```

---

## Task 11: Telegram Adapter

**Files:**
- Create: `src/messaging/telegram/auth.ts`
- Create: `tests/messaging/telegram/auth.test.ts`
- Create: `src/messaging/telegram/index.ts`

- [ ] **Step 1: Write the failing auth tests**

```typescript
// tests/messaging/telegram/auth.test.ts
import { describe, it, expect } from 'vitest';
import { isInAllowlist } from '../../../src/messaging/telegram/auth.js';

describe('isInAllowlist', () => {
  it('returns true when username is in allowlist', () => {
    expect(isInAllowlist('alice', ['alice', 'bob'])).toBe(true);
  });

  it('returns false when username is not in allowlist', () => {
    expect(isInAllowlist('charlie', ['alice', 'bob'])).toBe(false);
  });

  it('returns false for empty allowlist', () => {
    expect(isInAllowlist('alice', [])).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/messaging/telegram/auth.test.ts`
Expected: FAIL — "Cannot find module '../../../src/messaging/telegram/auth.js'"

- [ ] **Step 3: Write src/messaging/telegram/auth.ts**

```typescript
export function isInAllowlist(username: string, allowedUsers: string[]): boolean {
  return allowedUsers.includes(username);
}
```

- [ ] **Step 4: Run auth tests to verify they pass**

Run: `npm test -- tests/messaging/telegram/auth.test.ts`
Expected: all 3 tests PASS.

- [ ] **Step 5: Write src/messaging/telegram/index.ts**

```typescript
import { Telegraf } from 'telegraf';
import type { Logger } from 'pino';
import type {
  MessagingAdapter,
  AdapterContext,
  CallbackContext,
  CommandHandler,
  CallbackHandler,
  SendOptions,
  InlineOption,
  Config,
} from '../../types.js';
import { isInAllowlist } from './auth.js';

export class TelegramAdapter implements MessagingAdapter {
  private bot: Telegraf;
  private config: Config;
  private log: Logger;
  private pendingNotes = new Map<string, string>();
  private rateLimits = new Map<string, { count: number; resetAt: number }>();

  constructor(config: Config, log: Logger) {
    this.bot = new Telegraf(config.telegram.botToken);
    this.config = config;
    this.log = log;
    this.bot.use((ctx, next) => {
      if (ctx.chat?.id?.toString() !== config.telegram.groupId) return;
      return next();
    });
  }

  private checkRateLimit(userId: string): boolean {
    const now = Date.now();
    const entry = this.rateLimits.get(userId);
    if (!entry || now > entry.resetAt) {
      this.rateLimits.set(userId, { count: 1, resetAt: now + 60_000 });
      return false;
    }
    if (entry.count >= this.config.behavior.rateLimitPerMin) return true;
    entry.count++;
    return false;
  }

  async isAuthorized(userId: string, username: string): Promise<boolean> {
    if (isInAllowlist(username, this.config.telegram.allowedUsers)) return true;
    try {
      const member = await this.bot.telegram.getChatMember(
        this.config.telegram.groupId,
        parseInt(userId, 10),
      );
      return ['administrator', 'creator'].includes(member.status);
    } catch {
      return false;
    }
  }

  async sendMessage(text: string, options?: SendOptions): Promise<void> {
    await this.bot.telegram.sendMessage(this.config.telegram.groupId, text, {
      parse_mode: options?.parseMode,
    });
  }

  async sendDocument(filename: string, content: Buffer, caption?: string): Promise<void> {
    await this.bot.telegram.sendDocument(
      this.config.telegram.groupId,
      { source: content, filename },
      { caption },
    );
  }

  onCommand(command: string, handler: CommandHandler): void {
    this.bot.command(command, async (ctx) => {
      const userId = ctx.from?.id?.toString() ?? '';
      const username = ctx.from?.username ?? ctx.from?.first_name ?? 'unknown';

      if (this.checkRateLimit(userId)) {
        await ctx.reply('Rate limit exceeded. Please wait a minute before trying again.');
        return;
      }

      const fullText = (ctx.message as { text?: string }).text ?? '';
      const commandText = fullText.replace(/^\/\w+(@\w+)?\s*/, '');

      const pending = this.pendingNotes;
      const adapterCtx: AdapterContext = {
        userId,
        username,
        text: commandText,
        replyText: async (msg, opts) => { await ctx.reply(msg, { parse_mode: opts?.parseMode }); },
        showOptions: async (msg, options: InlineOption[]) => {
          await ctx.reply(msg, {
            reply_markup: {
              inline_keyboard: [options.map(o => ({ text: o.label, callback_data: o.callbackData }))],
            },
          });
        },
        setPendingNote: (text) => { pending.set(userId, text); },
        getPendingNote: () => pending.get(userId),
        clearPendingNote: () => { pending.delete(userId); },
      };

      try {
        await handler(adapterCtx);
      } catch (err) {
        this.log.error({ err }, `Error in /${command} handler`);
        await ctx.reply('An unexpected error occurred. Please try again.');
      }
    });
  }

  onCallback(action: string, handler: CallbackHandler): void {
    this.bot.action(new RegExp(`^${action}:`), async (ctx) => {
      const userId = ctx.from?.id?.toString() ?? '';
      const username = ctx.from?.username ?? ctx.from?.first_name ?? 'unknown';
      const callbackData = (ctx.callbackQuery as { data?: string }).data ?? '';
      const pending = this.pendingNotes;

      const callbackCtx: CallbackContext = {
        userId,
        username,
        callbackData,
        replyText: async (msg, opts) => { await ctx.reply(msg, { parse_mode: opts?.parseMode }); },
        answerCallback: async () => { await ctx.answerCbQuery(); },
        getPendingNote: () => pending.get(userId),
        clearPendingNote: () => { pending.delete(userId); },
      };

      try {
        await handler(callbackCtx);
      } catch (err) {
        this.log.error({ err }, `Error in callback ${action}`);
        await ctx.answerCbQuery('An error occurred.');
      }
    });
  }

  async start(): Promise<void> {
    this.log.info('Starting Telegram bot (long polling)...');
    await this.bot.launch();
    process.once('SIGINT', () => this.bot.stop('SIGINT'));
    process.once('SIGTERM', () => this.bot.stop('SIGTERM'));
  }
}
```

- [ ] **Step 6: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/messaging/telegram/auth.ts src/messaging/telegram/index.ts tests/messaging/telegram/auth.test.ts
git commit -m "feat: Telegram adapter with rate limiting and pending-note state"
```

---

## Task 12: /help Command

**Files:**
- Create: `src/commands/help.ts`
- Create: `tests/commands/help.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/commands/help.test.ts
import { describe, it, expect, vi } from 'vitest';
import type { Config } from '../../src/types.js';
import { createHelpPlugin } from '../../src/commands/help.js';

const config: Config = {
  telegram: { botToken: '', groupId: '', allowedUsers: [] },
  github: { token: '', owner: '', repo: '', defaultBranch: 'main' },
  note: { allowedPaths: ['docs'], shortcuts: { i: 'docs/ideas.md', m: 'docs/meetings.md' }, allowedExtensions: ['md'] },
  ai: { provider: 'anthropic', anthropicApiKey: '', anthropicModel: '' },
  scheduler: { nightlyCron: '', timezone: 'UTC' },
  behavior: { summaryMaxDays: 7, squashEnabled: true, summaryLanguage: 'en', logLevel: 'info', rateLimitPerMin: 10 },
};

function makeCtx(replyText = vi.fn()) {
  return { userId: '1', username: 'alice', text: '', replyText, showOptions: vi.fn(), setPendingNote: vi.fn(), getPendingNote: vi.fn(), clearPendingNote: vi.fn() };
}

describe('createHelpPlugin', () => {
  it('registers as /help with no auth required', () => {
    const plugin = createHelpPlugin(config);
    expect(plugin.command).toBe('help');
    expect(plugin.requiresAuth).toBe(false);
  });

  it('replies with command reference including configured shortcuts', async () => {
    const replyText = vi.fn();
    const plugin = createHelpPlugin(config);
    await plugin.handler(makeCtx(replyText));
    expect(replyText).toHaveBeenCalledTimes(1);
    const msg = replyText.mock.calls[0][0] as string;
    expect(msg).toContain('/note');
    expect(msg).toContain('/summary');
    expect(msg).toContain('/help');
    expect(msg).toContain('i → docs/ideas.md');
    expect(msg).toContain('m → docs/meetings.md');
  });

  it('omits shortcut section when no shortcuts configured', async () => {
    const noShortcutsConfig = { ...config, note: { ...config.note, shortcuts: {} } };
    const replyText = vi.fn();
    const plugin = createHelpPlugin(noShortcutsConfig);
    await plugin.handler(makeCtx(replyText));
    const msg = replyText.mock.calls[0][0] as string;
    expect(msg).not.toContain('Shortcuts');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/commands/help.test.ts`
Expected: FAIL — "Cannot find module '../../src/commands/help.js'"

- [ ] **Step 3: Write src/commands/help.ts**

```typescript
import type { CommandPlugin, Config } from '../types.js';

export function createHelpPlugin(config: Config): CommandPlugin {
  return {
    command: 'help',
    description: 'Show this help message',
    requiresAuth: false,
    handler: async (ctx) => {
      const shortcuts = Object.entries(config.note.shortcuts);
      const shortcutLine = shortcuts.length > 0
        ? `\nShortcuts configured: ${shortcuts.map(([k, v]) => `${k} → ${v}`).join(', ')}`
        : '';

      await ctx.replyText(
        `GitHAssistant commands:\n\n` +
        `/note [file|shortcut] <text>  — Add a note to a project file\n` +
        `/summary [period]             — Summarise recent changes (default: last 24h)\n` +
        `/help                         — Show this message` +
        shortcutLine,
      );
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/commands/help.test.ts`
Expected: all 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/commands/help.ts tests/commands/help.test.ts
git commit -m "feat: /help command"
```

---

## Task 13: Note Resolver (Path Dispatch Logic)

**Files:**
- Create: `src/commands/note-resolver.ts`
- Create: `tests/commands/note-resolver.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/commands/note-resolver.test.ts
import { describe, it, expect } from 'vitest';
import { parseNoteArgs, validateNotePath } from '../../src/commands/note-resolver.js';

const shortcuts: Record<string, string> = { i: 'docs/ideas.md', m: 'docs/meetings.md' };
const allowedPaths = ['docs'];
const allowedExtensions = ['md', 'txt'];

describe('parseNoteArgs', () => {
  it('detects Form B when first token is a known shortcut', () => {
    const result = parseNoteArgs('i My note here', shortcuts);
    expect(result).toEqual({ form: 'B', shortcutKey: 'i', noteText: 'My note here' });
  });

  it('detects Form A when first token contains a slash', () => {
    const result = parseNoteArgs('docs/notes.md Sprint review notes', shortcuts);
    expect(result).toEqual({ form: 'A', filePath: 'docs/notes.md', noteText: 'Sprint review notes' });
  });

  it('detects Form A when first token ends with .md', () => {
    const result = parseNoteArgs('notes.md My note', shortcuts);
    expect(result).toEqual({ form: 'A', filePath: 'notes.md', noteText: 'My note' });
  });

  it('detects Form A when first token ends with .txt', () => {
    const result = parseNoteArgs('log.txt entry text', shortcuts);
    expect(result).toEqual({ form: 'A', filePath: 'log.txt', noteText: 'entry text' });
  });

  it('detects Form C when first token is not a shortcut or path', () => {
    const result = parseNoteArgs('We agreed to deprecate the API.', shortcuts);
    expect(result).toEqual({ form: 'C', noteText: 'We agreed to deprecate the API.' });
  });

  it('detects Form C when text is empty', () => {
    const result = parseNoteArgs('', shortcuts);
    expect(result).toEqual({ form: 'C', noteText: '' });
  });
});

describe('validateNotePath', () => {
  it('accepts a path under an allowed root', () => {
    expect(validateNotePath('docs/notes.md', allowedPaths, allowedExtensions)).toBeNull();
  });

  it('rejects a path outside allowed roots', () => {
    expect(validateNotePath('secrets/passwords.md', allowedPaths, allowedExtensions)).toMatch(/not in an accessible folder/);
  });

  it('rejects path traversal attempts', () => {
    expect(validateNotePath('docs/../secrets/pw.md', allowedPaths, allowedExtensions)).toMatch(/not in an accessible folder/);
  });

  it('rejects disallowed file extensions', () => {
    expect(validateNotePath('docs/file.js', allowedPaths, allowedExtensions)).toMatch(/extension/i);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/commands/note-resolver.test.ts`
Expected: FAIL — "Cannot find module '../../src/commands/note-resolver.js'"

- [ ] **Step 3: Write src/commands/note-resolver.ts**

```typescript
import path from 'path';

export type NoteArgsResult =
  | { form: 'A'; filePath: string; noteText: string }
  | { form: 'B'; shortcutKey: string; noteText: string }
  | { form: 'C'; noteText: string };

const FILE_TOKEN_RE = /[/]|\.(?:md|txt|MD|TXT)$/;

export function parseNoteArgs(text: string, shortcuts: Record<string, string>): NoteArgsResult {
  const trimmed = text.trim();
  if (!trimmed) return { form: 'C', noteText: '' };

  const spaceIdx = trimmed.indexOf(' ');
  const firstToken = spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx);
  const rest = spaceIdx === -1 ? '' : trimmed.slice(spaceIdx + 1).trim();

  if (firstToken in shortcuts) {
    return { form: 'B', shortcutKey: firstToken, noteText: rest };
  }

  if (FILE_TOKEN_RE.test(firstToken)) {
    return { form: 'A', filePath: firstToken, noteText: rest };
  }

  return { form: 'C', noteText: trimmed };
}

export function validateNotePath(
  filePath: string,
  allowedPaths: string[],
  allowedExtensions: string[],
): string | null {
  const ext = path.extname(filePath).slice(1).toLowerCase();
  if (!allowedExtensions.includes(ext)) {
    return `File extension ".${ext}" is not allowed. Allowed extensions: ${allowedExtensions.map(e => `.${e}`).join(', ')}.`;
  }

  const resolved = path.normalize(filePath);
  const isAllowed = allowedPaths.some(allowed => {
    const normalizedAllowed = path.normalize(allowed);
    return resolved === normalizedAllowed || resolved.startsWith(normalizedAllowed + path.sep);
  });

  if (!isAllowed) {
    return `That path is not in an accessible folder. Allowed roots: ${allowedPaths.join(', ')}.`;
  }

  return null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/commands/note-resolver.test.ts`
Expected: all 10 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/commands/note-resolver.ts tests/commands/note-resolver.test.ts
git commit -m "feat: note path dispatch and validation logic"
```

---

## Task 14: /note Command

**Files:**
- Create: `src/commands/note.ts`
- Create: `tests/commands/note.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/commands/note.test.ts
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
};

function makeCtx(text: string, overrides: Partial<AdapterContext> = {}): AdapterContext {
  return {
    userId: '42',
    username: 'alice',
    text,
    replyText: vi.fn(),
    showOptions: vi.fn(),
    setPendingNote: vi.fn(),
    getPendingNote: vi.fn(),
    clearPendingNote: vi.fn(),
    ...overrides,
  };
}

function makeOctokit(getContentResult: unknown = null, createOrUpdateResult = {}): Octokit {
  return {
    repos: {
      getContent: getContentResult === null
        ? vi.fn().mockRejectedValue(Object.assign(new Error('Not Found'), { status: 404 }))
        : vi.fn().mockResolvedValue({ data: getContentResult }),
      createOrUpdateFileContents: vi.fn().mockResolvedValue(createOrUpdateResult),
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
  it('appends note to existing file and confirms', async () => {
    const existing = { type: 'file', content: Buffer.from('# Notes').toString('base64'), sha: 'sha1' };
    const octokit = makeOctokit(existing);
    const { plugin } = createNotePlugin(octokit, config);
    const ctx = makeCtx('docs/notes.md Sprint recap.');
    await plugin.handler(ctx);
    expect(octokit.repos.createOrUpdateFileContents).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'docs/notes.md', sha: 'sha1' }),
    );
    expect(ctx.replyText).toHaveBeenCalledWith(expect.stringContaining('✅'));
  });

  it('creates a new file if it does not exist', async () => {
    const octokit = makeOctokit(null);
    const { plugin } = createNotePlugin(octokit, config);
    const ctx = makeCtx('docs/notes.md First note.');
    await plugin.handler(ctx);
    expect(octokit.repos.createOrUpdateFileContents).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'docs/notes.md', sha: undefined }),
    );
  });

  it('rejects path outside allowed paths', async () => {
    const { plugin } = createNotePlugin(makeOctokit(), config);
    const ctx = makeCtx('secrets/pw.md Bad path.');
    await plugin.handler(ctx);
    expect(ctx.replyText).toHaveBeenCalledWith(expect.stringContaining('not in an accessible folder'));
    expect(octokit.repos.createOrUpdateFileContents).not.toHaveBeenCalled();
  });
});

describe('/note Form B — shortcut', () => {
  it('resolves shortcut and appends note', async () => {
    const existing = { type: 'file', content: Buffer.from('# Ideas').toString('base64'), sha: 'sha2' };
    const octokit = makeOctokit(existing);
    const { plugin } = createNotePlugin(octokit, config);
    const ctx = makeCtx('i New logo idea.');
    await plugin.handler(ctx);
    expect(octokit.repos.createOrUpdateFileContents).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'docs/ideas.md' }),
    );
  });

  it('replies with known shortcuts for unknown shortcut', async () => {
    const { plugin } = createNotePlugin(makeOctokit(), config);
    const ctx = makeCtx('z Unknown shortcut text.');
    // 'z' not in shortcuts → Form C (since z is not a path), so this actually goes to Form C
    // Let's use a shortcut-like single letter that looks like it should be a shortcut
    // Actually, Form C handles this — the text is appended as the note text
    // To test unknown shortcut feedback, we need to trigger Form B explicitly
    // Form B triggers when the token IS a known shortcut key — 'z' is not known, so it's Form C
    // This test case isn't needed — remove from implementation
  });
});

describe('/note Form C — no path (inline keyboard)', () => {
  it('lists files and stores pending note text', async () => {
    const dirContent = [
      { type: 'file', path: 'docs/notes.md' },
    ];
    const octokit = makeOctokit(dirContent);
    const setPendingNote = vi.fn();
    const showOptions = vi.fn();
    const { plugin } = createNotePlugin(octokit, config);
    const ctx = makeCtx('We agreed to deprecate the API.', { setPendingNote, showOptions });
    await plugin.handler(ctx);
    expect(setPendingNote).toHaveBeenCalledWith('We agreed to deprecate the API.');
    expect(showOptions).toHaveBeenCalledWith(
      expect.stringContaining('Choose a file'),
      expect.arrayContaining([expect.objectContaining({ label: 'docs/notes.md' })]),
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/commands/note.test.ts`
Expected: FAIL — "Cannot find module '../../src/commands/note.js'"

- [ ] **Step 3: Write src/commands/note.ts**

```typescript
import type { Octokit } from '@octokit/rest';
import type { Config, CommandPlugin, CallbackHandler } from '../types.js';
import { parseNoteArgs, validateNotePath } from './note-resolver.js';
import { getFile, writeFile, listFiles } from '../github/files.js';
import { formatNoteAppend } from '../messaging/telegram/formatter.js';
import path from 'path';

export function createNotePlugin(
  octokit: Octokit,
  config: Config,
): { plugin: CommandPlugin; callbackHandler: CallbackHandler } {
  const plugin: CommandPlugin = {
    command: 'note',
    description: 'Append a note to a project file',
    requiresAuth: true,
    handler: async (ctx) => {
      const args = parseNoteArgs(ctx.text, config.note.shortcuts);

      if (args.form === 'B') {
        const filePath = config.note.shortcuts[args.shortcutKey];
        await appendNoteToFile(octokit, config, filePath, args.noteText, ctx.username);
        await ctx.replyText(`✅ Note appended to \`${filePath}\`.`);
        return;
      }

      if (args.form === 'A') {
        const candidate = args.filePath;
        // If no slash, search allowed paths for a matching filename
        if (!candidate.includes('/')) {
          const allFiles = await listFiles(octokit, config, config.note.allowedPaths);
          const matches = allFiles.filter(f => path.basename(f) === candidate);
          if (matches.length === 1) {
            const validationErr = validateNotePath(matches[0], config.note.allowedPaths, config.note.allowedExtensions);
            if (validationErr) { await ctx.replyText(validationErr); return; }
            await appendNoteToFile(octokit, config, matches[0], args.noteText, ctx.username);
            await ctx.replyText(`✅ Note appended to \`${matches[0]}\`.`);
            return;
          }
          if (matches.length > 1) {
            ctx.setPendingNote(args.noteText);
            await ctx.showOptions('Multiple files found. Choose one:', matches.slice(0, 20).map(f => ({
              label: f,
              callbackData: `note_file:${f}`,
            })));
            return;
          }
          // No matches — treat as full path (will create)
        }
        const validationErr = validateNotePath(candidate, config.note.allowedPaths, config.note.allowedExtensions);
        if (validationErr) { await ctx.replyText(validationErr); return; }
        await appendNoteToFile(octokit, config, candidate, args.noteText, ctx.username);
        await ctx.replyText(`✅ Note appended to \`${candidate}\`.`);
        return;
      }

      // Form C — list all files
      const allFiles = await listFiles(octokit, config, config.note.allowedPaths);
      const options = allFiles.sort().slice(0, 20).map(f => ({ label: f, callbackData: `note_file:${f}` }));
      ctx.setPendingNote(args.noteText);
      if (options.length === 0) {
        await ctx.replyText(`No files found in allowed paths: ${config.note.allowedPaths.join(', ')}.`);
        return;
      }
      await ctx.showOptions('Choose a file to append your note to:', options);
    },
  };

  const callbackHandler: CallbackHandler = async (ctx) => {
    await ctx.answerCallback();
    const filePath = ctx.callbackData.replace(/^note_file:/, '');
    let noteText = ctx.getPendingNote();
    ctx.clearPendingNote();

    if (!noteText) {
      await ctx.replyText(`Selected \`${filePath}\`. Please send your note text with: /note ${filePath} <text>`);
      return;
    }

    const validationErr = validateNotePath(filePath, config.note.allowedPaths, config.note.allowedExtensions);
    if (validationErr) { await ctx.replyText(validationErr); return; }

    await appendNoteToFile(octokit, config, filePath, noteText, ctx.username);
    await ctx.replyText(`✅ Note appended to \`${filePath}\`.`);
  };

  return { plugin, callbackHandler };
}

async function appendNoteToFile(
  octokit: Octokit,
  config: Config,
  filePath: string,
  noteText: string,
  username: string,
): Promise<void> {
  const existing = await getFile(octokit, config, filePath);
  const header = `# ${path.basename(filePath, path.extname(filePath))}\n`;
  const currentContent = existing?.content ?? header;
  const appended = currentContent + formatNoteAppend(noteText, username);
  const commitMsg = `note(@${username}): ${filePath}`;
  await writeFile(octokit, config, filePath, appended, commitMsg, existing?.sha);
}
```

- [ ] **Step 4: Fix the test that had an incorrect test case (remove it)**

Edit `tests/commands/note.test.ts`: remove the "replies with known shortcuts for unknown shortcut" test body (it's a comment about Form C behaviour, not a real test scenario). The test file should compile and all meaningful tests should pass.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- tests/commands/note.test.ts`
Expected: all passing tests PASS (skip the empty shortcut test).

- [ ] **Step 6: Commit**

```bash
git add src/commands/note.ts tests/commands/note.test.ts
git commit -m "feat: /note command (forms A, B, C)"
```

---

## Task 15: /summary Command

**Files:**
- Create: `src/commands/summary.ts`
- Create: `tests/commands/summary.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/commands/summary.test.ts
import { describe, it, expect, vi } from 'vitest';
import type { Octokit } from '@octokit/rest';
import type { Config, AIProvider, AdapterContext } from '../../src/types.js';
import { parsePeriod, createSummaryPlugin } from '../../src/commands/summary.js';

const config: Config = {
  telegram: { botToken: '', groupId: '', allowedUsers: [] },
  github: { token: '', owner: 'o', repo: 'r', defaultBranch: 'main' },
  note: { allowedPaths: ['docs'], shortcuts: {}, allowedExtensions: ['md'] },
  ai: { provider: 'anthropic', anthropicApiKey: '', anthropicModel: '' },
  scheduler: { nightlyCron: '', timezone: 'UTC' },
  behavior: { summaryMaxDays: 7, squashEnabled: true, summaryLanguage: 'en', logLevel: 'info', rateLimitPerMin: 10 },
};

describe('parsePeriod', () => {
  const now = new Date('2025-04-25T12:00:00Z');

  it('defaults to last 24 hours when arg is empty', () => {
    const { since, label } = parsePeriod('', 7, now);
    expect(since.toISOString()).toBe(new Date('2025-04-24T12:00:00Z').toISOString());
    expect(label).toBe('last 24h');
  });

  it('parses "3d" as 3 days back', () => {
    const { since } = parsePeriod('3d', 7, now);
    expect(since.toISOString()).toBe(new Date('2025-04-22T12:00:00Z').toISOString());
  });

  it('parses "1w" as 7 days back', () => {
    const { since } = parsePeriod('1w', 7, now);
    expect(since.toISOString()).toBe(new Date('2025-04-18T12:00:00Z').toISOString());
  });

  it('parses ISO date string', () => {
    const { since, label } = parsePeriod('2025-04-20', 7, now);
    expect(since.toISOString()).toBe(new Date('2025-04-20T00:00:00Z').toISOString());
    expect(label).toBe('since 2025-04-20');
  });

  it('throws when period exceeds maxDays', () => {
    expect(() => parsePeriod('10d', 7, now)).toThrow('Maximum summary window is 7 days');
  });

  it('throws for invalid period format', () => {
    expect(() => parsePeriod('banana', 7, now)).toThrow();
  });
});

describe('createSummaryPlugin', () => {
  it('registers as /summary with no auth required', () => {
    const octokit = {} as Octokit;
    const ai: AIProvider = { summarise: vi.fn() };
    const { plugin } = createSummaryPlugin(octokit, config, ai);
    expect(plugin.command).toBe('summary');
    expect(plugin.requiresAuth).toBe(false);
  });

  it('replies with no-commits message when no commits found', async () => {
    const octokit = {
      repos: { listCommits: vi.fn().mockResolvedValue({ data: [] }) },
      request: vi.fn(),
    } as unknown as Octokit;
    const ai: AIProvider = { summarise: vi.fn() };
    const { plugin } = createSummaryPlugin(octokit, config, ai);

    const replyText = vi.fn();
    const ctx: AdapterContext = {
      userId: '1', username: 'alice', text: '',
      replyText, showOptions: vi.fn(),
      setPendingNote: vi.fn(), getPendingNote: vi.fn(), clearPendingNote: vi.fn(),
    };
    await plugin.handler(ctx);
    expect(replyText).toHaveBeenCalledWith(expect.stringContaining('No commits found'));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/commands/summary.test.ts`
Expected: FAIL — "Cannot find module '../../src/commands/summary.js'"

- [ ] **Step 3: Write src/commands/summary.ts**

```typescript
import type { Octokit } from '@octokit/rest';
import type { Config, AIProvider, CommandPlugin } from '../types.js';
import { fetchCommits, fetchCommitDiff } from '../github/commits.js';
import { summariseAuthorDiffs } from '../ai/summarise.js';
import { formatSummaryMessage } from '../messaging/telegram/formatter.js';
import type { AuthorSummary } from '../messaging/telegram/formatter.js';

export interface PeriodResult {
  since: Date;
  label: string;
}

export function parsePeriod(arg: string, maxDays: number, now: Date = new Date()): PeriodResult {
  const trimmed = arg.trim();

  if (!trimmed) {
    const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    return { since, label: 'last 24h' };
  }

  const dMatch = trimmed.match(/^(\d+)d$/);
  if (dMatch) {
    const days = parseInt(dMatch[1], 10);
    if (days > maxDays) throw new Error(`Maximum summary window is ${maxDays} days.`);
    const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    return { since, label: `last ${days}d` };
  }

  const wMatch = trimmed.match(/^(\d+)w$/);
  if (wMatch) {
    const days = parseInt(wMatch[1], 10) * 7;
    if (days > maxDays) throw new Error(`Maximum summary window is ${maxDays} days.`);
    const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    return { since, label: `last ${trimmed}` };
  }

  const isoMatch = trimmed.match(/^\d{4}-\d{2}-\d{2}$/);
  if (isoMatch) {
    const since = new Date(`${trimmed}T00:00:00Z`);
    if (isNaN(since.getTime())) throw new Error(`Invalid date: ${trimmed}`);
    const diffDays = Math.ceil((now.getTime() - since.getTime()) / (24 * 60 * 60 * 1000));
    if (diffDays > maxDays) throw new Error(`Maximum summary window is ${maxDays} days.`);
    return { since, label: `since ${trimmed}` };
  }

  throw new Error(`Invalid period format: "${trimmed}". Use 3d, 1w, or YYYY-MM-DD.`);
}

export function createSummaryPlugin(
  octokit: Octokit,
  config: Config,
  aiProvider: AIProvider,
): { plugin: CommandPlugin } {
  const plugin: CommandPlugin = {
    command: 'summary',
    description: 'Summarise recent commits (default: last 24h)',
    requiresAuth: false,
    handler: async (ctx) => {
      let period: PeriodResult;
      try {
        period = parsePeriod(ctx.text.trim(), config.behavior.summaryMaxDays);
      } catch (err: unknown) {
        await ctx.replyText((err as Error).message);
        return;
      }

      const commits = await fetchCommits(octokit, config, period.since);
      if (commits.length === 0) {
        await ctx.replyText(`No commits found in the ${period.label}.`);
        return;
      }

      // Group diffs by author
      const authorDiffs = new Map<string, string[]>();
      for (const commit of commits) {
        let diff: string;
        try {
          diff = await fetchCommitDiff(octokit, config, commit.sha);
        } catch {
          diff = `(diff unavailable for ${commit.shortSha})`;
        }
        const existing = authorDiffs.get(commit.authorLogin) ?? [];
        existing.push(diff);
        authorDiffs.set(commit.authorLogin, existing);
      }

      const authorSummaries: AuthorSummary[] = [];
      for (const [authorLogin, diffs] of authorDiffs.entries()) {
        let summary: string;
        try {
          summary = await summariseAuthorDiffs(aiProvider, diffs, config.behavior.summaryLanguage);
        } catch {
          summary = commits
            .filter(c => c.authorLogin === authorLogin)
            .map(c => `- ${c.message} (${c.shortSha})`)
            .join('\n') + '\n_(AI summary unavailable)_';
        }
        authorSummaries.push({ authorLogin, summary });
      }

      await ctx.replyText(formatSummaryMessage(period.label, authorSummaries), { parseMode: 'Markdown' });
    },
  };

  return { plugin };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/commands/summary.test.ts`
Expected: all 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/commands/summary.ts tests/commands/summary.test.ts
git commit -m "feat: /summary command with period parser"
```

---

## Task 16: Command Registry

**Files:**
- Create: `src/commands/registry.ts`

- [ ] **Step 1: Write src/commands/registry.ts**

```typescript
import type { Octokit } from '@octokit/rest';
import type { MessagingAdapter, Config, AIProvider } from '../types.js';
import { createHelpPlugin } from './help.js';
import { createNotePlugin } from './note.js';
import { createSummaryPlugin } from './summary.js';

export function registerCommands(
  adapter: MessagingAdapter,
  octokit: Octokit,
  config: Config,
  aiProvider: AIProvider,
): void {
  // /help — no auth
  const helpPlugin = createHelpPlugin(config);
  adapter.onCommand(helpPlugin.command, helpPlugin.handler);

  // /note — auth required, wraps handler
  const { plugin: notePlugin, callbackHandler: noteCallback } = createNotePlugin(octokit, config);
  adapter.onCommand(notePlugin.command, withAuth(notePlugin, adapter));
  adapter.onCallback('note_file', noteCallback);

  // /summary — no auth
  const { plugin: summaryPlugin } = createSummaryPlugin(octokit, config, aiProvider);
  adapter.onCommand(summaryPlugin.command, summaryPlugin.handler);
}

function withAuth(
  plugin: { requiresAuth: boolean; handler: (ctx: Parameters<typeof plugin.handler>[0]) => Promise<void> },
  adapter: MessagingAdapter,
) {
  return async (ctx: Parameters<typeof plugin.handler>[0]) => {
    if (plugin.requiresAuth) {
      const allowed = await adapter.isAuthorized(ctx.userId, ctx.username);
      if (!allowed) {
        await ctx.replyText("You don't have permission to use this command.");
        return;
      }
    }
    await plugin.handler(ctx);
  };
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/commands/registry.ts
git commit -m "feat: command registry with auth wrapping"
```

---

## Task 17: Nightly Squash Job

**Files:**
- Create: `src/jobs/squash.ts`
- Create: `tests/jobs/squash.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/jobs/squash.test.ts
import { describe, it, expect, vi } from 'vitest';
import { groupByAuthor, buildYesterdayWindow, buildSquashMessage } from '../../src/jobs/squash.js';
import type { GitHubCommit } from '../../src/types.js';

const makeCommit = (sha: string, authorLogin: string, date: string, treeSha = 'tree', parentShas = ['p']): GitHubCommit => ({
  sha, shortSha: sha.slice(0, 7), message: `feat: ${sha}`, authorLogin, date, treeSha, parentShas,
});

describe('groupByAuthor', () => {
  it('groups commits by authorLogin', () => {
    const commits = [
      makeCommit('aaa', 'alice', '2025-04-24T10:00:00Z'),
      makeCommit('bbb', 'bob', '2025-04-24T10:30:00Z'),
      makeCommit('ccc', 'alice', '2025-04-24T11:00:00Z'),
    ];
    const groups = groupByAuthor(commits);
    expect(groups).toHaveLength(2);
    const alice = groups.find(g => g.authorLogin === 'alice')!;
    expect(alice.commits).toHaveLength(2);
  });
});

describe('buildYesterdayWindow', () => {
  it('returns midnight-to-midnight UTC window for yesterday', () => {
    const now = new Date('2025-04-25T02:00:00Z');
    const { since, until, dateStr } = buildYesterdayWindow('UTC', now);
    expect(since.toISOString()).toBe('2025-04-24T00:00:00.000Z');
    expect(until.toISOString()).toBe('2025-04-25T00:00:00.000Z');
    expect(dateStr).toBe('2025-04-24');
  });
});

describe('buildSquashMessage', () => {
  it('formats squash commit message correctly', () => {
    const commits = [
      makeCommit('abc1234', 'alice', '2025-04-24T10:00:00Z'),
      makeCommit('def5678', 'alice', '2025-04-24T11:00:00Z'),
    ];
    const msg = buildSquashMessage('alice', '2025-04-24', commits);
    expect(msg).toContain('daily(@alice): 2 changes on 2025-04-24');
    expect(msg).toContain('feat: abc1234 (abc1234)');
    expect(msg).toContain('feat: def5678 (def5678)');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/jobs/squash.test.ts`
Expected: FAIL — "Cannot find module '../../src/jobs/squash.js'"

- [ ] **Step 3: Write src/jobs/squash.ts**

```typescript
import type { Octokit } from '@octokit/rest';
import type { Config, MessagingAdapter, JobPlugin, GitHubCommit, AuthorCommitGroup } from '../types.js';
import { fetchCommits, createCommit, updateBranchRef } from '../github/commits.js';

export function groupByAuthor(commits: GitHubCommit[]): AuthorCommitGroup[] {
  const map = new Map<string, GitHubCommit[]>();
  for (const commit of commits) {
    const existing = map.get(commit.authorLogin) ?? [];
    existing.push(commit);
    map.set(commit.authorLogin, existing);
  }
  return Array.from(map.entries()).map(([authorLogin, commits]) => ({ authorLogin, commits }));
}

export interface YesterdayWindow {
  since: Date;
  until: Date;
  dateStr: string;
}

export function buildYesterdayWindow(timezone: string, now: Date = new Date()): YesterdayWindow {
  // For UTC (and simplified implementation), compute yesterday's midnight boundaries
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const todayStr = formatter.format(now);
  const yesterdayStr = formatter.format(new Date(now.getTime() - 24 * 60 * 60 * 1000));

  const since = new Date(`${yesterdayStr}T00:00:00.000Z`);
  const until = new Date(`${todayStr}T00:00:00.000Z`);

  return { since, until, dateStr: yesterdayStr };
}

export function buildSquashMessage(authorLogin: string, dateStr: string, commits: GitHubCommit[]): string {
  const bullets = commits
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    .map(c => `- ${c.message} (${c.shortSha})`)
    .join('\n');
  return `daily(@${authorLogin}): ${commits.length} changes on ${dateStr}\n\n${bullets}`;
}

export function createSquashJob(
  octokit: Octokit,
  config: Config,
  adapter: MessagingAdapter,
): JobPlugin {
  return {
    name: 'squash',
    handler: async () => {
      if (!config.behavior.squashEnabled) return;

      const { since, until, dateStr } = buildYesterdayWindow(config.scheduler.timezone);

      let commits: GitHubCommit[];
      try {
        commits = await fetchCommits(octokit, config, since, until);
      } catch (err: unknown) {
        await adapter.sendMessage(`❌ Squash job failed: could not fetch commits. ${(err as Error).message}`);
        return;
      }

      if (commits.length === 0) {
        await adapter.sendMessage(`No commits on ${dateStr} — nothing to squash.`);
        return;
      }

      const groups = groupByAuthor(commits);
      // Sort all commits by date ascending
      const allSorted = [...commits].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

      // Find BASE = parent of the oldest yesterday commit
      const oldest = allSorted[0];
      const baseSha = oldest.parentShas[0];
      if (!baseSha) {
        await adapter.sendMessage(`❌ Squash aborted: cannot squash the first commit on the branch.`);
        return;
      }

      // Sort groups by each author's earliest commit
      groups.sort((a, b) => {
        const aEarliest = Math.min(...a.commits.map(c => new Date(c.date).getTime()));
        const bEarliest = Math.min(...b.commits.map(c => new Date(c.date).getTime()));
        return aEarliest - bEarliest;
      });

      // Build new linear history
      let prevSha = baseSha;
      let squashedCount = 0;
      let authorsSquashed = 0;

      try {
        for (const group of groups) {
          const sortedGroupCommits = [...group.commits].sort(
            (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
          );
          const lastCommit = sortedGroupCommits[sortedGroupCommits.length - 1];

          let message: string;
          if (group.commits.length === 1) {
            message = group.commits[0].message;
          } else {
            message = buildSquashMessage(group.authorLogin, dateStr, sortedGroupCommits);
            squashedCount += group.commits.length;
            authorsSquashed++;
          }

          prevSha = await createCommit(octokit, config, {
            message,
            treeSha: lastCommit.treeSha,
            parentSha: prevSha,
          });
        }

        await updateBranchRef(octokit, config, prevSha);

        if (authorsSquashed === 0) {
          await adapter.sendMessage(`✅ Nothing to squash on ${dateStr} — each author had only 1 commit.`);
        } else {
          await adapter.sendMessage(
            `✅ Squashed ${squashedCount} commits from ${authorsSquashed} author(s) on ${dateStr}.`,
          );
        }
      } catch (err: unknown) {
        await adapter.sendMessage(
          `❌ Squash job failed mid-way on ${dateStr}. Branch may be in a partially rewritten state. ` +
          `Error: ${(err as Error).message}. Please check branch history manually.`,
        );
      }
    },
  };
}

// Standalone entry point for `npm run job:squash`
const isMain = process.argv[1]?.endsWith('squash.ts') || process.argv[1]?.endsWith('squash.js');
if (isMain) {
  import('../config.js').then(({ loadConfig }) => {
    import('@octokit/rest').then(({ Octokit }) => {
      import('../messaging/telegram/index.js').then(async ({ TelegramAdapter }) => {
        import('pino').then(({ default: pino }) => {
          const config = loadConfig();
          const log = pino({ level: config.behavior.logLevel });
          const octokit = new Octokit({ auth: config.github.token });
          const adapter = new TelegramAdapter(config, log);
          createSquashJob(octokit, config, adapter).handler().catch(err => {
            log.error(err);
            process.exit(1);
          });
        });
      });
    });
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/jobs/squash.test.ts`
Expected: all 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/jobs/squash.ts tests/jobs/squash.test.ts
git commit -m "feat: nightly squash job"
```

---

## Task 18: Daily Summary Job and Scheduler

**Files:**
- Create: `src/jobs/dailySummary.ts`
- Create: `src/jobs/scheduler.ts`

- [ ] **Step 1: Write src/jobs/dailySummary.ts**

```typescript
import type { Octokit } from '@octokit/rest';
import type { Config, MessagingAdapter, AIProvider, JobPlugin, GitHubCommit } from '../types.js';
import { fetchCommits, fetchCommitDiff } from '../github/commits.js';
import { summariseAuthorDiffs } from '../ai/summarise.js';
import { formatSummaryMessage } from '../messaging/telegram/formatter.js';
import type { AuthorSummary } from '../messaging/telegram/formatter.js';
import { buildYesterdayWindow } from './squash.js';

export function createDailySummaryJob(
  octokit: Octokit,
  config: Config,
  adapter: MessagingAdapter,
  aiProvider: AIProvider,
): JobPlugin {
  return {
    name: 'dailySummary',
    handler: async () => {
      const { since, until, dateStr } = buildYesterdayWindow(config.scheduler.timezone);

      let commits: GitHubCommit[];
      try {
        commits = await fetchCommits(octokit, config, since, until);
      } catch (err: unknown) {
        await adapter.sendMessage(`❌ Daily summary failed: could not fetch commits. ${(err as Error).message}`);
        return;
      }

      if (commits.length === 0) {
        await adapter.sendMessage(`No commits on ${dateStr} — nothing to summarise.`);
        return;
      }

      const authorDiffs = new Map<string, string[]>();
      for (const commit of commits) {
        let diff: string;
        try {
          diff = await fetchCommitDiff(octokit, config, commit.sha);
        } catch {
          diff = `(diff unavailable for ${commit.shortSha})`;
        }
        const existing = authorDiffs.get(commit.authorLogin) ?? [];
        existing.push(diff);
        authorDiffs.set(commit.authorLogin, existing);
      }

      const authorSummaries: AuthorSummary[] = [];
      for (const [authorLogin, diffs] of authorDiffs.entries()) {
        let summary: string;
        try {
          summary = await summariseAuthorDiffs(aiProvider, diffs, config.behavior.summaryLanguage);
        } catch {
          summary = commits
            .filter(c => c.authorLogin === authorLogin)
            .map(c => `- ${c.message} (${c.shortSha})`)
            .join('\n') + '\n_(AI summary unavailable)_';
        }
        authorSummaries.push({ authorLogin, summary });
      }

      const label = dateStr;
      await adapter.sendMessage(formatSummaryMessage(label, authorSummaries), { parseMode: 'Markdown' });
    },
  };
}

// Standalone entry point for `npm run job:summary`
const isMain = process.argv[1]?.endsWith('dailySummary.ts') || process.argv[1]?.endsWith('dailySummary.js');
if (isMain) {
  import('../config.js').then(({ loadConfig }) => {
    import('@octokit/rest').then(({ Octokit }) => {
      import('../messaging/telegram/index.js').then(({ TelegramAdapter }) => {
        import('../ai/provider.js').then(({ createAIProvider }) => {
          import('pino').then(({ default: pino }) => {
            const config = loadConfig();
            const log = pino({ level: config.behavior.logLevel });
            const octokit = new Octokit({ auth: config.github.token });
            const adapter = new TelegramAdapter(config, log);
            const ai = createAIProvider(config);
            createDailySummaryJob(octokit, config, adapter, ai).handler().catch(err => {
              log.error(err);
              process.exit(1);
            });
          });
        });
      });
    });
  });
}
```

- [ ] **Step 2: Write src/jobs/scheduler.ts**

```typescript
import cron from 'node-cron';
import type { Logger } from 'pino';
import type { JobPlugin } from '../types.js';

export function startScheduler(jobs: JobPlugin[], nightlyCron: string, log: Logger): void {
  const jobsByExpression = new Map<string, JobPlugin[]>();

  for (const job of jobs) {
    const expr = job.cronExpression ?? nightlyCron;
    const existing = jobsByExpression.get(expr) ?? [];
    existing.push(job);
    jobsByExpression.set(expr, existing);
  }

  for (const [expression, jobGroup] of jobsByExpression.entries()) {
    cron.schedule(expression, async () => {
      for (const job of jobGroup) {
        log.info(`Running job: ${job.name}`);
        try {
          await job.handler();
          log.info(`Job completed: ${job.name}`);
        } catch (err) {
          log.error({ err }, `Job failed: ${job.name}`);
        }
      }
    });
    log.info(`Scheduled ${jobGroup.map(j => j.name).join(', ')} at "${expression}"`);
  }
}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/jobs/dailySummary.ts src/jobs/scheduler.ts
git commit -m "feat: daily summary job and cron scheduler"
```

---

## Task 19: Entry Point

**Files:**
- Create: `src/index.ts`

- [ ] **Step 1: Write src/index.ts**

```typescript
import pino from 'pino';
import { loadConfig } from './config.js';
import { getOctokit } from './github/client.js';
import { createAIProvider } from './ai/provider.js';
import { TelegramAdapter } from './messaging/telegram/index.js';
import { registerCommands } from './commands/registry.js';
import { createSquashJob } from './jobs/squash.js';
import { createDailySummaryJob } from './jobs/dailySummary.js';
import { startScheduler } from './jobs/scheduler.js';

const config = loadConfig();
const log = pino({ level: config.behavior.logLevel });

log.info('GitHAssistant starting...');

const octokit = getOctokit(config);
const aiProvider = createAIProvider(config);
const adapter = new TelegramAdapter(config, log);

registerCommands(adapter, octokit, config, aiProvider);

const squashJob = createSquashJob(octokit, config, adapter);
const dailySummaryJob = createDailySummaryJob(octokit, config, adapter, aiProvider);
startScheduler([squashJob, dailySummaryJob], config.scheduler.nightlyCron, log);

await adapter.start();
log.info('Bot is running.');
```

- [ ] **Step 2: Verify full TypeScript build succeeds**

Run: `npm run build`
Expected: `dist/` directory created, no TypeScript errors.

- [ ] **Step 3: Run all tests**

Run: `npm test`
Expected: all tests pass. Note exact count from output.

- [ ] **Step 4: Commit**

```bash
git add src/index.ts
git commit -m "feat: entry point — wires all subsystems together"
```

---

## Task 20: Final Polish

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update README.md with setup and manual-test checklist**

Replace the existing README content with:

```markdown
# GitHAssistant

A Telegram bot that keeps your GitHub project documented, summarised, and tidy — automatically.

## Setup

```bash
cp .env.example .env
# Fill in all required values (see .env.example for descriptions)
npm install
npm run dev      # tsx watch mode for local development
```

## Environment Variables

All required variables are documented in `.env.example`. The following are mandatory at startup — the process exits with a descriptive error listing exactly which are missing:

- `TELEGRAM_BOT_TOKEN` — From BotFather
- `TELEGRAM_GROUP_ID` — Numeric group ID (bot must be a member)
- `GITHUB_TOKEN` — Fine-grained PAT: Contents Read+Write, Metadata Read
- `GITHUB_OWNER` — Repository owner
- `GITHUB_REPO` — Repository name

## Commands

| Command | Auth | Description |
|---|---|---|
| `/note [file\|shortcut] <text>` | Required | Append a note to a repo file |
| `/summary [period]` | None | AI summary of recent commits |
| `/help` | None | Show command reference |

## Deployment (Render.com)

- Service type: **Background Worker**
- Build: `npm ci && npm run build`
- Start: `node dist/index.js`
- Set env vars via Render dashboard

## Manual Job Triggers

```bash
npm run job:squash    # Run nightly squash job immediately
npm run job:summary   # Run daily summary job immediately
```

## Manual Test Checklist

### /note
- [ ] Form A — full path: `/note docs/meeting-notes.md Sprint recap.`
- [ ] Form A — filename only (one match): `/note meeting-notes.md Sprint recap.`
- [ ] Form A — filename only (multiple matches): should show inline keyboard
- [ ] Form B — shortcut: `/note i New logo direction.`
- [ ] Form B — unknown shortcut: `/note xyz Text` (no shortcuts match → Form C)
- [ ] Form C — no path: `/note We agreed to deprecate the API.`
- [ ] Form C — no path, no text: `/note` (select file, then bot asks for text)
- [ ] Rejected path: `/note secrets/pw.md text` → error message
- [ ] Unauthorised user → friendly rejection

### /summary
- [ ] `/summary` → last 24h digest
- [ ] `/summary 3d` → 3-day digest
- [ ] `/summary 1w` → 7-day digest
- [ ] `/summary 2025-04-20` → since ISO date
- [ ] `/summary 100d` → "Maximum summary window is N days"
- [ ] AI fallback: disconnect API key → falls back to commit list

### Nightly Jobs (manual trigger)
- [ ] `npm run job:squash` → ✅ confirmation or "nothing to squash" message in Telegram
- [ ] `npm run job:summary` → daily digest posted in Telegram
- [ ] Squash revert: if history looks wrong, `git reflog` shows previous tip; hard-reset and force-push to restore.
```

- [ ] **Step 2: Run full test suite one final time**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 3: Final commit**

```bash
git add README.md
git commit -m "docs: setup guide and manual test checklist"
```

---

## Self-Review Notes

**Spec coverage check:**
- ✅ Section 2 (tech stack): package.json includes all specified libraries
- ✅ Section 3 (repo structure): matches exactly
- ✅ Section 4 (env vars): all vars in .env.example, loadConfig handles all with defaults
- ✅ Section 5 (adapter): MessagingAdapter interface in types.ts, TelegramAdapter implements it
- ✅ Section 6.1 (/note): Forms A/B/C, dispatch order, inline keyboard, path validation, file creation, commit message format
- ✅ Section 6.2 (/summary): period parsing, AI summarisation, Telegram Markdown output, fallback
- ✅ Section 6.3 (/help): shortcuts listed, no auth
- ✅ Section 7.1 (squash): groupByAuthor, buildYesterdayWindow, buildSquashMessage, linear chain reconstruction, force-update, abort on error
- ✅ Section 7.2 (daily summary): createDailySummaryJob reuses commits+diffs+AI logic
- ✅ Section 8 (AI provider): factory + AnthropicProvider + chunking at 80k chars
- ✅ Section 9 (error handling): all scenarios covered in handlers
- ✅ Section 10 (auth): group filter middleware, allowlist, admin check, rate limiting, path validation
- ✅ Section 11 (plugin interfaces): CommandPlugin and JobPlugin match spec exactly
- ✅ Section 12 (deployment): README covers Render.com + local dev + manual job triggers
- ✅ Section 13 (testing): unit tests for pure logic, mock-based tests for GitHub/AI interaction
