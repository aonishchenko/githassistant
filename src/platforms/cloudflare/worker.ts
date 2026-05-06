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
    if (typeof obj === 'string') { console.info(obj); return; }
    console.info(JSON.stringify({ msg, ...(obj as object) }));
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
    await env.BOT_QUEUE.send(update);
    return new Response('OK', { status: 200 });
  },

  async queue(batch: MessageBatch<TelegramUpdate>, env: CloudflareEnv): Promise<void> {
    const { adapter } = buildDeps(env);
    for (const message of batch.messages) {
      try {
        await adapter.handleUpdate(message.body);
        message.ack();
      } catch (err) {
        console.error('Failed to process update:', err);
        message.ack(); // don't retry — errors are systemic (rate limits, subrequest limits)
      }
    }
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
