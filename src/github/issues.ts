import type { Octokit } from '@octokit/rest';
import type { Config } from '../types.js';

export interface GitHubLabel {
  name: string;
  description: string | null;
}

export interface GitHubIssue {
  number: number;
  title: string;
}

export async function listLabels(octokit: Octokit, config: Config): Promise<GitHubLabel[]> {
  const data = await octokit.paginate(octokit.issues.listLabelsForRepo, {
    owner: config.github.owner,
    repo: config.github.repo,
    per_page: 100,
  });
  return data.map(l => ({ name: l.name, description: l.description ?? null }));
}

export async function listOpenIssues(octokit: Octokit, config: Config): Promise<GitHubIssue[]> {
  const data = await octokit.paginate(octokit.issues.listForRepo, {
    owner: config.github.owner,
    repo: config.github.repo,
    state: 'open',
    per_page: 100,
  });
  return data.map(i => ({ number: i.number, title: i.title }));
}

export async function createIssue(
  octokit: Octokit,
  config: Config,
  params: { title: string; assignee: string; label: string | null },
): Promise<number> {
  const { data } = await octokit.issues.create({
    owner: config.github.owner,
    repo: config.github.repo,
    title: params.title,
    assignees: [params.assignee],
    labels: params.label ? [params.label] : [],
  });
  return data.number;
}
