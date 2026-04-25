# GitHAssistant — Design Spec

**Date:** 2026-04-25  
**Status:** Approved

---

## Overview

A Node.js Telegram bot that keeps a GitHub project documented, summarised, and tidy. Added to a Telegram group, it responds to slash commands and runs nightly scheduled jobs. Built with two abstraction layers: a messaging adapter (Telegram first, others future) and a command plugin system.

**Stack:** Node.js 20, TypeScript strict, Telegraf v4, @octokit/rest + graphql, node-cron, @anthropic-ai/sdk, pino, vitest.

---

## Repository Layout

Code lives at the root of the repo:

```
src/
  index.ts                  # Entry: wires config → adapter → commands → scheduler → start
  config.ts                 # Validates env vars at boot, throws listing all missing vars
  types.ts                  # Shared interfaces
  messaging/
    adapter.ts              # MessagingAdapter interface + AdapterContext
    telegram/
      index.ts              # TelegramAdapter: wraps Telegraf, owns pendingNotes Map
      auth.ts               # Allowlist + group admin check
      formatter.ts          # Telegram Markdown helpers
  commands/
    registry.ts             # Registers all CommandPlugins with the adapter
    note.ts                 # /note handler (Forms A/B/C)
    summary.ts              # /summary handler
    help.ts                 # /help handler
  jobs/
    scheduler.ts            # node-cron setup, registers JobPlugins
    squash.ts               # Nightly squash job
    dailySummary.ts         # Nightly digest job (reuses summary logic)
  github/
    client.ts               # Octokit singleton
    commits.ts              # Commit read helpers + squash write logic
    files.ts                # File read/write/directory listing
  ai/
    provider.ts             # AIProvider factory (reads AI_PROVIDER env)
    anthropic.ts            # Anthropic implementation
    summarise.ts            # Diff chunking + summarisation logic
```

---

## Architecture

Three subsystems wired at startup in `index.ts`:

1. **Config** — validates all env vars, exports typed `Config`. Process exits with descriptive error on missing vars.
2. **Messaging** — `TelegramAdapter` implements `MessagingAdapter`. Commands registered via `onCommand()`; inline keyboard callbacks via `onCallback()`. Owns `pendingNotes: Map<userId, string>` for /note Form C state.
3. **Scheduler** — node-cron registers job plugins. Jobs receive the adapter via injection to send results to Telegram.

Data flows one direction: Telegram event → adapter → command plugin → GitHub/AI → adapter.sendMessage(). No circular dependencies.

---

## Interfaces

```typescript
// MessagingAdapter
interface MessagingAdapter {
  sendMessage(text: string, options?: SendOptions): Promise<void>;
  sendDocument(filename: string, content: Buffer, caption?: string): Promise<void>;
  onCommand(command: string, handler: CommandHandler): void;
  onCallback(action: string, handler: CallbackHandler): void;
  start(): Promise<void>;
}

// AdapterContext — what command handlers receive
interface AdapterContext {
  userId: string;
  username: string;
  text: string;
  replyText(text: string): Promise<void>;
  showOptions(text: string, options: InlineOption[]): Promise<void>;
}

// Plugin interfaces
interface CommandPlugin {
  command: string;
  description: string;
  requiresAuth: boolean;
  handler: (ctx: AdapterContext) => Promise<void>;
}

interface JobPlugin {
  name: string;
  cronExpression?: string;  // overrides NIGHTLY_CRON if set
  handler: () => Promise<void>;
}

// AI provider
interface AIProvider {
  summarise(prompt: string, content: string): Promise<string>;
}
```

---

## Commands

### /note

Auth required (TELEGRAM_ALLOWED_USERS or group admin). Single handler dispatches to three forms based on the first token after `/note`:

**Dispatch order:**
1. If first token is a known shortcut key (exact match in NOTE_SHORTCUTS) → **Form B**
2. If first token contains `/` or ends in `.md`/`.txt` → **Form A**
3. Otherwise → **Form C** (first token is part of the note text, or there is no text)

- **Form A** — path provided (`/note docs/file.md <text>` or `/note file.md <text>`): resolve path, validate against NOTE_ALLOWED_PATHS (no traversal), append timestamped note, commit. If only a filename (no `/`), search all NOTE_ALLOWED_PATHS; single match → use it silently; multiple matches → ask user to clarify (show inline keyboard).
- **Form B** — shortcut provided (`/note i <text>`): look up NOTE_SHORTCUTS, resolve to path, same as A. Unknown shortcut → list known shortcuts.
- **Form C** — no path (`/note <text>`): list files in NOTE_ALLOWED_PATHS (up to 20 alphabetically), show inline keyboard. Store note text in `pendingNotes` Map keyed by userId. On callback: retrieve text, append, commit. If text was also absent, prompt for it after file selection.

