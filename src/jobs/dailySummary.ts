import type { Octokit } from '@octokit/rest';
import type { Logger } from 'pino';
import type { Config, MessagingAdapter, AIProvider, JobPlugin, GitHubCommit, UsageContext } from '../types.js';
import { fetchCommits, buildAuthorCommitBlocks } from '../github/commits.js';
import { summariseAuthorDiffs } from '../ai/summarise.js';
import { generatePerAuthorReleaseNotes } from '../ai/skills/releaseNotes.js';
import { formatSummaryMessage, formatReleaseNotesMessage } from '../messaging/telegram/formatter.js';
import type { AuthorSummary } from '../messaging/telegram/formatter.js';
import { buildTodayWindow, buildYesterdayWindow, type TimeWindow } from './timeWindow.js';

export function createDailySummaryJob(
  octokit: Octokit,
  config: Config,
  adapter: MessagingAdapter,
  aiProvider: AIProvider,
  log: Logger,
  buildWindow: () => TimeWindow = () => buildTodayWindow(config.scheduler.timezone),
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

      const cappedCommits = commits.slice(0, config.behavior.dailySummaryMaxCommits);
      if (cappedCommits.length < commits.length) {
        log.warn({ total: commits.length, cap: cappedCommits.length }, 'daily summary: commit count capped to avoid subrequest limit');
      }

      // Fetch each diff once; the per-commit blocks feed both the summary and release notes.
      const authorBlocks = await buildAuthorCommitBlocks(octokit, config, cappedCommits, log);

      const { aiInputTruncateChars, aiCallDelayMs } = config.behavior;
      const cronCtx: UsageContext = { trigger: 'cron:daily', username: 'cron' };
      const authorSummaries: AuthorSummary[] = [];
      const authorEntries = [...authorBlocks.entries()];
      for (let i = 0; i < authorEntries.length; i++) {
        const [authorLogin, blocks] = authorEntries[i];
        if (i > 0 && aiCallDelayMs > 0) {
          await new Promise(resolve => setTimeout(resolve, aiCallDelayMs));
        }
        let combined = blocks.join('\n\n');
        if (aiInputTruncateChars !== null && combined.length > aiInputTruncateChars) {
          combined = combined.slice(0, aiInputTruncateChars);
          log.warn({ authorLogin, original: blocks.join('\n\n').length, truncated: aiInputTruncateChars }, 'AI input truncated');
        }
        let summary: string;
        try {
          summary = await summariseAuthorDiffs(aiProvider, [combined], config.behavior.summaryLanguage, authorLogin, cronCtx, true);
        } catch (err) {
          log.error({ err, authorLogin }, 'AI summarisation failed');
          summary = cappedCommits
            .filter(c => c.authorLogin === authorLogin)
            .map(c => `- ${c.message} (${c.shortSha})`)
            .join('\n') + '\n_(AI summary unavailable)_';
        }
        authorSummaries.push({ authorLogin, summary, files: [] });
      }

      await adapter.sendMessage(formatSummaryMessage(dateStr, authorSummaries), { parseMode: 'HTML' });

      // Per-author release notes for the same window (reusing the diffs fetched above).
      const releaseNotes = await generatePerAuthorReleaseNotes(
        aiProvider, dateStr, authorBlocks, cronCtx, log, aiCallDelayMs,
      );
      await adapter.sendMessage(formatReleaseNotesMessage(dateStr, releaseNotes), { parseMode: 'HTML' });

      log.info({ dateStr, commitCount: cappedCommits.length, totalCommits: commits.length, authorCount: authorSummaries.length }, 'daily summary job completed');
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
