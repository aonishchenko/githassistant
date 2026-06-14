export interface TimeWindow {
  since: Date;
  until: Date;
  dateStr: string;
}

function toUTCMidnight(dateStr: string, timezone: string): Date {
  const utcApprox = new Date(`${dateStr}T00:00:00.000Z`);
  const localTimeParts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).formatToParts(utcApprox);
  const localHour = parseInt(localTimeParts.find(p => p.type === 'hour')!.value, 10);
  const localMin = parseInt(localTimeParts.find(p => p.type === 'minute')!.value, 10);
  const localSec = parseInt(localTimeParts.find(p => p.type === 'second')!.value, 10);
  const localSecsFromMidnight = localHour * 3600 + localMin * 60 + localSec;
  return new Date(utcApprox.getTime() - localSecsFromMidnight * 1000);
}

export function buildTodayWindow(timezone: string, now: Date = new Date()): TimeWindow {
  const dateStr = new Intl.DateTimeFormat('sv-SE', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
  const since = toUTCMidnight(dateStr, timezone);
  return { since, until: now, dateStr };
}

export function buildYesterdayWindow(timezone: string, now: Date = new Date()): TimeWindow {
  const dateFmt = new Intl.DateTimeFormat('sv-SE', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const todayStr = dateFmt.format(now);
  const yesterdayStr = dateFmt.format(new Date(now.getTime() - 24 * 60 * 60 * 1000));
  const since = toUTCMidnight(yesterdayStr, timezone);
  const until = toUTCMidnight(todayStr, timezone);
  return { since, until, dateStr: yesterdayStr };
}

export function buildWindowUntilNow(since: Date, now: Date = new Date()): TimeWindow {
  const dateStr = `${since.toISOString().slice(0, 10)} → now`;
  return { since, until: now, dateStr };
}

/** True when `now` falls on the given wall-clock hour (0-23) in `timeZone`. */
export function isLocalHour(timeZone: string, hour: number, now: Date = new Date()): boolean {
  const localHour = parseInt(
    new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hour12: false }).format(now),
    10,
  );
  return localHour === hour;
}
