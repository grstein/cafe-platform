# Admin UI — functional spec

Functional specification for the operator console of a `cafe-platform`
deployment. This document owns **what** the admin UI does and **how**
it plugs into the running system. Visual treatment is defined in
[`../DESIGN.md`](../DESIGN.md). Roadmap is in [`../TODO.md`](../TODO.md).

Load this file when actively working on the admin UI. It is not
automatically included in every conversation.

---

## 1. Context

`cafe-platform` is **single-tenant per deployment**: one instance serves
one shop. Today the operator has only:

- SSH to the VPS to run `docker compose`.
- The Baileys bridge status page at `http://localhost:3001`.
- RabbitMQ management UI at `http://localhost:15672`.
- PostgreSQL on `127.0.0.1:5432` for ad-hoc SQL.
- JSONL logs at `logs/YYYY-MM-DD.jsonl`.

There is no unified console. Product actions — confirm a pending order,
edit the catalog, switch a customer's model, inspect a conversation —
require SQL or file edits on the server. The admin UI replaces those
with a web console bound to `127.0.0.1` and exposed through an
authenticated tunnel (Cloudflare Access, Tailscale, or a reverse proxy).

---

## 2. Audience & use cases

| Persona | Frequency | Primary job-to-be-done |
|---|---|---|
| **Shop owner** (non-technical) | Daily | Review new orders, mark paid, mark shipped, edit prices, step in on stuck conversations |
| **Support operator** (semi-technical) | Ad-hoc | Reset a session, add a phone to allowlist, find out why a message was not delivered |
| **Developer / SRE** (technical) | Occasional | Monitor queues, replay DLX, edit `config.json`, run the catalog seed, reconnect Baileys |

One UI serves all three. Heavier controls live behind extra
confirmation (see DESIGN.md §5.6) and are grouped under **Operação** and
**Configuração**.

---

## 3. Scope & non-goals

### In scope (v1)

- Read/write for domain data: customers, orders, products, cart,
  conversations, referrals.
- Read-only observability: queue depth, bridge status, logs, LLM key
  health.
- Runtime controls: reset a session, purge a queue, reconnect Baileys.
- Edit tenant config: `pi-config/config.json`, `pi-config/models.json`,
  `pi-config/allowlist.txt`, `pi-config/AGENTS.md`.
- Single-admin auth (password + bcrypt).

### Explicitly not in scope

- Multi-tenant switcher (each deploy is single-tenant by design).
- Multi-user RBAC (deferred — see `TODO.md`).
- Customer-facing surface (pricing pages, marketing, etc.).
- LLM prompt editor (too risky without versioning; out of v1).
- Analytics beyond today's numbers and the last 24h chart.

---

## 4. Architecture

### 4.1 New service in `docker-compose.yml`

```yaml
admin:
  container_name: platform_admin
  build: { context: . }
  command: ["node", "services/admin.mjs"]
  restart: unless-stopped
  depends_on:
    rabbitmq: { condition: service_healthy }
    database: { condition: service_healthy }
  ports: ["127.0.0.1:3002:3002"]     # localhost-only; expose via tunnel
  env_file: [.env]
  volumes:
    - ./data:/data
    - ./logs:/logs:ro
    - ./pi-config:/config/pi         # RW for the admin (others mount :ro)
  networks: [platform]
  deploy: { resources: { limits: { memory: 256M } } }
```

- Binds to `127.0.0.1` — public exposure is the deployer's responsibility
  (Cloudflare Tunnel, Tailscale, nginx/Caddy with TLS + auth).
- Same image as every other consumer. One Docker build.
- Only the admin mounts `pi-config/` read-write. Consumers stay `:ro`.

### 4.2 Data sources and write paths

```
                  ┌──────────────────────────────┐
                  │          admin (3002)        │
                  └──┬──────┬──────┬──────┬──────┘
                     │      │      │      │
        Postgres     │      │      │      │  file I/O
        (shared/db)  │      │      │      │  (pi-config/, logs/)
                     │      │      │      │
                RabbitMQ   Bridge  LLM
                Mgmt API   HTTP    (OpenRouter
                :15672     :3001    health only)
```

