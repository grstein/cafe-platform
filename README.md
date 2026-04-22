# cafe-platform

[![CI](https://github.com/grstein/cafe-platform/actions/workflows/ci.yml/badge.svg)](https://github.com/grstein/cafe-platform/actions/workflows/ci.yml)
[![Publish Docker image](https://github.com/grstein/cafe-platform/actions/workflows/publish.yml/badge.svg)](https://github.com/grstein/cafe-platform/actions/workflows/publish.yml)

Reusable WhatsApp agent platform. Connects to WhatsApp via
[Baileys](https://github.com/WhiskeySockets/Baileys), pushes each message
through a RabbitMQ pipeline of six independent Node.js consumers, delegates
reasoning to the [Pi Agent SDK](https://github.com/mariozechner/pi-coding-agent),
and sends replies back.

**Single-tenant per deployment** — no `TENANT_ID`, no `tenants/` directory.
Each client gets their own server instance. All configuration lives in a
single `pi-config/` directory (following the same conventions as `~/.pi`)
and is stored in a PostgreSQL database after the first boot.

## Architecture

```
WhatsApp ─▶ Baileys Bridge ─▶ gateway ─▶ aggregator ─▶ enricher ─▶ agent ─▶ sender ─▶ Baileys Bridge ─▶ WhatsApp
                                                                                ↘ analytics
```

Each stage runs as its own container and communicates over two RabbitMQ
topic exchanges (`msg.flow`, `events`) plus a dead-letter fanout. The
`database` container (PostgreSQL 16) stores customers, orders, cart,
conversations, referrals, the allowlist, and the runtime configuration.

See [`CLAUDE.md`](./CLAUDE.md) for the detailed architecture, pipeline
stages, and conventions.

## Quickstart (local dev)

**Requirements:** Node.js 22+, Docker Compose v2 (or Podman + podman-compose).

```bash
git clone https://github.com/grstein/cafe-platform.git
cd cafe-platform

# 1. Copy and configure environment
cp .env.example .env
# Edit .env: set POSTGRES_PASSWORD, DATABASE_URL, OPENROUTER_API_KEY, PIX_*, BOT_PHONE

# 2. Copy the example pi-config (business configuration seed)
cp -r examples/pi-config pi-config
# Edit pi-config/config.json: display_name, llm.model, pix.enabled, etc.
# Edit pi-config/allowlist.txt: add phone numbers that can access the bot
# Edit pi-config/AGENTS.md: business context for the agent

# 3. Install dependencies and start the stack
npm install
docker compose up -d
```

Initialize RabbitMQ topology and seed the database (run once on first boot):

```bash
docker compose exec gateway node setup/rabbitmq-init.mjs   # create exchanges/queues
docker compose exec gateway node setup/init-config.mjs     # push config + allowlist → DB
docker compose exec gateway node setup/seed-products.mjs pi-config/products.json
```

Then open `http://localhost:3001/qr` to scan the WhatsApp QR code.

Send a synthetic message through the pipeline (no WhatsApp required):

```bash
docker compose exec gateway node setup/send-test-message.mjs "/ajuda"
docker compose exec gateway node setup/send-test-message.mjs --listen
```

> **Note:** After the first boot, `config.json` and `allowlist.txt` are seeded
> into PostgreSQL automatically and become the source of truth. Editing the files
> later requires re-running `init-config.mjs` to push changes into the DB.

## Running the tests

A running PostgreSQL instance is required. Set `DATABASE_URL` in your environment
or `.env` file pointing to a test database (e.g. `postgresql://cafe_test:test@localhost:5432/cafe_test`).

```bash
npm test             # unit + integration (sequential to avoid DB race conditions)
npm run test:unit
npm run test:integration
```

`tests/setup.mjs` preloads `ORDER_PREFIX=TEST-`, `REFERRAL_CODE_PREFIX=TEST-`,
and `DATABASE_URL`. `createTestDB()` truncates tables and re-seeds `app_config`
before each test suite — no persistent state bleeds between files.

## Building the Docker image

```bash
docker build -t cafe-platform:dev .
```

The Dockerfile is a two-stage Alpine build. The runtime image contains only
`consumers/`, `services/`, `shared/`, `setup/`, and `node_modules/` — no
business data. `pi-config/` is bind-mounted read-only at `/config/pi`.

CI publishes automatically on every push to `main`:

- `ghcr.io/grstein/cafe-platform:latest`
- `ghcr.io/grstein/cafe-platform:<sha>` (full 40-char SHA and short 7-char)

See `.github/workflows/publish.yml`.

## Configuration

All runtime config is in the `app_config` PostgreSQL table (single JSONB row),
seeded from `pi-config/config.json` on first run. The allowlist lives in the
`allowlist` table, seeded from `pi-config/allowlist.txt` on first gateway start.

Environment variables control infrastructure; they do **not** replace `config.json`:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string (required) |
| `RABBITMQ_URI` | AMQP connection string |
| `OPENROUTER_API_KEY` | LLM provider key (Pi Agent SDK via OpenRouter) |
| `ORDER_PREFIX` | Prefix on order/PIX identifiers (e.g. `CDA-`) |
| `REFERRAL_CODE_PREFIX` | Prefix on referral codes (default `REF-`) |
| `PIX_KEY`, `PIX_NAME`, `PIX_CITY` | PIX payment credentials |
| `BOT_PHONE` | Bot's WhatsApp number (digits only, with country + area code) |
| `DATA_DIR`, `LOG_DIR`, `CONFIG_DIR` | In-container paths (rarely changed) |

`config.json` shape (stored in `app_config`):

```json
{
  "display_name": "My Store",
  "llm": { "provider": "openrouter", "model": "anthropic/claude-haiku-4.5", "thinking": "medium" },
  "session": { "ttl_minutes": 30, "soft_limit": 40, "hard_limit": 60, "debounce_ms": 2500 },
  "behavior": { "humanize_delay_min_ms": 2000, "humanize_delay_max_ms": 6000, "rate_limit_per_min": 8, "typing_indicator": true },
  "pix": { "enabled": false },
  "bot_phone": "5541999990000",
  "available_models": []
}
```

## Deployment

The engine ships as an OCI image at `ghcr.io/grstein/cafe-platform`. A
production deployment pairs this image with a **private client repository**
that owns `pi-config/` and a `docker-compose.prod.yml` with `image:` instead
of `build:`.

Typical lifecycle:

1. Push to `main` in this repo → CI tests + publishes `cafe-platform:<sha>` and `:latest`.
2. Push to `main` in the client repo → its `deploy.yml` SSHes into the VPS,
   runs `docker compose pull && up -d`, and the new image is live.

First-time VPS checklist:

```bash
docker compose -f docker-compose.prod.yml up -d
docker compose -f docker-compose.prod.yml exec gateway node setup/rabbitmq-init.mjs
docker compose -f docker-compose.prod.yml exec gateway node setup/init-config.mjs
docker compose -f docker-compose.prod.yml exec gateway node setup/seed-products.mjs /config/pi/products.json
# then: ssh -L 3001:127.0.0.1:3001 root@<vps>  →  open http://localhost:3001/qr
```

## pi-config structure

```
pi-config/
  config.json       # Runtime app config → seeded into app_config table
  AGENTS.md         # Agent instructions + business context (Pi SDK discovers at runtime)
  allowlist.txt     # Pre-authorized phones → seeded into allowlist table
  products.json     # Product catalog (optional, for seed-products.mjs)
  models.json       # OpenRouter model definitions
  settings.json     # Pi SDK settings (thinking level, compaction)
  skills/           # Pi Agent skills
  prompts/          # Prompt templates
```

See `examples/pi-config/` for ready-to-use templates.

## Contributing

- Test-first: write or update the test before changing behavior.
- ESM only (`.mjs`, `"type": "module"`).
- All DB repo methods are async (postgres.js v3); use `await` everywhere.
- Repository pattern: `create*Repo(sql)` returns an object. Singletons via `getDB()`.
- Config singleton: `loadConfig(sql)` at consumer startup; `getConfig()` anywhere after.
- Never commit `.env`, `data/`, `logs/`, or `pi-config/` with real business data.
- No hardcoded phone numbers, PIX keys, or API keys in code or tests.

## License

MIT — see [`LICENSE`](./LICENSE).
