# CLAUDE.md

This file provides guidance to AI coding agents working in this repository.

## Project Overview

WhatsApp agent platform: reusable engine that connects to WhatsApp via
Baileys (`@whiskeysockets/baileys`), processes messages through a RabbitMQ
pipeline of 6 independent Node.js consumers, generates LLM responses via
the Pi Agent SDK (OpenRouter), and sends replies back.

**Single-tenant per deployment**: each client runs their own instance on their
own server. All configuration lives in a single `pi-config/` directory (mounted
into containers), following the same conventions as `~/.pi` in the Pi Agent SDK.

## Architecture

**Message pipeline** (each stage is a separate consumer process/container):

```
WhatsApp → Baileys Bridge → gateway → aggregator → enricher → agent → sender → Baileys Bridge → WhatsApp
                                                                          ↘ analytics
```

- **whatsapp-bridge** (`services/whatsapp-bridge.mjs`): Single Baileys
  WebSocket. Publishes incoming messages to `msg.flow` with routing key
  `incoming`. Consumes from `whatsapp.send` queue. Serves QR at `http://localhost:3001`.
- **gateway** (`consumers/gateway.mjs`): Parses payload, enforces
  allowlist/referral access, rate limits, handles static commands.
- **aggregator** (`consumers/aggregator.mjs`): Debounces rapid-fire messages
  (2.5s window). Buffers while agent is processing.
- **enricher** (`consumers/enricher.mjs`): Loads customer profile, conversation
  history, cart, orders from PostgreSQL. Builds context block for agent.
- **agent** (`consumers/agent.mjs`): Creates Pi Agent SDK session per user
  (cached with TTL, keyed by `phone`). 11 custom tools.
- **sender** (`consumers/sender.mjs`): Humanized typing delay, sends via bridge.
- **analytics** (`consumers/analytics.mjs`): Terminal consumer. Logs to JSONL,
  updates CRM counters.

**RabbitMQ topology**: Two topic exchanges (`msg.flow`, `events`), one DLX
fanout (`dlx`). 10 queues. Defined in `shared/lib/rabbitmq.mjs`, initialized
by `setup/rabbitmq-init.mjs`.

**Database**: PostgreSQL in a dedicated container (`database`). All consumers
connect via `DATABASE_URL` using `postgres` (postgres.js v3). All repo methods
are async. Migrations run automatically at consumer startup via `initDB()`.

**Configuration** — stored in the PostgreSQL database, not in files:
- `app_config` table — single JSONB row with all runtime config (display_name, LLM model,
  session timing, PIX, available_models, etc.). Seeded from `pi-config/config.json` on first run.
- `allowlist` table — phone patterns pre-authorized to bypass the referral gate. Seeded from
  `pi-config/allowlist.txt` on first gateway start if the table is empty.

`pi-config/` (mounted at `/config/pi`) still holds Pi SDK artifacts:
- `config.json` — seed file for `app_config` (read once on first run → seeded into DB)
- `allowlist.txt` — seed file for `allowlist` table (read once on first gateway start)
- `AGENTS.md` — agent instructions + business context (discovered by Pi SDK at runtime)
- `models.json` — OpenRouter model definitions
- `settings.json` — Pi SDK settings
- `skills/` — Pi Agent skills

After the first run, configuration lives entirely in the DB. Use `setup/init-config.mjs` to
re-push file-based config into the DB at any time.

**Pi Agent SDK** (`consumers/agent.mjs`):
- `createAgentSession({ model, thinking, cwd: CONFIG_DIR, agentDir: CONFIG_DIR, ... })`
- `agentDir` = `CONFIG_DIR` = `/config/pi` — SDK discovers `AGENTS.md` and `skills/` here
- **Sessions dir**: written to `/data/pi-sessions/<phone>/` (writable `data/` volume)
- Session cache keyed by `phone`; TTL from `config.session.ttl_minutes`
- `session.prompt(text)` is async; `session.getLastAssistantText()` after awaiting
- `getLastAssistantText()` returns `undefined` when LLM call errors

**Per-deployment env prefixes**:
- `ORDER_PREFIX` — prepended to order IDs (e.g. `#CDA-123`)
- `REFERRAL_CODE_PREFIX` — prepended to referral codes (default `REF-`)

## Commands

```bash
# Start all services (infra + bridge + 6 consumers)
docker compose up -d

# Start only consumers (infra already running)
docker compose up -d gateway aggregator enricher agent sender analytics

# Rebuild and restart a specific consumer
docker compose build agent && docker compose up -d agent

# Initialize RabbitMQ topology (run once after topology changes)
docker compose exec gateway node setup/rabbitmq-init.mjs

# Seed products from JSON file (pi-config/products.json by default)
# Push pi-config files into DB (idempotent — use after editing config.json or allowlist.txt)
  docker compose exec gateway node setup/init-config.mjs

# Seed products from JSON file (pi-config/products.json by default)
  docker compose exec gateway node setup/seed-products.mjs [path/to/products.json]

# Send a test message through the pipeline without WhatsApp
docker compose exec gateway node setup/send-test-message.mjs "/ajuda"
docker compose exec gateway node setup/send-test-message.mjs --listen

# Run tests (needs PostgreSQL running)
npm test               # all unit + integration tests
npm run test:unit
npm run test:integration

# Install dependencies
npm install
```

## Deployment

