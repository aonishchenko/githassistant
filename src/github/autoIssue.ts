import type { Octokit } from '@octokit/rest';
import type { Logger } from 'pino';
import type { Config, AIProvider, UsageContext } from '../types.js';
import { listLabels, listOpenIssues, createIssue, findRepoProject, addIssueToProject } from './issues.js';
import { assignLabels } from '../ai/skills/labels.js';

export interface ActionItem {
  owner: string;
  action: string;
}

export function parseActionItems(summary: string): ActionItem[] {
  const items: ActionItem[] = [];
  const lines = summary.split('\n');
  let inSection = false;
  let pastHeader = false;

  for (const line of lines) {
    if (/^##\s+Action Items/i.test(line)) {
      inSection = true;
      continue;
    }
    if (inSection) {
      if (/^##\s/.test(line)) break;
      if (!line.startsWith('|')) continue;

      const cols = line.split('|').slice(1, -1).map(c => c.trim());

      if (cols[0] === '#') { pastHeader = true; continue; }
      if (cols[0].startsWith('-') || cols[0].startsWith('=')) continue;
      if (!pastHeader) continue;

      const owner = cols[1];
      const action = cols[2];
      if (owner && action) items.push({ owner, action });
    }
  }

  return items;
}

export async function autoIssueFromSummary(
  summary: string,
  config: Config,
  octokit: Octokit,
  aiProvider: AIProvider,
  log: Logger,
  usageCtx: UsageContext,
): Promise<{ login: string; number: number; title: string }[]> {
  if (config.meeting.autoIssueOwners.length === 0) return [];

  const actionItems = parseActionItems(summary);
  if (actionItems.length === 0) return [];

  const ownerMap = new Map(
    config.meeting.autoIssueOwners.map(({ name, login }) => [name.toLowerCase().trim(), login]),
  );

  const matched = actionItems
    .map(item => ({ ...item, login: ownerMap.get(item.owner.toLowerCase().trim()) }))
    .filter((item): item is ActionItem & { login: string } => !!item.login);

  if (matched.length === 0) return [];

  let labels: Awaited<ReturnType<typeof listLabels>> = [];
  let existingIssues: Awaited<ReturnType<typeof listOpenIssues>> = [];
  try {
    [labels, existingIssues] = await Promise.all([
      listLabels(octokit, config),
      listOpenIssues(octokit, config),
    ]);
  } catch (err) {
    log.error({ err }, 'autoIssue: failed to fetch labels or existing issues');
    return [];
  }

  const existingTitles = new Set(existingIssues.map(i => i.title.toLowerCase()));
  const toCreate = matched.filter(item => !existingTitles.has(item.action.toLowerCase()));

  if (toCreate.length === 0) return [];

  const assignedLabels = await assignLabels(aiProvider, toCreate.map(i => i.action), labels, usageCtx);

  let project: { id: string; title: string } | null = null;
  try {
    project = await findRepoProject(octokit, config);
  } catch (err) {
    log.warn({ err }, 'autoIssue: failed to find project');
  }

  const created: { login: string; number: number; title: string }[] = [];

  for (let i = 0; i < toCreate.length; i++) {
    try {
      const { number, nodeId } = await createIssue(octokit, config, {
        title: toCreate[i].action,
        assignee: toCreate[i].login,
        label: assignedLabels[i],
      });
      created.push({ login: toCreate[i].login, number, title: toCreate[i].action });
      if (project) {
        try {
          await addIssueToProject(octokit, project.id, nodeId);
        } catch (err) {
          log.warn({ err, number }, 'autoIssue: failed to add issue to project');
        }
      }
    } catch (err) {
      log.error({ err, title: toCreate[i].action }, 'autoIssue: failed to create issue');
    }
  }

  return created;
}
