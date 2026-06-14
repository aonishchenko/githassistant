# GitHAssistant

> Your GitHub project, fully alive in Telegram — notes committed, work summarised, history cleaned up, meetings digested. All from chat.

A Telegram bot that keeps your GitHub project documented, summarised, and tidy — automatically. Add it to your team group and it becomes a silent, always-on member that never forgets to write things down.

---

## What you get out of the box

| | |
|---|---|
| 📝 **Instant notes** | Send a thought in Telegram, it's committed to your repo in seconds |
| 📊 **Daily digest** | Every night: a high-level per-author summary of who did what, plus release notes — posted automatically |
| 🚀 **Release notes** | Per-author, user-facing changelog of features and fixes for any period — on demand or with the daily digest |
| 🔍 **Docs diff viewer** | See exactly what changed in your docs files for any period |
| 🎙️ **Meeting summaries** | Drop a transcript, get back exec summary + action items + full topic breakdown |
| 🎫 **Auto issues** | Action items from meeting summaries become GitHub issues, assigned to the right person and added to your project |
| 💰 **AI usage tracking** | Every AI call is logged to D1 — query token counts and cost by period or user |

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
Want a plain-language summary of your team's GitHub contributions for the last day — or any period? The bot fetches the commits, asks the AI for a factual summary per author, and lists the actual files each person changed.

```
/summary       → last 24 hours
/summary 3d    → last 3 days
/summary 1w    → last week
```

Every night the bot posts the daily digest automatically without anyone having to ask — a high-level per-author summary followed by per-author release notes for the same window.

---

**Turn commits into a user-facing changelog.**
`/releasenotes` reads the commit messages and diffs for a period and produces a per-author changelog focused on what changed for users — grouped into new features & improvements, fixes, and (only when significant) behind-the-scenes/infra changes. Asset and binary diffs (SVGs, images, lockfiles) are stripped so the AI focuses on real changes.

```
/releasenotes        → last 1 day
/releasenotes 2d     → last 2 days
/releasenotes 1w     → last week
```

---

**Never lose what was said in a meeting.**
Store meeting transcripts in a folder in your repo. The bot reads each transcript, runs it through a structured AI analysis, and saves back a full summary with an executive overview, a table of action items with owners and deadlines, and a detailed breakdown by discussion topic.

```
/meetingsummary                         → pick a transcript from the folder
/meetingsummary 2026-04-28-standup.md   → summarise one specific meeting
/meetingsummary 1w                      → summarise all meetings from the last week
```

Already summarised? The bot won't regenerate — it reads the existing summary file and posts it directly to the chat. Summaries are committed back to your repo alongside the transcripts, so your whole team can find them without digging through chat history. Long summaries are automatically split across multiple messages so nothing gets cut off.

**Action items become GitHub issues automatically.** If you configure `AUTO_CREATED_ISSUE_FOR_OWNER_NAMES` / `AUTO_CREATED_ISSUE_FOR_GITHUBNAMES`, every meeting summary turns the action items owned by those people into GitHub issues — assigned to their login, labelled by AI, added to your project, and de-duplicated against existing open issues. Owner names in the action-item table are deterministically expanded to full names (e.g. `John` → `John First`) so matching is reliable even when the model abbreviates.

---

**See exactly what changed in your docs.**
Want to know what was actually written or edited in your docs folder over the last day or week? `/changes` fetches the unified diff for every file in `DOCS_PATH`, so you can see the exact lines added and removed — not just commit messages.

```
/changes                    → all docs files, last 24 hours
/changes 3d                 → all docs files, last 3 days
/changes docs/notes.md      → specific file, last 24 hours
/changes docs/notes.md 1w   → specific file, last week
```

---

## Required Environment Variables

The following must be set or the process exits with a descriptive error:

- `TELEGRAM_BOT_TOKEN` — From BotFather
- `TELEGRAM_GROUP_ID` — Numeric group/supergroup ID (bot must be a member)
- `GITHUB_TOKEN` — Fine-grained PAT (see setup below)
- `GITHUB_OWNER` — Repository owner (user or org)
- `GITHUB_REPO` — Repository name

**AI provider key** — the provider is auto-detected: `anthropic` (if `ANTHROPIC_API_KEY` is set) → `openai` (if `OPENAI_API_KEY` is set) → `cloudflare` (Cloudflare Workers AI, **no key required**). Set one of these only if you want that provider:

