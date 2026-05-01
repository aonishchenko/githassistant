# GitHAssistant

> Your GitHub project, fully alive in Telegram — notes committed, work summarised, history cleaned up, meetings digested. All from chat.

A Telegram bot that keeps your GitHub project documented, summarised, and tidy — automatically. Add it to your team group and it becomes a silent, always-on member that never forgets to write things down.

---

## What you get out of the box

| | |
|---|---|
| 📝 **Instant notes** | Send a thought in Telegram, it's committed to your repo in seconds |
| 📊 **Daily digest** | Every morning: a plain-English summary of who did what, posted automatically |
| 🗂️ **Clean history** | Nightly squash keeps your commit log readable without losing any work |
| 🎙️ **Meeting summaries** | Drop a transcript, get back exec summary + action items + full topic breakdown |

---

## Why GitHAssistant?

**Working on a project with your team in a Telegram group?**

GitHAssistant connects your Telegram group directly to your GitHub repository. No context-switching, no web UI — everything through chat. It turns your casual group conversation into a well-documented, well-organised project record.

---

**Capture ideas without leaving Telegram.**
On the go, commuting, mid-meeting — have a decision or idea you want on record? Send it to the bot and it commits the note straight to the right file in your repo.

```
/note i New brand direction: wordmark only, drop the icon.
/note docs/meeting-notes.md Agreed to deprecate the v1 API by end of Q2.
```

The bot finds the file automatically. Use shortcuts, partial names, or just let it show you a picker.

---

**See who did what, automatically.**
Want a plain-language summary of your team's GitHub contributions for the last day — or any period? The bot fetches the commits, reads the diffs, and asks Claude to explain the changes in human language, one block per author.

```
/summary       → last 24 hours
/summary 3d    → last 3 days
/summary 1w    → last week
```

Every night the bot posts the daily digest automatically without anyone having to ask.

---

**Never lose what was said in a meeting.**
Store meeting transcripts in a folder in your repo. The bot reads each transcript, runs it through a structured AI analysis, and saves back a full summary with an executive overview, a table of action items with owners and deadlines, and a detailed breakdown by discussion topic.

```
/meeting-summary                         → pick a transcript from the folder
/meeting-summary 2026-04-28-standup.md   → summarise one specific meeting
/meeting-summary 1w                      → summarise all meetings from the last week
```

Already summarised? The bot won't regenerate — it reuses the existing file. Summaries are committed back to your repo alongside the transcripts, so your whole team can find them without digging through chat history.

---

**Clean up noisy commit history.**
Does someone on the team push a dozen small commits per day? `/squash` merges all of an author's commits for the selected period into one tidy commit per person, keeping the history readable without losing any changes.

```
/squash        → squash last 24 hours
/squash 3d     → squash last 3 days
```

The nightly job also runs this automatically so the history stays clean without manual effort.

---

## Setup

```bash
cp .env.example .env
# Fill in all required values (see .env.example for descriptions)
npm install
npm run dev      # tsx watch mode for local development
```

## Required Environment Variables

The following must be set or the process exits with a descriptive error:

- `TELEGRAM_BOT_TOKEN` — From BotFather
- `TELEGRAM_GROUP_ID` — Numeric group/supergroup ID (bot must be a member)
- `GITHUB_TOKEN` — Fine-grained PAT: Contents Read+Write, Metadata Read
- `GITHUB_OWNER` — Repository owner (user or org)
- `GITHUB_REPO` — Repository name
- `ANTHROPIC_API_KEY` — From console.anthropic.com (separate from claude.ai, billed by token usage)

All variables with defaults are documented in `.env.example`.

## Optional Environment Variables

| Variable | Default | Description |
|---|---|---|
| `MEETING_NOTES_FOLDER` | `meetings` | GitHub folder path containing meeting transcripts |
| `NOTE_ALLOWED_PATHS` | `docs` | Comma-separated folders `/note` can write to |
| `NOTE_SHORTCUTS` | _(none)_ | Comma-separated `key=path` shortcuts, e.g. `i=docs/ideas.md` |
| `NIGHTLY_CRON` | `0 2 * * *` | Cron expression for nightly jobs |
| `TIMEZONE` | `UTC` | Timezone for nightly job scheduling |
| `SUMMARY_MAX_DAYS` | `7` | Maximum period window for `/summary` and `/meeting-summary` |
| `SQUASH_ENABLED` | `true` | Set to `false` to disable the nightly squash job |

## Commands

| Command | Auth | Description |
|---|---|---|
| `/note [file\|shortcut] <text>` | Required | Append a note to a repo file |
| `/summary [period]` | None | AI-generated summary of recent commits by author |
| `/squash [period]` | Required | Squash multiple commits into one per author |
| `/meeting-summary [file\|period]` | Required | Summarise meeting transcript(s) from the meetings folder |
| `/help` | None | Show command reference |

**Auth** means the sender must be in `TELEGRAM_ALLOWED_USERS` or a group admin.

**Period formats** (applies to `/summary`, `/squash`, and `/meeting-summary`): none (last 24h), `3d`, `1w`, `2025-04-20`

