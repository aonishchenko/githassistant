import type { AIProvider, UsageContext } from '../types.js';
import { renderSkill } from './skills/loader.js';

// Char budget per AI chunk. Kept well under the model's 24k-token context window:
// even token-dense content (~2 chars/token) stays under ~20k input tokens, leaving
// room for the response. Asset/binary diffs are stripped upstream (filterDiffForSummary).
export const MAX_DIFF_CHARS = 40_000;

export const SUMMARY_PROMPT = (language: string, authorLogin: string): string =>
  renderSkill('commit-summary', { author: authorLogin, language });

export const HIGH_LEVEL_SUMMARY_PROMPT = (language: string, authorLogin: string): string =>
  renderSkill('commit-summary-highlevel', { author: authorLogin, language });

export function chunkText(text: string, maxChars: number): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    chunks.push(text.slice(start, start + maxChars));
    start += maxChars;
  }
  return chunks;
}

export async function summariseAuthorDiffs(
  provider: AIProvider,
  diffs: string[],
  language: string,
  authorLogin: string,
  ctx?: UsageContext,
  highLevel = false,
): Promise<string> {
  const combined = diffs.join('\n\n---\n\n');
  const prompt = highLevel
    ? HIGH_LEVEL_SUMMARY_PROMPT(language, authorLogin)
    : SUMMARY_PROMPT(language, authorLogin);

  if (combined.length <= MAX_DIFF_CHARS) {
    return provider.summarise(prompt, combined, undefined, ctx);
  }

  const chunks = chunkText(combined, MAX_DIFF_CHARS);
  const chunkSummaries = await Promise.all(
    chunks.map(chunk => provider.summarise(prompt, chunk, undefined, ctx)),
  );

  if (chunkSummaries.length === 1) return chunkSummaries[0];

  const consolidationPrompt = renderSkill(
    highLevel ? 'commit-summary-consolidate-highlevel' : 'commit-summary-consolidate',
    { author: authorLogin, language },
  );
  return provider.summarise(consolidationPrompt, chunkSummaries.join('\n\n'), undefined, ctx);
}
