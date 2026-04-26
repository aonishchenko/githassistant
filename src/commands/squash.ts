import type { Octokit } from '@octokit/rest';
import type { Config, CommandPlugin } from '../types.js';
import { parsePeriod } from './summary.js';
import { buildWindowUntilNow, runSquash } from '../jobs/squash.js';

export function createSquashPlugin(octokit: Octokit, config: Config): CommandPlugin {
  return {
    command: 'squash',
    description: 'Squash commits into one per author (default: last 24h)',
    requiresAuth: true,
    handler: async (ctx) => {
      let period: { since: Date; label: string };
      try {
        period = parsePeriod(ctx.text.trim(), config.behavior.summaryMaxDays);
      } catch (err: unknown) {
        await ctx.replyText((err as Error).message);
        return;
      }

      const window = buildWindowUntilNow(period.since);
      await runSquash(octokit, config, window, msg => ctx.replyText(msg));
    },
  };
}
