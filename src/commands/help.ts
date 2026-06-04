import type { CommandPlugin, Config } from '../types.js';

export function createHelpPlugin(config: Config): CommandPlugin {
  return {
    command: 'help',
    description: 'Show this help message',
    requiresAuth: true,
    handler: async (ctx) => {
      const shortcuts = Object.entries(config.note.shortcuts);
      const shortcutLine = shortcuts.length > 0
        ? `\nShortcuts configured: ${shortcuts.map(([k, v]) => `${k} → ${v}`).join(', ')}`
        : '';

      await ctx.replyText(
        `GitHAssistant commands:\n\n` +
        `/note [file|shortcut] <text>  — Add a note to a project file\n` +
        `/summary [period]             — Summarise recent changes (default: last 24h)\n` +
        `/releasenotes [period]        — Per-author release notes (default: last 1d)\n` +
        `/changes [file] [period]      — Show diffs for docs files (default: last 24h)\n` +
        `/issueadd @user\\nTitle 1\\n... — Create GitHub issues from a list of titles\n` +
        `/meetingsummary [file|period] — Summarise a meeting transcript\n` +
        `/usage [period]               — Show AI token usage and cost stats\n` +
        `/help                         — Show this message` +
        shortcutLine,
      );
    },
  };
}