### /note forms

The bot finds the right file automatically:

- **Full path:** `/note docs/meeting-notes.md Sprint recap.`
- **Filename only:** `/note meeting-notes.md Sprint recap.` — searches all allowed paths; if one match, uses it silently
- **Bare name (no extension):** `/note meeting Sprint recap.` — matches `docs/meeting.md` or `docs/drive/meeting` by basename
- **Shortcut:** `/note i New idea.` — resolves via `NOTE_SHORTCUTS` config
- **No path:** `/note Sprint recap.` — shows inline file picker; tap a file to append

### /meeting-summary forms

- **No args:** `/meeting-summary` — shows a picker of all transcript files in `MEETING_NOTES_FOLDER`
- **Filename:** `/meeting-summary 2026-04-28-standup-transcript.md` — summarise one file
- **Period:** `/meeting-summary 1w` — summarise all transcripts from the last week (skips any that already have a summary)

Summary files are saved next to the transcript in `MEETING_NOTES_FOLDER`. Naming: `*-transcript.md` → `*-summary.md`; other filenames get `-summary` appended before the extension.

Period filtering uses dates embedded in the filename (e.g. `2026-04-28-standup.md`) and falls back to the file's creation date in git history.

## Nightly Jobs

Both jobs run automatically at `NIGHTLY_CRON` (default 02:00 UTC):

- **Squash** — merges each author's commits from the previous calendar day into one commit per author on `GITHUB_DEFAULT_BRANCH`
- **Daily summary** — posts a per-author AI narrative digest of yesterday's changes to the group

Set `SQUASH_ENABLED=false` to disable squash while keeping the digest running.

## Deployment (Render.com)

- Service type: **Background Worker**
- Build command: `npm ci && npm run build`
- Start command: `node dist/index.js`
- Set env vars via Render dashboard — never commit `.env`

## Manual Job Triggers

```bash
npm run job:squash    # Run nightly squash job immediately
npm run job:summary   # Run daily summary job immediately
```

## Manual Test Checklist

### /note
- [ ] Full path: `/note docs/meeting-notes.md Sprint recap.`
- [ ] Filename only, one match: `/note meeting-notes.md Sprint recap.`
- [ ] Filename only, multiple matches: shows inline keyboard to pick file
- [ ] Bare name (no extension), one match: `/note meeting Sprint recap.`
- [ ] Bare name, no match: shows full file picker with note stored
- [ ] Shortcut: `/note i New logo direction.`
- [ ] No path: `/note We agreed to deprecate the API.`
- [ ] No path, no text: `/note` → select file → bot asks for text
- [ ] Rejected path: `/note secrets/pw.md text` → "not in an accessible folder"
- [ ] Unauthorised user → "You don't have permission to use this command."

### /summary
- [ ] `/summary` → last 24h digest
- [ ] `/summary 3d` → 3-day digest
- [ ] `/summary 1w` → 7-day digest
- [ ] `/summary 2025-04-20` → since ISO date
- [ ] `/summary 100d` → "Maximum summary window is N days"
- [ ] AI fallback: set invalid API key → falls back to plain commit list with note

### /squash
- [ ] `/squash` → squash last 24h until now
- [ ] `/squash 3d` → squash last 3 days
- [ ] `/squash 2025-04-20` → squash since ISO date
- [ ] Nothing to squash (each author has 1 commit) → confirmation message
- [ ] Unauthorised user → "You don't have permission to use this command."

### /meeting-summary
- [ ] `/meeting-summary` → shows transcript picker (summary files excluded from list)
- [ ] `/meeting-summary <filename>` → generates and commits summary
- [ ] `/meeting-summary <filename>` (summary already exists) → "already exists" message, no new file
- [ ] `/meeting-summary 1w` → generates summaries for all transcripts in last week, skips existing ones
- [ ] `/meeting-summary` → select from picker → summary generated and committed
- [ ] File not found → "File not found: `<filename>`."
- [ ] Unauthorised user → "You don't have permission to use this command."

### Nightly Jobs (manual trigger)
- [ ] `npm run job:squash` → ✅ or "nothing to squash" message appears in Telegram
- [ ] `npm run job:summary` → daily digest posted in Telegram group
- [ ] Squash revert: use `git reflog` to find the pre-squash tip, then `git push --force origin <sha>:main` to restore

## Architecture

Three subsystems wired at startup:

1. **Config** — validates env vars at boot, exits with descriptive error on missing vars
2. **Messaging** — `TelegramAdapter` wraps Telegraf, handles group-only filtering, rate limiting (10 cmd/min per user), and inline keyboard state for `/note` and `/meeting-summary` file pickers
3. **Scheduler** — node-cron runs squash + daily summary jobs nightly at `NIGHTLY_CRON` (default 02:00 UTC)

AI skills live in `.claude/skills/` as plain Markdown files and are loaded at runtime — swap or edit a skill file to change how the AI behaves without touching code.

All command and job logic receives dependencies via injection — no Telegraf context leaks into business logic.
