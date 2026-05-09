/// <reference types="@cloudflare/workers-types" />
import { Octokit } from '@octokit/rest';
import type { Logger } from 'pino';
import { loadCFConfig, type CloudflareEnv } from './config.js';
import { CloudflareAdapter, type TelegramUpdate } from './adapter.js';
import { createAIProvider } from '../../ai/provider.js';
import { registerCommands, withAuth } from '../../commands/registry.js';
import { createSquashJob } from '../../jobs/squash.js';
import { createDailySummaryJob } from '../../jobs/dailySummary.js';
import { createMeetingScanJob, processMeetingScanMessage, type MeetingScanMessage } from '../../jobs/meetingScan.js';
import { createD1UsageTracker } from './d1-tracker.js';

const NIGHTLY_CRON = '30 23 * * *';
const MEETING_SCAN_CRON = '0 * * * *';

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

async function buildDeps(env: CloudflareEnv) {
  const config = loadCFConfig(env);
  const octokit = new Octokit({ auth: config.github.token });
  const tracker = env.GITHASSISTANT_DB ? createD1UsageTracker(env.GITHASSISTANT_DB) : undefined;
  const aiProvider = createAIProvider(config, tracker);
  const adapter = new CloudflareAdapter(config, env.GITHASSISTANT_KV);
  const log = makeLogger();
  registerCommands(adapter, octokit, config, aiProvider, log);
  if (env.GITHASSISTANT_DB) {
    const { createUsagePlugin } = await import('../../commands/usage.js');
    const usagePlugin = createUsagePlugin(env.GITHASSISTANT_DB);
    adapter.onCommand(usagePlugin.command, withAuth(usagePlugin, adapter));
  }
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

  async queue(batch: MessageBatch<TelegramUpdate | MeetingScanMessage>, env: CloudflareEnv): Promise<void> {
    const { adapter, octokit, config, aiProvider, log } = await buildDeps(env);
    for (const message of batch.messages) {
      try {
        if ('type' in message.body && message.body.type === 'meeting_scan') {
          await processMeetingScanMessage(octokit, config, aiProvider, message.body.transcriptPath, adapter.sendMessage.bind(adapter), log);
        } else {
          await adapter.handleUpdate(message.body as TelegramUpdate);
        }
        message.ack();
      } catch (err) {
        console.error('Failed to process message:', err);
        message.ack(); // don't retry — errors are systemic
      }
    }
  },

  async scheduled(event: ScheduledEvent, env: CloudflareEnv): Promise<void> {
    const { config, octokit, aiProvider, adapter, log } = await buildDeps(env);
    log.info({ cron: event.cron }, 'scheduled trigger fired');

    if (event.cron === NIGHTLY_CRON) {
      await createDailySummaryJob(octokit, config, adapter, aiProvider, log).handler();
      if (config.behavior.squashEnabled) {
        await createSquashJob(octokit, config, adapter, log).handler();
      }
    }

    if (event.cron === MEETING_SCAN_CRON) {
      await createMeetingScanJob(octokit, config, env.GITHASSISTANT_KV, env.BOT_QUEUE, log).handler();
    }
  },
};
