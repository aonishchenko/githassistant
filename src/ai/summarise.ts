import type { AIProvider, UsageContext } from '../types.js';

const MAX_DIFF_CHARS = 60_000;

export const SUMMARY_PROMPT = (language: string, authorLogin: string): string =>
  `Summarise the following git commits by @${authorLogin} in 2-3 sentences. Be direct and specific: state what was built, fixed, or changed. Do not evaluate the work, add opinions, or suggest reviews. Respond in ${language}.`;

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
): Promise<string> {
  const combined = diffs.join('\n\n---\n\n');
  const prompt = SUMMARY_PROMPT(language, authorLogin);

  if (combined.length <= MAX_DIFF_CHARS) {
    return provider.summarise(prompt, combined, undefined, ctx);
  }

  const chunks = chunkText(combined, MAX_DIFF_CHARS);
  const chunkSummaries = await Promise.all(
    chunks.map(chunk => provider.summarise(prompt, chunk, undefined, ctx)),
  );

  if (chunkSummaries.length === 1) return chunkSummaries[0];

  const consolidationPrompt = `Consolidate the following partial summaries about @${authorLogin} into a single cohesive summary of 3–5 sentences. Respond in ${language}.`;
  return provider.summarise(consolidationPrompt, chunkSummaries.join('\n\n'), undefined, ctx);
}
