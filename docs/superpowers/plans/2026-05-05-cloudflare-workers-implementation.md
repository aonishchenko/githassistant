# Cloudflare Workers Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Cloudflare Workers as a second deployment target alongside the existing Node.js mode, sharing all business logic via a new `src/platforms/cloudflare/` adapter layer.

**Architecture:** A new CF entry point (`src/platforms/cloudflare/worker.ts`) exports `fetch` and `scheduled` handlers. The `CloudflareAdapter` implements the existing `MessagingAdapter` interface using direct Telegram Bot API `fetch` calls instead of Telegraf. All existing commands, jobs, GitHub client, and AI providers are reused without modification via DI.

**Tech Stack:** Cloudflare Workers runtime, `wrangler` CLI, Cloudflare KV (callback state), `@cloudflare/workers-types` (TypeScript types), existing `@octokit/rest` + Anthropic/OpenAI SDKs (both work in CF runtime via global `fetch`).

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Create | `wrangler.toml` | CF Workers config, KV binding, cron triggers |
| Modify | `package.json` | Add `cf:*` scripts and `@cloudflare/workers-types` devDep |
| Create | `src/platforms/cloudflare/config.ts` | Load `Config` from CF env bindings (no dotenv) |
| Create | `src/platforms/cloudflare/kv-state.ts` | Read/write callback state in KV namespace |
| Create | `src/platforms/cloudflare/adapter.ts` | `CloudflareAdapter` implementing `MessagingAdapter` |
| Create | `src/platforms/cloudflare/worker.ts` | CF entry point: `fetch()` + `scheduled()` handlers |
| Create | `scripts/register-webhook.ts` | One-time Telegram `setWebhook` registration script |
| Modify | `README.md` | Add CF Workers setup, OpenAI docs, architecture section |
| Create | `src/tests/cloudflare/config.test.ts` | Unit tests for CF config loader |
| Create | `src/tests/cloudflare/kv-state.test.ts` | Unit tests for KV state manager |
| Create | `src/tests/cloudflare/adapter.test.ts` | Unit tests for CloudflareAdapter |

---

## Task 1: Dependencies, `wrangler.toml`, and npm scripts

**Files:**
- Modify: `package.json`
- Create: `wrangler.toml`

- [ ] **Step 1.1: Install `@cloudflare/workers-types` and `wrangler`**

```bash
npm install --save-dev @cloudflare/workers-types wrangler
```

Expected: packages added to `node_modules`, `package.json` devDependencies updated.

- [ ] **Step 1.2: Add `cf:*` scripts to `package.json`**

In `package.json`, add to the `"scripts"` block:

```json
"cf:deploy": "wrangler deploy",
"cf:dev": "wrangler dev",
"cf:register-webhook": "tsx scripts/register-webhook.ts"
```

The full `"scripts"` block becomes:

```json
"scripts": {
  "build": "tsc",
  "dev": "tsx watch src/index.ts",
  "start": "node dist/index.js",
  "test": "vitest run",
  "test:watch": "vitest",
  "job:squash": "tsx src/jobs/squash.ts",
  "job:summary": "tsx src/jobs/dailySummary.ts",
  "cf:deploy": "wrangler deploy",
  "cf:dev": "wrangler dev",
  "cf:register-webhook": "tsx scripts/register-webhook.ts"
}
```

- [ ] **Step 1.3: Create `wrangler.toml`**

Create `/Users/aonishchenko/Desktop/Development/githassistant/wrangler.toml`:

```toml
name = "githassistant"
main = "src/platforms/cloudflare/worker.ts"
compatibility_date = "2024-09-23"
compatibility_flags = ["nodejs_compat"]

[[kv_namespaces]]
binding = "GITHASSISTANT_KV"
id = "REPLACE_WITH_KV_NAMESPACE_ID"

[triggers]
crons = ["0 2 * * *", "0 6 * * *"]
```

Note: `nodejs_compat` flag enables Node.js built-ins (`Buffer`, `process`, etc.) in the CF runtime, which is required for `@octokit/rest` and the AI SDKs. The `id` placeholder is replaced after running `wrangler kv namespace create GITHASSISTANT_KV`.

- [ ] **Step 1.4: Commit**

```bash
git add package.json package-lock.json wrangler.toml
git commit -m "chore: add wrangler config and cloudflare worker scripts"
```

---

## Task 2: CF config loader

**Files:**
- Create: `src/platforms/cloudflare/config.ts`
- Create: `src/tests/cloudflare/config.test.ts`

- [ ] **Step 2.1: Write the failing test**

