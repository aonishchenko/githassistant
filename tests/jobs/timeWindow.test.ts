import { describe, it, expect } from 'vitest';
import { isLocalHour, buildLast24hWindow } from '../../src/jobs/timeWindow.js';

describe('buildLast24hWindow', () => {
  it('spans exactly the 24 hours ending at now, regardless of run time', () => {
    const now = new Date('2026-06-16T08:00:00Z');
    const w = buildLast24hWindow('Europe/Lisbon', now);
    expect(w.since.toISOString()).toBe('2026-06-15T08:00:00.000Z');
    expect(w.until).toBe(now);
  });

  it('dates the window by the local day', () => {
    // 08:00 UTC = 09:00 in Lisbon (summer) — still the 16th
    const w = buildLast24hWindow('Europe/Lisbon', new Date('2026-06-16T08:00:00Z'));
    expect(w.dateStr).toBe('2026-06-16');
  });
});

describe('isLocalHour (Europe/Lisbon, 08:00 target)', () => {
  it('summer (WEST, UTC+1): 07:00 UTC is 08:00 Lisbon', () => {
    expect(isLocalHour('Europe/Lisbon', 8, new Date('2026-06-14T07:00:00Z'))).toBe(true);
  });

  it('summer: 08:00 UTC is 09:00 Lisbon — not 8', () => {
    expect(isLocalHour('Europe/Lisbon', 8, new Date('2026-06-14T08:00:00Z'))).toBe(false);
  });

  it('winter (WET, UTC+0): 08:00 UTC is 08:00 Lisbon', () => {
    expect(isLocalHour('Europe/Lisbon', 8, new Date('2026-01-14T08:00:00Z'))).toBe(true);
  });

  it('winter: 07:00 UTC is 07:00 Lisbon — not 8', () => {
    expect(isLocalHour('Europe/Lisbon', 8, new Date('2026-01-14T07:00:00Z'))).toBe(false);
  });
});
