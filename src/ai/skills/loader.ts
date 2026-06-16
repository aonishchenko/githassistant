import { SKILLS, type SkillName } from './skills.generated.js';

/** Return a skill prompt verbatim (for skills with no template variables). */
export function loadSkill(name: SkillName): string {
  return SKILLS[name];
}

/** Return a skill prompt with `{{var}}` placeholders replaced from `vars`. */
export function renderSkill(name: SkillName, vars: Record<string, string> = {}): string {
  return SKILLS[name].replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) => vars[key] ?? '');
}

export type { SkillName };
