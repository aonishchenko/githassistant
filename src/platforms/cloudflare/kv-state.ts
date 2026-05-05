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
