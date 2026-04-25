# GitHAssistant

A Telegram bot that keeps your GitHub project documented, summarised, and tidy — automatically.

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

All variables with defaults are documented in `.env.example`.

## Commands

| Command | Auth | Description |
|---|---|---|
| `/note [file\|shortcut] <text>` | Required | Append a timestamped note to a repo file |
| `/summary [period]` | None | AI-generated summary of recent commits |
| `/help` | None | Show command reference |

**Auth** means the sender must be in `TELEGRAM_ALLOWED_USERS` or a group admin.

**Period formats for `/summary`:** none (last 24h), `3d`, `1w`, `2025-04-20`

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
- [ ] Form A — full path: `/note docs/meeting-notes.md Sprint recap.`
- [ ] Form A — filename only, one match: `/note meeting-notes.md Sprint recap.`
- [ ] Form A — filename only, multiple matches: shows inline keyboard to pick file
- [ ] Form B — shortcut: `/note i New logo direction.`
- [ ] Form C — no path: `/note We agreed to deprecate the API.`
- [ ] Form C — no path, no text: `/note` then select file, then bot asks for text
- [ ] Rejected path: `/note secrets/pw.md text` → "not in an accessible folder"
- [ ] Unauthorised user → "You don't have permission to use this command."

### /summary
- [ ] `/summary` → last 24h digest
- [ ] `/summary 3d` → 3-day digest
- [ ] `/summary 1w` → 7-day digest
- [ ] `/summary 2025-04-20` → since ISO date
- [ ] `/summary 100d` → "Maximum summary window is N days"
- [ ] AI fallback: set invalid API key → falls back to plain commit list with note

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
