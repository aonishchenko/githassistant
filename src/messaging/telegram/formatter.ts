import type { GitHubCommit } from '../../types.js';

export function formatNoteAppend(text: string, username: string, date: Date = new Date()): string {
  const iso = date.toISOString().replace(/:\d{2}\.\d{3}Z$/, 'Z');
  return `\n<!-- note: ${iso} | @${username} -->\n${text}\n`;
}

export interface AuthorSummary {
  authorLogin: string;
  summary: string;
}

export function formatSummaryMessage(period: string, summaries: AuthorSummary[]): string {
  if (summaries.length === 0) return `No commits found in the ${period}.`;

  const lines = [`📋 *Project summary — ${period}*`];
  for (const { authorLogin, summary } of summaries) {
    lines.push('', `👤 *@${authorLogin}*`, summary);
  }
  return lines.join('\n');
}

export function formatSquashCommitMessage(
  authorLogin: string,
  dateStr: string,
  commits: GitHubCommit[],
): string {
  const bullets = commits.map(c => `- ${c.message} (${c.shortSha})`).join('\n');
  return `daily(@${authorLogin}): ${commits.length} changes on ${dateStr}\n\n${bullets}`;
}
