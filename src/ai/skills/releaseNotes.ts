import type { AIProvider, UsageContext } from '../../types.js';
import { chunkText, MAX_DIFF_CHARS } from '../summarise.js';

export interface ReleaseNotesEntry {
  authorLogin: string;
  notes: string;
}

// Char budget per AI chunk — shared with summarise.ts (model context-window limit).
const RELEASE_NOTES_MAX_CHARS = MAX_DIFF_CHARS;

export const RELEASE_NOTES_PROMPT = (authorLogin: string, period: string): string =>
  `You are writing release notes for the work done by @${authorLogin} during ${period}, based on their git commits (commit messages and code diffs below).

Produce a concise bullet list of what changed, focused on what matters to USERS of the product. Organize into these sections, and OMIT any section that has no items:

✨ New & Improved
- New features and enhancements to existing features, described from the user's perspective (what they can now do).

🐛 Fixes
- Bugs fixed, each described as the problem that is now resolved.

🔧 Behind the scenes
- ONLY major infrastructure, backend, or architecture changes worth highlighting. Skip routine refactors, dependency bumps, formatting, test-only changes, and minor internal tweaks.

Rules:
- Each bullet is ONE clear, plain-language sentence. No file names, no commit hashes, no code identifiers, no jargon.
- Focus on user-visible impact. Group several related commits into a single bullet rather than listing each commit.
- Omit trivial changes entirely.
- If a section has no items, OMIT THE ENTIRE SECTION — both its emoji header and any bullets. NEVER output a placeholder like "(no notable fixes)" or "(no notable changes)" under a header.
- Output ONLY the section headers (with their emoji) and bullets. No preamble, no title, no closing remarks.
- If there is genuinely nothing user-relevant to report at all, output exactly: (no notable changes)`;

const EXTRACT_PROMPT = `Extract the notable changes from this portion of an author's git commits (messages + diffs): new features, enhancements, bug fixes, and any major infrastructure/backend changes. Be concise but do not omit anything user-relevant. Ignore trivial changes (formatting, lint, test-only, dependency bumps).`;

const SECTION_HEADER_RE = /^\s*(✨|🐛|🔧)/;
const PLACEHOLDER_RE = /\(\s*no\b[^)]*\)/i;

/**
 * Drop any release-note section whose only content is a "(no notable …)"
 * placeholder, in case the model emits empty sections despite the prompt.
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
    const hasRealItem = body.some(l => {
      const t = l.trim();
      return t !== '' && !PLACEHOLDER_RE.test(t);
    });
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
