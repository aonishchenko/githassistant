import path from 'path';

export type NoteArgsResult =
  | { form: 'A'; filePath: string; noteText: string }
  | { form: 'B'; shortcutKey: string; noteText: string }
  | { form: 'C'; noteText: string };

export function parseNoteArgs(text: string, shortcuts: Record<string, string>): NoteArgsResult {
  const trimmed = text.trim();
  if (!trimmed) return { form: 'C', noteText: '' };

  const spaceIdx = trimmed.indexOf(' ');
  const firstToken = spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx);
  const rest = spaceIdx === -1 ? '' : trimmed.slice(spaceIdx + 1).trim();

  if (firstToken in shortcuts) {
    return { form: 'B', shortcutKey: firstToken, noteText: rest };
  }

  // Always treat the first token as a potential filename.
  // note.ts falls back to the full-picker Form C if no matching file is found.
  return { form: 'A', filePath: firstToken, noteText: rest };
}

export function validateNotePath(
  filePath: string,
  allowedPaths: string[],
  allowedExtensions: string[],
): string | null {
  if (!allowedExtensions.includes('*')) {
    const ext = path.extname(filePath).slice(1).toLowerCase();
    if (!allowedExtensions.includes(ext)) {
      return `File extension ".${ext}" is not allowed. Allowed extensions: ${allowedExtensions.map(e => `.${e}`).join(', ')}.`;
    }
  }

  const resolved = path.normalize(filePath);
  const isAllowed = allowedPaths.some(allowed => {
    const normalizedAllowed = path.normalize(allowed);
    return resolved === normalizedAllowed || resolved.startsWith(normalizedAllowed + path.sep);
  });

  if (!isAllowed) {
    return `That path is not in an accessible folder. Allowed roots: ${allowedPaths.join(', ')}.`;
  }

  return null;
}
