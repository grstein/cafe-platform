# CLAUDE.md

This file provides guidance to AI coding agents working in this repository.

## Project Overview

WhatsApp agent platform: reusable engine that connects to WhatsApp via
Baileys (`@whiskeysockets/baileys`), processes messages through a RabbitMQ
pipeline of 6 independent Node.js consumers, generates LLM responses via
the Pi Agent SDK (OpenRouter), and sends replies back.

**Single-tenant per deployment**: each client runs their own server instance.
All configuration lives in a single `pi-config/` directory (mounted into
containers at `/config/pi`), following the same conventions as `~/.pi` in
the Pi Agent SDK. Runtime config and allowlist are stored in PostgreSQL.

## Architecture

**Message pipeline** (each stage is a separate consumer process/container):

```
WhatsApp → Baileys Bridge → gateway → aggregator → enricher → agent → sender → Baileys Bridge → WhatsApp
                                                                          ↘ analytics
```

- **whatsapp-bridge** (`services/whatsapp-bridge.mjs`): Single Baileys WebSocket.
  Publishes incoming messages to `msg.flow` with routing key `incoming`. Consumes
  from `whatsapp.send` queue. Serves QR page at `http://localhost:3001/qr`.
  Auth state stored at `DATA_DIR/auth/` (no tenant prefix).
- **gateway** (`consumers/gateway.mjs`): Parses payload, enforces allowlist/referral
  access, rate limits, handles static commands (`/ajuda`, `/carrinho`, etc.).
  Allowlist loaded from `allowlist` DB table (TTL cache 60s); seeds from
  `pi-config/allowlist.txt` on first start if table is empty.
- **aggregator** (`consumers/aggregator.mjs`): Debounces rapid-fire messages
  (2.5s window, configurable). Buffers messages while agent is processing.
- **enricher** (`consumers/enricher.mjs`): Loads customer profile, conversation
  history, cart, orders from PostgreSQL. Builds context block injected into
  agent prompt.
- **agent** (`consumers/agent.mjs`): Creates Pi Agent SDK session per user
  (cached with TTL, keyed by `phone`). 11 custom tools (cart, catalog, customer,
  order, referral). Sessions written to `DATA_DIR/pi-sessions/<phone>/`.
- **sender** (`consumers/sender.mjs`): Humanized typing delay (random 2–6s),
  sends via bridge. Publishes `completed` and `analytics` events.
- **analytics** (`consumers/analytics.mjs`): Terminal consumer. Logs MSG_OUT /
  MSG_IN / CMD_OUT to JSONL files in `LOG_DIR`. Updates CRM counters.

**RabbitMQ topology**: Two topic exchanges (`msg.flow`, `events`), one DLX
fanout (`dlx`). 10 queues. Defined in `shared/lib/rabbitmq.mjs`, initialized
by `setup/rabbitmq-init.mjs`.

**Database**: PostgreSQL 16 in a dedicated `database` container. All consumers
connect via `DATABASE_URL` using `postgres` (postgres.js v3). All repo methods
are async. Migrations run automatically at every consumer startup via `initDB()`.

**Configuration** — stored in PostgreSQL, seeded from `pi-config/` on first run:
- `app_config` table — single JSONB row with all runtime config (display_name,
  LLM model, session timing, PIX, available_models, etc.). Seeded from
  `pi-config/config.json` on first consumer startup if empty.
- `allowlist` table — phone patterns pre-authorized to bypass the referral gate.
  Seeded from `pi-config/allowlist.txt` on first gateway start if empty.

`pi-config/` (mounted read-only at `/config/pi`) holds Pi SDK artifacts and seed files:
- `config.json` — seed for `app_config` (read once → DB)
- `allowlist.txt` — seed for `allowlist` table (read once → DB)
- `AGENTS.md` — agent instructions + business context (Pi SDK discovers at every session)
- `models.json` — OpenRouter model definitions
- `settings.json` — Pi SDK settings (thinking level, compaction)
- `skills/` — Pi Agent skills
- `products.json` — product catalog for `seed-products.mjs` (optional)

