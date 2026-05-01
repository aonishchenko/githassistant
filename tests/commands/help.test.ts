import { describe, it, expect, vi } from 'vitest';
import type { Config, AdapterContext } from '../../src/types.js';
import { createHelpPlugin } from '../../src/commands/help.js';

const config: Config = {
  telegram: { botToken: '', groupId: '', allowedUsers: [] },
  github: { token: '', owner: '', repo: '', defaultBranch: 'main' },
  note: { allowedPaths: ['docs'], shortcuts: { i: 'docs/ideas.md', m: 'docs/meetings.md' }, allowedExtensions: ['md'] },
  ai: { provider: 'anthropic', anthropicApiKey: '', anthropicModel: '' },
  scheduler: { nightlyCron: '', timezone: 'UTC' },
  behavior: { summaryMaxDays: 7, squashEnabled: true, summaryLanguage: 'en', logLevel: 'info', rateLimitPerMin: 10 },
  meeting: { notesFolder: 'meetings' },
};

function makeCtx(replyText = vi.fn()): AdapterContext {
  return {
    userId: '1', username: 'alice', text: '',
    replyText,
    showOptions: vi.fn(),
    setPendingNote: vi.fn(),
    getPendingNote: vi.fn(),
    clearPendingNote: vi.fn(),
  };
}

describe('createHelpPlugin', () => {
  it('registers as /help with no auth required', () => {
    const plugin = createHelpPlugin(config);
    expect(plugin.command).toBe('help');
    expect(plugin.requiresAuth).toBe(false);
  });

  it('replies with command reference including configured shortcuts', async () => {
    const replyText = vi.fn();
    const plugin = createHelpPlugin(config);
    await plugin.handler(makeCtx(replyText));
    expect(replyText).toHaveBeenCalledTimes(1);
    const msg = replyText.mock.calls[0][0] as string;
    expect(msg).toContain('/note');
    expect(msg).toContain('/summary');
    expect(msg).toContain('/help');
    expect(msg).toContain('i → docs/ideas.md');
    expect(msg).toContain('m → docs/meetings.md');
  });

  it('omits shortcut section when no shortcuts configured', async () => {
    const noShortcutsConfig = { ...config, note: { ...config.note, shortcuts: {} } };
    const replyText = vi.fn();
    const plugin = createHelpPlugin(noShortcutsConfig);
    await plugin.handler(makeCtx(replyText));
    const msg = replyText.mock.calls[0][0] as string;
    expect(msg).not.toContain('Shortcuts');
  });
});
