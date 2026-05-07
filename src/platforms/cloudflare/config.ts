/// <reference types="@cloudflare/workers-types" />
import type { Config } from '../../types.js';

export interface CloudflareEnv {
  GITHASSISTANT_KV: KVNamespace;
  BOT_QUEUE: Queue;
  GITHASSISTANT_DB?: D1Database;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_GROUP_ID: string;
  TELEGRAM_ALLOWED_USERS?: string;
  GITHUB_TOKEN: string;
  GITHUB_OWNER: string;
  GITHUB_REPO: string;
  GITHUB_DEFAULT_BRANCH?: string;
  AI_PROVIDER?: string;
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_MODEL?: string;
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
  NOTE_ALLOWED_PATHS?: string;
  NOTE_EXCLUDED_PATHS?: string;
  NOTE_SHORTCUTS?: string;
  NOTE_ALLOWED_EXTENSIONS?: string;
  MEETING_NOTES_FOLDER?: string;
  NIGHTLY_CRON?: string;
  TIMEZONE?: string;
  SUMMARY_MAX_DAYS?: string;
  SQUASH_ENABLED?: string;
  SUMMARY_LANGUAGE?: string;
  LOG_LEVEL?: string;
  RATE_LIMIT_PER_MIN?: string;
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

export function loadCFConfig(env: CloudflareEnv): Config {
  const missing: string[] = [];
  const req = (key: string, val: string | undefined): string => {
    if (!val) missing.push(key);
    return val ?? '';
  };

  const botToken = req('TELEGRAM_BOT_TOKEN', env.TELEGRAM_BOT_TOKEN);
  const groupId = req('TELEGRAM_GROUP_ID', env.TELEGRAM_GROUP_ID);
  const githubToken = req('GITHUB_TOKEN', env.GITHUB_TOKEN);
  const githubOwner = req('GITHUB_OWNER', env.GITHUB_OWNER);
  const githubRepo = req('GITHUB_REPO', env.GITHUB_REPO);

  if (missing.length > 0) {
    throw new Error(`Missing required CF Worker secrets: ${missing.join(', ')}`);
  }

  return {
    telegram: {
      botToken,
      groupId,
      allowedUsers: (env.TELEGRAM_ALLOWED_USERS ?? '')
        .split(',').map(s => s.trim()).filter(Boolean),
    },
    github: {
      token: githubToken,
      owner: githubOwner,
      repo: githubRepo,
      defaultBranch: env.GITHUB_DEFAULT_BRANCH ?? 'main',
    },
    note: {
      allowedPaths: (env.NOTE_ALLOWED_PATHS ?? 'docs')
        .split(',').map(s => s.trim()).filter(Boolean),
      excludedPaths: buildExcludedPaths(
        env.NOTE_EXCLUDED_PATHS ?? '',
        env.NOTE_ALLOWED_PATHS ?? 'docs',
        env.MEETING_NOTES_FOLDER ?? 'meetings',
      ),
      shortcuts: parseShortcuts(env.NOTE_SHORTCUTS ?? ''),
      allowedExtensions: (env.NOTE_ALLOWED_EXTENSIONS ?? 'md,txt')
        .split(',').map(s => s.trim()).filter(Boolean),
    },
    meeting: {
      notesFolder: env.MEETING_NOTES_FOLDER ?? 'meetings',
    },
    ai: {
      provider: env.AI_PROVIDER ?? (env.ANTHROPIC_API_KEY ? 'anthropic' : 'openai'),
      anthropicApiKey: env.ANTHROPIC_API_KEY ?? '',
      anthropicModel: env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-5',
      openaiApiKey: env.OPENAI_API_KEY ?? '',
      openaiModel: env.OPENAI_MODEL ?? 'gpt-5.3',
    },
    scheduler: {
      nightlyCron: env.NIGHTLY_CRON ?? '0 2 * * *',
      timezone: env.TIMEZONE ?? 'UTC',
    },
    behavior: {
      summaryMaxDays: parseInt(env.SUMMARY_MAX_DAYS ?? '7', 10),
      squashEnabled: env.SQUASH_ENABLED !== 'false',
      summaryLanguage: env.SUMMARY_LANGUAGE ?? 'en',
      logLevel: env.LOG_LEVEL ?? 'info',
      rateLimitPerMin: parseInt(env.RATE_LIMIT_PER_MIN ?? '10', 10),
    },
  };
}
