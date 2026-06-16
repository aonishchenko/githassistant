import type { AIProvider, UsageContext } from '../../types.js';
import type { GitHubLabel } from '../../github/issues.js';
import { loadSkill } from './loader.js';

const PROMPT = loadSkill('issue-labels');

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
