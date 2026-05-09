import type { AIProvider, UsageContext } from '../../types.js';
import type { GitHubLabel } from '../../github/issues.js';

const PROMPT = `You are a GitHub issue labeller. Given a list of issue titles and available labels, assign the single most appropriate label to each issue.

Return ONLY a JSON array of strings (label names) or nulls, one per issue, in the same order. No explanation, no markdown, just the JSON array.

Example: ["bug", null, "enhancement"]

If no label fits an issue, use null.`;

export async function assignLabels(
  provider: AIProvider,
  titles: string[],
  labels: GitHubLabel[],
  ctx?: UsageContext,
): Promise<(string | null)[]> {
  if (labels.length === 0) return titles.map(() => null);

  const labelList = labels
    .map(l => `- ${l.name}${l.description ? `: ${l.description}` : ''}`)
    .join('\n');

  const content = `Available labels:\n${labelList}\n\nIssue titles:\n${titles.map((t, i) => `${i + 1}. ${t}`).join('\n')}`;

  try {
    const response = await provider.summarise(PROMPT, content, 256, ctx);
    const match = response.match(/\[[\s\S]*\]/);
    if (!match) return titles.map(() => null);
    const parsed = JSON.parse(match[0]) as (string | null)[];
    if (!Array.isArray(parsed) || parsed.length !== titles.length) return titles.map(() => null);
    return parsed.map(l => (typeof l === 'string' ? l : null));
  } catch {
    return titles.map(() => null);
  }
}