Create `src/tests/cloudflare/config.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { loadCFConfig } from '../../platforms/cloudflare/config.js';
import type { CloudflareEnv } from '../../platforms/cloudflare/config.js';

const baseEnv: CloudflareEnv = {
  GITHASSISTANT_KV: {} as KVNamespace,
  TELEGRAM_BOT_TOKEN: 'tok',
  TELEGRAM_GROUP_ID: '-100123',
  GITHUB_TOKEN: 'ghp_test',
  GITHUB_OWNER: 'owner',
  GITHUB_REPO: 'repo',
};

describe('loadCFConfig', () => {
  it('returns a valid Config from required env bindings', () => {
    const config = loadCFConfig(baseEnv);
    expect(config.telegram.botToken).toBe('tok');
    expect(config.telegram.groupId).toBe('-100123');
    expect(config.github.token).toBe('ghp_test');
    expect(config.github.owner).toBe('owner');
    expect(config.github.repo).toBe('repo');
  });

  it('applies defaults for optional fields', () => {
    const config = loadCFConfig(baseEnv);
    expect(config.github.defaultBranch).toBe('main');
    expect(config.note.allowedPaths).toEqual(['docs']);
    expect(config.ai.provider).toBe('anthropic');
    expect(config.behavior.summaryMaxDays).toBe(7);
    expect(config.behavior.squashEnabled).toBe(true);
    expect(config.scheduler.nightlyCron).toBe('0 2 * * *');
  });

  it('parses TELEGRAM_ALLOWED_USERS into an array', () => {
    const config = loadCFConfig({ ...baseEnv, TELEGRAM_ALLOWED_USERS: 'alice,bob' });
    expect(config.telegram.allowedUsers).toEqual(['alice', 'bob']);
  });

  it('parses NOTE_SHORTCUTS into a record', () => {
    const config = loadCFConfig({ ...baseEnv, NOTE_SHORTCUTS: 'i=docs/ideas.md,m=docs/meeting.md' });
    expect(config.note.shortcuts).toEqual({ i: 'docs/ideas.md', m: 'docs/meeting.md' });
  });

  it('infers anthropic provider when ANTHROPIC_API_KEY is set and AI_PROVIDER is absent', () => {
    const config = loadCFConfig({ ...baseEnv, ANTHROPIC_API_KEY: 'sk-ant-test' });
    expect(config.ai.provider).toBe('anthropic');
    expect(config.ai.anthropicApiKey).toBe('sk-ant-test');
  });

  it('throws when required secrets are missing', () => {
    const env = { ...baseEnv, TELEGRAM_BOT_TOKEN: undefined as unknown as string };
    expect(() => loadCFConfig(env)).toThrow('TELEGRAM_BOT_TOKEN');
  });
});
```

- [ ] **Step 2.2: Run test to verify it fails**

```bash
npm test -- src/tests/cloudflare/config.test.ts
```

Expected: FAIL — `Cannot find module '../../platforms/cloudflare/config.js'`

- [ ] **Step 2.3: Implement `src/platforms/cloudflare/config.ts`**

```typescript
/// <reference types="@cloudflare/workers-types" />
import type { Config } from '../../types.js';

export interface CloudflareEnv {
  GITHASSISTANT_KV: KVNamespace;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_GROUP_ID: string;
  TELEGRAM_ALLOWED_USERS?: string;
  GITHUB_TOKEN: string;
  GITHUB_OWNER: string;
  GITHUB_REPO: string;
  GITHUB_DEFAULT_BRANCH?: string;
  AI_PROVIDER?: string;
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_MODEL?: string;
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
  NOTE_ALLOWED_PATHS?: string;
  NOTE_SHORTCUTS?: string;
  NOTE_ALLOWED_EXTENSIONS?: string;
  MEETING_NOTES_FOLDER?: string;
  NIGHTLY_CRON?: string;
  TIMEZONE?: string;
  SUMMARY_MAX_DAYS?: string;
  SQUASH_ENABLED?: string;
  SUMMARY_LANGUAGE?: string;
  LOG_LEVEL?: string;
  RATE_LIMIT_PER_MIN?: string;
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

export function loadCFConfig(env: CloudflareEnv): Config {
  const missing: string[] = [];
  const req = (key: string, val: string | undefined): string => {
    if (!val) missing.push(key);
    return val ?? '';
  };

  const botToken = req('TELEGRAM_BOT_TOKEN', env.TELEGRAM_BOT_TOKEN);
  const groupId = req('TELEGRAM_GROUP_ID', env.TELEGRAM_GROUP_ID);
  const githubToken = req('GITHUB_TOKEN', env.GITHUB_TOKEN);
  const githubOwner = req('GITHUB_OWNER', env.GITHUB_OWNER);
  const githubRepo = req('GITHUB_REPO', env.GITHUB_REPO);

  if (missing.length > 0) {
    throw new Error(`Missing required CF Worker secrets: ${missing.join(', ')}`);
  }

  return {
    telegram: {
      botToken,
      groupId,
      allowedUsers: (env.TELEGRAM_ALLOWED_USERS ?? '')
        .split(',').map(s => s.trim()).filter(Boolean),
    },
    github: {
      token: githubToken,
      owner: githubOwner,
      repo: githubRepo,
      defaultBranch: env.GITHUB_DEFAULT_BRANCH ?? 'main',
    },
    note: {
      allowedPaths: (env.NOTE_ALLOWED_PATHS ?? 'docs')
        .split(',').map(s => s.trim()).filter(Boolean),
      shortcuts: parseShortcuts(env.NOTE_SHORTCUTS ?? ''),
      allowedExtensions: (env.NOTE_ALLOWED_EXTENSIONS ?? 'md,txt')
        .split(',').map(s => s.trim()).filter(Boolean),
    },
    meeting: {
      notesFolder: env.MEETING_NOTES_FOLDER ?? 'meetings',
    },
    ai: {
      provider: env.AI_PROVIDER ?? (env.ANTHROPIC_API_KEY ? 'anthropic' : 'openai'),
      anthropicApiKey: env.ANTHROPIC_API_KEY ?? '',
      anthropicModel: env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-5',
      openaiApiKey: env.OPENAI_API_KEY ?? '',
      openaiModel: env.OPENAI_MODEL ?? 'gpt-5.3',
    },
    scheduler: {
      nightlyCron: env.NIGHTLY_CRON ?? '0 2 * * *',
      timezone: env.TIMEZONE ?? 'UTC',
    },
    behavior: {
      summaryMaxDays: parseInt(env.SUMMARY_MAX_DAYS ?? '7', 10),
      squashEnabled: env.SQUASH_ENABLED !== 'false',
      summaryLanguage: env.SUMMARY_LANGUAGE ?? 'en',
      logLevel: env.LOG_LEVEL ?? 'info',
      rateLimitPerMin: parseInt(env.RATE_LIMIT_PER_MIN ?? '10', 10),
    },
  };
}
```

