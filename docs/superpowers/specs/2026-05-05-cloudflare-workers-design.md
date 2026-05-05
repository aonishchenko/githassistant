# GitHAssistant — Cloudflare Workers Deployment Design

**Date:** 2026-05-05  
**Status:** Approved  
**Scope:** Add CF Workers as a second deployment target alongside the existing Node.js (local/Render) mode

---

## 1. Goal

Run GitHAssistant on Cloudflare Workers infrastructure using Telegram webhooks instead of polling, Cloudflare Cron Triggers instead of node-cron, and Cloudflare KV for callback state. All AI calls continue to hit external providers (Anthropic/OpenAI) via their APIs — no CF Workers AI inference. Configuration is supplied via CF Workers secrets instead of `.env`.

Both deployment modes (Node.js and CF Workers) coexist in the same repository, sharing all business logic unchanged.

---

## 2. Repository Structure Changes

Minimal additions. Nothing in `src/` moves. A new `src/platforms/cloudflare/` subtree is added.

```
src/
├── index.ts                            ← unchanged (Node.js polling entry point)
├── platforms/
│   └── cloudflare/
│       ├── worker.ts                   ← CF entry point: fetch() + scheduled()
│       ├── adapter.ts                  ← CloudflareAdapter implements MessagingAdapter
│       ├── config.ts                   ← Config loader from CF env bindings (no dotenv)
│       └── kv-state.ts                ← KV-backed callback state for file pickers
├── commands/                           ← unchanged
├── jobs/                               ← unchanged
├── github/                             ← unchanged
├── ai/                                 ← unchanged
└── ...

scripts/
└── register-webhook.ts                 ← one-time Telegram setWebhook call

wrangler.toml                           ← CF Workers config + cron triggers + KV binding
```

All existing command handlers, job functions, GitHub client, AI providers, types, and the `Config` shape are reused without modification. They receive dependencies via DI and have no Node.js-specific imports.

---

## 3. Architecture: Two Runtime Modes

```
┌─────────────────────────────────────────────────────────────────┐
│                        SHARED CORE (src/)                       │
│  commands/ · jobs/ · github/ · ai/ · types.ts                   │
└────────────────┬────────────────────────────────┬───────────────┘
                 │                                │
    ┌────────────▼────────────┐      ┌────────────▼────────────┐
    │   Node.js (src/index.ts)│      │  CF Workers              │
    │                         │      │  (src/platforms/         │
    │  Telegraf polling        │      │   cloudflare/worker.ts) │
    │  node-cron scheduler     │      │                         │
    │  dotenv config           │      │  Telegram webhook        │
    │  Local / Render.com      │      │  CF Cron Triggers        │
    └─────────────────────────┘      │  CF Workers secrets      │
                                     │  CF KV (callback state)  │
                                     └─────────────────────────┘
```

### Telegram update flow (CF Workers)

```
User sends /summary 3d in Telegram group
  → Telegram POSTs Update JSON to https://githassistant.{subdomain}.workers.dev/webhook
  → CF Worker fetch() handler wakes up
  → CloudflareAdapter parses Update, identifies command, calls handler
  → Handler fetches GitHub commits, calls Anthropic API, builds reply
  → CloudflareAdapter POSTs reply to api.telegram.org/sendMessage
  → Telegram delivers message to group
  → Worker returns 200 OK to Telegram
```

### Nightly job flow (CF Cron Triggers)

```
CF Cron fires at 0 2 * * * (squash) or 0 6 * * * (daily summary)
  → CF Worker scheduled() handler wakes up
  → Identifies job from event.cron
  → Runs job function (same as npm run job:squash / job:summary)
  → Job sends result to Telegram group via CloudflareAdapter
```

---

## 4. New Components

### 4.1 `src/platforms/cloudflare/worker.ts`

CF Workers entry point. Exports the default object with `fetch` and `scheduled` handlers.

- `fetch`: validates the request is a POST to `/webhook`, parses the Telegram Update, dispatches via CloudflareAdapter, returns `200 OK` immediately.
- `scheduled`: switches on `event.cron` — `'0 2 * * *'` runs the squash job, `'0 6 * * *'` runs the daily summary job.

Both handlers build dependencies (config, octokit, ai provider, adapter) at the top of each invocation. CF Workers have fast cold starts; DI at invocation start is the correct pattern.

### 4.2 `src/platforms/cloudflare/adapter.ts` — CloudflareAdapter

Implements the existing `MessagingAdapter` interface. No Telegraf dependency.

**Outgoing messages:** direct `fetch` calls to `https://api.telegram.org/bot{TOKEN}/sendMessage` (and `sendDocument` for file uploads).

**Command routing:** handlers are registered in a `Map<string, CommandHandler>` at invocation start (same as `registerCommands` in the Node.js path). On incoming Update, the adapter extracts the command text and dispatches to the matching handler.

**Inline keyboards:** `showOptions()` sends a message with `reply_markup.inline_keyboard`. The pending state (note text, command context) is written to KV before returning. On `callback_query` updates, the adapter reads KV state, resolves the pending operation, then deletes the KV entry.