- `ANTHROPIC_API_KEY` — From console.anthropic.com (separate from claude.ai, billed by token usage)
- `OPENAI_API_KEY` — From platform.openai.com

> On Cloudflare Workers, if no key is set the bot falls back to the built-in `AI` binding (Workers AI) — so no external AI key is strictly required there. On Node.js/Render you should set one of the keys above.

All variables with defaults are documented in `.env.example`.

### GitHub token setup

Create a **fine-grained personal access token** at GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens:

1. Set **Resource owner** to the org or user that owns the repo (e.g. `empiro-io`)
2. Under **Repository access** → select **Only select repositories** → pick your repo
3. Under **Permissions → Repositories**, add:
   - **Contents** — Read and write (commit notes and summaries, read files)
   - **Issues** — Read and write (`/issueadd` and meeting auto-issues — create and list issues)
   - **Metadata** — Read (required by GitHub for all fine-grained tokens)
4. Under **Permissions → Organizations**, add:
   - **Projects** — Read and write (add created issues to the linked project)
5. Click **Generate token** and copy the value → this is your `GITHUB_TOKEN`

> The Organizations tab only appears when the resource owner is an organisation. If you set resource owner to your personal account and the repo belongs to an org, switch the resource owner to the org.

## Optional Environment Variables

| Variable | Default | Description |
|---|---|---|
| `AI_PROVIDER` | _(auto)_ | AI backend: `anthropic`, `openai`, or `cloudflare`. Auto-detected from whichever key is set (see above) |
| `ANTHROPIC_MODEL` | `claude-sonnet-4-5` | Anthropic model name |
| `OPENAI_MODEL` | `gpt-5.3` | OpenAI model name (used when `AI_PROVIDER=openai`) |
| `CF_AI_MODEL` | `@cf/meta/llama-3.3-70b-instruct-fp8-fast` | Cloudflare Workers AI model (used when `AI_PROVIDER=cloudflare`) |
| `TELEGRAM_ALLOWED_USERS` | _(none)_ | Comma-separated Telegram usernames allowed to run commands (group admins are always allowed) |
| `GITHUB_DEFAULT_BRANCH` | `main` | Branch the bot reads from and commits to |
| `MEETING_NOTES_FOLDER` | `meetings` | GitHub folder path containing meeting transcripts |
| `DOCS_PATH` | `docs` | Comma-separated folders `/note` and `/changes` can access |
| `NOTE_EXCLUDED_PATHS` | _(none)_ | Comma-separated folders excluded from `/note` picker. `MEETING_NOTES_FOLDER` is auto-excluded if it is a subfolder of `DOCS_PATH` |
| `NOTE_SHORTCUTS` | _(none)_ | Comma-separated `key=path` shortcuts, e.g. `i=docs/ideas.md` |
| `NOTE_ALLOWED_EXTENSIONS` | `md,txt` | Comma-separated file extensions `/note` may write (`*` allows any) |
| `AUTO_CREATED_ISSUE_FOR_OWNER_NAMES` | _(none)_ | Comma-separated full names whose meeting action items become GitHub issues, e.g. `John First,Joanna Second` |
| `AUTO_CREATED_ISSUE_FOR_GITHUBNAMES` | _(none)_ | Comma-separated GitHub logins, positionally matched to the names above, e.g. `john-gh,joanna-gh` |
| `NIGHTLY_CRON` | `0 2 * * *` | Cron for nightly jobs (Node.js only; on CF the schedule is fixed in `wrangler.toml`) |
| `TIMEZONE` | `UTC` | Timezone for nightly job scheduling |
| `SUMMARY_MAX_DAYS` | `7` | Maximum period window for `/summary`, `/releasenotes`, `/meetingsummary`, and `/changes` |
| `SUMMARY_LANGUAGE` | `en` | Language for AI summaries |
| `DAILY_SUMMARY_MAX_COMMITS` | `25` | Max commits the daily job fetches diffs for (bounds Worker subrequests) |
| `AI_CALL_DELAY_MS` | `10000` | Delay between per-author AI calls in the daily job (rate-limit pacing) |
| `AI_INPUT_TRUNCATE_CHARS` | _(none)_ | Hard cap on AI input length; unset means no truncation (diffs are chunked instead) |
| `RATE_LIMIT_PER_MIN` | `10` | Per-user command rate limit |
| `LOG_LEVEL` | `info` | Log verbosity |

