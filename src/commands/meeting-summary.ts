import path from 'path';
import type { Octokit } from '@octokit/rest';
import type { Logger } from 'pino';
import type { Config, AIProvider, CommandPlugin, CallbackHandler, SendOptions, UsageContext } from '../types.js';
import { getFile, writeFile, listFiles, getFileCreationDate } from '../github/files.js';
import { summariseMeeting } from '../ai/skills/meeting.js';
import { autoIssueFromSummary } from '../github/autoIssue.js';
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

export async function getTranscriptDate(
  octokit: Octokit,
  config: Config,
  filePath: string,
): Promise<Date | null> {
  const fromName = extractDateFromFilename(filePath);
  if (fromName) return fromName;
  return getFileCreationDate(octokit, config, filePath);
}

const TG_MAX_CHARS = 4000;

export async function sendLong(text: string, replyText: (t: string) => Promise<void>): Promise<void> {
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

function githubFileUrl(config: Config, filePath: string): string {
  return `https://github.com/${config.github.owner}/${config.github.repo}/blob/${config.github.defaultBranch}/${filePath}`;
}

export async function processFile(
  octokit: Octokit,
  config: Config,
  aiProvider: AIProvider,
  transcriptPath: string,
  username: string,
  replyText: (text: string, opts?: SendOptions) => Promise<void>,
  log: Logger,
  usageCtx?: UsageContext,
  silentIfExists = false,
): Promise<void> {
  const transcript = await getFile(octokit, config, transcriptPath);
  if (!transcript) {
    await replyText(`File not found: ${transcriptPath}.`);
    return;
  }

  const summaryPath = buildSummaryFilename(transcriptPath);
  const existing = await getFile(octokit, config, summaryPath);
  const content = existing?.content ?? null;

  if (!content) {
    let summary: string;
    try {
      summary = await summariseMeeting(aiProvider, transcript.content, usageCtx);
    } catch (err) {
      log.error({ err, transcriptPath }, 'meeting summarisation failed');
      await replyText(`Failed to generate summary for ${transcriptPath}. Please try again.`);
      return;
    }
    const commitMsg = `summary(@${username}): ${summaryPath}`;
    await writeFile(octokit, config, summaryPath, summary, commitMsg);
    await replyText(
      `<a href="${githubFileUrl(config, summaryPath)}">${path.basename(summaryPath)}</a>`,
      { parseMode: 'HTML' as const },
    );
    await sendLong(summary, replyText);

    if (config.meeting.autoIssueOwners.length > 0) {
      try {
        const created = await autoIssueFromSummary(summary, config, octokit, aiProvider, log, usageCtx ?? { trigger: 'meetingsummary', username });
        if (created.length > 0) {
          await replyText(
            `🎫 Auto-created ${created.length} issue(s) from action items:\n` +
            created.map(i => `• #${i.number} @${i.login} — ${i.title}`).join('\n'),
          );
        }
      } catch (err) {
        log.error({ err }, 'autoIssue: unexpected error during auto-issue creation');
      }
    }
  } else {
    log.info({ summaryPath }, 'summary already exists, skipping AI generation');
    if (!silentIfExists) {
      await replyText(
        `<a href="${githubFileUrl(config, summaryPath)}">${path.basename(summaryPath)}</a>`,
        { parseMode: 'HTML' as const },
      );
      await sendLong(content, replyText);
    }
  }
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
        const usageCtx: UsageContext = { trigger: 'meetingsummary', username: ctx.username };
        for (const f of inPeriod) {
          await processFile(octokit, config, aiProvider, f, ctx.username, ctx.replyText.bind(ctx), log, usageCtx);
        }
        return;
      }

      const filePath = arg.includes('/')
        ? arg
        : `${config.meeting.notesFolder}/${arg}`;
      await processFile(octokit, config, aiProvider, filePath, ctx.username, ctx.replyText.bind(ctx), log, { trigger: 'meetingsummary', username: ctx.username });
    },
  };

  const callbackHandler: CallbackHandler = async (ctx) => {
    await ctx.answerCallback();
    const filePath = ctx.callbackData.replace(/^mf:/, '');
    await processFile(octokit, config, aiProvider, filePath, ctx.username, ctx.replyText.bind(ctx), log, { trigger: 'meetingsummary', username: ctx.username });
  };

  return { plugin, callbackHandler };
}
