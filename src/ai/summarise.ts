import type { AIProvider, UsageContext } from '../types.js';

// Char budget per AI chunk. Kept well under the model's 24k-token context window:
// even token-dense content (~2 chars/token) stays under ~20k input tokens, leaving
// room for the response. Asset/binary diffs are stripped upstream (filterDiffForSummary).
export const MAX_DIFF_CHARS = 40_000;

export const SUMMARY_PROMPT = (language: string, authorLogin: string): string =>
  `Summarise the following git commits by @${authorLogin} in 2-3 sentences. Be direct and specific: state what was built, fixed, or changed. Do not evaluate the work, add opinions, or suggest reviews. Respond in ${language}.`;

export const HIGH_LEVEL_SUMMARY_PROMPT = (language: string, authorLogin: string): string =>
  `Give a brief, HIGH-LEVEL summary of what @${authorLogin} worked on, in 1-2 sentences. Focus on the overall themes and direction of their work — not a list of individual changes or technical details. Do not evaluate the work or add opinions. Respond in ${language}.`;

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

  const consolidationSentences = highLevel ? '1-2 sentences' : '3–5 sentences';
  const consolidationPrompt = `Consolidate the following partial summaries about @${authorLogin} into a single cohesive ${highLevel ? 'high-level ' : ''}summary of ${consolidationSentences}. Respond in ${language}.`;
  return provider.summarise(consolidationPrompt, chunkSummaries.join('\n\n'), undefined, ctx);
}
