export function formatNoteAppend(text: string, username: string, date: Date = new Date()): string {
  const iso = date.toISOString().replace(/:\d{2}\.\d{3}Z$/, 'Z');
  return `\n<!-- note: ${iso} | @${username} -->\n${text}\n`;
}

export interface AuthorSummary {
  authorLogin: string;
  summary: string;
  files: string[];
}

export function formatSummaryMessage(period: string, summaries: AuthorSummary[]): string {
  if (summaries.length === 0) return `No commits found in the ${period}.`;

  const lines = [`📋 *Project summary — ${period}*`];
  for (const { authorLogin, summary, files } of summaries) {
    lines.push('', `👤 *@${authorLogin}*`, summary);
    if (files.length > 0) {
      const shown = files.slice(0, 10).map(f => `• \`${f}\``);
      if (files.length > 10) {
        shown.push(`_…and ${files.length - 10} more (${files.length} files total)_`);
      }
      lines.push('', ...shown);
    }
  }
  return lines.join('\n');
}