After first boot, the DB is the source of truth. Use `setup/init-config.mjs`
to re-push file changes into the DB.

**Pi Agent SDK** (`consumers/agent.mjs`):
- `createAgentSession({ model, thinking, cwd: CONFIG_DIR, agentDir: CONFIG_DIR, ... })`
- `agentDir` = `CONFIG_DIR` = `/config/pi` — SDK discovers `AGENTS.md` and `skills/` here
- `cwd` = same `CONFIG_DIR` — SDK walks up from here to find `AGENTS.md`
- Sessions written to `DATA_DIR/pi-sessions/<phone>/` (writable volume; never inside
  the read-only `/config/pi`)
- Session cache keyed by `phone`; TTL from `config.session.ttl_minutes`
- `session.prompt(text)` is async; call `session.getLastAssistantText()` after awaiting
- `getLastAssistantText()` returns `undefined` when the LLM call errors

**Per-deployment env prefixes**:
- `ORDER_PREFIX` — prepended to order IDs (e.g. `#CDA-123`); non-alphanumeric chars
  stripped when used as PIX identifier
- `REFERRAL_CODE_PREFIX` — prepended to referral codes (default `REF-`)

## Commands

```bash
# Start all services (infra + bridge + 6 consumers)
docker compose up -d

# Start only consumers (infra already running)
docker compose up -d gateway aggregator enricher agent sender analytics

# Rebuild and restart a specific consumer
docker compose build agent && docker compose up -d agent

# Initialize RabbitMQ topology (run once, or after topology changes)
docker compose exec gateway node setup/rabbitmq-init.mjs

# Push pi-config files into DB (idempotent — use after editing config.json or allowlist.txt)
docker compose exec gateway node setup/init-config.mjs

# Seed products from JSON file (pi-config/products.json by default)
docker compose exec gateway node setup/seed-products.mjs [path/to/products.json]

# Send a test message through the pipeline without WhatsApp
docker compose exec gateway node setup/send-test-message.mjs "/ajuda"
docker compose exec gateway node setup/send-test-message.mjs --listen

# Run tests (needs PostgreSQL running at DATABASE_URL)
npm test                  # all unit + integration
npm run test:unit
npm run test:integration

# Install dependencies
npm install
```

## Deployment

The engine is published as a Docker image to `ghcr.io/grstein/cafe-platform`.

A production deployment:
1. Copies `examples/pi-config/` → `pi-config/` and customizes for the client
2. Sets env vars in `.env` (DATABASE_URL, RABBITMQ_URI, OPENROUTER_API_KEY, etc.)
3. Runs `docker compose -f docker-compose.prod.yml up -d`
4. Runs `setup/rabbitmq-init.mjs` (once), `setup/init-config.mjs`, `setup/seed-products.mjs`
5. Scans QR at `http://localhost:3001/qr`

**First-deploy checklist**:
1. `docker compose exec gateway node setup/rabbitmq-init.mjs`
2. `docker compose exec gateway node setup/init-config.mjs` — push config.json + allowlist.txt
3. `docker compose exec gateway node setup/seed-products.mjs pi-config/products.json`
4. Verify key: `curl -H "Authorization: Bearer $OPENROUTER_API_KEY" https://openrouter.ai/api/v1/auth/key`

## Shared Code (`shared/`)

- `db/` — PostgreSQL repos (postgres.js v3). **All methods async.**
  - `connection.mjs` — `getDB()` singleton, `initDB()` migration runner, `closeDB()`
  - `migrations.mjs` — versioned async migrations (v1 schema, v2 conversations+referrals,
    v3 app_config+allowlist)
  - `customers.mjs`, `products.mjs`, `orders.mjs`, `cart.mjs`, `conversations.mjs`,
    `referrals.mjs` — domain repos
  - `allowlist.mjs` — CRUD for phone patterns + `seedFromFile()` auto-seed on first start
