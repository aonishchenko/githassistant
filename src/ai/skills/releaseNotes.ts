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
- Output ONLY the section headers (with their emoji) and bullets. No preamble, no title, no closing remarks.
- If there is genuinely nothing user-relevant to report, output exactly: (no notable changes)`;

const EXTRACT_PROMPT = `Extract the notable changes from this portion of an author's git commits (messages + diffs): new features, enhancements, bug fixes, and any major infrastructure/backend changes. Be concise but do not omit anything user-relevant. Ignore trivial changes (formatting, lint, test-only, dependency bumps).`;

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
    return provider.summarise(prompt, combined, 4096, ctx);
  }

  const chunks = chunkText(combined, RELEASE_NOTES_MAX_CHARS);
  const extractions = await Promise.all(
    chunks.map(chunk => provider.summarise(EXTRACT_PROMPT, chunk, 2048, ctx)),
  );
  return provider.summarise(prompt, extractions.join('\n\n'), 4096, ctx);
}

/**
 * Generate release notes for each author. `authorBlocks` maps an author login to
 * their list of commit blocks (each block = commit message + filtered diff).
 * Failures per author degrade gracefully to a placeholder rather than aborting.
 */
export async function generatePerAuthorReleaseNotes(
  provider: AIProvider,
  period: string,
  authorBlocks: Map<string, string[]>,
  ctx: UsageContext | undefined,
  log: { error: (obj: object, msg?: string) => void },
  delayMs = 0,
): Promise<ReleaseNotesEntry[]> {
  const result: ReleaseNotesEntry[] = [];
  const entries = [...authorBlocks.entries()];
  for (let i = 0; i < entries.length; i++) {
    const [authorLogin, blocks] = entries[i];
    if (i > 0 && delayMs > 0) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
    try {
      const notes = await summariseReleaseNotes(provider, authorLogin, period, blocks, ctx);
      result.push({ authorLogin, notes });
    } catch (err) {
      log.error({ err, authorLogin }, 'release notes generation failed');
      result.push({ authorLogin, notes: '(release notes unavailable)' });
    }
  }
  return result;
}
