export function formatNoteAppend(text: string, username: string, date: Date = new Date()): string {
  const iso = date.toISOString().replace(/:\d{2}\.\d{3}Z$/, 'Z');
  return `\n<!-- note: ${iso} | @${username} -->\n${text}\n`;
}

// Telegram rejects messages longer than 4096 chars; stay safely under it.
const TG_MAX_CHARS = 4000;

/**
 * Send `text` via `send`, splitting into multiple messages when it exceeds
 * Telegram's per-message limit. Splits at newline/space boundaries so HTML
 * tags (which sit on their own short header lines here) stay balanced.
 */
export async function sendLong(text: string, send: (t: string) => Promise<void>): Promise<void> {
  if (text.length <= TG_MAX_CHARS) {
    await send(text);
    return;
  }
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= TG_MAX_CHARS) {
      await send(remaining);
      break;
    }
    const slice = remaining.slice(0, TG_MAX_CHARS);
    const cut = Math.max(slice.lastIndexOf('\n'), slice.lastIndexOf(' '));
    const end = cut > TG_MAX_CHARS / 2 ? cut : TG_MAX_CHARS;
    await send(remaining.slice(0, end));
    remaining = remaining.slice(end).trimStart();
  }
}

export interface AuthorSummary {
  authorLogin: string;
  summary: string;
  files: string[];
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function formatSummaryMessage(period: string, summaries: AuthorSummary[]): string {
  if (summaries.length === 0) return `No commits found in the ${period}.`;

  const lines = [`📋 <b>Project summary — ${escapeHtml(period)}</b>`];
  for (const { authorLogin, summary, files } of summaries) {
    lines.push('', `👤 <b>@${escapeHtml(authorLogin)}</b>`, escapeHtml(summary));
    if (files.length > 0) {
      const shown = files.slice(0, 10).map(f => `• <code>${escapeHtml(f)}</code>`);
      if (files.length > 10) {
        shown.push(`<i>…and ${files.length - 10} more (${files.length} files total)</i>`);
      }
      lines.push('', ...shown);
    }
  }
  return lines.join('\n');
}

export interface AuthorReleaseNotes {
  authorLogin: string;
  notes: string;
}

export function formatReleaseNotesMessage(period: string, perAuthor: AuthorReleaseNotes[]): string {
  if (perAuthor.length === 0) return `No commits found in the ${period}.`;

  const lines = [`🚀 <b>Release notes — ${escapeHtml(period)}</b>`];
  for (const { authorLogin, notes } of perAuthor) {
    lines.push('', `👤 <b>@${escapeHtml(authorLogin)}</b>`, escapeHtml(notes.trim()));
  }
  return lines.join('\n');
}

