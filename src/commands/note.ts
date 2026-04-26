import path from 'path';
import type { Octokit } from '@octokit/rest';
import type { Config, CommandPlugin, CallbackHandler } from '../types.js';
import { parseNoteArgs, validateNotePath } from './note-resolver.js';
import { getFile, writeFile, listFiles } from '../github/files.js';

export function createNotePlugin(
  octokit: Octokit,
  config: Config,
): { plugin: CommandPlugin; callbackHandler: CallbackHandler } {
  const plugin: CommandPlugin = {
    command: 'note',
    description: 'Append a note to a project file',
    requiresAuth: true,
    handler: async (ctx) => {
      const args = parseNoteArgs(ctx.text, config.note.shortcuts);

      if (args.form === 'B') {
        const filePath = config.note.shortcuts[args.shortcutKey];
        await appendNoteToFile(octokit, config, filePath, args.noteText, ctx.username);
        await ctx.replyText(`✅ Note appended to \`${filePath}\`.`);
        return;
      }

      if (args.form === 'A') {
        const candidate = args.filePath;
        const fullText = args.noteText ? `${candidate} ${args.noteText}` : candidate;

        if (!candidate.includes('/')) {
          const allFiles = await listFiles(octokit, config, config.note.allowedPaths);
          const matches = allFiles.filter(f =>
            path.basename(f) === candidate ||
            path.basename(f, path.extname(f)) === candidate,
          );
          if (matches.length === 1) {
            const err = validateNotePath(matches[0], config.note.allowedPaths, config.note.allowedExtensions);
            if (err) { await ctx.replyText(err); return; }
            await appendNoteToFile(octokit, config, matches[0], args.noteText, ctx.username);
            await ctx.replyText(`✅ Note appended to \`${matches[0]}\`.`);
            return;
          }
          if (matches.length > 1) {
            ctx.setPendingNote(args.noteText);
            await ctx.showOptions('Multiple files found. Choose one:', matches.slice(0, 20).map(f => ({
              label: f, callbackData: `note_file:${f}`,
            })));
            return;
          }
          // No file match — treat full text as note and show picker
          if (allFiles.length === 0) {
            await ctx.replyText(`No files found in allowed paths: ${config.note.allowedPaths.join(', ')}.`);
            return;
          }
          ctx.setPendingNote(fullText);
          await ctx.showOptions('Choose a file to append your note to:', allFiles.sort().slice(0, 20).map(f => ({
            label: f, callbackData: `note_file:${f}`,
          })));
          return;
        }

        const err = validateNotePath(candidate, config.note.allowedPaths, config.note.allowedExtensions);
        if (err) { await ctx.replyText(err); return; }
        await appendNoteToFile(octokit, config, candidate, args.noteText, ctx.username);
        await ctx.replyText(`✅ Note appended to \`${candidate}\`.`);
        return;
      }

      // Form C — list all files
      const allFiles = await listFiles(octokit, config, config.note.allowedPaths);
      if (allFiles.length === 0) {
        await ctx.replyText(`No files found in allowed paths: ${config.note.allowedPaths.join(', ')}.`);
        return;
      }
      const options = allFiles.sort().slice(0, 20).map(f => ({ label: f, callbackData: `note_file:${f}` }));
      ctx.setPendingNote(args.noteText);
      await ctx.showOptions('Choose a file to append your note to:', options);
    },
  };

  const callbackHandler: CallbackHandler = async (ctx) => {
    await ctx.answerCallback();
    const filePath = ctx.callbackData.replace(/^note_file:/, '');
    const noteText = ctx.getPendingNote();
    ctx.clearPendingNote();

    if (!noteText) {
      await ctx.replyText(`Selected \`${filePath}\`. Please send your note text with: /note ${filePath} <text>`);
      return;
    }

    const err = validateNotePath(filePath, config.note.allowedPaths, config.note.allowedExtensions);
    if (err) { await ctx.replyText(err); return; }

    await appendNoteToFile(octokit, config, filePath, noteText, ctx.username);
    await ctx.replyText(`✅ Note appended to \`${filePath}\`.`);
  };

  return { plugin, callbackHandler };
}

async function appendNoteToFile(
  octokit: Octokit,
  config: Config,
  filePath: string,
  noteText: string,
  username: string,
): Promise<void> {
  const existing = await getFile(octokit, config, filePath);
  const header = `# ${path.basename(filePath, path.extname(filePath))}\n`;
  const currentContent = existing?.content ?? header;
  const appended = currentContent + `\n${noteText}\n`;
  const commitMsg = `note(@${username}): ${filePath}`;
  await writeFile(octokit, config, filePath, appended, commitMsg, existing?.sha);
}
