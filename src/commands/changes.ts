import type { Octokit } from '@octokit/rest';
import type { Logger } from 'pino';
import type { Config, CommandPlugin } from '../types.js';
import { fetchCommits, fetchCommitPatches } from '../github/commits.js';
import { parsePeriod } from './summary.js';
import { sendLong } from './meeting-summary.js';

const MAX_COMMITS = 50;

function stripContext(patch: string): string {
  return patch
    .split('\n')
    .filter(line => line.startsWith('+') || line.startsWith('-'))
    .join('\n');
}

function isInDocsPaths(filename: string, allowedPaths: string[], excludedPaths: string[]): boolean {
  const inAllowed = allowedPaths.some(p => filename === p || filename.startsWith(p + '/'));
  const inExcluded = excludedPaths.some(p => filename === p || filename.startsWith(p + '/'));
  return inAllowed && !inExcluded;
}

function parseArgs(arg: string, maxDays: number): { filePath?: string; since: Date } {
  const parts = arg.trim().split(/\s+/);
  if (parts.length >= 2) {
    const { since } = parsePeriod(parts[parts.length - 1], maxDays);
    return { filePath: parts.slice(0, -1).join(' '), since };
  }
  if (parts.length === 1 && parts[0]) {
    try {
      const { since } = parsePeriod(parts[0], maxDays);
      return { since };
    } catch {
      return { filePath: parts[0], since: new Date(Date.now() - 24 * 60 * 60 * 1000) };
    }
  }
  return { since: new Date(Date.now() - 24 * 60 * 60 * 1000) };
}

export function createChangesPlugin(
  octokit: Octokit,
  config: Config,
  log: Logger,
): CommandPlugin {
  return {
    command: 'changes',
    description: 'Show diffs for docs files (default: last 24h)',
    requiresAuth: false,
    handler: async (ctx) => {
      log.info({ username: ctx.username, arg: ctx.text }, 'changes command started');

      const { filePath, since } = parseArgs(ctx.text.trim(), config.behavior.summaryMaxDays);

      const pathFilter = (filename: string) => {
        if (filePath) {
          return filename === filePath || filename.startsWith(filePath + '/');
        }
        return isInDocsPaths(filename, config.note.allowedPaths, config.note.excludedPaths);
      };

      let commits;
      try {
        commits = await fetchCommits(octokit, config, since);
      } catch (err) {
        log.error({ err }, 'changes: failed to fetch commits');
        await ctx.replyText('Failed to fetch commits. Please try again.');
        return;
      }

      if (commits.length === 0) {
        await ctx.replyText('No commits found in the requested period.');
        return;
      }

      // author → filename → patch lines[]
      const grouped = new Map<string, Map<string, string[]>>();

      for (const commit of commits.slice(0, MAX_COMMITS)) {
        let patches;
        try {
          patches = await fetchCommitPatches(octokit, config, commit.sha, pathFilter);
        } catch (err) {
          log.error({ err, sha: commit.shortSha }, 'changes: failed to fetch patches');
          continue;
        }
        for (const f of patches) {
          const stripped = stripContext(f.patch);
          if (!stripped) continue;
          if (!grouped.has(commit.authorLogin)) grouped.set(commit.authorLogin, new Map());
          const byFile = grouped.get(commit.authorLogin)!;
          if (!byFile.has(f.filename)) byFile.set(f.filename, []);
          byFile.get(f.filename)!.push(stripped);
        }
      }

      if (grouped.size === 0) {
        const scope = filePath ?? config.note.allowedPaths.join(', ');
        await ctx.replyText(`No changes found in \`${scope}\` for the requested period.`);
        return;
      }

      const sections: string[] = [];
      for (const [author, byFile] of grouped) {
        const fileBlocks = [...byFile.entries()]
          .map(([filename, chunks]) => `\`${filename}\`\n\`\`\`\n${chunks.join('\n')}\n\`\`\``)
          .join('\n\n');
        sections.push(`*@${author}*\n\n${fileBlocks}`);
      }

      await sendLong(sections.join('\n\n---\n\n'), t => ctx.replyText(t, { parseMode: 'Markdown' }));
      log.info({ username: ctx.username, authors: grouped.size }, 'changes command completed');
    },
  };
}