- [ ] **Step 2.4: Run test to verify it passes**

```bash
npm test -- src/tests/cloudflare/config.test.ts
```

Expected: all 6 tests PASS.

- [ ] **Step 2.5: Commit**

```bash
git add src/platforms/cloudflare/config.ts src/tests/cloudflare/config.test.ts
git commit -m "feat(cloudflare): add CF config loader"
```

---

## Task 3: KV state manager

**Files:**
- Create: `src/platforms/cloudflare/kv-state.ts`
- Create: `src/tests/cloudflare/kv-state.test.ts`

- [ ] **Step 3.1: Write the failing test**

Create `src/tests/cloudflare/kv-state.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { getPendingState, setPendingState, clearPendingState } from '../../platforms/cloudflare/kv-state.js';

function makeMockKV(): KVNamespace {
  const store = new Map<string, string>();
  return {
    get: async (key: string) => store.get(key) ?? null,
    put: async (key: string, value: string) => { store.set(key, value); },
    delete: async (key: string) => { store.delete(key); },
    list: async () => ({ keys: [], list_complete: true, cursor: '' }),
    getWithMetadata: async (key: string) => ({ value: store.get(key) ?? null, metadata: null }),
  } as unknown as KVNamespace;
}

describe('KV state manager', () => {
  let kv: KVNamespace;

  beforeEach(() => { kv = makeMockKV(); });

  it('returns null when no state exists', async () => {
    expect(await getPendingState(kv, 'user1')).toBeNull();
  });

  it('stores and retrieves pending state', async () => {
    await setPendingState(kv, 'user1', { text: 'hello world' });
    const state = await getPendingState(kv, 'user1');
    expect(state).toEqual({ text: 'hello world' });
  });

  it('clears pending state', async () => {
    await setPendingState(kv, 'user1', { text: 'hello' });
    await clearPendingState(kv, 'user1');
    expect(await getPendingState(kv, 'user1')).toBeNull();
  });

  it('isolates state per userId', async () => {
    await setPendingState(kv, 'user1', { text: 'note for user1' });
    await setPendingState(kv, 'user2', { text: 'note for user2' });
    expect((await getPendingState(kv, 'user1'))?.text).toBe('note for user1');
    expect((await getPendingState(kv, 'user2'))?.text).toBe('note for user2');
  });

  it('returns null for corrupted KV value', async () => {
    await (kv as unknown as { put(k: string, v: string): Promise<void> }).put('callback-state:user1', 'not-json');
    expect(await getPendingState(kv, 'user1')).toBeNull();
  });
});
```

- [ ] **Step 3.2: Run test to verify it fails**

```bash
npm test -- src/tests/cloudflare/kv-state.test.ts
```

Expected: FAIL — `Cannot find module '../../platforms/cloudflare/kv-state.js'`

- [ ] **Step 3.3: Implement `src/platforms/cloudflare/kv-state.ts`**

```typescript
/// <reference types="@cloudflare/workers-types" />

export interface PendingState {
  text: string;
}

const KV_TTL_SECONDS = 600;

export async function getPendingState(
  kv: KVNamespace,
  userId: string,
): Promise<PendingState | null> {
  const raw = await kv.get(`callback-state:${userId}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PendingState;
  } catch {
    return null;
  }
}

export async function setPendingState(
  kv: KVNamespace,
  userId: string,
  state: PendingState,
): Promise<void> {
  await kv.put(`callback-state:${userId}`, JSON.stringify(state), {
    expirationTtl: KV_TTL_SECONDS,
  });
}

export async function clearPendingState(
  kv: KVNamespace,
  userId: string,
): Promise<void> {
  await kv.delete(`callback-state:${userId}`);
}
```

- [ ] **Step 3.4: Run test to verify it passes**

```bash
npm test -- src/tests/cloudflare/kv-state.test.ts
```

Expected: all 5 tests PASS.

- [ ] **Step 3.5: Commit**

```bash
git add src/platforms/cloudflare/kv-state.ts src/tests/cloudflare/kv-state.test.ts
git commit -m "feat(cloudflare): add KV-backed callback state manager"
```

---

## Task 4: CloudflareAdapter

**Files:**
- Create: `src/platforms/cloudflare/adapter.ts`
- Create: `src/tests/cloudflare/adapter.test.ts`

- [ ] **Step 4.1: Write the failing tests**

Create `src/tests/cloudflare/adapter.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CloudflareAdapter } from '../../platforms/cloudflare/adapter.js';
import type { Config } from '../../types.js';