## Commands

All commands require authorization.

| Command | Description |
|---|---|
| `/note [file\|shortcut] <text>` | Append a note to a repo file |
| `/summary [period]` | High-level AI summary of recent commits by author |
| `/releasenotes [period]` | Per-author release notes: features, fixes, and key changes (default: last 1d) |
| `/changes [file] [period]` | Show unified diffs for docs files |
| `/issueadd @user\nTitle 1\n...` | Create GitHub issues from a list of titles |
| `/meetingsummary [file\|period]` | Summarise meeting transcript(s); auto-creates issues from action items |
| `/usage [period]` | Show AI token usage and cost breakdown by trigger and user (CF only) |
| `/help` | Show command reference |

**Auth**: every command requires the sender to be in `TELEGRAM_ALLOWED_USERS` or a group admin.

**Period formats** (applies to `/summary`, `/releasenotes`, `/changes`, `/meetingsummary`, and `/usage`): none (default window), `3d`, `1w`, `2025-04-20`

### /note forms

The bot finds the right file automatically:

- **Full path:** `/note docs/meeting-notes.md Sprint recap.`
- **Filename only:** `/note meeting-notes.md Sprint recap.` — searches all allowed paths; if one match, uses it silently
- **Bare name (no extension):** `/note meeting Sprint recap.` — matches `docs/meeting.md` or `docs/drive/meeting` by basename
- **Shortcut:** `/note i New idea.` — resolves via `NOTE_SHORTCUTS` config
- **No path:** `/note Sprint recap.` — shows inline file picker; tap a file to append

### /changes forms

```
/changes                    → all DOCS_PATH files, last 24 hours
/changes 3d                 → all DOCS_PATH files, last 3 days
/changes docs/notes.md      → specific file, last 24 hours
/changes docs/notes.md 1w   → specific file, last week
```

Shows unified diffs (added/removed lines) for files in `DOCS_PATH`, excluding `MEETING_NOTES_FOLDER`. Output is split across multiple messages if needed. Capped at 10 commits per request.

### /releasenotes forms

```
/releasenotes        → last 1 day
/releasenotes 2d     → last 2 days
/releasenotes 1w     → last week
```

- Produces a **per-author** release-notes message: each author gets sections for ✨ New & Improved, 🐛 Fixes, and 🔧 Behind the scenes (the last only for significant infra/backend work). Empty sections are omitted.
- Built from commit **messages + diffs**; asset/binary diffs (SVG, images, fonts, lockfiles, minified bundles) are stripped so the AI focuses on real changes.
- Capped at 25 commits per run. Long output is split across multiple messages.
- Also posted automatically with the nightly daily digest.

### /issueadd forms

```
/issueadd @username
Issue title 1
Issue title 2
Issue title 3
```

- First line must be an @username (the GitHub assignee for all issues).
- Each subsequent line becomes one GitHub issue in `GITHUB_REPO`.
- The bot fetches existing open issues and skips any with a matching title (case-insensitive).
- AI picks the best label from the repo's label list (single batched call); uses no label if none fits.
- Reply shows three sections: ✅ created, ⏭️ skipped (duplicates), ❌ failed.

### /usage forms

```
/usage          → AI usage for the last 24 hours
/usage 7d       → last 7 days
/usage 1w       → last week
```

Shows total tokens (input + output), cost in USD, and a breakdown by trigger (`/summary`, `/meetingsummary`, `cron:daily`, etc.) and by user.

> **Cloudflare Workers only.** This command requires a D1 database and is not available in local or Render.com deployments. See Cloudflare Workers setup below.

### /meetingsummary forms

- **No args:** `/meetingsummary` — shows a picker of all transcript files in `MEETING_NOTES_FOLDER`
- **Filename:** `/meetingsummary 2026-04-28-standup-transcript.md` — summarise one file
- **Period:** `/meetingsummary 1w` — summarise all transcripts from the last week (skips any that already have a summary)

Summary files are saved next to the transcript in `MEETING_NOTES_FOLDER`. Naming: `*-transcript.md` → `*-summary.md`; other filenames get `-summary` appended before the extension.

The transcript picker includes `.md`, `.txt`, and extensionless files. Files containing `summary` in the name are automatically excluded from the picker.

