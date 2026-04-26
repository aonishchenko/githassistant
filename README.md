# GitHAssistant

A Telegram bot that keeps your GitHub project documented, summarised, and tidy — automatically.

## Why GitHAssistant?

**Working on a project with your team in a Telegram group?**

GitHAssistant connects your Telegram group directly to your GitHub repository. No context-switching, no web UI — everything through chat.

---

**Capture ideas without leaving Telegram.**
Are you on the go (AFK, commuting, in a meeting) and have ideas or decisions you want recorded in your project documentation? Just send a message to the bot and it commits the note straight to the right file in your repo.

```
/note i New brand direction: wordmark only, drop the icon.
/note docs/meeting-notes.md Agreed to deprecate the v1 API by end of Q2.
```

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

## Commands

| Command | Auth | Description |
|---|---|---|
| `/note [file\|shortcut] <text>` | Required | Append a note to a repo file |
| `/summary [period]` | None | AI-generated summary of recent commits by author |
| `/squash [period]` | Required | Squash multiple commits into one per author |
| `/help` | None | Show command reference |

**Auth** means the sender must be in `TELEGRAM_ALLOWED_USERS` or a group admin.

**Period formats** (applies to `/summary` and `/squash`): none (last 24h), `3d`, `1w`, `2025-04-20`

### /note forms

The bot finds the right file automatically:

- **Full path:** `/note docs/meeting-notes.md Sprint recap.`
- **Filename only:** `/note meeting-notes.md Sprint recap.` — searches all allowed paths; if one match, uses it silently
- **Bare name (no extension):** `/note meeting Sprint recap.` — matches `docs/meeting.md` or `docs/drive/meeting` by basename
- **Shortcut:** `/note i New idea.` — resolves via `NOTE_SHORTCUTS` config
- **No path:** `/note Sprint recap.` — shows inline file picker; tap a file to append

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

### Nightly Jobs (manual trigger)
- [ ] `npm run job:squash` → ✅ or "nothing to squash" message appears in Telegram
- [ ] `npm run job:summary` → daily digest posted in Telegram group
- [ ] Squash revert: use `git reflog` to find the pre-squash tip, then `git push --force origin <sha>:main` to restore

## Architecture

Three subsystems wired at startup:

1. **Config** — validates env vars at boot, exits with descriptive error on missing vars
2. **Messaging** — `TelegramAdapter` wraps Telegraf, handles group-only filtering, rate limiting (10 cmd/min per user), and inline keyboard state for `/note` file picker
3. **Scheduler** — node-cron runs squash + daily summary jobs nightly at `NIGHTLY_CRON` (default 02:00 UTC)

All command and job logic receives dependencies via injection — no Telegraf context leaks into business logic.
