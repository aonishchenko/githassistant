import { describe, it, expect } from 'vitest';
import { parseNoteArgs, validateNotePath } from '../../src/commands/note-resolver.js';

const shortcuts: Record<string, string> = { i: 'docs/ideas.md', m: 'docs/meetings.md' };
const allowedPaths = ['docs'];
const allowedExtensions = ['md', 'txt'];

describe('parseNoteArgs', () => {
  it('detects Form B when first token is a known shortcut', () => {
    const result = parseNoteArgs('i My note here', shortcuts);
    expect(result).toEqual({ form: 'B', shortcutKey: 'i', noteText: 'My note here' });
  });

  it('detects Form A when first token contains a slash', () => {
    const result = parseNoteArgs('docs/notes.md Sprint review notes', shortcuts);
    expect(result).toEqual({ form: 'A', filePath: 'docs/notes.md', noteText: 'Sprint review notes' });
  });

  it('detects Form A when first token ends with .md', () => {
    const result = parseNoteArgs('notes.md My note', shortcuts);
    expect(result).toEqual({ form: 'A', filePath: 'notes.md', noteText: 'My note' });
  });

  it('detects Form A when first token ends with .txt', () => {
    const result = parseNoteArgs('log.txt entry text', shortcuts);
    expect(result).toEqual({ form: 'A', filePath: 'log.txt', noteText: 'entry text' });
  });

  it('detects Form A for a bare word (potential filename, falls back in note.ts if no match)', () => {
    const result = parseNoteArgs('some rrrr', shortcuts);
    expect(result).toEqual({ form: 'A', filePath: 'some', noteText: 'rrrr' });
  });

  it('detects Form A for any first token even without extension', () => {
    const result = parseNoteArgs('meeting Sprint recap', shortcuts);
    expect(result).toEqual({ form: 'A', filePath: 'meeting', noteText: 'Sprint recap' });
  });

  it('detects Form C when text is empty', () => {
    const result = parseNoteArgs('', shortcuts);
    expect(result).toEqual({ form: 'C', noteText: '' });
  });
});

describe('validateNotePath', () => {
  it('accepts a path under an allowed root', () => {
    expect(validateNotePath('docs/notes.md', allowedPaths, allowedExtensions)).toBeNull();
  });

  it('rejects a path outside allowed roots', () => {
    expect(validateNotePath('secrets/passwords.md', allowedPaths, allowedExtensions)).toMatch(/not in an accessible folder/);
  });

  it('rejects path traversal attempts', () => {
    expect(validateNotePath('docs/../secrets/pw.md', allowedPaths, allowedExtensions)).toMatch(/not in an accessible folder/);
  });

  it('rejects disallowed file extensions', () => {
    expect(validateNotePath('docs/file.js', allowedPaths, allowedExtensions)).toMatch(/extension/i);
  });

  it('allows any extension when * is configured', () => {
    expect(validateNotePath('docs/file.js', allowedPaths, ['*'])).toBeNull();
    expect(validateNotePath('docs/data.csv', allowedPaths, ['*'])).toBeNull();
    expect(validateNotePath('docs/image.png', allowedPaths, ['*'])).toBeNull();
  });
});
