import { Octokit } from '@octokit/rest';
import type { Config } from '../types.js';

let _instance: Octokit | null = null;

export function getOctokit(config: Config): Octokit {
  if (!_instance) {
    _instance = new Octokit({ auth: config.github.token });
  }
  return _instance;
}

export function resetOctokit(): void {
  _instance = null;
}
