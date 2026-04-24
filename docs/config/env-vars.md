# Environment Variables Reference

**Scope**: every environment variable read by the platform at runtime.
**Out of scope**: DB-backed runtime config (see [app-config.md](./app-config.md)),
`pi-config/` files (see [pi-config.md](./pi-config.md)).

Source of truth: `.env.example` + `grep -r "process.env\."` across
`consumers/`, `services/`, `shared/`, `setup/`.

Set these in `.env` at the repo root (not committed). `docker compose`
reads `.env` automatically.

## Infrastructure

| Name | Required | Default | Read by | Purpose |
|------|----------|---------|---------|---------|
| `DATABASE_URL` | yes | — | all consumers, setup/* | PostgreSQL connection string, e.g. `postgresql://cafe:pass@database:5432/cafe` |
| `POSTGRES_DB` | yes (compose) | `cafe` | `database` container | DB name created on first boot |
| `POSTGRES_USER` | yes (compose) | `cafe` | `database` container | DB role |
| `POSTGRES_PASSWORD` | yes (compose) | — | `database` container | Must match password in `DATABASE_URL` |
| `RABBITMQ_URI` | yes | — | all consumers, setup/rabbitmq-init, setup/send-test-message | AMQP URI, e.g. `amqp://evolution:pass@rabbitmq:5672/evolution` |
| `RABBITMQ_USER` | yes (compose) | — | `rabbitmq` container | Initial admin user |
| `RABBITMQ_PASSWORD` | yes (compose) | — | `rabbitmq` container | Must match password in `RABBITMQ_URI` |

## LLM

| Name | Required | Default | Read by | Purpose |
|------|----------|---------|---------|---------|
| `OPENROUTER_API_KEY` | yes | — | agent (via Pi SDK `models.json`) | OpenRouter API key. Validated by `models.json`'s `envVar` field. |

## PIX

Required only if `pix.enabled = true` in `app_config`.

| Name | Required | Default | Read by | Purpose |
|------|----------|---------|---------|---------|
| `PIX_KEY` | if pix enabled | — | gateway (`/confirma`) | PIX key (CPF, CNPJ, email, phone, or random key) |
| `PIX_NAME` | if pix enabled | `app_config.display_name` | gateway (`/confirma`) | Recipient name embedded in BR Code |
| `PIX_CITY` | if pix enabled | `"São Paulo"` | gateway (`/confirma`) | Recipient city embedded in BR Code |

## Identity & prefixes

| Name | Required | Default | Read by | Purpose |
|------|----------|---------|---------|---------|
| `BOT_PHONE` | no | `app_config.bot_phone` | gateway, agent (`/indicar`, `invite_customer`) | Digits-only WhatsApp number; used to build `wa.me/` referral links. Empty = no link is shown. |
| `ORDER_PREFIX` | no | `""` | gateway, cart-tools, order-tools, commands | Prepended to order IDs (e.g. `CDA-123`). Non-alphanumeric chars are stripped when used as PIX TXID. |
| `REFERRAL_CODE_PREFIX` | no | `"REF-"` | gateway, shared/db/customers | Prepended to referral codes. Gateway's code-detection regex is built from this. |

## Paths (container)

Only adjust if you change volume mounts in `docker-compose.yml`. Inside
containers, defaults are correct.

| Name | Default | Read by | Purpose |
|------|---------|---------|---------|
| `DATA_DIR` | `/data` | whatsapp-bridge (`DATA_DIR/auth/`), agent (`DATA_DIR/pi-sessions/<phone>/`) | Writable volume for Baileys auth state and Pi SDK session files. **Must be writable**; never place inside the read-only `/config/pi`. |
| `LOG_DIR` | `/logs` | analytics, logger | JSONL log output directory |
| `CONFIG_DIR` | `/config/pi` | config.mjs, allowlist.mjs, agent, setup/init-config, setup/seed-products | Root of `pi-config/`. Pi SDK discovers `AGENTS.md`, `skills/`, `models.json`, `settings.json` from here. Typically mounted `:ro`. |

## Test-only

Read only by test helpers or `send-test-message.mjs`.

| Name | Default | Read by | Purpose |
|------|---------|---------|---------|
| `INSTANCE_NAME` | `"demo"` | setup/send-test-message | Label injected into the synthetic Baileys payload |
| `QR_PORT` | `3001` | services/whatsapp-bridge | Port for the QR code web page |

## Validation notes

- `RABBITMQ_URI`, `DATABASE_URL` — no validation at boot; connection
  failures surface on first query. Check logs of each consumer.
- `OPENROUTER_API_KEY` — not validated at boot. The first LLM call will
  fail with a provider error. Verify manually:
  ```
  curl -H "Authorization: Bearer $OPENROUTER_API_KEY" https://openrouter.ai/api/v1/auth/key
  ```
- `BOT_PHONE` — digits only, include country + area code (e.g.
  `5541999999999`). No `+`, spaces, or punctuation.
- `REFERRAL_CODE_PREFIX` — any string. Regex-escaped before use, so
  punctuation is safe.

## Related

- [app-config.md](./app-config.md) — DB-backed runtime knobs (LLM model,
  session TTL, humanize delays, PIX enabled flag).
- [pi-config.md](./pi-config.md) — file-based configuration layout.
- [../reference/setup-scripts.md](../reference/setup-scripts.md) — scripts
  that consume these env vars.
