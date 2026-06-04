import type { Octokit } from '@octokit/rest';
import type { Logger } from 'pino';
import type { MessagingAdapter, Config, AIProvider, CommandPlugin, AdapterContext } from '../types.js';
import { createHelpPlugin } from './help.js';
import { createNotePlugin } from './note.js';
import { createSummaryPlugin } from './summary.js';
import { createMeetingSummaryPlugin } from './meeting-summary.js';
import { createChangesPlugin } from './changes.js';
import { createIssueAddPlugin } from './issueadd.js';
import { createReleaseNotesPlugin } from './releasenotes.js';

export function registerCommands(
  adapter: MessagingAdapter,
  octokit: Octokit,
  config: Config,
  aiProvider: AIProvider,
  log: Logger,
): void {
  // All commands require authorization (TELEGRAM_ALLOWED_USERS).
  const helpPlugin = createHelpPlugin(config);
  adapter.onCommand(helpPlugin.command, withAuth(helpPlugin, adapter));

  const { plugin: notePlugin, callbackHandler: noteCallback } = createNotePlugin(octokit, config);
  adapter.onCommand(notePlugin.command, withAuth(notePlugin, adapter));
  adapter.onCallback('nf', noteCallback);

  const { plugin: summaryPlugin } = createSummaryPlugin(octokit, config, aiProvider, log);
  adapter.onCommand(summaryPlugin.command, withAuth(summaryPlugin, adapter));

  const changesPlugin = createChangesPlugin(octokit, config, log);
  adapter.onCommand(changesPlugin.command, withAuth(changesPlugin, adapter));

  const issueAddPlugin = createIssueAddPlugin(octokit, config, aiProvider, log);
  adapter.onCommand(issueAddPlugin.command, withAuth(issueAddPlugin, adapter));

  const releaseNotesPlugin = createReleaseNotesPlugin(octokit, config, aiProvider, log);
  adapter.onCommand(releaseNotesPlugin.command, withAuth(releaseNotesPlugin, adapter));

  const { plugin: meetingPlugin, callbackHandler: meetingCallback } =
    createMeetingSummaryPlugin(octokit, config, aiProvider, log);
  adapter.onCommand(meetingPlugin.command, withAuth(meetingPlugin, adapter));
  adapter.onCallback('mf', meetingCallback);
}

export function withAuth(
  plugin: CommandPlugin,
  adapter: MessagingAdapter,
): (ctx: AdapterContext) => Promise<void> {
  return async (ctx: AdapterContext) => {
    if (plugin.requiresAuth) {
      const allowed = await adapter.isAuthorized(ctx.userId, ctx.username);
      if (!allowed) {
        await ctx.replyText("You don't have permission to use this command.");
        return;
      }
    }
    await plugin.handler(ctx);
  };
}