const config: Config = {
  telegram: { botToken: 'tok', groupId: '-100999', allowedUsers: ['alice'] },
  github: { token: 'gh', owner: 'o', repo: 'r', defaultBranch: 'main' },
  note: { allowedPaths: ['docs'], shortcuts: {}, allowedExtensions: ['md'] },
  meeting: { notesFolder: 'meetings' },
  ai: { provider: 'anthropic', anthropicApiKey: 'k', anthropicModel: 'm', openaiApiKey: '', openaiModel: '' },
  scheduler: { nightlyCron: '0 2 * * *', timezone: 'UTC' },
  behavior: { summaryMaxDays: 7, squashEnabled: true, summaryLanguage: 'en', logLevel: 'info', rateLimitPerMin: 10 },
};

function makeMockKV() {
  const store = new Map<string, string>();
  return {
    get: async (key: string) => store.get(key) ?? null,
    put: async (key: string, value: string) => { store.set(key, value); },
    delete: async (key: string) => { store.delete(key); },
  } as unknown as KVNamespace;
}

function makeMessage(text: string, userId = '42', username = 'alice') {
  return {
    update_id: 1,
    message: {
      message_id: 1,
      from: { id: parseInt(userId), username },
      chat: { id: -100999 },
      text,
    },
  };
}

function makeCallback(data: string, userId = '42', username = 'alice') {
  return {
    update_id: 2,
    callback_query: {
      id: 'cbq1',
      from: { id: parseInt(userId), username },
      message: { message_id: 1, chat: { id: -100999 } },
      data,
    },
  };
}

describe('CloudflareAdapter', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let kv: KVNamespace;
  let adapter: CloudflareAdapter;

  beforeEach(() => {
    kv = makeMockKV();
    fetchMock = vi.fn().mockResolvedValue(new Response('{"ok":true}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    adapter = new CloudflareAdapter(config, kv);
  });

  it('dispatches a registered command handler on message update', async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    adapter.onCommand('help', handler);
    await adapter.handleUpdate(makeMessage('/help'));
    expect(handler).toHaveBeenCalledOnce();
  });

  it('passes command text (args after command) in ctx.text', async () => {
    let capturedText = '';
    adapter.onCommand('note', async (ctx) => { capturedText = ctx.text; });
    await adapter.handleUpdate(makeMessage('/note docs/ideas.md hello world'));
    expect(capturedText).toBe('docs/ideas.md hello world');
  });

  it('ignores messages from other chats', async () => {
    const handler = vi.fn();
    adapter.onCommand('help', handler);
    const update = { update_id: 1, message: { message_id: 1, from: { id: 1, username: 'x' }, chat: { id: -100001 }, text: '/help' } };
    await adapter.handleUpdate(update);
    expect(handler).not.toHaveBeenCalled();
  });

  it('ignores unknown commands silently', async () => {
    await adapter.handleUpdate(makeMessage('/unknown'));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sendMessage calls Telegram sendMessage API', async () => {
    await adapter.sendMessage('hello', { parseMode: 'Markdown' });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.telegram.org/bottok/sendMessage',
      expect.objectContaining({ method: 'POST' }),
    );
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.text).toBe('hello');
    expect(body.parse_mode).toBe('Markdown');
    expect(body.chat_id).toBe('-100999');
  });

  it('setPendingNote writes to KV after handler completes', async () => {
    adapter.onCommand('note', async (ctx) => { ctx.setPendingNote('my note'); });
    await adapter.handleUpdate(makeMessage('/note'));
    const stored = await kv.get('callback-state:42');
    expect(stored).not.toBeNull();
    expect(JSON.parse(stored!)).toEqual({ text: 'my note' });
  });

  it('getPendingNote reads pre-loaded KV value in handler', async () => {
    await kv.put('callback-state:42', JSON.stringify({ text: 'stored note' }));
    let retrieved = '';
    adapter.onCommand('note', async (ctx) => { retrieved = ctx.getPendingNote() ?? ''; });
    await adapter.handleUpdate(makeMessage('/note'));
    expect(retrieved).toBe('stored note');
  });

  it('clearPendingNote deletes from KV after handler completes', async () => {
    await kv.put('callback-state:42', JSON.stringify({ text: 'old' }));
    adapter.onCommand('note', async (ctx) => { ctx.clearPendingNote(); });
    await adapter.handleUpdate(makeMessage('/note'));
    expect(await kv.get('callback-state:42')).toBeNull();
  });

  it('dispatches callback handler when callbackData matches action prefix', async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    adapter.onCallback('note_file', handler);
    await adapter.handleUpdate(makeCallback('note_file:docs/ideas.md'));
    expect(handler).toHaveBeenCalledOnce();
  });

  it('ignores callback_query with no matching handler', async () => {
    adapter.onCallback('note_file', vi.fn());
    await adapter.handleUpdate(makeCallback('meeting_file:doc.md'));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('isAuthorized returns true for allowlisted username', async () => {
    expect(await adapter.isAuthorized('99', 'alice')).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('isAuthorized calls getChatMember for non-allowlisted users', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, result: { status: 'administrator' } })));
    expect(await adapter.isAuthorized('99', 'bob')).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.telegram.org/bottok/getChatMember',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('isAuthorized returns false when getChatMember reports member status', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, result: { status: 'member' } })));
    expect(await adapter.isAuthorized('99', 'charlie')).toBe(false);
  });
});
```

- [ ] **Step 4.2: Run test to verify it fails**

```bash
npm test -- src/tests/cloudflare/adapter.test.ts
```

Expected: FAIL — `Cannot find module '../../platforms/cloudflare/adapter.js'`

- [ ] **Step 4.3: Implement `src/platforms/cloudflare/adapter.ts`**

```typescript
/// <reference types="@cloudflare/workers-types" />
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
import { isInAllowlist } from '../../messaging/telegram/auth.js';
import { getPendingState, setPendingState, clearPendingState } from './kv-state.js';

