/// <reference types="@cloudflare/workers-types" />
import type { Octokit } from '@octokit/rest';
import type { Logger } from 'pino';
import type { Config, AIProvider, JobPlugin, SendOptions, UsageContext } from '../types.js';
import { listFiles } from '../github/files.js';
import { isTranscriptFile, buildSummaryFilename, processFile } from '../commands/meeting-summary.js';

export interface MeetingScanMessage {
  type: 'meeting_scan';
  transcriptPath: string;
}

/**
 * Returns the transcripts (anywhere under the meeting folder, including subfolders)
 * that do not yet have a corresponding summary file. Uses only the single recursive
 * directory listing — no per-file git-history lookups — so it stays well within the
 * Worker subrequest budget no matter how many transcripts accumulate.
 */
export function findUnsummarisedTranscripts(allFiles: string[]): string[] {
  const existing = new Set(allFiles);
  return allFiles.filter(isTranscriptFile).filter(t => !existing.has(buildSummaryFilename(t)));
}

export function createMeetingScanJob(
  octokit: Octokit,
  config: Config,
  queue: Queue,
  log: Logger,
): JobPlugin {
  return {
    name: 'meetingScan',
    handler: async () => {
      log.info('meeting scan job started');

      const allFiles = await listFiles(octokit, config, [config.meeting.notesFolder]);
      const toProcess = findUnsummarisedTranscripts(allFiles);

      if (toProcess.length === 0) {
        log.info('meeting scan: all transcripts already have summaries');
        return;
      }

      log.info({ count: toProcess.length }, 'meeting scan: queuing transcripts');
      for (const transcriptPath of toProcess) {
        await queue.send({ type: 'meeting_scan', transcriptPath } satisfies MeetingScanMessage);
      }

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