Append format:
```markdown
<!-- note: 2025-04-25T14:32Z | @username -->
Note content here.
```

Commit message: `note(@username): docs/meeting-notes.md`

If target file doesn't exist, create it with `# filename` header.

Allowed extensions: `.md`, `.txt` (configurable via NOTE_ALLOWED_EXTENSIONS).

### /summary [period]

No auth required. Period forms: none (24h), `3d`, `1w`, `2025-04-20` (ISO date). Rejected if > SUMMARY_MAX_DAYS.

Flow:
1. Fetch commits for branch within date window (Octokit GraphQL).
2. Fetch changed files + diffs per commit.
3. Group diffs by author.
4. Call AI.summarise() per author with the standard prompt.
5. Assemble and post Telegram Markdown output.

Falls back to plain commit list if AI fails; notes the fallback in the message.

### /help

No auth, always available. Returns command reference including configured shortcuts.

---

## Nightly Jobs

Both run sequentially at NIGHTLY_CRON. "Yesterday" computed using TIMEZONE.

### Squash Job (squash.ts)

1. Fetch yesterday's commits on GITHUB_DEFAULT_BRANCH.
2. Group by committer.login. Skip authors with ≤1 commit.
3. Per author with >1 commit:
   - Take last commit's tree SHA (final state).
   - Find parent: commit immediately before their first commit of the day.
   - Create new commit object with that parent + tree.
   - Message: `daily(@alice): 3 changes on 2025-04-24` + bulleted original messages with short SHAs.
4. Replay squashed commits in chronological order (by each author's first commit time).
5. Force-update branch ref to new tip.
6. Post confirmation or abort warning to Telegram.

On any error: abort, leave branch unchanged, post warning with context.

### Daily Summary Job (dailySummary.ts)

Reuses /summary logic hardcoded to "yesterday". Posts automatically to group.

---

## AI Provider

Factory in `src/ai/provider.ts` reads AI_PROVIDER env var and returns the correct `AIProvider` implementation.

Anthropic implementation:
- Model: ANTHROPIC_MODEL (default `claude-sonnet-4-5`).
- Max tokens per call: 1024.
- Diffs >80k chars: chunked, summarised in passes, then consolidated.

---

## State Management

`/note` Form C (file-picker flow) uses an in-memory `Map<userId, string>` on `TelegramAdapter` to hold pending note text between command and callback. State is lost on restart (acceptable: user simply re-issues the command).

---

## Error Handling

| Scenario | Response |
|---|---|
| File not found on /note | Create file, confirm |
| Path outside NOTE_ALLOWED_PATHS | "That path is not in an accessible folder." + list roots |
| Unknown shortcut | "Unknown shortcut. Known shortcuts: ..." |
| GitHub API error (write) | Human-readable message + status code, no retry |
| AI timeout/error | Fallback to plain commit list, note fallback |
| Squash conflict | Abort, leave branch unchanged, post warning |
| Period > SUMMARY_MAX_DAYS | "Maximum summary window is N days." |
| No commits found | "No commits found in the last 24h." |
| Missing required env var at startup | Exit with list of missing vars |
| Unknown command | Silently ignored |

---

## Security

- Bot ignores messages from groups other than TELEGRAM_GROUP_ID and all DMs.
- /note requires TELEGRAM_ALLOWED_USERS or group admin.
- Path validation: resolved path must be inside a NOTE_ALLOWED_PATHS entry. No path traversal, no shell execution.
- GitHub token: Fine-Grained PAT, target repo only, Contents Read+Write + Metadata Read.
- Rate limit: 10 commands/minute per user (configurable via RATE_LIMIT_PER_MIN).

---

## Testing

- **Unit tests** (vitest): period parser, path resolver, shortcut expander, config validator, note formatter.
- **Integration tests** (nock): mock Octokit + Anthropic responses for command flows.
- **Manual checklist** in README: /note all three forms, /summary, nightly jobs via manual trigger, squash revert procedure.

---

## Deployment

- **Render.com**: Background Worker. Build: `npm ci && npm run build`. Start: `node dist/index.js`. Env vars via dashboard.
- **Local**: `npm run dev` (tsx watch). Manual job triggers: `npm run job:squash`, `npm run job:summary`.