interface TelegramUser {
  id: number;
  username?: string;
  first_name?: string;
}

interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: { id: number };
  text?: string;
}

interface TelegramCallbackQuery {
  id: string;
  from: TelegramUser;
  message?: { message_id: number; chat: { id: number } };
  data?: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

export class CloudflareAdapter implements MessagingAdapter {
  private config: Config;
  private kv: KVNamespace;
  private commandHandlers = new Map<string, CommandHandler>();
  private callbackHandlers = new Map<string, CallbackHandler>();
  private apiBase: string;

  constructor(config: Config, kv: KVNamespace) {
    this.config = config;
    this.kv = kv;
    this.apiBase = `https://api.telegram.org/bot${config.telegram.botToken}`;
  }

  private async telegramPost(method: string, body: object): Promise<Response> {
    return fetch(`${this.apiBase}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  async sendMessage(text: string, options?: SendOptions): Promise<void> {
    await this.telegramPost('sendMessage', {
      chat_id: this.config.telegram.groupId,
      text,
      parse_mode: options?.parseMode,
    });
  }

  async sendDocument(filename: string, content: Buffer, caption?: string): Promise<void> {
    const form = new FormData();
    form.append('chat_id', this.config.telegram.groupId);
    form.append('document', new Blob([content]), filename);
    if (caption) form.append('caption', caption);
    await fetch(`${this.apiBase}/sendDocument`, { method: 'POST', body: form });
  }

  onCommand(command: string, handler: CommandHandler): void {
    this.commandHandlers.set(command, handler);
  }

  onCallback(action: string, handler: CallbackHandler): void {
    this.callbackHandlers.set(action, handler);
  }

  async isAuthorized(userId: string, username: string): Promise<boolean> {
    if (isInAllowlist(username, this.config.telegram.allowedUsers)) return true;
    try {
      const res = await this.telegramPost('getChatMember', {
        chat_id: this.config.telegram.groupId,
        user_id: parseInt(userId, 10),
      });
      const data = await res.json() as { result?: { status?: string } };
      return ['administrator', 'creator'].includes(data.result?.status ?? '');
    } catch {
      return false;
    }
  }

  async handleUpdate(update: TelegramUpdate): Promise<void> {
    if (update.message) {
      await this.handleMessage(update.message);
    } else if (update.callback_query) {
      await this.handleCallback(update.callback_query);
    }
  }

  private async handleMessage(message: TelegramMessage): Promise<void> {
    const chatId = message.chat.id.toString();
    if (chatId !== this.config.telegram.groupId) return;

    const text = message.text ?? '';
    if (!text.startsWith('/')) return;

    const commandMatch = text.match(/^\/(\w+)(@\w+)?/);
    if (!commandMatch) return;
    const command = commandMatch[1];
    const commandText = text.replace(/^\/\w+(@\w+)?\s*/, '');

    const handler = this.commandHandlers.get(command);
    if (!handler) return;

    const userId = message.from?.id?.toString() ?? '';
    const username = message.from?.username ?? message.from?.first_name ?? 'unknown';

    const pending = await getPendingState(this.kv, userId);
    let pendingText: string | undefined = pending?.text;
    let kvAction: { action: 'set'; text: string } | { action: 'clear' } | null = null;

    const replyFn = async (msg: string, opts?: SendOptions) => {
      await this.telegramPost('sendMessage', {
        chat_id: chatId,
        text: msg,
        parse_mode: opts?.parseMode,
      });
    };

    const adapterCtx: AdapterContext = {
      userId,
      username,
      text: commandText,
      replyText: replyFn,
      showOptions: async (msg: string, options: InlineOption[]) => {
        await this.telegramPost('sendMessage', {
          chat_id: chatId,
          text: msg,
          reply_markup: {
            inline_keyboard: options.map(o => [{ text: o.label, callback_data: o.callbackData }]),
          },
        });
      },
      setPendingNote: (t: string) => { pendingText = t; kvAction = { action: 'set', text: t }; },
      getPendingNote: () => pendingText,
      clearPendingNote: () => { pendingText = undefined; kvAction = { action: 'clear' }; },
    };

    try {
      await handler(adapterCtx);
    } catch {
      await replyFn('An unexpected error occurred. Please try again.');
    }

    if (kvAction?.action === 'set') {
      await setPendingState(this.kv, userId, { text: kvAction.text });
    } else if (kvAction?.action === 'clear') {
      await clearPendingState(this.kv, userId);
    }
  }

  private async handleCallback(query: TelegramCallbackQuery): Promise<void> {
    const userId = query.from.id.toString();
    const username = query.from.username ?? query.from.first_name ?? 'unknown';
    const callbackData = query.data ?? '';
    const chatId = query.message?.chat.id.toString() ?? this.config.telegram.groupId;

    let matchedHandler: CallbackHandler | undefined;
    for (const [action, handler] of this.callbackHandlers) {
      if (callbackData.startsWith(`${action}:`)) {
        matchedHandler = handler;
        break;
      }
    }
    if (!matchedHandler) return;

    const pending = await getPendingState(this.kv, userId);
    let pendingText: string | undefined = pending?.text;
    let shouldClear = false;

    const replyFn = async (msg: string, opts?: SendOptions) => {
      await this.telegramPost('sendMessage', {
        chat_id: chatId,
        text: msg,
        parse_mode: opts?.parseMode,
      });
    };

    const callbackCtx: CallbackContext = {
      userId,
      username,
      callbackData,
      replyText: replyFn,
      answerCallback: async () => {
        await this.telegramPost('answerCallbackQuery', { callback_query_id: query.id });
      },
      getPendingNote: () => pendingText,
      clearPendingNote: () => { pendingText = undefined; shouldClear = true; },
    };

    try {
      await matchedHandler(callbackCtx);
    } catch {
      await this.telegramPost('answerCallbackQuery', {
        callback_query_id: query.id,
        text: 'An error occurred.',
      });
    }

    if (shouldClear) {
      await clearPendingState(this.kv, userId);
    }
  }

  async start(): Promise<void> {
    throw new Error('start() is not available in CF Workers mode — use handleUpdate() instead');
  }
}
```

- [ ] **Step 4.4: Run tests to verify they pass**

```bash
npm test -- src/tests/cloudflare/adapter.test.ts
```

Expected: all 13 tests PASS.

- [ ] **Step 4.5: Run full test suite to check for regressions**

```bash
npm test
```

Expected: all tests PASS.

- [ ] **Step 4.6: Commit**

```bash
git add src/platforms/cloudflare/adapter.ts src/tests/cloudflare/adapter.test.ts
git commit -m "feat(cloudflare): add CloudflareAdapter implementing MessagingAdapter"
```

---

## Task 5: CF worker entry point

**Files:**
- Create: `src/platforms/cloudflare/worker.ts`

No unit test for the entry point — it wires together already-tested components. Integration is verified manually via `wrangler dev`.

- [ ] **Step 5.1: Implement `src/platforms/cloudflare/worker.ts`**

```typescript
/// <reference types="@cloudflare/workers-types" />
import { Octokit } from '@octokit/rest';
import type { Logger } from 'pino';
import { loadCFConfig, type CloudflareEnv } from './config.js';
import { CloudflareAdapter, type TelegramUpdate } from './adapter.js';
import { createAIProvider } from '../../ai/provider.js';
import { registerCommands } from '../../commands/registry.js';
import { createSquashJob } from '../../jobs/squash.js';
import { createDailySummaryJob } from '../../jobs/dailySummary.js';

const SQUASH_CRON = '0 2 * * *';
const SUMMARY_CRON = '0 6 * * *';

function makeLogger(): Logger {
  const fmt = (obj: unknown, msg?: string) => {
    if (typeof obj === 'string') return console.log(obj);
    console.log(JSON.stringify({ msg, ...(obj as object) }));
  };
  return {
    info: fmt,
    warn: (obj: unknown, msg?: string) => console.warn(typeof obj === 'string' ? obj : JSON.stringify({ msg, ...(obj as object) })),
    error: (obj: unknown, msg?: string) => console.error(typeof obj === 'string' ? obj : JSON.stringify({ msg, ...(obj as object) })),
    child: () => makeLogger(),
  } as unknown as Logger;
}

function buildDeps(env: CloudflareEnv) {
  const config = loadCFConfig(env);
  const octokit = new Octokit({ auth: config.github.token });
  const aiProvider = createAIProvider(config);
  const adapter = new CloudflareAdapter(config, env.GITHASSISTANT_KV);
  const log = makeLogger();
  registerCommands(adapter, octokit, config, aiProvider, log);
  return { config, octokit, aiProvider, adapter, log };
}

export default {
  async fetch(request: Request, env: CloudflareEnv): Promise<Response> {
    const url = new URL(request.url);

    if (request.method !== 'POST' || url.pathname !== '/webhook') {
      return new Response('Not found', { status: 404 });
    }

    let update: TelegramUpdate;
    try {
      update = await request.json() as TelegramUpdate;
    } catch {
      return new Response('Bad request', { status: 400 });
    }

    const { adapter } = buildDeps(env);
    await adapter.handleUpdate(update);

    return new Response('OK', { status: 200 });
  },

  async scheduled(event: ScheduledEvent, env: CloudflareEnv): Promise<void> {
    const { config, octokit, aiProvider, adapter, log } = buildDeps(env);

    if (event.cron === SQUASH_CRON) {
      const job = createSquashJob(octokit, config, adapter);
      await job.handler();
    } else if (event.cron === SUMMARY_CRON) {
      const job = createDailySummaryJob(octokit, config, adapter, aiProvider, log);
      await job.handler();
    }
  },
};
```

- [ ] **Step 5.2: Verify TypeScript compiles without errors**

```bash
npx tsc --noEmit
```

Expected: no errors. If there are CF types conflicts, add `"skipLibCheck": true` is already in `tsconfig.json` so it should pass.

- [ ] **Step 5.3: Commit**

```bash
git add src/platforms/cloudflare/worker.ts
git commit -m "feat(cloudflare): add CF Workers entry point with fetch and scheduled handlers"
```

---

## Task 6: Webhook registration script

**Files:**
- Create: `scripts/register-webhook.ts`

- [ ] **Step 6.1: Create `scripts/register-webhook.ts`**

```typescript
import 'dotenv/config';

const token = process.env.TELEGRAM_BOT_TOKEN;
const workerUrl = process.env.CF_WORKER_URL;

if (!token || !workerUrl) {
  console.error('Error: TELEGRAM_BOT_TOKEN and CF_WORKER_URL must be set in your .env');
  console.error('  CF_WORKER_URL example: https://githassistant.<subdomain>.workers.dev');
  process.exit(1);
}

const webhookUrl = `${workerUrl.replace(/\/$/, '')}/webhook`;
const apiUrl = `https://api.telegram.org/bot${token}/setWebhook`;

console.log(`Registering Telegram webhook → ${webhookUrl}`);

const res = await fetch(apiUrl, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ url: webhookUrl }),
});

const data = await res.json() as { ok: boolean; description?: string };
console.log('Telegram response:', JSON.stringify(data, null, 2));

if (!data.ok) {
  console.error(`Failed: ${data.description ?? 'unknown error'}`);
  process.exit(1);
}

console.log('Webhook registered successfully.');
```

- [ ] **Step 6.2: Verify the script runs without syntax errors**

```bash
npx tsx --version && echo "tsx available"
```

Expected: tsx version printed.

- [ ] **Step 6.3: Add `CF_WORKER_URL` to `.env.example`**

In `.env.example`, add after the existing deployment-related entries:

```dotenv
# === Cloudflare Workers (only needed for CF deployment) ===
# CF_WORKER_URL=https://githassistant.<subdomain>.workers.dev
```

- [ ] **Step 6.4: Commit**

```bash
git add scripts/register-webhook.ts .env.example
git commit -m "feat(cloudflare): add webhook registration script"
```

---

## Task 7: Update README

**Files:**
- Modify: `README.md`

- [ ] **Step 7.1: Add OpenAI provider documentation**

In the `## Required Environment Variables` section, replace:

```
- `ANTHROPIC_API_KEY` — From console.anthropic.com (separate from claude.ai, billed by token usage)
```

with:

```
- `ANTHROPIC_API_KEY` — From console.anthropic.com (separate from claude.ai, billed by token usage). Required when `AI_PROVIDER=anthropic` (default).
```

Add after it:

```
- `OPENAI_API_KEY` — From platform.openai.com. Required when `AI_PROVIDER=openai`.
```

In the `## Optional Environment Variables` table, add a row:

```
| `AI_PROVIDER` | `anthropic` | AI backend: `anthropic` or `openai` |
| `OPENAI_MODEL` | `gpt-4o` | OpenAI model name (used when `AI_PROVIDER=openai`) |
| `ANTHROPIC_MODEL` | `claude-sonnet-4-5` | Anthropic model name |
```

- [ ] **Step 7.2: Add Architecture section**

Add a new `## Architecture` section before the existing one (which currently starts with "Three subsystems wired at startup"). Replace the existing architecture section with:

```markdown
## Architecture

GitHAssistant runs in two modes that share all business logic:

```
┌─────────────────────────────────────────────────────────────────┐
│                     SHARED CORE (src/)                          │
│  commands/ · jobs/ · github/ · ai/ · types.ts                   │
│  All command and job logic receives deps via DI — no platform   │
│  imports.                                                       │
└────────────────┬────────────────────────────────┬───────────────┘
                 │                                │
    ┌────────────▼────────────┐      ┌────────────▼────────────┐
    │     Node.js mode         │      │   Cloudflare Workers     │
    │   (src/index.ts)         │      │   (src/platforms/        │
    │                         │      │    cloudflare/worker.ts) │
    │  Telegraf long-polling   │      │                         │
    │  node-cron scheduler     │      │  Telegram webhook        │
    │  dotenv config           │      │  CF Cron Triggers        │
    │  Local / Render.com      │      │  CF Workers secrets      │
    └─────────────────────────┘      │  CF KV (callback state)  │
                                     └─────────────────────────┘
```

Three subsystems wired at startup (both modes):

1. **Config** — validates env vars at boot, exits with descriptive error on missing vars
2. **Messaging** — platform-specific adapter implementing `MessagingAdapter`; Telegram is the only concrete implementation
3. **AI** — pluggable provider behind `AIProvider` interface; Anthropic and OpenAI supported

AI skills live in `.claude/skills/` as plain Markdown files and are loaded at runtime — swap or edit a skill file to change how the AI behaves without touching code.

All command and job logic receives dependencies via injection — no platform context leaks into business logic.
```

- [ ] **Step 7.3: Add Cloudflare Workers deployment section**

After the existing `## Deployment (Render.com)` section, add:

```markdown
## Deployment (Cloudflare Workers)

### First-time setup

```bash
# 1. Install Wrangler globally (or use npx)
npm install -g wrangler

# 2. Authenticate with your Cloudflare account
wrangler login

# 3. Create the KV namespace for callback state
wrangler kv namespace create GITHASSISTANT_KV
# Copy the returned `id` value into wrangler.toml → kv_namespaces[0].id

# 4. Set required secrets (you'll be prompted to type each value)
wrangler secret put TELEGRAM_BOT_TOKEN
wrangler secret put TELEGRAM_GROUP_ID
wrangler secret put GITHUB_TOKEN
wrangler secret put GITHUB_OWNER
wrangler secret put GITHUB_REPO
wrangler secret put ANTHROPIC_API_KEY   # or OPENAI_API_KEY + AI_PROVIDER=openai

# Optional secrets (have defaults):
wrangler secret put TELEGRAM_ALLOWED_USERS   # comma-separated usernames
wrangler secret put AI_PROVIDER              # anthropic or openai

# 5. Deploy
npm run cf:deploy

# 6. Register the Telegram webhook (one-time, re-run after URL changes)
CF_WORKER_URL=https://githassistant.<your-subdomain>.workers.dev npm run cf:register-webhook
```

### Ongoing deployments

```bash
npm run cf:deploy
```

### Local development with CF runtime

```bash
npm run cf:dev   # wrangler dev — runs CF Workers runtime locally on port 8787
```

### Nightly job schedule

Both jobs run automatically via CF Cron Triggers:

| Job | Schedule | Description |
|---|---|---|
| Squash | `0 2 * * *` (02:00 UTC) | Squash each author's commits from yesterday |
| Daily summary | `0 6 * * *` (06:00 UTC) | Post AI digest of yesterday's changes |

Cron schedules are defined in `wrangler.toml` and cannot be overridden via secrets.

### Free tier limits

Cloudflare Workers free tier is sufficient for normal bot usage:

| Resource | Free limit | Typical bot usage |
|---|---|---|
| Requests | 100,000/day | ~2–20/day |
| Cron Triggers | 5 triggers | 2 triggers |
| KV reads | 100,000/day | <100/day |
| KV writes | 1,000/day | <20/day |

> **Note:** CF Workers free tier has a 10ms CPU time limit per request. Since summarisation calls await external AI APIs (Anthropic/OpenAI), and CF counts only active CPU time (not I/O wait), this limit is not a concern in practice. The paid plan ($5/month) raises the limit to 30s CPU and is recommended only for very large meeting transcript batches.
```

- [ ] **Step 7.4: Verify README renders correctly**

Open `README.md` and visually scan for broken markdown (unclosed code fences, misaligned tables).

- [ ] **Step 7.5: Run full test suite one final time**

```bash
npm test
```

Expected: all tests PASS.

- [ ] **Step 7.6: Commit**

```bash
git add README.md
git commit -m "docs: add Cloudflare Workers setup, OpenAI provider docs, and architecture section"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Covered by |
|---|---|
| `src/platforms/cloudflare/worker.ts` with `fetch` + `scheduled` | Task 5 |
| `src/platforms/cloudflare/adapter.ts` implementing `MessagingAdapter` | Task 4 |
| `src/platforms/cloudflare/config.ts` from CF env bindings | Task 2 |
| `src/platforms/cloudflare/kv-state.ts` KV callback state, 10-min TTL | Task 3 |
| `scripts/register-webhook.ts` | Task 6 |
| `wrangler.toml` with KV binding + cron triggers | Task 1 |
| Cron: squash at `0 2 * * *`, summary at `0 6 * * *` | Task 1 + Task 5 |
| `cf:deploy`, `cf:dev`, `cf:register-webhook` scripts | Task 1 |
| CF Rate Limiting via CF dashboard (not code) | Noted in README |
| README: architecture, OpenAI docs, CF setup | Task 7 |
| Existing Node.js path unchanged | No existing files modified |

**Type consistency check:** `TelegramUpdate` is defined and exported in `adapter.ts`, imported in `worker.ts`. `CloudflareEnv` is defined and exported in `config.ts`, imported in `adapter.ts` and `worker.ts`. `KVNamespace` comes from `@cloudflare/workers-types` via `/// <reference>` in each CF file. All consistent.

**Placeholder scan:** No TBDs. `REPLACE_WITH_KV_NAMESPACE_ID` in `wrangler.toml` is intentional — the README instructs the user to fill it in after running `wrangler kv namespace create`.
