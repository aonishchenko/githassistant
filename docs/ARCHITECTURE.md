# GitHAssistant — Architecture & Module Reference

Technical documentation of every module in the codebase, how they fit together, and the
main runtime flows. For setup and command usage, see the [README](../README.md).

---

## 1. High-level design

GitHAssistant runs in **two modes that share all business logic** via dependency injection.
No platform detail leaks into the command/job code — it only receives interfaces (`MessagingAdapter`,
`AIProvider`, `Octokit`, `Config`).

```
                        SHARED CORE (src/)
   commands/ · jobs/ · github/ · ai/ · messaging/ · types.ts
                     │                         │
        ┌────────────▼───────────┐   ┌─────────▼──────────────┐
        │  Node.js mode          │   │  Cloudflare Workers     │
        │  src/index.ts          │   │  src/platforms/cloudflare│
        │  Telegraf long-polling │   │  Telegram webhook + Queue│
        │  node-cron scheduler   │   │  CF Cron Triggers        │
        │  dotenv config         │   │  KV (state) · D1 (usage) │
        │  Local / Render.com    │   │  Workers AI binding      │
        └────────────────────────┘   └─────────────────────────┘
```

Three subsystems are wired at startup in both modes:

1. **Config** — validates env vars, builds the `Config` object (`src/config.ts` for Node,
   `src/platforms/cloudflare/config.ts` for CF).
2. **Messaging** — a `MessagingAdapter` implementation (Telegram only): Telegraf polling for Node,
   webhook handler for CF.
3. **AI** — a pluggable `AIProvider` (Anthropic, OpenAI, or Cloudflare Workers AI), auto-detected
   from the configured key; every call is optionally instrumented by a `UsageTracker` (CF → D1).

---

## 2. Entry points

| File | Mode | Responsibility |
|---|---|---|
| `src/index.ts` | Node | Boots Telegraf adapter + node-cron scheduler, registers commands/jobs. |
| `src/platforms/cloudflare/worker.ts` | CF | Exports `fetch` (Telegram webhook → enqueue), `queue` (process updates & meeting-scan messages), and `scheduled` (cron triggers). |

The CF worker’s `fetch` handler does almost nothing per request: it validates the webhook and pushes
the update onto **`BOT_QUEUE`**, returning 200 immediately. The actual command runs in the `queue`
consumer, isolating slow AI work from the webhook response.

---

## 3. Core types — `src/types.ts`

Single source of truth for shared shapes: `Config`, `MessagingAdapter`, `AdapterContext`,
`CallbackContext`, `CommandPlugin`, `JobPlugin`, `AIProvider`, `UsageTracker`, `UsageContext`,
`GitHubCommit`, `SendOptions`, `InlineOption`. Commands and jobs depend only on these interfaces.

---

## 4. AI layer — `src/ai/`

| File | Responsibility |
|---|---|
| `provider.ts` | `createAIProvider(config, tracker?, cfBinding?)` factory — returns Anthropic / OpenAI / Cloudflare provider by `config.ai.provider`. |
| `anthropic.ts`, `openai.ts`, `cloudflare.ts` | Concrete `AIProvider` implementations. Each `summarise(prompt, content, maxTokens?, ctx?)` call records usage via the tracker. The CF provider uses the Workers `AI` binding and handles both `{ response }` and OpenAI-style `{ choices }` shapes. |
| `pricing.ts` | `computeCost(model, inTokens, outTokens)` → USD (null for unknown models). |
| `summarise.ts` | Commit summarisation: `summariseAuthorDiffs` (chunk → consolidate), `chunkText`, `MAX_DIFF_CHARS` (40k chunk budget), and the `SUMMARY_PROMPT` / `HIGH_LEVEL_SUMMARY_PROMPT` builders. |
| `skills/meeting.ts` | `summariseMeeting` — single call under 40k chars, otherwise chunk-extract with a shared token budget then consolidate, hard-bounded to stay inside the model’s 24k-token context. |
| `skills/releaseNotes.ts` | `summariseReleaseNotes`, `generatePerAuthorReleaseNotes` (parallel when no rate-limit delay), and `stripEmptyReleaseNoteSections` (drops sections whose only content is a "nothing to report" placeholder). |
| `skills/labels.ts` | `assignLabels` — one batched call returning a JSON array of labels for issue titles. |

