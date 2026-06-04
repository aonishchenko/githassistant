import type { Octokit } from '@octokit/rest';
import type { Logger } from 'pino';
import type { Config, AIProvider, CommandPlugin, UsageContext } from '../types.js';
import { fetchCommits, buildAuthorCommitBlocks } from '../github/commits.js';
import { generatePerAuthorReleaseNotes } from '../ai/skills/releaseNotes.js';
import { formatReleaseNotesMessage } from '../messaging/telegram/formatter.js';
import { parsePeriod } from './summary.js';
import { sendLong } from './meeting-summary.js';

const MAX_COMMITS = 25;

export function createReleaseNotesPlugin(
  octokit: Octokit,
  config: Config,
  aiProvider: AIProvider,
  log: Logger,
): CommandPlugin {
  return {
    command: 'releasenotes',
    description: 'Generate per-author release notes (default: last 1d)',
    requiresAuth: true,
    handler: async (ctx) => {
      const arg = ctx.text.trim() || '1d';

      let period: ReturnType<typeof parsePeriod>;
      try {
        period = parsePeriod(arg, config.behavior.summaryMaxDays);
      } catch (err: unknown) {
        await ctx.replyText((err as Error).message);
        return;
      }

      let commits;
      try {
        commits = await fetchCommits(octokit, config, period.since);
      } catch (err) {
        log.error({ err }, 'releasenotes: failed to fetch commits');
        await ctx.replyText('Failed to fetch commits. Please try again.');
        return;
      }

      if (commits.length === 0) {
        await ctx.replyText(`No commits found in the ${period.label}.`);
        return;
      }

      const capped = commits.slice(0, MAX_COMMITS);
      const authorBlocks = await buildAuthorCommitBlocks(octokit, config, capped, log);

      const usageCtx: UsageContext = { trigger: 'releasenotes', username: ctx.username };
      const perAuthor = await generatePerAuthorReleaseNotes(
        aiProvider, period.label, authorBlocks, usageCtx, log, config.behavior.aiCallDelayMs,
      );

      await sendLong(
        formatReleaseNotesMessage(period.label, perAuthor),
        t => ctx.replyText(t, { parseMode: 'HTML' }),
      );
      log.info({ username: ctx.username, authors: perAuthor.length }, 'releasenotes command completed');
    },
  };
}
