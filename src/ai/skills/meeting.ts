import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import type { AIProvider } from '../../types.js';

const MEETING_SUMMARY_MAX_TOKENS = 4096;

function loadSkill(): string {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const skillPath = resolve(__dirname, '../../../.claude/skills/meeting-transcription-summarizer.md');
  return readFileSync(skillPath, 'utf-8');
}

let cachedSkill: string | undefined;

function getSkill(): string {
  if (!cachedSkill) cachedSkill = loadSkill();
  return cachedSkill;
}

export async function summariseMeeting(
  provider: AIProvider,
  transcript: string,
): Promise<string> {
  return provider.summarise(getSkill(), transcript, MEETING_SUMMARY_MAX_TOKENS);
}
