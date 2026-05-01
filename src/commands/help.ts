import type { CommandPlugin, Config } from '../types.js';

export function createHelpPlugin(config: Config): CommandPlugin {
  return {
    command: 'help',
    description: 'Show this help message',
    requiresAuth: false,
    handler: async (ctx) => {
      const shortcuts = Object.entries(config.note.shortcuts);
      const shortcutLine = shortcuts.length > 0
        ? `\nShortcuts configured: ${shortcuts.map(([k, v]) => `${k} → ${v}`).join(', ')}`
        : '';

      await ctx.replyText(
        `GitHAssistant commands:\n\n` +
        `/note [file|shortcut] <text>  — Add a note to a project file\n` +
        `/summary [period]             — Summarise recent changes (default: last 24h)\n` +
        `/squash [period]              — Squash commits per author (default: last 24h)\n` +
        `/meeting-summary [file|period] — Summarise a meeting transcript\n` +
        `/help                         — Show this message` +
        shortcutLine,
      );
    },
  };
}
