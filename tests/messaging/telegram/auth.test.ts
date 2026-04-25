import { describe, it, expect } from 'vitest';
import { isInAllowlist } from '../../../src/messaging/telegram/auth.js';

describe('isInAllowlist', () => {
  it('returns true when username is in allowlist', () => {
    expect(isInAllowlist('alice', ['alice', 'bob'])).toBe(true);
  });

  it('returns false when username is not in allowlist', () => {
    expect(isInAllowlist('charlie', ['alice', 'bob'])).toBe(false);
  });

  it('returns false for empty allowlist', () => {
    expect(isInAllowlist('alice', [])).toBe(false);
  });
});
