/// <reference types="@cloudflare/workers-types" />
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CloudflareAdapter } from '../../src/platforms/cloudflare/adapter.js';
import type { Config } from '../../src/types.js';

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
