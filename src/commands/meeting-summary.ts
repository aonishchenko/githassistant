import path from 'path';
import type { Octokit } from '@octokit/rest';
import type { Logger } from 'pino';
import type { Config, AIProvider, CommandPlugin, CallbackHandler } from '../types.js';
import { getFile, writeFile, listFiles, getFileCreationDate } from '../github/files.js';
import { summariseMeeting } from '../ai/skills/meeting.js';
import { parsePeriod } from './summary.js';

export function buildSummaryFilename(transcriptPath: string): string {
  const ext = path.extname(transcriptPath);
  const base = path.basename(transcriptPath, ext);
  const dir = path.dirname(transcriptPath);
  const newBase = /transcript/i.test(base)
    ? base.replace(/transcription/gi, 'summary').replace(/transcript/gi, 'summary')
    : `${base}-summary`;
  const result = `${newBase}${ext}`;
  return dir === '.' ? result : `${dir}/${result}`;
}

export function extractDateFromFilename(filePath: string): Date | null {
  const name = path.basename(filePath);
  const match = name.match(/(\d{4}[-_]\d{2}[-_]\d{2})/);
  if (!match) return null;
  const normalized = match[1].replace(/_/g, '-');
  const d = new Date(`${normalized}T00:00:00Z`);
  return isNaN(d.getTime()) ? null : d;
}

export function isTranscriptFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase().slice(1);
  if (ext !== '' && !['md', 'txt'].includes(ext)) return false;
  const base = path.basename(filePath, path.extname(filePath)).toLowerCase();
  return !base.includes('summary');
}

async function getTranscriptDate(
  octokit: Octokit,
  config: Config,
  filePath: string,
): Promise<Date | null> {
  const fromName = extractDateFromFilename(filePath);
  if (fromName) return fromName;
  return getFileCreationDate(octokit, config, filePath);
}

const TG_MAX_CHARS = 4000;

async function sendLong(text: string, replyText: (t: string) => Promise<void>): Promise<void> {
  if (text.length <= TG_MAX_CHARS) {
    await replyText(text);
    return;
  }
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= TG_MAX_CHARS) {
      await replyText(remaining);
      break;
    }
    const slice = remaining.slice(0, TG_MAX_CHARS);
    const cut = Math.max(slice.lastIndexOf('\n'), slice.lastIndexOf(' '));
    const end = cut > TG_MAX_CHARS / 2 ? cut : TG_MAX_CHARS;
    await replyText(remaining.slice(0, end));
    remaining = remaining.slice(end).trimStart();
  }
}

async function processFile(
  octokit: Octokit,
  config: Config,
  aiProvider: AIProvider,
  transcriptPath: string,
  username: string,
  replyText: (text: string) => Promise<void>,
  log: Logger,
): Promise<void> {
  const transcript = await getFile(octokit, config, transcriptPath);
  if (!transcript) {
    await replyText(`File not found: \`${transcriptPath}\`.`);
    return;
  }

  const summaryPath = buildSummaryFilename(transcriptPath);
  const existing = await getFile(octokit, config, summaryPath);
  if (existing) {
    log.info({ summaryPath }, 'summary already exists, skipping AI generation');
    await sendLong(`${path.basename(summaryPath)}\n\n${existing.content}`, replyText);
    return;
  }

  let summary: string;
  try {
    summary = await summariseMeeting(aiProvider, transcript.content);
  } catch (err) {
    log.error({ err, transcriptPath }, 'meeting summarisation failed');
    await replyText(`Failed to generate summary for \`${transcriptPath}\`. Please try again.`);
    return;
  }

  const commitMsg = `summary(@${username}): ${summaryPath}`;
  await writeFile(octokit, config, summaryPath, summary, commitMsg);
  await sendLong(`${path.basename(summaryPath)}\n\n${summary}`, replyText);
}

export function createMeetingSummaryPlugin(
  octokit: Octokit,
  config: Config,
  aiProvider: AIProvider,
  log: Logger,
): { plugin: CommandPlugin; callbackHandler: CallbackHandler } {
  const plugin: CommandPlugin = {
    command: 'meetingsummary',
    description: 'Summarise a meeting transcript from the meetings folder',
    requiresAuth: true,
    handler: async (ctx) => {
      const arg = ctx.text.trim();

      if (!arg) {
        const allFiles = await listFiles(octokit, config, [config.meeting.notesFolder]);
        const transcripts = allFiles.filter(isTranscriptFile).sort();
        if (transcripts.length === 0) {
          await ctx.replyText(`No transcript files found in \`${config.meeting.notesFolder}\`.`);
          return;
        }
        await ctx.showOptions(
          'Choose a transcript to summarise:',
          transcripts.slice(0, 20).map(f => ({ label: f, callbackData: `mf:${f}` })),
        );
        return;
      }

      let isPeriod = false;
      let since: Date | undefined;
      try {
        const parsed = parsePeriod(arg, config.behavior.summaryMaxDays);
        isPeriod = true;
        since = parsed.since;
      } catch {
        // not a period — treat as filename
      }

      if (isPeriod && since) {
        const allFiles = await listFiles(octokit, config, [config.meeting.notesFolder]);
        const transcripts = allFiles.filter(isTranscriptFile);
        const inPeriod: string[] = [];
        for (const f of transcripts) {
          const d = await getTranscriptDate(octokit, config, f);
          if (d && d >= since) inPeriod.push(f);
        }
        if (inPeriod.length === 0) {
          await ctx.replyText(`No transcript files found in the requested period.`);
          return;
        }
        for (const f of inPeriod) {
          await processFile(octokit, config, aiProvider, f, ctx.username, ctx.replyText.bind(ctx), log);
        }
        return;
      }

      const filePath = arg.includes('/')
        ? arg
        : `${config.meeting.notesFolder}/${arg}`;
      await processFile(octokit, config, aiProvider, filePath, ctx.username, ctx.replyText.bind(ctx), log);
    },
  };

  const callbackHandler: CallbackHandler = async (ctx) => {
    await ctx.answerCallback();
    const filePath = ctx.callbackData.replace(/^mf:/, '');
    await processFile(octokit, config, aiProvider, filePath, ctx.username, ctx.replyText.bind(ctx), log);
  };

  return { plugin, callbackHandler };
}