- `lib/`
  - `config.mjs` — `loadConfig(sql)` async (reads DB, auto-seeds from JSON file);
    `getConfig()` sync (returns cache, throws if not pre-loaded); `updateConfig(sql, partial)`;
    `clearConfig()` for tests
  - `rabbitmq.mjs`, `envelope.mjs`, `baileys-client.mjs`, `pix.mjs`, `logger.mjs`
- `tools/` — 11 Pi Agent tool definitions: `search_catalog`, `add_to_cart`,
  `update_cart`, `remove_from_cart`, `view_cart`, `checkout`, `create_order`,
  `list_orders`, `save_customer_info`, `invite_customer`, `get_referral_info`
- `commands/` — static command handlers (all async): `/ajuda`, `/carrinho`
  (alias `/pedido`), `/confirma`, `/cancelar`, `/reiniciar`, `/indicar`, `/modelo`,
  `/admin` (operator-only, see `docs/reference/commands.md`)

**Envelope** (`shared/lib/envelope.mjs`): `createEnvelope({ phone, text, pushName, actor })`
returns the message object flowing through the pipeline. Contains `phone`, `payload`
(messages, merged_text, response), `context` (enriched data), `metadata`
(stage, timings, command_result, `actor` — `"admin" | "customer"`, default
`"customer"`). The gateway sets `actor="admin"` only for WhatsApp self-chat
from `BOT_PHONE`; future enricher/agent branching will key off this field.
No `tenant_id` field.

## Development Workflow

- **Test-first**: write or update the test before implementing. Confirm failure,
  implement, confirm pass.
- Tests require a running PostgreSQL at `DATABASE_URL`
  (default: `postgresql://cafe_test:test@localhost:5432/cafe_test`).
- Test helpers in `tests/helpers/`:
  - `createTestDB()` — async: connects, runs migrations, truncates tables,
    re-seeds `app_config` with `APP_CONFIG` fixture, returns postgres.js client
  - `createTestRepos(sql)` — returns `{ customers, products, orders, cart, referrals, conversations, allowlist }`
  - `seedProducts(sql)` — seeds 3 test products (Mr. Chocolate, Honey&Coffee, Blend Clássico)
  - `seedCustomer(sql, overrides)` — seeds a customer; `overrides.accessStatus` sets access status
  - `createMockChannel()` — for RabbitMQ publish/consume mocks
  - `PHONES`, `PRODUCTS`, `APP_CONFIG`, `PIX_CONFIG`, `ENVELOPE()`, `EVOLUTION_PAYLOAD()` from `fixtures.mjs`
- Tests run sequentially (`--test-concurrency=1`) to avoid PostgreSQL data races
  between test files sharing the same DB.
- `tests/setup.mjs` sets `ORDER_PREFIX=TEST-`, `REFERRAL_CODE_PREFIX=TEST-`,
  `DATABASE_URL`, `CONFIG_DIR` before any test module imports.

## Key Conventions

- ESM modules throughout (`.mjs` files, `"type": "module"` in package.json)
- All consumers follow: `initDB()` → `loadConfig(getDB())` → `connect()` →
  seed/init → `consume()` → process → `publish()` → `ack()`/`nack()`
- Repository pattern: `create*Repo(sql)` returns an object with async query methods;
  `sql` is the postgres.js tagged-template client from `getDB()`
- Config: call `await loadConfig(sql)` once at consumer startup;
  then `getConfig()` anywhere (sync, returns cache)
- No `TENANT_ID` — single-tenant per deployment
- `DATABASE_URL` — PostgreSQL connection string
  (e.g. `postgresql://cafe:pass@database:5432/cafe`)
- JSONB values: use `sql.json(obj)` (not `JSON.stringify + ::jsonb`) to avoid
  values being stored as JSON string literals instead of JSON objects
- Environment config via `.env`; key vars: `DATABASE_URL`, `RABBITMQ_URI`,
  `OPENROUTER_API_KEY`, `ORDER_PREFIX`, `REFERRAL_CODE_PREFIX`, `PIX_KEY`,
  `PIX_NAME`, `PIX_CITY`, `BOT_PHONE`, `DATA_DIR`, `LOG_DIR`, `CONFIG_DIR`
