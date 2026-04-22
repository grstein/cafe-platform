# CLAUDE.md

This file provides guidance to AI coding agents working in this repository.

## Project Overview

WhatsApp agent platform: reusable engine that connects to WhatsApp directly
via Baileys (`@whiskeysockets/baileys`), processes messages through a
RabbitMQ pipeline of 6 independent Node.js consumers, generates LLM
responses via the Pi Agent SDK (OpenRouter), and sends replies back. Any
single-tenant business can run on this engine by providing its own
`tenants/<TENANT_ID>/` and `pi-config/` directories via volume mounts.

## Architecture

**Message pipeline** (each stage is a separate consumer process/container):

```
WhatsApp → Baileys Bridge → gateway → aggregator → enricher → agent → sender → Baileys Bridge → WhatsApp
                                                                          ↘ analytics
```

- **whatsapp-bridge** (`services/whatsapp-bridge.mjs`): Single Baileys
  WebSocket connection. Publishes incoming messages to `msg.flow` with
  routing key `incoming`. Consumes from `whatsapp.send` queue to deliver
  outgoing messages. Serves a QR code page at `http://localhost:3001`.
- **gateway** (`consumers/gateway.mjs`): Parses incoming payload, enforces
  allowlist/referral access control, rate limiting; handles static
  commands (`/carrinho`, `/ajuda`, `/modelo`, etc.). Publishes to
  `validated` or `outgoing`.
- **aggregator** (`consumers/aggregator.mjs`): Debounces rapid-fire
  messages (2.5s window, configurable). Buffers messages while agent is
  processing. Publishes to `ready`.
- **enricher** (`consumers/enricher.mjs`): Loads customer profile,
  conversation history, cart, orders from SQLite. Builds context block
  injected into agent prompt. Publishes to `enriched`.
- **agent** (`consumers/agent.mjs`): Creates Pi Agent SDK session per user
  (cached with TTL, keyed by `phone`). Uses `session.prompt()` +
  `session.getLastAssistantText()`. 11 custom tools (cart, catalog,
  orders, customer, referrals). Publishes to `response`.
- **sender** (`consumers/sender.mjs`): Humanized typing delay (random 2–6s),
  sends via bridge. Handles multi-message commands (e.g. `/confirma` sends
  instructions + PIX code separately). Publishes `completed` and
  `analytics` events.
- **analytics** (`consumers/analytics.mjs`): Terminal consumer. Single
  logger, single repo. Logs MSG_OUT/MSG_IN/CMD_OUT to JSONL files in
  `LOG_DIR`. Updates CRM counters.

**RabbitMQ topology**: Two topic exchanges (`msg.flow`, `events`), one DLX
fanout (`dlx`). 10 queues. Routing keys are plain stage names —
`incoming`, `validated`, `ready`, `enriched`, `response`, `outgoing`,
`send`, `completed`, `session_reset`. Defined in
`shared/lib/rabbitmq.mjs`, initialized by `setup/rabbitmq-init.mjs`.

**Tenant selection**: The active tenant is chosen via the `TENANT_ID`
environment variable. `shared/lib/config.mjs:getTenantId()` throws if
unset. `getConfig()` reads `${TENANTS_DIR}/${TENANT_ID}/tenant.json` and
merges it over defaults. This repo ships an `examples/` folder with a
demo tenant (`examples/tenants/demo-tenant/`) and a generic
`examples/pi-config/` to let contributors run the stack locally with
`cp -r examples/... tenants/... && cp -r examples/pi-config pi-config`;
production deployments mount a real tenant via volumes.

**Per-tenant id prefixes**: Two env vars control user-visible identifier
prefixes so the engine stays tenant-agnostic:
- `ORDER_PREFIX` — prepended to order display IDs (e.g. `#CDA-123`) and
  to PIX identifiers (non-alphanumeric chars stripped there).
- `REFERRAL_CODE_PREFIX` — prepended to generated referral codes
  (default `REF-`).

Both are read lazily at call time, so changing them and restarting the
affected consumers is enough to retenant without a rebuild.

**Database**: Single SQLite file at `${DATA_DIR}/${TENANT_ID}.db`.
Connection managed by `shared/db/connection.mjs` as a singleton. Access
via `getDB(dataDir?)`.

