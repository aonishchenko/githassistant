/// <reference types="@cloudflare/workers-types" />
import { describe, it, expect, beforeEach } from 'vitest';
import { getPendingState, setPendingState, clearPendingState } from '../../src/platforms/cloudflare/kv-state.js';

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
