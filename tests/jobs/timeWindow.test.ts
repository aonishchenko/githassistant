import { describe, it, expect } from 'vitest';
import { isLocalHour } from '../../src/jobs/timeWindow.js';

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