### The skills system (`/skills` + `src/ai/skills/loader.ts`)

AI prompts are **not hardcoded** in TypeScript. They live as LLM-agnostic, reusable Markdown files in
the top-level [`skills/`](../skills) folder, with `{{var}}` placeholders.

```
skills/*.md  ──(npm run skills:build)──►  src/ai/skills/skills.generated.ts  ──►  loader.ts ──► app code
```

- `scripts/build-skills.mjs` bundles every `skills/*.md` into the generated TS module.
  This build step exists because **Cloudflare Workers cannot read the filesystem at runtime**, and no
  single `.md`-as-text import works across tsx, esbuild (wrangler) and vitest. The codegen is hooked
  into `prebuild`, `pretest`, and `cf:deploy`, so it always runs before build/test/deploy.
- `loader.ts` exposes `loadSkill(name)` (verbatim) and `renderSkill(name, vars)` (fills `{{var}}`).
- To edit a prompt: change the `.md` and run `npm run skills:build` (or just `npm run build`/`test`).
- To reuse a skill elsewhere: copy the `.md` file — it has no project dependencies.

Current skills: `meeting-summary`, `meeting-chunk-extract`, `commit-summary`(+`-highlevel`,
`-consolidate`, `-consolidate-highlevel`), `release-notes`(+`-extract`), `issue-labels`.

---

## 5. GitHub layer — `src/github/`

| File | Responsibility |
|---|---|
| `client.ts` | `getOctokit(config)` — cached Octokit instance. |
| `commits.ts` | `fetchCommits`, `fetchCommitDiff`/`fetchCommitPatches`, `filterDiffForSummary` (strips asset/binary file diffs + truncates oversized files so the AI gets signal, not noise), `buildAuthorCommitBlocks` (fetch each diff once, group by author — shared by daily job and `/releasenotes`). |
| `files.ts` | `getFile`, `writeFile`, `listFiles`, `getFileCreationDate` — repo content R/W for notes and meeting summaries. |
| `issues.ts` | `listLabels`, `listOpenIssues`, `createIssue`, `findRepoProject`, `addIssueToProject` (GraphQL ProjectsV2). |
| `autoIssue.ts` | Meeting → issues: `parseActionItems` (reads the Action Items table), `canonicaliseActionItemOwners` (deterministically expands short names like "John" → "John First" from config + transcript), and `autoIssueFromSummary` (matches configured owners, dedups by title, labels, creates, adds to project). |

---

## 6. Commands — `src/commands/`

`registry.ts` registers every command on the adapter, each wrapped with `withAuth` (all commands
require the sender to be in `TELEGRAM_ALLOWED_USERS` or be a group admin).

| Command file | Command | Notes |
|---|---|---|
| `help.ts` | `/help` | Lists commands + configured shortcuts. |
| `note.ts` + `note-resolver.ts` | `/note` | Commits a note to a repo file; resolver handles shortcuts, partial names, and the file picker. |
| `summary.ts` | `/summary` | Per-author commit-message summary; also exports `parsePeriod` (shared period parsing). |
| `releasenotes.ts` | `/releasenotes` | Per-author user-facing changelog from messages + diffs (default 1d). |
| `changes.ts` | `/changes` | Unified diffs for docs files over a period. |
| `issueadd.ts` | `/issueadd` | Creates issues from a title list, assigns, labels, adds to project. |
| `meeting-summary.ts` | `/meetingsummary` | Summarises a transcript (`processFile`), writes the summary back, and triggers auto-issue creation. Shared by the hourly scan. |
| `usage.ts` | `/usage` | AI token/cost breakdown from D1 (CF only). |

---

## 7. Jobs — `src/jobs/`

