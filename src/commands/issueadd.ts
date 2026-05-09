import type { Octokit } from '@octokit/rest';
import type { Logger } from 'pino';
import type { Config, AIProvider, CommandPlugin, UsageContext } from '../types.js';
import { listLabels, listOpenIssues, createIssue } from '../github/issues.js';
import { assignLabels } from '../ai/skills/labels.js';

export function createIssueAddPlugin(
  octokit: Octokit,
  config: Config,
  aiProvider: AIProvider,
  log: Logger,
): CommandPlugin {
  return {
    command: 'issueadd',
    description: 'Create GitHub issues from a list of titles (one per line)',
    requiresAuth: true,
    handler: async (ctx) => {
      log.info({ username: ctx.username }, 'issueadd command started');

      const lines = ctx.text.split('\n').map(l => l.trim()).filter(Boolean);
      if (lines.length < 2) {
        await ctx.replyText(
          'Usage:\n`/issueadd @username`\n`Issue title 1`\n`Issue title 2`\n...',
          { parseMode: 'Markdown' },
        );
        return;
      }

      const assignee = lines[0].replace(/^@/, '');
      const titles = lines.slice(1);

      let labels: Awaited<ReturnType<typeof listLabels>> = [];
      let existingIssues: Awaited<ReturnType<typeof listOpenIssues>> = [];
      try {
        [labels, existingIssues] = await Promise.all([
          listLabels(octokit, config),
          listOpenIssues(octokit, config),
        ]);
      } catch (err) {
        log.error({ err }, 'issueadd: failed to fetch labels or existing issues');
        await ctx.replyText('Failed to fetch repository data. Please try again.');
        return;
      }

      const existingTitles = new Set(existingIssues.map(i => i.title.toLowerCase()));
      const toCreate = titles.filter(t => !existingTitles.has(t.toLowerCase()));
      const skipped = titles.filter(t => existingTitles.has(t.toLowerCase()));

      if (toCreate.length === 0) {
        await ctx.replyText('All issues already exist — no new issues created.');
        return;
      }

      const usageCtx: UsageContext = { trigger: 'issueadd', username: ctx.username };
      const assignedLabels = await assignLabels(aiProvider, toCreate, labels, usageCtx);

      const created: { number: number; title: string; label: string | null }[] = [];
      const failed: string[] = [];

      for (let i = 0; i < toCreate.length; i++) {
        try {
          const number = await createIssue(octokit, config, {
            title: toCreate[i],
            assignee,
            label: assignedLabels[i],
          });
          created.push({ number, title: toCreate[i], label: assignedLabels[i] });
        } catch (err) {
          log.error({ err, title: toCreate[i] }, 'issueadd: failed to create issue');
          failed.push(toCreate[i]);
        }
      }

      const lines_out: string[] = [];

      if (created.length > 0) {
        lines_out.push(`✅ Created ${created.length} issue(s) assigned to @${assignee}:`);
        for (const issue of created) {
          const labelTag = issue.label ? ` [${issue.label}]` : '';
          lines_out.push(`- #${issue.number} ${issue.title}${labelTag}`);
        }
      }
      if (skipped.length > 0) {
        lines_out.push(`\n⏭️ Skipped (already exists):`);
        for (const t of skipped) lines_out.push(`- ${t}`);
      }
      if (failed.length > 0) {
        lines_out.push(`\n❌ Failed to create:`);
        for (const t of failed) lines_out.push(`- ${t}`);
      }

      await ctx.replyText(lines_out.join('\n'));
      log.info({ username: ctx.username, created: created.length, skipped: skipped.length }, 'issueadd command completed');
    },
  };
}