The engine is published as a Docker image to `ghcr.io/grstein/cafe-platform`.
A production deploy:
1. Copies `examples/pi-config/` → `pi-config/` and customizes for the client
2. Sets env vars in `.env` (DATABASE_URL, RABBITMQ_URI, OPENROUTER_API_KEY, etc.)
3. Runs `docker compose up -d`
4. Runs `docker compose exec gateway node setup/rabbitmq-init.mjs` (once)
5. Seeds products with `node setup/seed-products.mjs`
6. Scans QR at `http://localhost:3001/qr`

**First-deploy checklist**:
1. `docker compose exec gateway node setup/rabbitmq-init.mjs` — create RabbitMQ topology
2. *(optional)* `docker compose exec gateway node setup/init-config.mjs` — push config.json + allowlist.txt into DB (auto-done on first consumer start, but explicit is safer)
3. `docker compose exec gateway node setup/seed-products.mjs pi-config/products.json` — seed catalog
4. Verify `OPENROUTER_API_KEY`: `curl -H "Authorization: Bearer $KEY" https://openrouter.ai/api/v1/auth/key`

## Shared Code (`shared/`)

- `db/` — PostgreSQL repos (postgres.js): customers, products, orders, cart,
  conversations, referrals, allowlist, migrations, connection. **All methods async.**
  `allowlist.mjs` — CRUD for allowed phone patterns + `seedFromFile()` auto-seed.
- `lib/` — RabbitMQ wrapper, envelope helpers, Baileys client, PIX generation,
  app config, logger
- `tools/` — Pi Agent tool definitions (cart, catalog, customer, order, referral) — 11 tools
- `commands/` — Static command handlers (`/ajuda`, `/carrinho`, `/pedido`,
  `/confirma`, `/cancelar`, `/reiniciar`, `/indicar`, `/modelo`). **All async.**

**Envelope** (`shared/lib/envelope.mjs`): `createEnvelope({ phone, text, pushName })`
returns an envelope flowing through the pipeline. Contains `phone`, `payload`
(messages, merged_text, response), `context` (enriched data), `metadata`
(stage, timings, command_result). No tenant_id.

## Development Workflow

- **Test-first**: always write or update the test before implementing. Run to
  confirm failure, then implement, then confirm pass.
- Tests require a running PostgreSQL instance at `DATABASE_URL`.
- Test helpers in `tests/helpers/`:
  - `createTestDB()` — async, connects to PG, runs migrations, truncates data tables, seeds `app_config` with test config
  - `createTestRepos(sql)` — returns all repo instances
  - `seedProducts(sql)` — seeds 3 test products
  - `seedCustomer(sql, overrides)` — seeds a customer
  - `createMockChannel()` — for RabbitMQ tests
  - `PHONES`, `PRODUCTS`, `APP_CONFIG`, `ENVELOPE()`, `EVOLUTION_PAYLOAD()` from `fixtures.mjs`
- Tests run sequentially (`--test-concurrency=1`) to avoid PG data races.
- `tests/setup.mjs` sets `ORDER_PREFIX`, `REFERRAL_CODE_PREFIX`, `DATABASE_URL`, `CONFIG_DIR`.

## Key Conventions

- ESM modules throughout (`.mjs` files, `"type": "module"` in package.json)
- All consumers follow: `initDB()` → `connect()` → `consume()` → process → `publish()` → `ack()`/`nack()`
- Repository pattern: `create*Repo(sql)` returns an object with async query methods
- Config singleton: `getConfig()` from `shared/lib/config.mjs` — call `clearConfig()` in tests
- No `TENANT_ID` — single-tenant per deployment
- `DATABASE_URL` — PostgreSQL connection string (e.g. `postgresql://user:pass@database:5432/cafe`)
- Environment config via `.env`; key vars: `DATABASE_URL`, `RABBITMQ_URI`,
  `OPENROUTER_API_KEY`, `ORDER_PREFIX`, `REFERRAL_CODE_PREFIX`, `PIX_KEY`,
  `PIX_NAME`, `PIX_CITY`, `BOT_PHONE`, `DATA_DIR`, `LOG_DIR`, `CONFIG_DIR`
- RabbitMQ routing keys: `incoming`, `validated`, `ready`, `enriched`, `response`,
  `outgoing`, `send`, `completed`, `session_reset`
- GPix library used for PIX QR code generation
- Test framework: Node.js native test runner (`node:test` + `node:assert/strict`)

## pi-config Files (provided per deployment)

```
pi-config/
  config.json       # display_name, llm, session, behavior, pix, bot_phone, available_models
  AGENTS.md         # Global instructions + business context (discovered by Pi SDK)
  allowlist.txt     # Pre-authorized phone numbers
  products.json     # Product catalog for seed-products.mjs (optional)
  models.json       # OpenRouter model definitions
  settings.json     # Pi SDK settings
  skills/           # Pi Agent skills
  prompts/          # Prompt templates
```

See `examples/pi-config/` for templates.

## Additional docs (load on demand)

Do not read these unless the current task matches. They are not auto-loaded.

- `DESIGN.md` — visual design system for the admin UI (tokens,
  components, do's/don'ts). Read when writing any admin-UI code.
- `docs/admin-ui.md` — functional spec for the admin UI (architecture,
  screens, auth, integration with the pipeline). Read when implementing
  or extending admin screens.
- `TODO.md` — roadmap and backlog. Read when planning new work or
  picking up an open item.