Rule: writes that touch **domain data** go through the existing
`shared/db/*.mjs` repositories. Writes that change **pipeline runtime
state** publish a bus event so the existing consumers react. The admin
has no private state machine.

| Admin action | Path |
|---|---|
| Mark order `paid` | `repos.orders.updateStatus(id, 'paid')` |
| Reset a phone's agent session | Publish `session_reset` on `events` exchange (agent already consumes) |
| Edit catalog entry | `repos.products.upsert(...)` |
| Add phone to allowlist | Write `pi-config/allowlist.txt` → publish `allowlist_reload` (new event, see §5) |
| Send test message through pipeline | Publish `incoming` on `msg.flow` (same path as `setup/send-test-message.mjs`) |
| Purge a queue | `DELETE /api/queues/evolution/<name>/contents` on RabbitMQ Mgmt API |
| Reconnect Baileys | `POST /reconnect` on bridge (new endpoint, see §5) |
| Edit `config.json` | Write file atomically → publish `config_reload` (new event, see §5) |

### 4.3 Stack

- **Runtime:** Node.js 22, ESM `.mjs` — same as consumers.
- **HTTP:** `fastify` + `@fastify/secure-session` +
  `@fastify/csrf-protection` + `@fastify/rate-limit`.
- **Views:** `@fastify/view` with EJS server-side templates.
- **Interactivity:** HTMX for partial updates, Alpine.js for small
  local state. No build step beyond a one-shot Tailwind compile.
- **CSS:** Tailwind. Tokens from DESIGN.md mapped to a static
  `tailwind.config.js`. Output committed to
  `services/admin/public/admin.css`.
- **Background jobs:** short tasks (run seed, curl OpenRouter) spawn a
  child process; long tasks are rejected — the admin does not host
  workers.

### 4.4 Auth

v1 is single-admin:

- `ADMIN_PASSWORD_HASH` in `.env` (bcrypt, 12 rounds).
- `setup/admin-set-password.mjs` prompts for a password and prints the
  hash for the operator to paste into `.env`.
- `POST /login` → signed session cookie `admin_sess`, TTL 12h, `HttpOnly
  SameSite=Lax Secure` (Secure applies behind TLS proxy).
- `GET /logout` destroys the cookie.
- All routes except `/login`, `/healthz`, and `/public/*` require a
  valid session.
- Rate limit: 5 login attempts per 15 min per IP; 10 destructive
  actions per minute per session.

Future (Phase 3): an `admin_users` table with roles
(`owner` / `operator` / `viewer`) and optional OIDC via Cloudflare
Access. Not part of v1.

---

## 5. Upstream changes needed

The admin UI requires additive changes in existing services. Each is
independent and ships in its own PR.

### 5.1 `consumers/agent.mjs`

- Expose `GET /sessions` on an internal port (`:3013`, cluster-network
  only). Returns a JSON snapshot of `sessionCache`:
  `[{ phone, model, msgCount, lastUsed, ageMs }]`.
- Already consumes `session_reset` — no change needed there.

### 5.2 `consumers/gateway.mjs`

- Expose `GET /rate-limits` on `:3010` — snapshot of the in-memory
  rate-limit windows and allowlist cache.
- Expose `POST /rate-limits/:phone/reset`.
- Consume a new `allowlist_reload` event on `events` exchange and
  re-read `pi-config/allowlist.txt` immediately (bypassing the 60s TTL).

### 5.3 `services/whatsapp-bridge.mjs`

- Expose `POST /reconnect` — tears down and recreates the Baileys
  connection.
- Append connection events to `data/bridge-events.jsonl` with
  `{ ts, type: 'connected'|'disconnected', reason }` so the admin can
  show the last-disconnect banner.

### 5.4 Config reload

- Add a `config_reload` event on `events` exchange.
- `shared/lib/config.mjs.getConfig()` caches on first read; add a
  consumer-side handler that calls `clearConfig()` when
  `config_reload` arrives. Not all settings hot-reload cleanly
  (`llm.model` requires a new session); the admin UI flags those.

---

## 6. Information architecture

Side nav on desktop; bottom tabs + menu on mobile. Screens are grouped:

- **Diário** — Visão Geral, Pedidos, Clientes, Catálogo, Conversas,
  Indicações
