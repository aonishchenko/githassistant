import type { Octokit } from '@octokit/rest';
import type { Logger } from 'pino';
import type { Config, AIProvider, CommandPlugin } from '../types.js';
import { fetchCommits } from '../github/commits.js';
import { summariseAuthorDiffs } from '../ai/summarise.js';
import { formatSummaryMessage } from '../messaging/telegram/formatter.js';
import type { AuthorSummary } from '../messaging/telegram/formatter.js';

export interface PeriodResult {
  since: Date;
  label: string;
}

export function parsePeriod(arg: string, maxDays: number, now: Date = new Date()): PeriodResult {
  const trimmed = arg.trim();

  if (!trimmed) {
    const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    return { since, label: 'last 24h' };
  }

  const dMatch = trimmed.match(/^(\d+)d$/);
  if (dMatch) {
    const days = parseInt(dMatch[1], 10);
    if (days > maxDays) throw new Error(`Maximum summary window is ${maxDays} days.`);
    const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    return { since, label: `last ${days}d` };
  }

  const wMatch = trimmed.match(/^(\d+)w$/);
  if (wMatch) {
    const days = parseInt(wMatch[1], 10) * 7;
    if (days > maxDays) throw new Error(`Maximum summary window is ${maxDays} days.`);
    const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    return { since, label: `last ${trimmed}` };
  }

  const isoMatch = trimmed.match(/^\d{4}-\d{2}-\d{2}$/);
  if (isoMatch) {
    const since = new Date(`${trimmed}T00:00:00Z`);
    if (isNaN(since.getTime())) throw new Error(`Invalid date: ${trimmed}`);
    const diffDays = Math.ceil((now.getTime() - since.getTime()) / (24 * 60 * 60 * 1000));
    if (diffDays > maxDays) throw new Error(`Maximum summary window is ${maxDays} days.`);
    return { since, label: `since ${trimmed}` };
  }

  throw new Error(`Invalid period format: "${trimmed}". Use 3d, 1w, or YYYY-MM-DD.`);
}

export function createSummaryPlugin(
  octokit: Octokit,
  config: Config,
  aiProvider: AIProvider,
  log: Logger,
): { plugin: CommandPlugin } {
  const plugin: CommandPlugin = {
    command: 'summary',
    description: 'Summarise recent commits (default: last 24h)',
    requiresAuth: false,
    handler: async (ctx) => {
      let period: PeriodResult;
      try {
        period = parsePeriod(ctx.text.trim(), config.behavior.summaryMaxDays);
      } catch (err: unknown) {
        await ctx.replyText((err as Error).message);
        return;
      }

      const commits = await fetchCommits(octokit, config, period.since);
      if (commits.length === 0) {
        await ctx.replyText(`No commits found in the ${period.label}.`);
        return;
      }

      const authorDiffs = new Map<string, string[]>();
      for (const commit of commits) {
        const existing = authorDiffs.get(commit.authorLogin) ?? [];
        existing.push(`${commit.shortSha}: ${commit.message}`);
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
        authorSummaries.push({ authorLogin, summary });
      }

      await ctx.replyText(formatSummaryMessage(period.label, authorSummaries), { parseMode: 'Markdown' });
    },
  };

  return { plugin };
}
