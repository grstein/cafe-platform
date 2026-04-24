# `app_config` JSONB Schema

**Scope**: the single JSONB row in the `app_config` PostgreSQL table —
the platform's runtime configuration source of truth.
**Out of scope**: environment variables (see [env-vars.md](./env-vars.md)),
`pi-config/` files (see [pi-config.md](./pi-config.md)).

Source of truth: `shared/lib/config.mjs`, migration v3 in
`shared/db/migrations.mjs`.

## Storage

```sql
CREATE TABLE app_config (
  id         INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  config     JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

One row, `id = 1`. JSONB values are stored as native JSON objects — use
`sql.json(obj)` when writing (never `JSON.stringify + ::jsonb`).

## Seeding flow

1. At every consumer startup, `loadConfig(sql)` is called once.
2. It reads row `id=1`. If non-empty, merges over `DEFAULTS` and caches.
3. If the table is empty, it reads `CONFIG_DIR/config.json`, seeds the row
   with `INSERT … ON CONFLICT DO UPDATE`, and caches.
4. `getConfig()` returns the cached object synchronously.

**After first boot the DB is the source of truth.** To push file changes
into the DB after edits, run:

```
docker compose exec gateway node setup/init-config.mjs
```

`init-config.mjs` replaces the row unconditionally (idempotent).

## Top-level shape

```json
{
  "display_name": "string",
  "llm":              { ... },
  "session":          { ... },
  "behavior":         { ... },
  "pix":              { ... },
  "bot_phone":        "string",
  "available_models": [ ... ]
}
```

Defaults are merged deeply from `DEFAULTS` in `shared/lib/config.mjs`.
Missing keys fall back to defaults; explicit `null` does not.

## Field reference

### `display_name` · string · default `""`

Name shown in `/ajuda`, referral welcome message, and used as fallback for
`PIX_NAME`. Read by gateway. Changing it takes effect on the next message
after a consumer restart.

### `llm.provider` · string · default `"openrouter"`

Provider key used to look up the model in `pi-config/models.json`. Must
match a key under `providers.*` in `models.json`. Currently only
`"openrouter"` is wired through `modelRegistry.find("openrouter", id)` in
`consumers/agent.mjs`.

### `llm.model` · string · default `"anthropic/claude-haiku-4.5"`

Default model ID (matches `models[].id` in `models.json`). Used unless the
customer has overridden via `/modelo` (stored in
`customers.preferences.modelo`). A missing model logs a warning and falls
back to this default.

### `llm.thinking` · `"off" | "low" | "medium" | "high"` · default `"medium"`

Passed to `createAgentSession({ thinking })`. Applied per-session; takes
effect when a new session is created (existing cached sessions keep their
original level).

### `session.ttl_minutes` · number · default `30`

Pi SDK session cache TTL (keyed by phone). After `ttl_minutes` without a
message, the next message disposes the old session and creates a new one
(losing in-memory conversation state; persisted history in `conversations`
table is unaffected).

### `session.soft_limit`, `session.hard_limit` · numbers · defaults `40`, `60`

Reserved for compaction/turn-limit logic. Not currently read anywhere in
the pipeline; safe to leave at defaults.

### `session.debounce_ms` · number · default `2500`

Aggregator debounce window. Messages arriving within this window are
buffered and merged into a single agent prompt. Set higher for chatty
users, lower for snappier responses.

### `behavior.humanize_delay_min_ms`, `behavior.humanize_delay_max_ms` · numbers · defaults `2000`, `6000`

Sender picks a uniform random delay between these bounds before sending
each outgoing message, to mimic human typing. Applied per message. Set
both to `0` to disable.

### `behavior.rate_limit_per_min` · number · default `8`

Gateway per-phone rate limit. Messages beyond this count in a rolling
60-second window are silently dropped (log-only). A hard cap of 20 also
applies (abuse threshold) regardless of this setting.

### `behavior.typing_indicator` · boolean · default `true`

Whether the sender sends a typing presence to the bridge before the
message. Currently informational; the bridge layer honors it if supported.

### `pix.enabled` · boolean · default `false`

When `true`, `/confirma` builds a BR Code from `PIX_KEY`, `PIX_NAME`,
`PIX_CITY`. When `false`, `/confirma` returns an error if invoked. If you
enable this, set the `PIX_*` env vars (see [env-vars.md](./env-vars.md)).

### `bot_phone` · string · default `""`

Fallback for `BOT_PHONE` env var. Used to build `wa.me/<phone>` links in
`/indicar` and `invite_customer` tool. Empty = no link shown. `BOT_PHONE`
env var wins if both are set.

### `available_models` · array · default `[]`

Model options shown by the `/modelo` command. Each entry:

```json
{
  "id": "anthropic/claude-sonnet-4.6",
  "name": "Claude Sonnet 4.6",
  "emoji": "🧠",
  "reasoning": true,
  "supportsReasoningEffort": true
}
```

- `id` — must also exist in `pi-config/models.json` provider list.
- `name`, `emoji` — display only.
- `reasoning`, `supportsReasoningEffort` — hints (not enforced here).

`/modelo` lists these 1-indexed; `/modelo N` sets
`customers.preferences.modelo` to `available_models[N-1].id` and resets the
session.

## Side effects of changing fields at runtime

Consumers cache the config in-process. After `setup/init-config.mjs` or a
manual UPDATE, **restart all consumers** to pick up changes. There is no
hot-reload mechanism today.

| Field | Requires restart | Takes effect |
|-------|------------------|-------------|
| `display_name`, `bot_phone`, `available_models` | yes | next message |
| `llm.*` | yes | next new session (cached sessions keep old values) |
| `session.ttl_minutes`, `session.debounce_ms` | yes | next message / session |
| `behavior.*` | yes | next message |
| `pix.enabled` | yes | next `/confirma` |

## Updating programmatically

```js
import { updateConfig } from "./shared/lib/config.mjs";
await updateConfig(sql, { behavior: { rate_limit_per_min: 15 } });
```

`updateConfig` deep-merges over the current config and refreshes the cache
in the current process only. Other consumers still need a restart.

## Related

- [env-vars.md](./env-vars.md) — env vars that override or pair with these fields.
- [models.md](./models.md) — `pi-config/models.json` schema (provider + models).
- [../reference/commands.md](../reference/commands.md) — how `/ajuda`, `/modelo`
  consume these fields.