- **Sistema** — Agente, Acesso, Operação, Configuração, Auditoria

---

## 7. Screens

Each screen below: **purpose · content · actions · data sources**.
States (empty, loading, error) are defined in DESIGN.md §5.7 and must
be implemented everywhere.

### 7.1 Visão Geral (Dashboard)

**Purpose.** In under five seconds: is the system healthy, and is there
anything the operator must do right now?

**Content.**
- Health cards (4): WhatsApp bridge, database, queues, OpenRouter key.
- Today's KPIs: messages in/out, commands executed, new orders, paid
  orders, unique customers, revenue confirmed.
- Last-24h message volume chart (line, hourly buckets).
- Two short lists: "Pedidos pendentes" (5), "Conversas recentes" (5).

**Actions.** Click any red card → opens the relevant screen.

**Data sources.** Bridge `/` for connection; `SELECT 1` for DB;
RabbitMQ `GET /api/queues` for depth; OpenRouter
`GET /api/v1/auth/key` for credit; JSONL `logs/YYYY-MM-DD.jsonl` for
message counts; `orders` and `customers` tables for KPIs and lists.

### 7.2 Pedidos

**Purpose.** The highest-traffic screen. Drive orders through
`pending → confirmed → paid → shipped → delivered`.

**Content.** Filterable table (status multi-select, date range, search
by phone/name/ID). Default filter: `pending|confirmed|paid` in the
last 7 days.

Columns: order ID (with `ORDER_PREFIX`), customer (name + phone),
items count, total, status badge, created.

**Drawer.** Status transition buttons, parsed item list, totals
breakdown, customer link, CEP, notes, editable `tracking` when status
is `shipped`, "Copiar PIX" (regenerates via `generatePixCode`),
timeline of status timestamps, "Reimprimir recibo" modal.

**Actions.** Transition status (writes the matching `*_at` column via
`repos.orders.updateStatus`); edit notes/tracking; export CSV of
current filter; cancel (Level 2 confirmation, requires a reason written
into `orders.notes`).

**Data sources.** `repos.orders.listByPhone` with filter extension
(extension required); `repos.customers.getByPhone` for customer chip;
`shared/lib/pix.mjs` for PIX.

### 7.3 Clientes

**Purpose.** Lightweight CRM — tag, note, fix address, inspect
behavior.

**Content.** List with filters (tag, `access_status`, has-orders,
last-seen). Columns: phone, name (preferring `name` over `push_name`),
tags, order count, total spent, last-seen, access badge.

**Detail page** (not drawer — too much content):

1. Header — name, phone (links to `wa.me/`), referral code, `Resetar
   sessão`, `Bloquear`, primary tag.
2. Editable profile (`repos.customers.updateInfo`).
3. Preferences — `preferences.modelo` dropdown + JSON editor
   (toggleable).
4. Tags — chips, `addTag` / `removeTag`.
5. Internal notes — `notes` textarea.
6. Conversation timeline — paginated 50/page from `conversations`,
   role-colored, `tool_name` badge. Read-only.
7. Current cart + `Esvaziar carrinho`.
8. Orders — inline filter from 7.2.
9. Referrals — as referrer and as referred.
10. Counters + `Recalcular contadores` (`updateCounters`).

**Data sources.** `repos.customers`, `repos.conversations`,
`repos.cart`, `repos.orders`, `repos.referrals`.

### 7.4 Catálogo

**Purpose.** Edit prices and stock fast; add and deactivate products.

**Content.** Table: SKU, name, roaster, price, stock, SCA, available
(switch), actions. Search by name/roaster/origin.

**Inline editing** on price, stock, available (saves onBlur via
`repos.products.upsert` / `updateStock` / `setAvailable`).

**Drawer.** Full fields including `sca_score`, `profile`, `origin`,
`process`, `weight`, `highlight`, `knowledge_file`. Upload on
`knowledge_file` writes into `pi-config/skills/products/`.

**Import.** `Importar do products.json` runs
`setup/seed-products.mjs` as a subprocess, previewing the diff (create
/ update / deactivate counts) before applying. Manual CSV upload
follows the same diff-then-apply flow.

**Bulk actions.** Select rows → Deactivate, Activate, Apply X% discount.

