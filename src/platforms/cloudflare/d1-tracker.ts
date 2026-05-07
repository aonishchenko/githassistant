/// <reference types="@cloudflare/workers-types" />
import type { UsageTracker } from '../../types.js';

export function createD1UsageTracker(db: D1Database): UsageTracker {
  return async (record) => {
    try {
      await db.prepare(
        'INSERT INTO ai_usage (ts, trigger, username, model, input_tk, output_tk, cost_usd) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).bind(
        Math.floor(Date.now() / 1000),
        record.trigger,
        record.username,
        record.model,
        record.inputTokens,
        record.outputTokens,
        record.costUsd,
      ).run();
    } catch (err) {
      console.error(JSON.stringify({ msg: 'd1 usage insert failed', err: String(err) }));
    }
  };
}