Period filtering uses dates embedded in the filename — both hyphen (`2026-04-28`) and underscore (`2026_04_28`) formats are recognised. Falls back to the file's git creation date if no date is found in the name.

**Auto-created issues:** when `AUTO_CREATED_ISSUE_FOR_OWNER_NAMES` / `AUTO_CREATED_ISSUE_FOR_GITHUBNAMES` are configured, each new summary turns the matching owners' action items into GitHub issues (assigned, AI-labelled, added to the single linked project, de-duplicated by title). The bot posts a `🎫 Auto-created N issue(s)…` message listing them. Owner names are deterministically expanded to full names before matching.

## Scheduled Jobs

### Daily (08:00 Europe/Lisbon on Cloudflare)

- **Daily summary** — posts two messages to the group: a high-level per-author summary of today's commits, then per-author release notes for the same window
- CF cron is UTC-only, so the worker triggers at both 07:00 and 08:00 UTC and runs the summary only when it is actually 08:00 in Lisbon — keeping it at 08:00 local across DST (WEST/WET)

### Meeting scan (every hour, CF only)

Every hour the bot scans `MEETING_NOTES_FOLDER` for transcripts committed since the last scan. Any transcript without a corresponding summary file is automatically summarised and posted to the TG group.

- Last scan timestamp is stored in CF KV (`meeting:last_scan`) so only newly committed transcripts are checked — the full folder is not re-probed on every run
- On first run the timestamp is `0`, so all existing transcripts without summaries are processed once
- Uses the same `processFile` logic as `/meetingsummary` — existing summaries are never regenerated

## Telegram Bot Setup

### 1. Create the bot

