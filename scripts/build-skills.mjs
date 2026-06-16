#!/usr/bin/env node
// Bundles the LLM-agnostic prompt files in /skills into a TypeScript module the app
// imports. Needed because Cloudflare Workers can't read the filesystem at runtime, and
// there is no single ".md as text" import that works across tsx, esbuild, and vitest.
// Run via `npm run skills:build` (also hooked into prebuild / pretest / cf:deploy).
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const skillsDir = join(root, 'skills');
const outFile = join(root, 'src/ai/skills/skills.generated.ts');

const files = readdirSync(skillsDir).filter(f => f.endsWith('.md')).sort();
const skills = {};
for (const file of files) {
  const name = basename(file, '.md');
  skills[name] = readFileSync(join(skillsDir, file), 'utf8').replace(/\r\n/g, '\n').trimEnd();
}

const banner =
  '// AUTO-GENERATED from skills/*.md by scripts/build-skills.mjs — DO NOT EDIT.\n' +
  '// Edit the .md files in /skills and run `npm run skills:build`.\n\n';
const body =
  `export const SKILLS = ${JSON.stringify(skills, null, 2)} as const;\n\n` +
  'export type SkillName = keyof typeof SKILLS;\n';

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, banner + body);
console.log(`Bundled ${files.length} skills -> ${outFile.slice(root.length + 1)}`);
