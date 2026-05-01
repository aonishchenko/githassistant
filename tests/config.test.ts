import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfig } from '../src/config.js';

const REQUIRED = {
  TELEGRAM_BOT_TOKEN: 'token123',
  TELEGRAM_GROUP_ID: '-100123456',
  GITHUB_TOKEN: 'ghp_abc',
  GITHUB_OWNER: 'acme',
  GITHUB_REPO: 'repo',
};

function setEnv(vars: Record<string, string>) {
  for (const [k, v] of Object.entries(vars)) process.env[k] = v;
}

function clearEnv() {
  for (const k of Object.keys(REQUIRED)) delete process.env[k];
  delete process.env.TELEGRAM_ALLOWED_USERS;
  delete process.env.NOTE_ALLOWED_PATHS;
  delete process.env.NOTE_ALLOWED_EXTENSIONS;
  delete process.env.NOTE_SHORTCUTS;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.MEETING_NOTES_FOLDER;
}

describe('loadConfig', () => {
  beforeEach(clearEnv);
  afterEach(clearEnv);

  it('throws listing all missing required vars', () => {
    expect(() => loadConfig()).toThrow(/TELEGRAM_BOT_TOKEN.*TELEGRAM_GROUP_ID.*GITHUB_TOKEN.*GITHUB_OWNER.*GITHUB_REPO/s);
  });

  it('throws listing only missing vars when some are set', () => {
    setEnv({ TELEGRAM_BOT_TOKEN: 'x', TELEGRAM_GROUP_ID: 'y', GITHUB_TOKEN: 'z' });
    expect(() => loadConfig()).toThrow(/GITHUB_OWNER/);
    expect(() => loadConfig()).not.toThrow(/TELEGRAM_BOT_TOKEN/);
  });

  it('returns config when all required vars are set', () => {
    setEnv(REQUIRED);
    const config = loadConfig();
    expect(config.telegram.botToken).toBe('token123');
    expect(config.telegram.groupId).toBe('-100123456');
    expect(config.github.owner).toBe('acme');
    expect(config.github.defaultBranch).toBe('main');
  });

  it('parses TELEGRAM_ALLOWED_USERS as trimmed array', () => {
    setEnv({ ...REQUIRED, TELEGRAM_ALLOWED_USERS: 'alice, bob ,charlie' });
    const config = loadConfig();
    expect(config.telegram.allowedUsers).toEqual(['alice', 'bob', 'charlie']);
  });

  it('parses NOTE_SHORTCUTS into a record', () => {
    setEnv({ ...REQUIRED, NOTE_SHORTCUTS: 'i=docs/brand_ideas.md,m=docs/meeting-notes.md' });
    const config = loadConfig();
    expect(config.note.shortcuts).toEqual({
      i: 'docs/brand_ideas.md',
      m: 'docs/meeting-notes.md',
    });
  });

  it('applies defaults for optional vars', () => {
    setEnv(REQUIRED);
    const config = loadConfig();
    expect(config.note.allowedPaths).toEqual(['docs']);
    expect(config.note.allowedExtensions).toEqual(['md', 'txt']);
    expect(config.behavior.summaryMaxDays).toBe(7);
    expect(config.behavior.squashEnabled).toBe(true);
    expect(config.ai.anthropicModel).toBe('claude-sonnet-4-5');
    expect(config.meeting.notesFolder).toBe('meetings');
  });

  it('reads MEETING_NOTES_FOLDER env var', () => {
    setEnv({ ...REQUIRED, MEETING_NOTES_FOLDER: 'custom/meetings' });
    const config = loadConfig();
    expect(config.meeting.notesFolder).toBe('custom/meetings');
  });
});
