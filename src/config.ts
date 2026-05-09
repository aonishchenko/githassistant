import 'dotenv/config';
import type { Config } from './types.js';

function collect(name: string, value: string | undefined, missing: string[]): string {
  if (!value) missing.push(name);
  return value ?? '';
}

function parseShortcuts(raw: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const entry of raw.split(',')) {
    const eq = entry.indexOf('=');
    if (eq < 1) continue;
    const key = entry.slice(0, eq).trim();
    const val = entry.slice(eq + 1).trim();
    if (key && val) result[key] = val;
  }
  return result;
}

function buildExcludedPaths(rawExcluded: string, rawAllowed: string, meetingFolder: string): string[] {
  const explicit = rawExcluded.split(',').map(s => s.trim()).filter(Boolean);
  const allowedPaths = rawAllowed.split(',').map(s => s.trim()).filter(Boolean);
  const meetingIsSubfolder = allowedPaths.some(p =>
    meetingFolder === p || meetingFolder.startsWith(p + '/'),
  );
  const auto = meetingIsSubfolder ? [meetingFolder] : [];
  return [...new Set([...explicit, ...auto])];
}

export function loadConfig(): Config {
  const missing: string[] = [];

  const botToken = collect('TELEGRAM_BOT_TOKEN', process.env.TELEGRAM_BOT_TOKEN, missing);
  const groupId = collect('TELEGRAM_GROUP_ID', process.env.TELEGRAM_GROUP_ID, missing);
  const githubToken = collect('GITHUB_TOKEN', process.env.GITHUB_TOKEN, missing);
  const githubOwner = collect('GITHUB_OWNER', process.env.GITHUB_OWNER, missing);
  const githubRepo = collect('GITHUB_REPO', process.env.GITHUB_REPO, missing);

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  return {
    telegram: {
      botToken,
      groupId,
      allowedUsers: (process.env.TELEGRAM_ALLOWED_USERS ?? '')
        .split(',').map(s => s.trim()).filter(Boolean),
    },
    github: {
      token: githubToken,
      owner: githubOwner,
      repo: githubRepo,
      defaultBranch: process.env.GITHUB_DEFAULT_BRANCH ?? 'main',
    },
    note: {
      allowedPaths: (process.env.DOCS_PATH ?? 'docs')
        .split(',').map(s => s.trim()).filter(Boolean),
      excludedPaths: buildExcludedPaths(
        process.env.NOTE_EXCLUDED_PATHS ?? '',
        process.env.DOCS_PATH ?? 'docs',
        process.env.MEETING_NOTES_FOLDER ?? 'meetings',
      ),
      shortcuts: parseShortcuts(process.env.NOTE_SHORTCUTS ?? ''),
      allowedExtensions: (process.env.NOTE_ALLOWED_EXTENSIONS ?? 'md,txt')
        .split(',').map(s => s.trim()).filter(Boolean),
    },
    meeting: {
      notesFolder: process.env.MEETING_NOTES_FOLDER ?? 'meetings',
    },
    ai: {
      provider: process.env.AI_PROVIDER
        ?? (process.env.ANTHROPIC_API_KEY ? 'anthropic' : 'openai'),
      anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? '',
      anthropicModel: process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-5',
      openaiApiKey: process.env.OPENAI_API_KEY ?? '',
      openaiModel: process.env.OPENAI_MODEL ?? 'gpt-5.3',
    },
    scheduler: {
      nightlyCron: process.env.NIGHTLY_CRON ?? '0 2 * * *',
      timezone: process.env.TIMEZONE ?? 'UTC',
    },
    behavior: {
      summaryMaxDays: parseInt(process.env.SUMMARY_MAX_DAYS ?? '7', 10),
      summaryLanguage: process.env.SUMMARY_LANGUAGE ?? 'en',
      logLevel: process.env.LOG_LEVEL ?? 'info',
      rateLimitPerMin: parseInt(process.env.RATE_LIMIT_PER_MIN ?? '10', 10),
    },
  };
}
