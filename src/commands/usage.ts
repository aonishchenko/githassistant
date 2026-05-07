/// <reference types="@cloudflare/workers-types" />
import type { CommandPlugin } from '../types.js';
import { parsePeriod } from './summary.js';

export function createUsagePlugin(db: D1Database): CommandPlugin {
  return {
    command: 'usage',
    description: 'Show AI token usage and cost stats',
    requiresAuth: true,
    handler: async (ctx) => {
      let since: Date;
      let label: string;
      try {
        const period = parsePeriod(ctx.text.trim() || '7d', 90);
        since = period.since;
        label = period.label;
      } catch (err: unknown) {
        await ctx.replyText((err as Error).message);
        return;
      }

      const sinceTs = Math.floor(since.getTime() / 1000);

      // Per trigger aggregation
      const byTrigger = await db.prepare(
        `SELECT trigger, SUM(input_tk) as total_input, SUM(output_tk) as total_output, SUM(cost_usd) as total_cost
         FROM ai_usage WHERE ts >= ? GROUP BY trigger ORDER BY total_cost DESC`,
      ).bind(sinceTs).all<{ trigger: string; total_input: number; total_output: number; total_cost: number }>();

      // Per user aggregation
      const byUser = await db.prepare(
        `SELECT username, SUM(input_tk) as total_input, SUM(output_tk) as total_output, SUM(cost_usd) as total_cost
         FROM ai_usage WHERE ts >= ? GROUP BY username ORDER BY total_cost DESC`,
      ).bind(sinceTs).all<{ username: string; total_input: number; total_output: number; total_cost: number }>();

      if (!byTrigger.results.length) {
        await ctx.replyText(`No AI usage recorded in the ${label}.`);
        return;
      }

      const totalCost = byTrigger.results.reduce((sum, r) => sum + r.total_cost, 0);
      const totalInput = byTrigger.results.reduce((sum, r) => sum + r.total_input, 0);
      const totalOutput = byTrigger.results.reduce((sum, r) => sum + r.total_output, 0);

      const fmt = (n: number) => n.toLocaleString('en-US');
      const fmtCost = (n: number) => `$${n.toFixed(4)}`;

      const triggerLines = byTrigger.results.map(r =>
        `• ${r.trigger}: ${fmt(r.total_input)} in / ${fmt(r.total_output)} out — ${fmtCost(r.total_cost)}`,
      ).join('\n');

      const userLines = byUser.results.map(r =>
        `• ${r.username}: ${fmt(r.total_input)} in / ${fmt(r.total_output)} out — ${fmtCost(r.total_cost)}`,
      ).join('\n');

      await ctx.replyText(
        `📊 AI usage — ${label}\n\n` +
        `By command:\n${triggerLines}\n\n` +
        `By user:\n${userLines}\n\n` +
        `Total: ${fmt(totalInput)} in / ${fmt(totalOutput)} out — ${fmtCost(totalCost)}`,
      );
    },
  };
}
