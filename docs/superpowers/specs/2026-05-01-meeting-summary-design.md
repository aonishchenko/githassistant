# Meeting Summary Feature — Design Spec

**Date:** 2026-05-01  
**Status:** Approved

---

## Overview

Add a `/meeting-summary` Telegram command that reads meeting transcript files from a configured GitHub folder, generates structured summaries using the meeting transcription skill, and stores the summaries back in the same GitHub folder. Summaries are only generated once — existing summary files are reused.

---

## New Files

```
.claude/skills/
  meeting-transcription-summarizer.md   # SKILL.md verbatim — the AI prompt source

src/ai/skills/
  meeting.ts                            # Reads skill file, exposes summariseMeeting()

src/commands/
  meeting-summary.ts                    # /meeting-summary command plugin
```

---

## Config Changes

### New env var
| Var | Default | Description |
|-----|---------|-------------|
| `MEETING_NOTES_FOLDER` | `meetings` | GitHub folder path containing transcript files |

### `Config` type (types.ts)
Add a `meeting` section:
```typescript
meeting: {
  notesFolder: string;
};
```

### `config.ts`
Read `MEETING_NOTES_FOLDER` (optional, defaults to `"meetings"`), add to `meeting.notesFolder`.

---

## AI Skill: `src/ai/skills/meeting.ts`

- Reads `.claude/skills/meeting-transcription-summarizer.md` at runtime using `fs.readFileSync`
- Exports `summariseMeeting(provider: AIProvider, transcript: string): Promise<string>`
- Calls `provider.summarise(skillContent, transcript)` — one AI call, full structured output (Executive Summary + Action Items + Discussion Topics)
- Throws if skill file is missing

---

## Command: `/meeting-summary`

**Auth:** Required — uses `withAuth` wrapper (same as `/note`).  
**Registration:** Added in `commands/registry.ts`.

### Argument parsing

| Input | Behaviour |
|-------|-----------|
| No args | List all transcript files in `MEETING_NOTES_FOLDER`, show inline keyboard (one file per row) |
| `<filename>` | Summarize that specific file; skip if summary already exists |
| `<period>` (`3d`, `1w`, `YYYY-MM-DD`) | Find all transcripts in that period; generate missing summaries; skip existing ones; post results |

Period parsing reuses the existing `parsePeriod()` from `commands/summary.ts`.

**Distinguishing filename vs period:** try `parsePeriod()` first; if it throws, treat the argument as a filename.

### Transcript file detection

Files in `MEETING_NOTES_FOLDER` are considered transcripts if they end in `.md` or `.txt` AND are not themselves summary files (i.e., basename does not end with `-summary` before the extension).

### Period filtering

1. Extract a `YYYY-MM-DD` date from the filename (regex scan — any occurrence)
2. If no date found in filename, fetch the file's **creation date** from GitHub: call `octokit.repos.listCommits({ path, direction: 'asc', per_page: 1 })` and use the date of the first (oldest) commit that touched the file
3. Include the file if its resolved date falls within the period window

### Summary file naming

| Transcript filename | Summary filename |
|--------------------|-----------------|
| `2026-04-28-standup-transcript.md` | `2026-04-28-standup-summary.md` |
| `team-meeting-transcript.txt` | `team-meeting-summary.txt` |
| `kickoff-notes.md` | `kickoff-notes-summary.md` |

Rule: replace the word `transcript` (case-insensitive, whole-word) with `summary` in the basename. If the word `transcript` is not present, append `-summary` before the extension.

### Skip logic

Before generating, check if the summary file already exists in GitHub (`getFile()`). If it exists, skip generation and note it in the reply.

### Reply format

- **Single file:** Post the full summary text inline (Markdown).
- **Period:** Post one message per meeting: filename as header, then the summary. If some were skipped (already existed), list them with a note. If a file was too large or AI failed, note it per file and continue.
- **File picker (no args):** Show inline keyboard; on selection, summarize that file (same as single-file flow).

---

## Summary Storage

Write the generated summary to GitHub using `writeFile()`:
- Path: `<MEETING_NOTES_FOLDER>/<summary-filename>`
- Commit message: `summary(@username): <summary-filename>`
- Branch: `config.github.defaultBranch`

---

## Error Handling

| Scenario | Response |
|----------|----------|
| `MEETING_NOTES_FOLDER` is empty/not found | "No transcript files found in `<folder>`." |
| Specified file not found | "File not found: `<filename>`." |
| Summary already exists (single file) | "Summary already exists: `<summary-filename>`. No changes made." |
| AI call fails | Note the failure per file, continue with remaining files |
| Skill file missing | Throw at startup (or on first use) with clear message |
| Period > `SUMMARY_MAX_DAYS` | Reuse existing error from `parsePeriod()` |

---

## Security

- Path is restricted to `MEETING_NOTES_FOLDER` — no traversal.
- Auth required (same as `/note`).
- Skill file read from project-local path — no user input influences the path.

---

## Callback

Inline keyboard callback action: `meeting_file` — follows the same pattern as `note_file`.

---

## Registration (registry.ts)

```typescript
import { createMeetingSummaryPlugin } from './meeting-summary.js';

const { plugin: meetingPlugin, callbackHandler: meetingCallback } =
  createMeetingSummaryPlugin(octokit, config, aiProvider, log);
adapter.onCommand(meetingPlugin.command, withAuth(meetingPlugin, adapter));
adapter.onCallback('meeting_file', meetingCallback);
```
