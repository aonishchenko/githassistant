import type { AIProvider } from '../types.js';

const MAX_DIFF_CHARS = 80_000;

export const SUMMARY_PROMPT = (language: string, authorLogin: string): string =>
  `Summarise the following git changes made by @${authorLogin} in plain language, as if explaining to a colleague. Refer to the author by their username @${authorLogin}. Focus on what changed and why it matters. Do not list file names or statistics. Keep it to 3–5 sentences. Respond in ${language}.`;

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
): Promise<string> {
  const combined = diffs.join('\n\n---\n\n');
  const prompt = SUMMARY_PROMPT(language, authorLogin);

  if (combined.length <= MAX_DIFF_CHARS) {
    return provider.summarise(prompt, combined);
  }

  const chunks = chunkText(combined, MAX_DIFF_CHARS);
  const chunkSummaries = await Promise.all(
    chunks.map(chunk => provider.summarise(prompt, chunk)),
  );

  if (chunkSummaries.length === 1) return chunkSummaries[0];

  const consolidationPrompt = `Consolidate the following partial summaries about @${authorLogin} into a single cohesive summary of 3–5 sentences. Respond in ${language}.`;
  return provider.summarise(consolidationPrompt, chunkSummaries.join('\n\n'));
}
