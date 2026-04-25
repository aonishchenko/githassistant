import type { Octokit } from '@octokit/rest';
import type { MessagingAdapter, Config, AIProvider, CommandPlugin, AdapterContext } from '../types.js';
import { createHelpPlugin } from './help.js';
import { createNotePlugin } from './note.js';
import { createSummaryPlugin } from './summary.js';

export function registerCommands(
  adapter: MessagingAdapter,
  octokit: Octokit,
  config: Config,
  aiProvider: AIProvider,
): void {
  const helpPlugin = createHelpPlugin(config);
  adapter.onCommand(helpPlugin.command, helpPlugin.handler);

  const { plugin: notePlugin, callbackHandler: noteCallback } = createNotePlugin(octokit, config);
  adapter.onCommand(notePlugin.command, withAuth(notePlugin, adapter));
  adapter.onCallback('note_file', noteCallback);

  const { plugin: summaryPlugin } = createSummaryPlugin(octokit, config, aiProvider);
  adapter.onCommand(summaryPlugin.command, summaryPlugin.handler);
}

function withAuth(
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
