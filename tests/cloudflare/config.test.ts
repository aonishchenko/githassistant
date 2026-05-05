/// <reference types="@cloudflare/workers-types" />
import { describe, it, expect } from 'vitest';
import { loadCFConfig } from '../../src/platforms/cloudflare/config.js';
import type { CloudflareEnv } from '../../src/platforms/cloudflare/config.js';

const baseEnv: CloudflareEnv = {
  GITHASSISTANT_KV: {} as KVNamespace,
  TELEGRAM_BOT_TOKEN: 'tok',
  TELEGRAM_GROUP_ID: '-100123',
  GITHUB_TOKEN: 'ghp_test',
  GITHUB_OWNER: 'owner',
  GITHUB_REPO: 'repo',
};

describe('loadCFConfig', () => {
  it('returns a valid Config from required env bindings', () => {
    const config = loadCFConfig(baseEnv);
    expect(config.telegram.botToken).toBe('tok');
    expect(config.telegram.groupId).toBe('-100123');
    expect(config.github.token).toBe('ghp_test');
    expect(config.github.owner).toBe('owner');
    expect(config.github.repo).toBe('repo');
  });

  it('applies defaults for optional fields', () => {
    const config = loadCFConfig(baseEnv);
    expect(config.github.defaultBranch).toBe('main');
    expect(config.note.allowedPaths).toEqual(['docs']);
    expect(config.ai.provider).toBe('openai');
    expect(config.behavior.summaryMaxDays).toBe(7);
    expect(config.behavior.squashEnabled).toBe(true);
    expect(config.scheduler.nightlyCron).toBe('0 2 * * *');
  });

  it('parses TELEGRAM_ALLOWED_USERS into an array', () => {
    const config = loadCFConfig({ ...baseEnv, TELEGRAM_ALLOWED_USERS: 'alice,bob' });
    expect(config.telegram.allowedUsers).toEqual(['alice', 'bob']);
  });

  it('parses NOTE_SHORTCUTS into a record', () => {
    const config = loadCFConfig({ ...baseEnv, NOTE_SHORTCUTS: 'i=docs/ideas.md,m=docs/meeting.md' });
    expect(config.note.shortcuts).toEqual({ i: 'docs/ideas.md', m: 'docs/meeting.md' });
  });

  it('infers anthropic provider when ANTHROPIC_API_KEY is set and AI_PROVIDER is absent', () => {
    const config = loadCFConfig({ ...baseEnv, ANTHROPIC_API_KEY: 'sk-ant-test' });
    expect(config.ai.provider).toBe('anthropic');
    expect(config.ai.anthropicApiKey).toBe('sk-ant-test');
  });

  it('throws when required secrets are missing', () => {
    const env = { ...baseEnv, TELEGRAM_BOT_TOKEN: undefined as unknown as string };
    expect(() => loadCFConfig(env)).toThrow('TELEGRAM_BOT_TOKEN');
  });
});
