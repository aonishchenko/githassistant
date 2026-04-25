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
