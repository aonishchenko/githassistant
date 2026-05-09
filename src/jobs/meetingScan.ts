/// <reference types="@cloudflare/workers-types" />
import type { Octokit } from '@octokit/rest';
import type { Logger } from 'pino';
import type { Config, AIProvider, JobPlugin, SendOptions, UsageContext } from '../types.js';
import { listFiles } from '../github/files.js';
import { isTranscriptFile, getTranscriptDate, processFile } from '../commands/meeting-summary.js';

const KV_KEY = 'meeting:last_scan';

export interface MeetingScanMessage {
  type: 'meeting_scan';
  transcriptPath: string;
}

export function createMeetingScanJob(
  octokit: Octokit,
  config: Config,
  kv: KVNamespace,
  queue: Queue,
  log: Logger,
): JobPlugin {
  return {
    name: 'meetingScan',
    handler: async () => {
      const now = Date.now();
      const lastScanStr = await kv.get(KV_KEY);
      const lastScanTs = lastScanStr ? parseInt(lastScanStr, 10) : 0;
      log.info({ lastScanTs }, 'meeting scan job started');

      const allFiles = await listFiles(octokit, config, [config.meeting.notesFolder]);
      const transcripts = allFiles.filter(isTranscriptFile);

      const toProcess: string[] = [];
      for (const f of transcripts) {
        const d = await getTranscriptDate(octokit, config, f);
        if (d && d.getTime() >= lastScanTs) toProcess.push(f);
      }

      if (toProcess.length === 0) {
        log.info('meeting scan: no new transcripts');
        await kv.put(KV_KEY, String(now));
        return;
      }

      log.info({ count: toProcess.length }, 'meeting scan: queuing transcripts');
      for (const transcriptPath of toProcess) {
        await queue.send({ type: 'meeting_scan', transcriptPath } satisfies MeetingScanMessage);
      }

      await kv.put(KV_KEY, String(now));
      log.info({ count: toProcess.length }, 'meeting scan job completed');
    },
  };
}

export async function processMeetingScanMessage(
  octokit: Octokit,
  config: Config,
  aiProvider: AIProvider,
  transcriptPath: string,
  sendMessage: (text: string, opts?: SendOptions) => Promise<void>,
  log: Logger,
): Promise<void> {
  log.info({ transcriptPath }, 'processing meeting scan message');
  const usageCtx: UsageContext = { trigger: 'cron:meeting-scan', username: 'cron' };
  await processFile(octokit, config, aiProvider, transcriptPath, 'cron', sendMessage, log, usageCtx, true);
}
