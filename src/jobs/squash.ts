import type { Octokit } from '@octokit/rest';
import type { Logger } from 'pino';
import type { Config, MessagingAdapter, JobPlugin, GitHubCommit, AuthorCommitGroup } from '../types.js';
import { fetchCommits, createCommit, updateBranchRef } from '../github/commits.js';

export function groupByAuthor(commits: GitHubCommit[]): AuthorCommitGroup[] {
  const map = new Map<string, GitHubCommit[]>();
  for (const commit of commits) {
    const existing = map.get(commit.authorLogin) ?? [];
    existing.push(commit);
    map.set(commit.authorLogin, existing);
  }
  return Array.from(map.entries()).map(([authorLogin, commits]) => ({ authorLogin, commits }));
}

export function groupConsecutiveRuns(commits: GitHubCommit[]): AuthorCommitGroup[] {
  if (commits.length === 0) return [];
  const runs: AuthorCommitGroup[] = [];
  let currentAuthor = commits[0].authorLogin;
  let currentRun: GitHubCommit[] = [commits[0]];
  for (let i = 1; i < commits.length; i++) {
    if (commits[i].authorLogin === currentAuthor) {
      currentRun.push(commits[i]);
    } else {
      runs.push({ authorLogin: currentAuthor, commits: currentRun });
      currentAuthor = commits[i].authorLogin;
      currentRun = [commits[i]];
    }
  }
  runs.push({ authorLogin: currentAuthor, commits: currentRun });
  return runs;
}

export interface SquashWindow {
  since: Date;
  until: Date;
  dateStr: string;
}

// Convert a YYYY-MM-DD date string at midnight in `timezone` to a UTC Date.
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

export function buildTodayWindow(timezone: string, now: Date = new Date()): SquashWindow {
  const dateStr = new Intl.DateTimeFormat('sv-SE', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
  const since = toUTCMidnight(dateStr, timezone);
  return { since, until: now, dateStr };
}

export function buildYesterdayWindow(timezone: string, now: Date = new Date()): SquashWindow {
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

export function buildWindowUntilNow(since: Date, now: Date = new Date()): SquashWindow {
  const dateStr = `${since.toISOString().slice(0, 10)} → now`;
  return { since, until: now, dateStr };
}

export function buildSquashMessage(authorLogin: string, dateStr: string, commits: GitHubCommit[]): string {
  const sorted = [...commits].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  const bullets = sorted.map(c => `- ${c.message} (${c.shortSha})`).join('\n');
  return `daily(@${authorLogin}): ${commits.length} changes on ${dateStr}\n\n${bullets}`;
}

export async function runSquash(
  octokit: Octokit,
  config: Config,
  window: SquashWindow,
  send: (msg: string) => Promise<void>,
): Promise<void> {
  const { since, until, dateStr } = window;

  let commits: GitHubCommit[];
  try {
    const all = await fetchCommits(octokit, config, since, until);
    commits = all.filter(c => !/^daily\(@/.test(c.message));
  } catch (err: unknown) {
    await send(`❌ Squash failed: could not fetch commits. ${(err as Error).message}`);
    return;
  }

  if (commits.length === 0) {
    await send(`No commits on ${dateStr} — nothing to squash.`);
    return;
  }

  const allSorted = [...commits].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  const oldest = allSorted[0];
  const baseSha = oldest.parentShas[0];

  if (!baseSha) {
    await send(`❌ Squash aborted: cannot squash the first commit on the branch.`);
    return;
  }

  const groups = groupConsecutiveRuns(allSorted);

  const needsSquash = groups.some(g => g.commits.length > 1);
  if (!needsSquash) {
    await send(`✅ Nothing to squash on ${dateStr} — each author had only 1 commit.`);
    return;
  }

  let prevSha = baseSha;
  let squashedCount = 0;
  let authorsSquashed = 0;

  try {
    for (const group of groups) {
      const sortedGroupCommits = [...group.commits].sort(
        (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
      );
      const lastCommit = sortedGroupCommits[sortedGroupCommits.length - 1];

      let message: string;
      if (group.commits.length === 1) {
        message = group.commits[0].message;
      } else {
        message = buildSquashMessage(group.authorLogin, dateStr, sortedGroupCommits);
        squashedCount += group.commits.length;
        authorsSquashed++;
      }

      prevSha = await createCommit(octokit, config, {
        message,
        treeSha: lastCommit.treeSha,
        parentSha: prevSha,
      });
    }

    await updateBranchRef(octokit, config, prevSha);
    await send(`✅ Squashed ${squashedCount} commits from ${authorsSquashed} author(s) on ${dateStr}.`);
  } catch (err: unknown) {
    await send(
      `❌ Squash failed mid-way on ${dateStr}. Branch may be in a partially rewritten state. ` +
      `Error: ${(err as Error).message}. Please check branch history manually.`,
    );
  }
}

export function createSquashJob(
  octokit: Octokit,
  config: Config,
  adapter: MessagingAdapter,
  log?: Logger,
  buildWindow: () => SquashWindow = () => buildTodayWindow(config.scheduler.timezone),
): JobPlugin {
  return {
    name: 'squash',
    handler: async () => {
      if (!config.behavior.squashEnabled) return;
      const window = buildWindow();
      log?.info({ dateStr: window.dateStr }, 'squash job started');
      await runSquash(octokit, config, window, async msg => {
        log?.info({ msg }, 'squash job result');
        await adapter.sendMessage(msg);
      });
    },
  };
}

// Standalone entry point for `npm run job:squash`
const isMain = process.argv[1]?.endsWith('squash.ts') || process.argv[1]?.endsWith('squash.js');
if (isMain) {
  const { loadConfig } = await import('../config.js');
  const { Octokit } = await import('@octokit/rest');
  const { TelegramAdapter } = await import('../messaging/telegram/index.js');
  const { default: pino } = await import('pino');
  const config = loadConfig();
  const log = pino({ level: config.behavior.logLevel });
  const octokit = new Octokit({ auth: config.github.token });
  const adapter = new TelegramAdapter(config, log);
  createSquashJob(octokit, config, adapter, log).handler().catch((err: unknown) => {
    log.error(err);
    process.exit(1);
  });
}
