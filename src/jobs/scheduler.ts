import cron from 'node-cron';
import type { Logger } from 'pino';
import type { JobPlugin } from '../types.js';

export function startScheduler(jobs: JobPlugin[], nightlyCron: string, log: Logger): void {
  const jobsByExpression = new Map<string, JobPlugin[]>();

  for (const job of jobs) {
    const expr = job.cronExpression ?? nightlyCron;
    const existing = jobsByExpression.get(expr) ?? [];
    existing.push(job);
    jobsByExpression.set(expr, existing);
  }

  for (const [expression, jobGroup] of jobsByExpression.entries()) {
    cron.schedule(expression, async () => {
      for (const job of jobGroup) {
        log.info(`Running job: ${job.name}`);
        try {
          await job.handler();
          log.info(`Job completed: ${job.name}`);
        } catch (err) {
          log.error({ err }, `Job failed: ${job.name}`);
        }
      }
    });
    log.info(`Scheduled ${jobGroup.map(j => j.name).join(', ')} at "${expression}"`);
  }
}