- RabbitMQ routing keys (plain stage names): `incoming`, `validated`, `ready`,
  `enriched`, `response`, `outgoing`, `send`, `completed`, `session_reset`
- GPix library for PIX QR code generation
- Test framework: Node.js native `node:test` + `node:assert/strict`; glob
  expansion of `**/*.test.mjs` requires Node.js 22+

## pi-config Files (provided per deployment)

```
pi-config/
  config.json       # display_name, llm, session, behavior, pix, bot_phone, available_models
  AGENTS.md         # All agent instructions + business context (Pi SDK discovers at runtime)
  allowlist.txt     # Pre-authorized phone numbers (one per line, # comments, * wildcards)
  products.json     # Product catalog array for seed-products.mjs (optional)
  models.json       # OpenRouter provider + model definitions
  settings.json     # defaultThinkingLevel, compaction settings
  skills/           # Pi Agent skills (discovered by SDK)
  prompts/          # Prompt templates
  extensions/       # Extensions
```

See `examples/pi-config/` for templates with all fields documented.

## Prototypes

UI mockups and prototypes live in `/prototypes/` (gitignored). The directory
may contain real PII for design reference, so it must never be committed.
Place any new mockup or HTML prototype there — not under `docs/`.

## Additional docs (load on demand)

Do not read these unless the current task matches them — they are not auto-loaded.

- `DESIGN.md` — visual design system for the admin UI (tokens, components,
  do's/don'ts). Read when writing any admin-UI code.
- `docs/admin-ui.md` — functional spec for the admin UI (architecture, screens,
  auth, pipeline integration). Read when implementing or extending admin screens.
- `TODO.md` — roadmap and backlog. Read when planning new work or picking up
  an open item.

### Configuration & customization reference (`docs/config/`, `docs/reference/`)

Reference docs for every configurable surface. Full index:
`docs/config/README.md`.

- `docs/config/env-vars.md` — env var reference (`.env`). Read when touching
  `.env`, `DATABASE_URL`, `RABBITMQ_URI`, `OPENROUTER_API_KEY`, `PIX_*`,
  `ORDER_PREFIX`, `REFERRAL_CODE_PREFIX`, paths.
- `docs/config/app-config.md` — `app_config` JSONB schema (LLM, session,
  behavior, PIX, available models). Read before changing any DB-backed
  runtime knob.
- `docs/config/pi-config.md` — layout of `pi-config/` and which file is
  read when. Read when confused about seed-once vs per-session files.
- `docs/config/agents-md.md` — authoring `pi-config/AGENTS.md`. Read when
  customizing persona, business context, or tool guardrails.
- `docs/config/models.md` — `pi-config/models.json` and `settings.json`.
  Read when adding an LLM model or tuning thinking/compaction.
- `docs/config/skills.md` — `pi-config/skills/`, `prompts/`,
  `extensions/`. Read when adding a Pi SDK skill.
- `docs/config/products.md` — `products.json` schema and seed-products
  upsert semantics. Read when editing the catalog.
- `docs/config/allowlist.md` — allowlist patterns, referral gating,
  `access_status` transitions. Read when debugging access control.
- `docs/reference/commands.md` — static `/command` catalog and how to add
  one. Read before adding a new command or changing alias behavior.
- `docs/reference/tools.md` — Pi Agent tools catalog (11 tools) and how
  to add one. Read before adding or modifying a tool.
- `docs/reference/database.md` — table schemas, lifecycle rules,
  migration conventions.
- `docs/reference/rabbitmq.md` — exchange/queue/routing table, DLQ ops,
  common failure modes.
- `docs/reference/setup-scripts.md` — `setup/*.mjs` reference with
  idempotency and re-run notes.
- `docs/reference/performance.md` — simulation scripts (`scripts/sim/*`),
  `PIPELINE_TIMING` events, prefetch tuning, known bottlenecks. Read when
  benchmarking or tuning throughput.