| File | Responsibility |
|---|---|
| `dailySummary.ts` | Daily digest: fetch commits (capped by `DAILY_SUMMARY_MAX_COMMITS`), build author blocks, send a high-level per-author summary then per-author release notes (both split via `sendLong`). |
| `meetingScan.ts` | Hourly: list transcripts newer than the last scan (KV `meeting:last_scan`), enqueue each; `processMeetingScanMessage` runs `processFile` per transcript. |
| `timeWindow.ts` | Window builders (`buildLast24hWindow` — the daily digest window, `buildTodayWindow`, `buildYesterdayWindow`, `buildWindowUntilNow`) and `isLocalHour` (DST-aware schedule guard). |
| `scheduler.ts` | `startScheduler` — node-cron wiring for Node mode. |

### Daily summary scheduling (DST)

CF cron is UTC-only. To keep the digest at **08:00 Europe/Lisbon** year-round, the worker registers
two daily crons (`0 7 * * *`, `0 8 * * *`) and runs the summary only when `isLocalHour('Europe/Lisbon', 8)`
is true — 07:00 UTC in summer (WEST), 08:00 UTC in winter (WET). The job covers a rolling **last 24h**
window, independent of the trigger time.

---

## 8. Messaging — `src/messaging/`

| File | Responsibility |
|---|---|
| `telegram/index.ts` | `TelegramAdapter` — Telegraf-based `MessagingAdapter` for Node mode (long polling). |
| `telegram/formatter.ts` | Message builders: `formatSummaryMessage`, `formatReleaseNotesMessage`, `formatNoteAppend`, and `sendLong` (splits messages over Telegram’s 4096-char limit at safe boundaries). |
| `telegram/auth.ts` | `isInAllowlist(username, allowed)`. |
| `adapter.ts` | Re-exports the messaging interface types. |

The CF adapter (`platforms/cloudflare/adapter.ts`) is the webhook-based `MessagingAdapter`: it posts to
the Telegram REST API, parses incoming updates, dispatches commands/callbacks, and surfaces Telegram API
errors (logs non-2xx responses instead of failing silently).

---

## 9. Cloudflare platform — `src/platforms/cloudflare/`

| File | Responsibility |
|---|---|
| `worker.ts` | Entry: `fetch` (webhook → enqueue), `queue` (process Telegram updates + `meeting_scan` messages), `scheduled` (daily summary with DST guard + hourly meeting scan). |
| `config.ts` | Builds `Config` from CF `env` (secrets + `[vars]`). |
| `adapter.ts` | `CloudflareAdapter` — webhook `MessagingAdapter`. |
| `kv-state.ts` | Pending-note conversation state in KV. |
| `d1-tracker.ts` | `createD1UsageTracker` — writes per-call token/cost rows to D1 (powers `/usage`). |

**Bindings** (in `wrangler.toml`): `GITHASSISTANT_KV` (state + last-scan), `GITHASSISTANT_DB` (D1 usage),
`BOT_QUEUE` (decouples webhook from processing), `AI` (Workers AI fallback provider).

---

## 10. Supporting files

| Path | Purpose |
|---|---|
| `skills/*.md` | LLM-agnostic prompt definitions (source of truth for all AI behaviour). |
| `scripts/build-skills.mjs` | Bundles skills into `src/ai/skills/skills.generated.ts`. |
| `scripts/register-webhook.ts` | One-time Telegram webhook registration for CF. |
| `migrations/0001_ai_usage.sql` | D1 schema for the AI usage log. |
| `wrangler.toml(.example)` | CF config: bindings, `[vars]`, cron triggers. |
| `.env.example` | Documented env vars for Node/Render mode. |

---

## 11. Key runtime flows

**Command (CF):** Telegram → `fetch` webhook → `BOT_QUEUE` → `queue` consumer → `CloudflareAdapter.handleUpdate`
→ `withAuth` → command handler → GitHub/AI → reply via Telegram REST.

**Daily summary:** cron (07/08 UTC) → DST guard → fetch + cap commits → per-author high-level summary →
send → per-author release notes (reusing diffs) → send.

**Meeting → issues:** hourly scan finds new transcript → enqueue → `processFile` → `summariseMeeting` →
`canonicaliseActionItemOwners` → write summary to repo → `autoIssueFromSummary` (match configured owners,
dedup, label, create, add to project) → post issue list.
