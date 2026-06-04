import type { Octokit } from '@octokit/rest';
import type { Logger } from 'pino';
import type { Config, AIProvider, CommandPlugin, UsageContext } from '../types.js';
import { fetchCommits, fetchCommitFiles } from '../github/commits.js';
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
    requiresAuth: true,
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

      const MAX_COMMITS_FOR_FILES = 30;
      const authorDiffs = new Map<string, string[]>();
      const authorFiles = new Map<string, Set<string>>();
      for (const commit of commits) {
        const existing = authorDiffs.get(commit.authorLogin) ?? [];
        existing.push(`${commit.shortSha}: ${commit.message}`);
        authorDiffs.set(commit.authorLogin, existing);
        if (commits.length <= MAX_COMMITS_FOR_FILES) {
          if (!authorFiles.has(commit.authorLogin)) authorFiles.set(commit.authorLogin, new Set());
        }
      }

      if (commits.length <= MAX_COMMITS_FOR_FILES) {
        for (const commit of commits) {
          try {
            const files = await fetchCommitFiles(octokit, config, commit.sha);
            files.forEach(f => authorFiles.get(commit.authorLogin)?.add(f));
          } catch (err) {
            log.error({ err, sha: commit.sha }, 'failed to fetch commit files');
          }
        }
      }

      const authorSummaries: AuthorSummary[] = [];
      for (const [authorLogin, diffs] of authorDiffs.entries()) {
        const usageCtx: UsageContext = { trigger: 'summary', username: ctx.username };
        let summary: string;
        try {
          summary = await summariseAuthorDiffs(aiProvider, diffs, config.behavior.summaryLanguage, authorLogin, usageCtx);
        } catch (err) {
          log.error({ err, authorLogin }, 'AI summarisation failed');
          summary = commits
            .filter(c => c.authorLogin === authorLogin)
            .map(c => `- ${c.message} (${c.shortSha})`)
            .join('\n') + '\n_(AI summary unavailable)_';
        }
        const files = Array.from(authorFiles.get(authorLogin) ?? []).sort();
        authorSummaries.push({ authorLogin, summary, files });
      }

      await ctx.replyText(formatSummaryMessage(period.label, authorSummaries), { parseMode: 'HTML' });
    },
  };

  return { plugin };
}
