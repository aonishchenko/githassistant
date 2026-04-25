import type { Octokit } from '@octokit/rest';
import type { Config } from '../types.js';

export interface FileContent {
  content: string;
  sha: string;
}

export async function getFile(
  octokit: Octokit,
  config: Config,
  path: string,
): Promise<FileContent | null> {
  try {
    const { data } = await octokit.repos.getContent({
      owner: config.github.owner,
      repo: config.github.repo,
      path,
      ref: config.github.defaultBranch,
    });
    const file = data as { type: string; content: string; sha: string };
    if (file.type !== 'file') return null;
    return {
      content: Buffer.from(file.content, 'base64').toString('utf-8'),
      sha: file.sha,
    };
  } catch (err: unknown) {
    if (typeof err === 'object' && err !== null && 'status' in err && (err as { status: number }).status === 404) {
      return null;
    }
    throw err;
  }
}

export async function writeFile(
  octokit: Octokit,
  config: Config,
  path: string,
  content: string,
  message: string,
  existingSha?: string,
): Promise<void> {
  await octokit.repos.createOrUpdateFileContents({
    owner: config.github.owner,
    repo: config.github.repo,
    path,
    message,
    content: Buffer.from(content, 'utf-8').toString('base64'),
    sha: existingSha,
    branch: config.github.defaultBranch,
  });
}

export async function listFiles(
  octokit: Octokit,
  config: Config,
  allowedPaths: string[],
): Promise<string[]> {
  const results: string[] = [];
  for (const dir of allowedPaths) {
    await collectFiles(octokit, config, dir, results);
  }
  return results;
}

async function collectFiles(
  octokit: Octokit,
  config: Config,
  path: string,
  results: string[],
): Promise<void> {
  try {
    const { data } = await octokit.repos.getContent({
      owner: config.github.owner,
      repo: config.github.repo,
      path,
      ref: config.github.defaultBranch,
    });
    const items = Array.isArray(data) ? data : [data];
    for (const item of items as Array<{ type: string; path: string }>) {
      if (item.type === 'file') {
        results.push(item.path);
      } else if (item.type === 'dir') {
        await collectFiles(octokit, config, item.path, results);
      }
    }
  } catch {
    // directory not found — skip
  }
}
