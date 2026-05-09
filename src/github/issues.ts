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
): Promise<{ number: number; nodeId: string }> {
  const { data } = await octokit.issues.create({
    owner: config.github.owner,
    repo: config.github.repo,
    title: params.title,
    assignees: [params.assignee],
    labels: params.label ? [params.label] : [],
  });
  return { number: data.number, nodeId: data.node_id };
}

interface ProjectsQueryResult {
  repository: {
    projectsV2: {
      nodes: Array<{ id: string; title: string }>;
    };
  };
}

export async function findRepoProject(
  octokit: Octokit,
  config: Config,
): Promise<{ id: string; title: string } | null> {
  const result = await octokit.graphql<ProjectsQueryResult>(
    `query($owner: String!, $repo: String!) {
      repository(owner: $owner, name: $repo) {
        projectsV2(first: 10) {
          nodes { id title }
        }
      }
    }`,
    { owner: config.github.owner, repo: config.github.repo },
  );
  const nodes = result.repository.projectsV2.nodes;
  return nodes.length === 1 ? nodes[0] : null;
}

export async function addIssueToProject(
  octokit: Octokit,
  projectId: string,
  issueNodeId: string,
): Promise<void> {
  await octokit.graphql(
    `mutation($projectId: ID!, $contentId: ID!) {
      addProjectV2ItemById(input: { projectId: $projectId, contentId: $contentId }) {
        item { id }
      }
    }`,
    { projectId, contentId: issueNodeId },
  );
}
