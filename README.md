# cafe-platform

[![CI](https://github.com/grstein/cafe-platform/actions/workflows/ci.yml/badge.svg)](https://github.com/grstein/cafe-platform/actions/workflows/ci.yml)
[![Publish Docker image](https://github.com/grstein/cafe-platform/actions/workflows/publish.yml/badge.svg)](https://github.com/grstein/cafe-platform/actions/workflows/publish.yml)

Reusable WhatsApp agent platform. Connects to WhatsApp via
[Baileys](https://github.com/WhiskeySockets/Baileys), pushes each message
through a RabbitMQ pipeline of six independent Node.js consumers, delegates
reasoning to the [Pi Agent SDK](https://github.com/mariozechner/pi-coding-agent),
and sends replies back.

The engine is single-tenant per instance. The active tenant is selected
via `TENANT_ID` and loaded from `tenants/${TENANT_ID}/tenant.json`.
Tenant-specific config (allowlists, catalogs, agent prompts, skills) lives
outside this repo — typically in a private companion repo that mounts its
`tenants/` and `pi-config/` directories at runtime.

## Architecture

```
WhatsApp ─▶ Baileys Bridge ─▶ gateway ─▶ aggregator ─▶ enricher ─▶ agent ─▶ sender ─▶ Baileys Bridge ─▶ WhatsApp
                                                                                ↘ analytics
```

Each stage runs as its own container and they communicate over two
RabbitMQ topic exchanges (`msg.flow`, `events`) plus a dead-letter fanout.
See [`CLAUDE.md`](./CLAUDE.md) for the detailed architecture, pipeline
stages, and conventions.

## Quickstart (local dev)

Requirements: Node.js 22+ (the test runner expands `**/*.test.mjs`
natively in v22), Docker (or Podman + podman-compose), `docker compose`
v2 (or `podman-compose`).

```bash
git clone https://github.com/grstein/cafe-platform.git
cd cafe-platform
cp .env.example .env                               # edit OPENROUTER_API_KEY, etc.
cp -r examples/tenants/demo-tenant tenants/demo-tenant
cp -r examples/pi-config pi-config
npm install
docker compose up -d                               # or: podman-compose up -d
```

Open `http://localhost:3001` to see the bridge status. When prompted,
scan the QR code with a WhatsApp account you control (a secondary number
is recommended during development).

Initialize the RabbitMQ topology (once, or after topology changes) and
seed the catalog:

```bash
docker compose exec gateway node setup/rabbitmq-init.mjs
docker compose exec gateway node setup/seed-products.mjs
```

Send a synthetic message through the pipeline (no WhatsApp required):

```bash
docker compose exec gateway node setup/send-test-message.mjs "/ajuda"
```

## Running the tests

```bash
npm test                 # unit + integration
npm run test:unit
npm run test:integration
```

`tests/setup.mjs` is preloaded by the test scripts — it sets
`TENANT_ID=test-tenant`, `ORDER_PREFIX=TEST-`, and
`REFERRAL_CODE_PREFIX=TEST-` so tests don't require a real tenant on
disk.

## Building the Docker image

```bash
docker build -t cafe-platform:dev .                # or: podman build -t localhost/cafe-platform:dev .
```

The Dockerfile is a two-stage Alpine build. The runtime image contains
only `consumers/`, `services/`, `shared/`, `setup/`, and `node_modules/`
— no tenant data. `tenants/` and `pi-config/` are bind-mounted at
runtime (see `docker-compose.yml`).

CI automatically publishes an image on every push to `main`:

- `ghcr.io/grstein/cafe-platform:latest`
- `ghcr.io/grstein/cafe-platform:<sha>` (full 40-char SHA and short 7-char)

See `.github/workflows/publish.yml`.

## Configuration

All configuration is via environment variables. Copy `.env.example` to
`.env` and adjust values. Notable:

| Variable | Purpose |
|---|---|
| `TENANT_ID` | Active tenant; must match a subdirectory of `TENANTS_DIR`. **Required** — `getTenantId()` throws if unset |
| `ORDER_PREFIX` | Prefix on order display IDs (e.g. `ORD-`). Also used as the PIX identifier prefix — non-alphanumeric chars are stripped there |
| `REFERRAL_CODE_PREFIX` | Prefix on generated referral codes (default `REF-`) |
| `RABBITMQ_URI` | AMQP connection string |
| `OPENROUTER_API_KEY` | Provider key for the LLM (Pi Agent SDK via OpenRouter) |
| `PIX_KEY`, `PIX_NAME`, `PIX_CITY` | PIX payment config (when `tenant.json:pix.enabled=true`) |
| `BOT_PHONE` | The bot's WhatsApp number (digits only, country + area code) |
| `DATA_DIR`, `LOG_DIR`, `TENANTS_DIR`, `CONFIG_DIR` | In-container paths |

Tenant-level config lives in `tenants/${TENANT_ID}/tenant.json`. See
`examples/tenants/demo-tenant/tenant.json` for the expected shape.

## Deployment

The engine is distributed as an OCI image at
`ghcr.io/grstein/cafe-platform` (multi-tag: `latest`, `<sha>`,
semver tags when released). A production deployment pairs this image
with a private tenant repository that owns the business configuration,
uses a `docker-compose.prod.yml` with `image:` (not `build:`), and
persists data in named Docker volumes (`cafe_data`, `cafe_logs`). See
the companion tenant repo's `deploy.md` for its runbook.

Typical production lifecycle:

1. Push to `main` in this repo → CI runs tests → `publish.yml` builds
   and pushes `ghcr.io/grstein/cafe-platform:<sha>` and `:latest`.
2. Push to `main` in the tenant repo (or manual `workflow_dispatch`) →
   its `deploy.yml` SSHes into the VPS, runs `docker compose pull` +
   `up -d`, and the new image is live.

## Contributing

- Test-first: write or update the test before changing behavior.
- ESM only (`.mjs`, `"type": "module"`).
- Repository pattern for DB access; singletons loaded via `getDB()` /
  `getConfig()`.
- Never commit `.env`, `data/`, `logs/`, or tenant-specific files —
  they are git-ignored.
- Don't hardcode tenant identifiers, phone numbers, or PIX data in
  code or tests. Prefer env vars (`ORDER_PREFIX`, `REFERRAL_CODE_PREFIX`,
  `BOT_PHONE`) or neutral fixtures.

## License

MIT — see [`LICENSE`](./LICENSE).