**Data sources.** `repos.products`; `setup/seed-products.mjs` for
import.

### 7.5 Conversas

**Purpose.** Inspect what the bot is saying live, and investigate past
complaints.

**Content.**
- **Live mode** — Server-Sent Events stream tailing today's JSONL.
  Filters: phone, command, only failures.
- **History mode** — search `conversations` by phone and time range.

**Drilldown.** Click a message → modal with the envelope
(`metadata.timings`, `correlation_id`, `context` block sent to the
LLM, `command_result`). Answers "why did the bot respond this way?"

**Data sources.** `logs/YYYY-MM-DD.jsonl` (tailed), `conversations`
table.

### 7.6 Indicações

**Purpose.** Track the referral program; release rewards manually when
needed.

**Content.** Metrics (issued, activated, rewarded, conversion rate,
total discount given). Filterable table from `referrals` joined with
`customers` for names.

**Actions.** Per row: `Marcar recompensado` (choose which order →
`markRewarded(id, orderId)`); `Ajustar recompensa`
(`reward_type` / `reward_value`); `Revogar` (deferred: requires a
`cancelled` status value — migration in TODO.md).

**Top referrers.** Ranked by `countByReferrer(...).total`.

### 7.7 Agente

**Purpose.** Understand and intervene in agent runtime state.

**Content.**

- **Active sessions** — table from `GET /sessions` on the agent.
  Columns: phone, model, age, msg count vs. soft/hard limits. Action:
  `Encerrar sessão` publishes `session_reset`.
- **Available models** — list from `pi-config/models.json`. CRUD
  writes that file.
- **Agent settings** — `thinking` (low/medium/high), session TTL,
  soft/hard limits, debounce. Writes
  `pi-config/settings.json`. Banner: "Restart `agent` to apply."
- **Message simulator** — send a synthetic `incoming` to the pipeline
  and stream the response by `correlation_id`.
- **`AGENTS.md` viewer** — read-only preview of `pi-config/AGENTS.md`.
  Edit with diff and rollback is deferred (Phase 3).

### 7.8 Acesso

**Purpose.** Control who may message the bot.

**Content.**
- **Allowlist editor** — two groups (exact numbers, `*`-prefixes), each
  with optional inline comment. Saves `pi-config/allowlist.txt` and
  publishes `allowlist_reload`.
- **Rate limit** — snapshot from `GET /rate-limits` on gateway. Reset
  per-phone; adjust global threshold (writes `config.json`).
- **Access status** — filter by `customers.access_status`; change via
  inline dropdown.

### 7.9 Operação

**Purpose.** Diagnose and recover.

**Content.**

- **Bridge** — status badge; embedded QR (proxied from
  `http://whatsapp-bridge:3001/qr`); `Reconectar` button; last
  disconnect reason from `data/bridge-events.jsonl`.
- **RabbitMQ** — queue table (name, depth, consumers, in/out rate) from
  `GET /api/queues`. Red badge for depth > 50 or DLX > 0. Per-queue
  actions: `Purgar` (Level 3 confirmation); for `dead-letters`,
  `Inspecionar` (lists messages with `x-death` error) and
  `Reenfileirar`.
- **Logs** — file selector, filters (stage, phone), download,
  structured viewer (same as 7.5).
- **Setup scripts** — buttons for `setup/rabbitmq-init.mjs`,
  `setup/seed-products.mjs`, `setup/send-test-message.mjs "/ajuda"`,
  and an OpenRouter key check.

### 7.10 Configuração

**Purpose.** Edit tenant config through a form instead of SSH.

**Content.**

- **`pi-config/config.json` editor** — form with sections
  (`display_name`, `llm`, `session`, `behavior`, `pix`, `bot_phone`).
  Zod validation. Each save writes a `.bak` of the previous version.
  Banner indicates which consumers must restart (e.g. `llm.model`
  change requires agent restart).
- **`pi-config/models.json` editor** — CRUD on the available-models
  array.
- **PIX block** — `PIX_KEY`, `PIX_NAME`, `PIX_CITY` are `.env`
  values; shown masked, read-only. Editing requires the operator to
  edit `.env` and restart (documented).