**Auth:** same username/admin check as `src/messaging/telegram/auth.ts` — reused directly.

### 4.3 `src/platforms/cloudflare/config.ts`

Same `Config` shape as `src/config.ts`. Reads from the CF `env` bindings object instead of `process.env`. No `dotenv` import. Same required-variable validation — throws with a descriptive error if any required binding is missing.

```typescript
export function loadCFConfig(env: CloudflareEnv): Config { ... }
```

`CloudflareEnv` is a TypeScript interface matching the bindings declared in `wrangler.toml`.

### 4.4 `src/platforms/cloudflare/kv-state.ts`

Manages callback state in the `GITHASSISTANT_KV` namespace.

| Operation | Key | Value | TTL |
|---|---|---|---|
| Write pending state | `callback-state:{userId}` | `{ command, pendingText, ... }` | 600s |
| Read pending state | `callback-state:{userId}` | — | — |
| Delete after use | `callback-state:{userId}` | — | — |

10-minute TTL covers the case where a user opens the file picker but never taps a file.

### 4.5 `scripts/register-webhook.ts`

One-time script. Reads `TELEGRAM_BOT_TOKEN` and `CF_WORKER_URL` from env, calls:
```
POST https://api.telegram.org/bot{TOKEN}/setWebhook
Body: { url: "https://githassistant.{subdomain}.workers.dev/webhook" }
```
Prints the Telegram API response. Must be re-run after the first `cf:deploy` and after any worker URL change.

### 4.6 `wrangler.toml`

```toml
name = "githassistant"
main = "src/platforms/cloudflare/worker.ts"
compatibility_date = "2024-01-01"

[[kv_namespaces]]
binding = "GITHASSISTANT_KV"
id = "<kv-namespace-id>"          # filled in after: wrangler kv namespace create

[[triggers.crons]]
crons = ["0 2 * * *", "0 6 * * *"]
```

All secrets set via `wrangler secret put` — never committed to `wrangler.toml`.

---

## 5. Secrets Configuration (CF Workers)

Set each secret once via Wrangler CLI. These replace the `.env` file for the CF deployment.

**Required:**
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_GROUP_ID`
- `GITHUB_TOKEN`
- `GITHUB_OWNER`
- `GITHUB_REPO`
- `ANTHROPIC_API_KEY` (or `OPENAI_API_KEY` if using OpenAI)

**Optional (have defaults):**
- `TELEGRAM_ALLOWED_USERS`
- `GITHUB_DEFAULT_BRANCH` (default: `main`)
- `AI_PROVIDER` (default: `anthropic`)
- `ANTHROPIC_MODEL`
- `OPENAI_MODEL`
- `NOTE_ALLOWED_PATHS`
- `NOTE_SHORTCUTS`
- `MEETING_NOTES_FOLDER`
- `SUMMARY_MAX_DAYS`
- `SQUASH_ENABLED`
- `SUMMARY_LANGUAGE`
- `LOG_LEVEL`

---

## 6. New npm Scripts

| Script | Command | Purpose |
|---|---|---|
| `cf:deploy` | `wrangler deploy` | Deploy to CF Workers |
| `cf:dev` | `wrangler dev` | Local CF runtime emulator |
| `cf:register-webhook` | `tsx scripts/register-webhook.ts` | Register webhook with Telegram |

---

## 7. State & Limitations vs Node.js Mode

| Feature | Node.js mode | CF Workers mode |
|---|---|---|
| Telegram updates | Polling (getUpdates) | Webhook (POST to worker) |
| Scheduling | node-cron | CF Cron Triggers |
| Config | `.env` / dotenv | CF Workers secrets |
| Inline file picker | In-memory Telegraf state | CF KV (10 min TTL) |
| Rate limiting | In-memory (10 cmd/min/user) | CF Rate Limiting rules (configured in CF dashboard) |
| Squash job | `npm run job:squash` | Cron: 0 2 * * * UTC |
| Daily summary | `npm run job:summary` | Cron: 0 6 * * * UTC |
| Max invocation CPU | Unlimited (process) | 10ms free / 30s paid |

AI API calls (Anthropic/OpenAI) are `await`ed inside the Worker invocation. The Worker's wall-clock time limit (free: 30s, paid: no limit) covers normal summarisation. For large meeting transcript batches that exceed 30s, the paid plan is recommended.

---

## 8. README Updates

The README will be updated with:

1. **Architecture section** — diagram showing both runtime modes and the shared core
2. **AI Providers section** — documents OpenAI support (currently missing from README)
3. **Deployment section** — split into three subsections:
   - Local development (existing)
   - Render.com (existing)
   - Cloudflare Workers (new) — full step-by-step setup walkthrough
4. **Environment variables table** — annotated with which vars apply to Node.js, CF Workers, or both

---

## 9. Out of Scope

- CF Workers AI inference (using CF's built-in models) — kept external AI APIs instead
- Migrating existing Node.js deployment — both modes coexist
- WhatsApp or other messaging adapters — unchanged from original spec
- CF Durable Objects — KV is sufficient for the callback state use case
