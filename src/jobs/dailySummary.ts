import type { Octokit } from '@octokit/rest';
import type { Logger } from 'pino';
import type { Config, MessagingAdapter, AIProvider, JobPlugin, GitHubCommit } from '../types.js';
import { fetchCommits, fetchCommitDiff } from '../github/commits.js';
import { summariseAuthorDiffs } from '../ai/summarise.js';
import { formatSummaryMessage } from '../messaging/telegram/formatter.js';
import type { AuthorSummary } from '../messaging/telegram/formatter.js';
import { buildTodayWindow, buildYesterdayWindow, type SquashWindow } from './squash.js';

export function createDailySummaryJob(
  octokit: Octokit,
  config: Config,
  adapter: MessagingAdapter,
  aiProvider: AIProvider,
  log: Logger,
  buildWindow: () => SquashWindow = () => buildTodayWindow(config.scheduler.timezone),
): JobPlugin {
  return {
    name: 'dailySummary',
    handler: async () => {
      const { since, until, dateStr } = buildWindow();
      log.info({ dateStr }, 'daily summary job started');

      let commits: GitHubCommit[];
      try {
        commits = await fetchCommits(octokit, config, since, until);
      } catch (err: unknown) {
        await adapter.sendMessage(`❌ Daily summary failed: could not fetch commits. ${(err as Error).message}`);
        return;
      }

      if (commits.length === 0) {
        log.info({ dateStr }, 'daily summary: no commits found');
        await adapter.sendMessage(`No commits on ${dateStr} — nothing to summarise.`);
        return;
      }

      const authorDiffs = new Map<string, string[]>();
      for (const commit of commits) {
        let diff: string;
        try {
          diff = await fetchCommitDiff(octokit, config, commit.sha);
        } catch (err) {
          log.error({ err, sha: commit.shortSha }, 'failed to fetch commit diff');
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
          summary = await summariseAuthorDiffs(aiProvider, diffs, config.behavior.summaryLanguage, authorLogin);
        } catch (err) {
          log.error({ err, authorLogin }, 'AI summarisation failed');
          summary = commits
            .filter(c => c.authorLogin === authorLogin)
            .map(c => `- ${c.message} (${c.shortSha})`)
            .join('\n') + '\n_(AI summary unavailable)_';
        }
        authorSummaries.push({ authorLogin, summary, files: [] });
      }

      await adapter.sendMessage(formatSummaryMessage(dateStr, authorSummaries), { parseMode: 'Markdown' });
      log.info({ dateStr, commitCount: commits.length, authorCount: authorSummaries.length }, 'daily summary job completed');
    },
  };
}

// Standalone entry point for `npm run job:summary`
const isMain = process.argv[1]?.endsWith('dailySummary.ts') || process.argv[1]?.endsWith('dailySummary.js');
if (isMain) {
  const { loadConfig } = await import('../config.js');
  const { Octokit } = await import('@octokit/rest');
  const { TelegramAdapter } = await import('../messaging/telegram/index.js');
  const { createAIProvider } = await import('../ai/provider.js');
  const { default: pino } = await import('pino');
  const config = loadConfig();
  const log = pino({ level: config.behavior.logLevel });
  const octokit = new Octokit({ auth: config.github.token });
  const adapter = new TelegramAdapter(config, log);
  const ai = createAIProvider(config);
  createDailySummaryJob(octokit, config, adapter, ai, log).handler().catch((err: unknown) => {
    log.error(err);
    process.exit(1);
  });
}