1. Open [@BotFather](https://t.me/BotFather) in Telegram
2. Send `/newbot` and follow the prompts — choose a name and username
3. Copy the token BotFather gives you → this is your `TELEGRAM_BOT_TOKEN`
4. Send `/setdescription` → select your bot → paste:
   ```
   GitHAssistant keeps your GitHub project documented and tidy — straight from Telegram. Commit notes, get AI summaries of who did what, browse docs diffs, and summarise meeting transcripts. All from chat.
   ```
5. Send `/setabouttext` → select your bot → paste:
   ```
   GitHub assistant for teams. Notes → GitHub commits. AI daily digests. Docs diff viewer. Meeting transcript summaries.
   ```

### 2. Register bot commands

Send `/setcommands` to BotFather, select your bot, then paste the full list below as a single message:

```
note - Append a note to a project file (/note [file] <text> e.g. /note ideas.md Great new feature idea)
summary - AI-generated summary of commits by author (/summary [period]; e.g. /summary or /summary 3d)
releasenotes - Per-author release notes: new features, fixes, and key changes (/releasenotes [period]; e.g. /releasenotes or /releasenotes 2d)
meetingsummary - Summarise meeting transcript(s) from the meetings folder (specify period like 1d or 1w, or specify the meeting transcript file name in the params; /meetingsummary [file|period])
help - Show all available commands and configured shortcuts
changes - Show diffs for specified files or all in docs folder for specific timeframe (default: last 24h)
usage - Show AI token usage and cost by trigger and user (/usage [period])
issueadd - Create GitHub issues from a list of titles. Usage: /issueadd @user and a list of titles - each on a separate line
```

### 3. Add the bot to your group

1. Add the bot as a member of your Telegram group
2. Promote it to **admin** — it needs permission to read messages and send messages
3. Send any message in the group, then call `https://api.telegram.org/bot<TOKEN>/getUpdates` to find the numeric group ID → this is your `TELEGRAM_GROUP_ID`

---

## Deployment (Local / Render.com)

```bash
cp .env.example .env
# Fill in all required values (see .env.example for descriptions)
npm install
npm run dev      # tsx watch mode for local development
```

For Render.com:

- Service type: **Background Worker**
- Build command: `npm ci && npm run build`
- Start command: `node dist/index.js`
- Set env vars via Render dashboard — never commit `.env`

## Deployment (Cloudflare Workers)

### First-time setup

```bash
# 1. Install Wrangler globally (or use npx)
npm install -g wrangler

# 2. Authenticate with your Cloudflare account
wrangler login

# 3. Copy the config template and fill in your infra IDs
cp wrangler.toml.example wrangler.toml
```

`wrangler.toml` is git-ignored — it holds your specific resource IDs **and your non-sensitive `[vars]` config** (group ID, repo owner/name, models, folders, behaviour, auto-issue owners). Fill those in after copying the template. Only true secrets (`TELEGRAM_BOT_TOKEN`, `GITHUB_TOKEN`, the AI key) are set via `wrangler secret put` in step 7.

```bash
# 4. Create the KV namespace for callback state
wrangler kv namespace create GITHASSISTANT_KV
# Copy the returned `id` into wrangler.toml → kv_namespaces[0].id

# 5. Create the D1 database for AI usage tracking
wrangler d1 create githassistant-db
# Copy the returned `database_id` into wrangler.toml → d1_databases[0].database_id

# 6. Run the database migration against the remote database
wrangler d1 execute githassistant-db --remote --file=migrations/0001_ai_usage.sql

# 7. Set the sensitive secrets only (you will be prompted to type each value).
#    Non-sensitive config (group ID, repo, models, folders, behaviour) lives in
#    [vars] in wrangler.toml — edit it there, do NOT set it as a secret.
wrangler secret put TELEGRAM_BOT_TOKEN
wrangler secret put GITHUB_TOKEN
wrangler secret put ANTHROPIC_API_KEY   # optional — omit to use Cloudflare Workers AI; or set OPENAI_API_KEY instead

# 8. Deploy
npm run cf:deploy

# 9. Register the Telegram webhook (one-time, re-run after URL changes)
CF_WORKER_URL=https://githassistant.<your-subdomain>.workers.dev npm run cf:register-webhook
```

### Ongoing deployments

```bash
npm run cf:deploy
```

### Local development with CF runtime

```bash
npm run cf:dev   # wrangler dev — runs CF Workers runtime locally on port 8787
```

### Nightly job schedule

Cron triggers are defined in `wrangler.toml`:

| Schedule (UTC) | Job | Description |
|---|---|---|
| `0 7 * * *` + `0 8 * * *` | Daily summary | Posts a per-author summary + per-author release notes; runs only at 08:00 Europe/Lisbon (DST-guarded in code) |
| `0 * * * *` | Meeting scan | Checks for new transcripts, posts summaries, and auto-creates issues from action items |

Cron schedules are defined in `wrangler.toml` and cannot be overridden via secrets.

## Manual Job Triggers

```bash
npm run job:summary   # Run daily summary job immediately
```

## Architecture

GitHAssistant runs in two modes that share all business logic:

```
┌─────────────────────────────────────────────────────────────────┐
│                     SHARED CORE (src/)                          │
│  commands/ · jobs/ · github/ · ai/ · types.ts                   │
│  All command and job logic receives deps via DI — no platform   │
│  imports.                                                       │
└────────────────┬────────────────────────────────┬───────────────┘
                 │                                │
    ┌────────────▼────────────┐      ┌────────────▼────────────┐
    │     Node.js mode         │      │   Cloudflare Workers     │
    │   (src/index.ts)         │      │   (src/platforms/        │
    │                         │      │    cloudflare/worker.ts) │
    │  Telegraf long-polling   │      │                         │
    │  node-cron scheduler     │      │  Telegram webhook        │
    │  dotenv config           │      │  CF Cron Triggers        │
    │  Local / Render.com      │      │  CF Workers secrets      │
    └─────────────────────────┘      │  CF KV (callback state)  │
                                     │  CF D1 (AI usage log)    │
                                     └─────────────────────────┘
```

Three subsystems wired at startup (both modes):

1. **Config** — validates env vars at boot, exits with descriptive error on missing vars
2. **Messaging** — platform-specific adapter implementing `MessagingAdapter`; Telegram is the only concrete implementation (Telegraf polling for Node.js, webhook handler for CF Workers)
3. **AI** — pluggable provider behind the `AIProvider` interface; **Anthropic, OpenAI, and Cloudflare Workers AI** supported (auto-detected from the configured key, falling back to the CF `AI` binding); every call is instrumented with an optional `UsageTracker` that logs tokens and cost to CF D1

AI skills (the prompts for meeting summaries, release notes, and issue labelling) live in `src/ai/skills/` as TypeScript modules — edit the prompt constants there to change how the AI behaves.

All command and job logic receives dependencies via injection — no platform context leaks into business logic.