**Shared code** (`shared/`):
- `db/` — SQLite repos (better-sqlite3): customers, products, orders,
  cart, conversations, referrals, migrations, connection
- `lib/` — RabbitMQ wrapper, envelope helpers, Baileys client, PIX
  generation, app config, logger
- `tools/` — Pi Agent tool definitions (cart, catalog, customer, order,
  referral) — 11 tools total
- `commands/` — Static command handlers (`/ajuda`, `/carrinho`, `/pedido`,
  `/confirma`, `/cancelar`, `/reiniciar`, `/indicar`, `/modelo`)

**Envelope** (`shared/lib/envelope.mjs`): The message object flowing
through the pipeline. `createEnvelope({ phone, text, pushName })` returns
an envelope whose `tenant_id` comes from `getTenantId()`. Contains
`phone`, `payload` (messages, merged_text, response), `context` (enriched
data), `metadata` (stage, timings, command_result).

**Pi Agent SDK** (`consumers/agent.mjs`):
- `createAgentSession({ model, thinking, cwd: tenantWorkspace, agentDir: CONFIG_DIR, ... })` — `cwd` and `agentDir` are the correct parameter names
- `agentDir` = `CONFIG_DIR` = `/config/pi` (mounted from `pi-config/`) — SDK discovers `AGENTS.md`, `skills/`, `prompts/` here
- `cwd` = `tenantWorkspace` = `/tenants/${TENANT_ID}` — SDK walks up looking for `AGENTS.md`
- **Sessions dir**: the SDK writes session files to `agentDir/sessions/<encoded-cwd>/`. Since
  `pi-config/` is mounted `:ro`, a custom `SessionManager` is passed pointing to
  `/data/pi-sessions/<tenant_id>/<phone>` (writable `cafe_data` volume). Never mount
  `pi-config` read-write just to satisfy this — always pass `sessionManager` explicitly.
- Session cache keyed by `phone` (string)
- `session.prompt(text)` is async and fire-and-forget; call `session.getLastAssistantText()` after awaiting to get response
- `getLastAssistantText()` returns `undefined` when the LLM call errors (check `OPENROUTER_API_KEY` validity if this happens)

## Commands

```bash
# Start all services (infra + bridge + 6 consumers) using the bundled demo tenant
TENANT_ID=demo-tenant docker compose up -d

# Start only the consumers (infra already running)
docker compose up -d gateway aggregator enricher agent sender analytics

# Rebuild and restart a specific consumer
docker compose build agent && docker compose up -d agent

# Initialize RabbitMQ topology (run once, or after topology changes)
docker compose exec gateway node setup/rabbitmq-init.mjs

# Seed a catalog from the tenant's catalogo.csv
docker compose exec gateway node setup/seed-products.mjs

# Send a test message through the pipeline without going through WhatsApp
docker compose exec gateway node setup/send-test-message.mjs "/ajuda"
docker compose exec gateway node setup/send-test-message.mjs --listen   # monitor responses

# Run a single consumer locally (needs RABBITMQ_URI + TENANT_ID in .env)
TENANT_ID=demo-tenant node consumers/gateway.mjs

# Run tests
npm test                 # all unit + integration tests
npm run test:unit
npm run test:integration

# Install dependencies
npm install
```

## Deployment

The engine is published as a Docker image (via `.github/workflows/publish.yml`)
to `ghcr.io/grstein/cafe-platform`. Tags: `latest`, the full commit SHA,
the 7-char short SHA, and semver tags when a `v*` tag is pushed.

A production deploy combines this image with a **tenant-specific private
repo** that owns `tenants/${TENANT_ID}/`, `pi-config/`, the production
compose file (`docker-compose.prod.yml` with `image:` instead of
`build:`), and the deploy workflow. The VPS clones the tenant repo, its
`deploy.yml` SSHes in on push to `main` and runs `git pull` + `docker
compose pull` + `docker compose up -d`. Persistent data (SQLite + Baileys
auth state + logs) lives in named Docker volumes (`cafe_data`,
`cafe_logs`) that survive image upgrades.

CI (`.github/workflows/ci.yml`) runs on Node.js 22 — required so that
`node --test` expands globs like `tests/unit/**/*.test.mjs` natively
without relying on the shell.

