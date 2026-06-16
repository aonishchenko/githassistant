import type { AIProvider, UsageContext } from '../../types.js';
import { chunkText, MAX_DIFF_CHARS } from '../summarise.js';
import { loadSkill, renderSkill } from './loader.js';

export interface ReleaseNotesEntry {
  authorLogin: string;
  notes: string;
}

// Char budget per AI chunk — shared with summarise.ts (model context-window limit).
const RELEASE_NOTES_MAX_CHARS = MAX_DIFF_CHARS;

export const RELEASE_NOTES_PROMPT = (authorLogin: string, period: string): string =>
  renderSkill('release-notes', { author: authorLogin, period });

const EXTRACT_PROMPT = loadSkill('release-notes-extract');

const SECTION_HEADER_RE = /^\s*(✨|🐛|🔧)/;

/**
 * True when a bullet is a "nothing to report" placeholder rather than a real item.
 * Catches both parenthesised forms — "(no notable fixes)" — and full sentences like
 * "No bugs were fixed in this release." / "No major changes were made.", without
 * dropping genuine items such as "No longer crashes on startup".
 */
function isEmptyPlaceholderLine(line: string): boolean {
  const t = line.trim().replace(/^[*\-+•]\s*/, '').trim();
  if (!t) return false;
  if (/^\(\s*no\b[^)]*\)\.?$/i.test(t)) return true;                                  // (no notable fixes)
  if (/^(no|none|nothing)\b[\s\S]*\b(were|was|made|reported|to report)\b/i.test(t)) return true; // No bugs were fixed / No ... changes were made
  if (/^(no|none|nothing)\b[\s\S]*\bin this (release|period|update)\b/i.test(t)) return true;     // No ... in this release
  if (/^(none|n\/a|nothing to report)\.?$/i.test(t)) return true;
  return false;
}

/**
 * Drop any release-note section whose only content is a placeholder, in case the
 * model emits empty sections despite the prompt.
 */
export function stripEmptyReleaseNoteSections(notes: string): string {
  const lines = notes.split('\n');
  const out: string[] = [];
  let i = 0;
  while (i < lines.length && !SECTION_HEADER_RE.test(lines[i])) {
    out.push(lines[i]);
    i++;
  }
  while (i < lines.length) {
    const header = lines[i];
    const body: string[] = [];
    i++;
    while (i < lines.length && !SECTION_HEADER_RE.test(lines[i])) {
      body.push(lines[i]);
      i++;
    }
    const hasRealItem = body.some(l => l.trim() !== '' && !isEmptyPlaceholderLine(l));
    if (hasRealItem) out.push(header, ...body);
  }
  const cleaned = out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return cleaned || '(no notable changes)';
}

/**
 * Generate per-author release notes from their commits (each entry = message + diff).
 * Chunks and consolidates when the combined text exceeds the context budget.
 */
export async function summariseReleaseNotes(
  provider: AIProvider,
  authorLogin: string,
  period: string,
  commitBlocks: string[],
  ctx?: UsageContext,
): Promise<string> {
  const combined = commitBlocks.join('\n\n---\n\n');
  const prompt = RELEASE_NOTES_PROMPT(authorLogin, period);

  if (combined.length <= RELEASE_NOTES_MAX_CHARS) {
    return stripEmptyReleaseNoteSections(await provider.summarise(prompt, combined, 4096, ctx));
  }

  const chunks = chunkText(combined, RELEASE_NOTES_MAX_CHARS);
  const extractions = await Promise.all(
    chunks.map(chunk => provider.summarise(EXTRACT_PROMPT, chunk, 2048, ctx)),
  );
  return stripEmptyReleaseNoteSections(await provider.summarise(prompt, extractions.join('\n\n'), 4096, ctx));
}

/**
 * Generate release notes for each author. `authorBlocks` maps an author login to
 * their list of commit blocks (each block = commit message + filtered diff).
 * Failures per author degrade gracefully to a placeholder rather than aborting.
 *
 * When `delayMs <= 0` (interactive use) the authors are processed in parallel for
 * speed. When `delayMs > 0` (background cron) they run sequentially with that
 * delay between authors to pace the AI provider.
 */
export async function generatePerAuthorReleaseNotes(
  provider: AIProvider,
  period: string,
  authorBlocks: Map<string, string[]>,
  ctx: UsageContext | undefined,
  log: { error: (obj: object, msg?: string) => void },
  delayMs = 0,
): Promise<ReleaseNotesEntry[]> {
  const entries = [...authorBlocks.entries()];

  const generate = async (authorLogin: string, blocks: string[]): Promise<ReleaseNotesEntry> => {
    try {
      const notes = await summariseReleaseNotes(provider, authorLogin, period, blocks, ctx);
      return { authorLogin, notes };
    } catch (err) {
      log.error({ err, authorLogin }, 'release notes generation failed');
      return { authorLogin, notes: '(release notes unavailable)' };
    }
  };

  if (delayMs <= 0) {
    return Promise.all(entries.map(([authorLogin, blocks]) => generate(authorLogin, blocks)));
  }

  const result: ReleaseNotesEntry[] = [];
  for (let i = 0; i < entries.length; i++) {
    if (i > 0) await new Promise(resolve => setTimeout(resolve, delayMs));
    result.push(await generate(entries[i][0], entries[i][1]));
  }
  return result;
}
