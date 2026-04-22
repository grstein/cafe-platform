# cafe-platform

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

Each stage is its own container; all communicate over RabbitMQ topic
exchanges. See [`CLAUDE.md`](./CLAUDE.md) for the detailed architecture,
pipeline stages, and conventions.

## Quickstart (local dev)

Requirements: Node.js 20+, Docker (or Podman + podman-compose),
`docker compose` v2 (or `podman-compose`).

```bash
git clone https://github.com/<owner>/cafe-platform.git
cd cafe-platform
cp .env.example .env                        # edit OPENROUTER_API_KEY, etc.
cp -r examples/tenants/demo-tenant tenants/demo-tenant
cp -r examples/pi-config pi-config
npm install
docker compose up -d                        # or: podman-compose up -d
```

Open `http://localhost:3001` to see the bridge status. When prompted,
scan the QR code with your WhatsApp app on a secondary number.

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

`tests/setup.mjs` is preloaded by the test scripts — it defines
`TENANT_ID=test-tenant` and neutral prefix env vars so tests don't require
a real tenant on disk.

## Building the Docker image

```bash
docker build -t cafe-platform:dev .
```

The Dockerfile is a two-stage Alpine build. The image contains only
`consumers/`, `services/`, `shared/`, `setup/`, and `node_modules/`. It is
tenant-agnostic by design — `tenants/` and `pi-config/` are bind-mounted
at runtime (see `docker-compose.yml`).

CI automatically publishes an image to
`ghcr.io/<owner>/cafe-platform:<sha>` and `:latest` on every push to
`main` (see `.github/workflows/publish.yml`).

## Configuration

All configuration is via environment variables. Copy `.env.example` to
`.env` and adjust values. Notable:

| Variable | Purpose |
|---|---|
| `TENANT_ID` | Active tenant; must match a subdirectory of `TENANTS_DIR` |
| `ORDER_PREFIX` | Optional prefix on order display IDs (e.g. `ORD-`) |
| `REFERRAL_CODE_PREFIX` | Prefix on generated referral codes (default `REF-`) |
| `RABBITMQ_URI` | AMQP connection string |
| `OPENROUTER_API_KEY` | Provider key for the LLM |
| `PIX_KEY`, `PIX_NAME`, `PIX_CITY` | PIX payment config (when `tenant.json:pix.enabled=true`) |
| `BOT_PHONE` | The bot's WhatsApp number (digits only, including country + area code) |
| `DATA_DIR`, `LOG_DIR`, `TENANTS_DIR`, `CONFIG_DIR` | In-container paths |

Tenant-level config lives in `tenants/${TENANT_ID}/tenant.json`. See
`examples/tenants/demo-tenant/tenant.json` for the expected shape.

## Deployment

The engine is distributed as an OCI image at
`ghcr.io/<owner>/cafe-platform`. A production deployment pairs this image
with a private tenant repo that owns the business configuration, uses a
`docker-compose.prod.yml` with `image:` (not `build:`), and persists data
in named Docker volumes. See the companion tenant repo for its
`deploy.md` runbook.

## Contributing

- Test-first: write or update the test before changing behavior.
- ESM only (`.mjs`, `"type": "module"`).
- Repository pattern for DB access; singletons loaded via `getDB()` /
  `getConfig()`.
- Never commit `.env`, `data/`, `logs/`, or tenant-specific files.

## License

MIT — see [`LICENSE`](./LICENSE).