**First-deploy checklist** (after `docker compose up -d`):
1. `docker compose exec gateway node setup/rabbitmq-init.mjs` — creates exchanges/queues (must run once, or after topology changes)
2. `docker compose exec gateway node setup/seed-products.mjs` — seeds catalog from `catalogo.csv`
3. Verify `OPENROUTER_API_KEY` is valid: `curl -s -H "Authorization: Bearer $KEY" https://openrouter.ai/api/v1/auth/key`

## Baileys Notes

- Baileys uses LID format (`@lid`) for `remoteJid` in newer WhatsApp
  protocol; the bridge resolves to phone JID via `remoteJidAlt` field.
- History sync disabled (`shouldSyncHistoryMessage: () => false`) to
  avoid event buffering on startup.
- Auth state stored in `${DATA_DIR}/${TENANT_ID}/auth/` via
  `useMultiFileAuthState`.
- QR code served at `http://localhost:3001/qr` (port 3001 on bridge
  container).
- Container runs as `node` user — `data/` and `logs/` dirs must be owned
  by UID 1000.

## Tenant files (provided by caller, not in this repo)

The platform expects these files at runtime. This repo provides placeholder
examples under `examples/`:

- `tenants/${TENANT_ID}/tenant.json` — config: display_name, LLM
  provider/model, session timing, PIX flag, available_models
- `tenants/${TENANT_ID}/AGENTS.md` — business context (hours, policies,
  address) injected by the Pi Agent SDK via `cwd` walk-up
- `tenants/${TENANT_ID}/allowlist.txt` — preauthorized phone numbers
  (one per line, optional comments with `#`)
- `tenants/${TENANT_ID}/catalogo.csv` — product catalog seeded by
  `setup/seed-products.mjs`
- `pi-config/AGENTS.md` — global agent instructions for every session
- `pi-config/models.json` — OpenRouter provider + model definitions
- `pi-config/settings.json` — defaultThinkingLevel, compaction settings
- `pi-config/skills/` — skills discovered by the SDK at startup

## Development Workflow

- **Test-first**: always write or update the test before implementing the
  feature or fix. Run the test to confirm it fails, then implement, then
  confirm it passes.
- Test helpers in `tests/helpers/`: `createTestDB()`, `createTestRepos(db)`,
  `seedProducts(db)`, `seedCustomer(db, overrides)` for DB tests;
  `createMockChannel()` for RabbitMQ tests; `PHONES`, `PRODUCTS`,
  `APP_CONFIG`, `ENVELOPE()`, `EVOLUTION_PAYLOAD()` from `fixtures.mjs`.
- `TENANT_CONFIG` is an alias for `APP_CONFIG` in fixtures — use
  `APP_CONFIG` in new tests.
- `tests/setup.mjs` sets `TENANT_ID=test-tenant`, `ORDER_PREFIX=TEST-`,
  `REFERRAL_CODE_PREFIX=TEST-` before any test module is imported. It's
  loaded via `node --test --import=./tests/setup.mjs`.

## Key Conventions

- ESM modules throughout (`.mjs` files, `"type": "module"` in
  package.json)
- All consumers follow the same pattern: `connect()` →
  `consume(channel, QUEUE, handler)` → process envelope → `publish()` to
  next stage → `ack()`/`nack()`
- Repository pattern: `create*Repo(db)` returns an object with query
  methods; DB is a singleton from `getDB(dataDir?)`
- Config singleton: `getConfig()` from `shared/lib/config.mjs` — call
  `clearConfig()` in tests to reset
- Environment config via `.env` (not committed); key vars: `TENANT_ID`,
  `RABBITMQ_URI`, `OPENROUTER_API_KEY`, `ORDER_PREFIX`,
  `REFERRAL_CODE_PREFIX`, `PIX_KEY`, `PIX_NAME`, `PIX_CITY`, `BOT_PHONE`,
  `TENANTS_DIR`, `DATA_DIR`, `LOG_DIR`, `CONFIG_DIR`
- RabbitMQ routing keys are plain stage names (no tenant prefix):
  `incoming`, `validated`, `ready`, `enriched`, `response`, `outgoing`,
  `send`
- GPix library used for PIX QR code generation
- Test framework: Node.js native test runner (`node:test` +
  `node:assert/strict`), in-memory SQLite for DB tests