- **`.env` viewer** — read-only list of all variables with values
  masked (`••••1234`). Never editable from the UI.
- **Tenant `AGENTS.md`** — read-only in v1.

### 7.11 Auditoria

**Purpose.** "Who changed this yesterday at 14:00?"

**Sources.**
1. `admin_audit` table (new migration):
   `(id, admin_user, action, target_type, target_id, before, after, at)`.
   Every mutation writes one row **before** executing.
2. System events from existing JSONL (MSG_IN, MSG_OUT, CMD_OUT).

**Content.** Filter by user, target, period. CSV export.

---

## 8. Interaction patterns

All interaction patterns, state treatment, confirmation levels, and
visual rules live in [DESIGN.md](../DESIGN.md). Highlights:

- Every list implements the four states (loading / empty / error /
  permission denied) from DESIGN.md §5.7.
- Confirmation levels from DESIGN.md §5.6 are mandatory — never
  downgrade.
- Every badge uses the semantic mapping in DESIGN.md §6.

---

## 9. Security

- Bind on `127.0.0.1`; public exposure through an authenticated tunnel
  is a **deployment requirement**, not optional.
- `ADMIN_PASSWORD_HASH` is bcrypt, 12 rounds. No plaintext passwords in
  transit beyond TLS.
- CSRF token on every mutating route.
- Admin logs never print `.env` values in plaintext — they are always
  masked.
- Every destructive endpoint writes to `admin_audit` *before* executing.
- Login rate-limited (5/15min/IP); destructive endpoints rate-limited
  (10/min/session).
- PostgreSQL and RabbitMQ stay bound to `127.0.0.1` in the compose file
  (they already are).

---

## 10. Observability the admin surfaces

All signals exist today; the admin just aggregates them.

| Signal | Source | Used on |
|---|---|---|
| Bridge connection state | Bridge `/` + new `bridge-events.jsonl` | 7.1, 7.9 |
| Queue depth / consumers / in/out rate | RabbitMQ `GET /api/queues` | 7.1, 7.9 |
| DLX contents | RabbitMQ `GET /api/queues/.../dead-letters/get` | 7.9 |
| Messages in/out/commands (daily) | `logs/YYYY-MM-DD.jsonl` aggregation | 7.1 |
| Pipeline latency by stage | `envelope.metadata.timings` in JSONL | 7.5 |
| Active agent sessions | New `GET /sessions` on agent | 7.7 |
| Rate-limit state | New `GET /rate-limits` on gateway | 7.8 |
| DB health | `SELECT 1` | 7.1 |
| LLM key health / credit | OpenRouter `GET /api/v1/auth/key` | 7.1 |

No new persistent metric store (Prometheus, etc.) is introduced in v1.

---

## 11. Operational runbook additions

A production deploy that adopts the admin service must:

1. Set `ADMIN_PASSWORD_HASH` in `.env`
   (use `node setup/admin-set-password.mjs`).
2. Add the `admin` service block from §4.1 to
   `docker-compose.prod.yml`.
3. Front the admin with a tunnel (Cloudflare, Tailscale) or a TLS
   reverse proxy with additional auth.
4. Verify `POST /reconnect`, `GET /sessions`, `GET /rate-limits` are
   reachable from the admin container name over the `platform` network.
5. Run the `admin_audit` migration (it is auto-applied on startup via
   `initDB()`, same as every other migration).

---

## 12. Open questions

1. **i18n.** pt-BR only in v1. If a non-Brazilian tenant ships, add
   `@fastify/i18n`. The decision is deferred.
2. **Outbound notifications** (email / push / webhook) on "pedido
   pago". Prefer webhook-first — avoids shipping SMTP in the container.
   Deferred to Phase 3.
3. **Multi-tenant admin view.** The engine is single-tenant by design.
   If one owner runs three shops, run three deploys. Revisit only if
   that pattern becomes common.
4. **Editing `AGENTS.md` through the UI.** Changes the bot's behavior
   in subtle ways. Deferred until the UI can offer diff + rollback +
   quick canary.
5. **Static-analysis of bot conversations** ("is the bot refusing too
   often?" "is it misclassifying product questions?"). Cross-functional
   with data science; not an admin-UI v1 concern.
