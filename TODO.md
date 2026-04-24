# TODO

Active and planned work. Keep items in imperative mood ("Add X", not
"X added"). When a sprint finishes, either delete its block or collapse
it to a one-line reference to the git tag that completed it.

Design contract lives in [`DESIGN.md`](./DESIGN.md). Functional spec
for the admin UI lives in [`docs/admin-ui.md`](./docs/admin-ui.md).
Visual reference lives in
[`prototypes/admin-ui.html`](./prototypes/admin-ui.html) — open
it in a browser to compare any screen against the prototype.

Sprints are sized ~1 week of focused work, ordered simple → complex.
Each sprint has an **Objetivo** (what ships at the end), a checklist,
and a **Pronto quando** criterion. Do not start sprint N+1 before
sprint N's criterion is met.

---

## Sprint 0 — Upstream prereqs

**Objetivo.** Expose the endpoints and events the admin needs from
existing services. No UI yet.

- [ ] Add `GET /sessions` to `consumers/agent.mjs` on internal port
      `:3013` — returns `sessionCache` snapshot as
      `[{ phone, model, msgCount, lastUsed, ageMs }]`.
- [ ] Add `GET /rate-limits` and `POST /rate-limits/:phone/reset` to
      `consumers/gateway.mjs` on internal port `:3010`.
- [ ] Make `consumers/gateway.mjs` consume a new `allowlist_reload`
      event and re-read `pi-config/allowlist.txt` immediately (bypass
      the 60s TTL).
- [ ] Add `POST /reconnect` to `services/whatsapp-bridge.mjs` (tears
      down + recreates the Baileys connection).
- [ ] Append connection events to `data/bridge-events.jsonl` in the
      bridge (`{ ts, type: 'connected'|'disconnected', reason }`).
- [ ] Add `config_reload` event handler in every service that calls
      `getConfig()` (calls `clearConfig()` on receipt).
- [ ] Migration: add `orders.cancellation_reason TEXT NULL`.
- [ ] Migration: add `admin_audit` table
      `(id, admin_user, action, target_type, target_id, before, after, at)`.
- [ ] Accept `referrals.status = 'cancelled'` (no DDL — column is
      already `TEXT`; add docstring in `shared/db/migrations.mjs`).

**Pronto quando.** `curl` from the admin container reaches every new
endpoint, and publishing `allowlist_reload` on `events` makes gateway
re-read the file within 1s.

---

## Sprint 1 — Scaffold & auth

**Objetivo.** `services/admin.mjs` sobe no compose, autentica, serve
uma página vazia em `127.0.0.1:3002` com o header e a sidebar
definitivos. Nada mais.

- [ ] Scaffold `services/admin.mjs` with Fastify, `@fastify/view` + EJS,
      `@fastify/secure-session`, `@fastify/csrf-protection`,
      `@fastify/rate-limit`, `@fastify/formbody`,
      `@fastify/static`.
- [ ] Add the `admin` service block to `docker-compose.yml`
      (see `docs/admin-ui.md` §4.1 — `127.0.0.1:3002`, RW mount of
      `pi-config/`).
- [ ] `setup/admin-set-password.mjs` — prompt password, print bcrypt(12)
      hash for `.env` (`ADMIN_PASSWORD_HASH`).
- [ ] Auth: `POST /login`, `GET /logout`, signed session cookie
      `admin_sess` (`HttpOnly SameSite=Lax`, TTL 12h).
- [ ] CSRF token on every mutating route.
- [ ] Rate limit: 5 logins / 15min / IP; 10 destructive / min / session.
- [ ] Layout EJS: persistent sidebar (grupos **Diário** / **Sistema**),
      sticky header with `display_name` + `BOT_PHONE` (masked), mobile
      sheet fallback below `1024px`.
- [ ] `/healthz` (no auth) and `/public/*` static (auth bypass).
- [ ] Auth-required middleware on every other route.

**Pronto quando.** Owner hits `http://127.0.0.1:3002`, logs in, sees the
empty shell with the correct nav and header; CSRF + session + rate
limits verified by tests.

---

## Sprint 2 — Design system & base components

**Objetivo.** Partials reusáveis que casam 1:1 com DESIGN.md. Sem telas
ainda — só um `/styleguide` demo listando cada componente.

- [ ] Ship DESIGN.md tokens as `tailwind.config.js` (surfaces, text,
      accent, semantic, spacing 4px scale, radii, breakpoints).
- [ ] Compile `services/admin/public/admin.css` (one-shot, committed).
- [ ] Load Inter + JetBrains Mono locally in `public/fonts/` (no CDN).
- [ ] Partials in `services/admin/views/partials/`:
  - [ ] `button.ejs` — variants `primary` / `secondary` / `danger`,
        sizes `md` / `sm`.
  - [ ] `badge.ejs` — status → color per DESIGN.md §6.
  - [ ] `table.ejs` — sticky header, row height 48/56, pagination slot,
        empty/loading slots.
  - [ ] `field.ejs` — label + input + help/error; required asterisk in
        `--danger`.
  - [ ] `drawer.ejs` — 480px, 160ms, `Esc` closes, sticky footer slot.
  - [ ] `confirm.ejs` — three levels (inline / dialog / typed).
  - [ ] `toast.ejs` + `banner.ejs` — sticky-bottom toasts stack of 3,
        sticky-top banner with reason prop.
  - [ ] `empty.ejs` / `skeleton.ejs` / `error.ejs` — three states
        (DESIGN.md §5.7).
- [ ] `phoneMask(phone)` helper + header toggle (`+55 41 ••• 1234`,
      reveal per-session only — no persistence).
- [ ] `/styleguide` route lists every partial with variants so Sprint
      3+ authors copy-paste instead of re-implementing.

**Pronto quando.** `/styleguide` renders every partial; no inline
styles anywhere else; visual diff against
`prototypes/admin-ui.html` for each component.

---

## Sprint 3 — Dashboard + Pedidos

**Objetivo.** As duas telas mais valiosas para a dona da cafeteria:
saber se tá tudo bem e mover pedidos pelo funil.

### 3.1 Dashboard (§7.1)

- [ ] 4 health cards: WhatsApp, banco, filas, OpenRouter.
- [ ] Data sources: bridge `/`, `SELECT 1`, RabbitMQ `GET /api/queues`,
      OpenRouter `GET /api/v1/auth/key`.
- [ ] Today's KPIs: messages in/out, commands, new orders, paid orders,
      unique customers, revenue confirmed — from JSONL aggregate + DB.
- [ ] Last-24h message volume — hourly buckets, inline SVG line chart
      (no chart lib).
- [ ] Pedidos pendentes (5) + Conversas recentes (5) short lists.
- [ ] Click any red card → navigate to the relevant screen.

### 3.2 Pedidos (§7.2)

- [ ] Extend `repos.orders` with a filter method (status multi-select,
      date range, text search by phone/name/id).
- [ ] List table with default filter `pending|confirmed|paid` last 7d.
- [ ] Drawer: status buttons, parsed items, totals, customer chip,
      CEP, editable notes, editable `tracking` when `shipped`, "Copiar
      PIX" via `generatePixCode`, timeline of `*_at` timestamps.
- [ ] Status transitions write the matching `*_at` column via
      `repos.orders.updateStatus`.
- [ ] Cancel order — Level 2 confirmation with reason written to
      `orders.cancellation_reason`.
- [ ] "Reimprimir recibo" modal.
- [ ] Export CSV of current filter.

**Pronto quando.** Owner marks a pending order as `paid` from the
phone in ≤3 taps and sees it disappear from the dashboard list.

---

## Sprint 4 — Clientes + Catálogo

**Objetivo.** CRM leve + edição rápida de preço/estoque.

### 4.1 Clientes (§7.3)

- [ ] List with filters (tag, `access_status`, has-orders, last-seen).
- [ ] Detail page (not drawer) — header with phone (masked), `wa.me/`
      link, referral code, `Resetar sessão`, `Bloquear`.
- [ ] Editable profile via `repos.customers.updateInfo`.
- [ ] Tags chips (`addTag` / `removeTag`).
- [ ] Internal notes textarea.
- [ ] Current cart + `Esvaziar carrinho`.
- [ ] Orders inline list (reuse Sprint 3 filter).
- [ ] Referrals: as referrer and as referred.
- [ ] Counters block + `Recalcular contadores` (`updateCounters`).
- [ ] Conversation timeline — paginated 50/page from `conversations`,
      role-colored, `tool_name` badge. Read-only.

### 4.2 Catálogo (§7.4)

- [ ] Table: SKU, name, roaster, price, stock, SCA, available (switch),
      actions. Search.
- [ ] Inline edit on price, stock, available (saves onBlur via
      `repos.products.upsert` / `updateStock` / `setAvailable`).
- [ ] Drawer with full fields (`sca_score`, `profile`, `origin`,
      `process`, `weight`, `highlight`, `knowledge_file`).
- [ ] `knowledge_file` upload writes into `pi-config/skills/products/`.

**Pronto quando.** Owner tweaks a price and restocks in under 10s
without opening the drawer.

---

## Sprint 5 — Conversas (histórico) + Operação (read-only)

**Objetivo.** "Por que o bot respondeu assim?" e "as filas estão ok?"
sem SSH. Tudo read-only ainda.

### 5.1 Conversas — history mode only (§7.5)

- [ ] Search `conversations` by phone + time range.
- [ ] Drilldown modal: envelope JSON (`metadata.timings`,
      `correlation_id`, `context`, `command_result`).
- [ ] No live tail yet (Sprint 7).

### 5.2 Operação — read-only (§7.9)

- [ ] Bridge panel: status, embedded QR (proxied from
      `http://whatsapp-bridge:3001/qr`), last disconnect reason from
      `data/bridge-events.jsonl`. No reconnect button yet.
- [ ] Queues table: name, depth, consumers, in/out rates from RabbitMQ
      mgmt API. Red badge when `depth > 50` or `dead-letters > 0`.
- [ ] Logs viewer: file selector (today + yesterday), filter by stage
      and phone, download. No tail yet.

**Pronto quando.** Operator investigates a past incident by opening
one conversation, seeing its envelope, and correlating to queue depth
at that timestamp — without SSH.

---

## Sprint 6 — Indicações + Acesso + Agente (básico)

**Objetivo.** Telas de sistema que o dev mexe uma vez por semana.

### 6.1 Indicações (§7.6)

- [ ] Metrics cards: issued, activated, rewarded, conversion,
      total-discount.
- [ ] Filterable table joining `referrals` + `customers`.
- [ ] Row action: `Marcar recompensado` (order picker →
      `markRewarded(id, orderId)`).
- [ ] Row action: `Ajustar recompensa` (`reward_type` / `reward_value`).
- [ ] Top referrers block via `countByReferrer`.
- [ ] `Revogar` once Sprint 0's `cancelled` status is documented.

### 6.2 Acesso (§7.8)

- [ ] Allowlist editor: two groups (exact numbers, `*`-prefixes),
      optional inline comment per row.
- [ ] Save writes `pi-config/allowlist.txt` and publishes
      `allowlist_reload`.
- [ ] Rate-limit snapshot from `GET /rate-limits`; per-phone reset via
      `POST /rate-limits/:phone/reset`.
- [ ] Global rate-limit threshold field (writes `config.json` — calls
      the Sprint 8 save endpoint).
- [ ] `access_status` inline dropdown on the customers list.

### 6.3 Agente — read-only + simulator (§7.7)

- [ ] Active sessions table from `GET /sessions` on agent.
- [ ] `Encerrar sessão` → publish `session_reset` (Level 2
      confirmation).
- [ ] Message simulator: publish synthetic `incoming` on `msg.flow`,
      stream response by `correlation_id` (short-lived SSE).
- [ ] `AGENTS.md` viewer — read-only preview only.

**Pronto quando.** Dev adds a phone to allowlist and the gateway picks
it up in ≤1s without a container restart.

---

## Sprint 7 — Ações de estado + tempo real

**Objetivo.** Tudo que precisa de Level 3 confirmation e de streams
ao vivo. Requer auditoria antes da execução.

- [ ] Live tail for Conversas (§7.5): SSE endpoint tailing today's
      JSONL; filters phone / command / only-failures.
- [ ] Operação: `Reconectar` Baileys (Level 3, type `bridge`) →
      `POST /reconnect`.
- [ ] Operação: per-queue `Purgar` (Level 3, type queue name) →
      `DELETE /api/queues/evolution/<name>/contents`.
- [ ] Operação: `dead-letters` inspector — list with `x-death` error +
      `Reenfileirar` action.
- [ ] Operação: "Setup scripts" one-click runs for
      `setup/rabbitmq-init.mjs`, `setup/seed-products.mjs`,
      `setup/send-test-message.mjs "/ajuda"`, and OpenRouter key test.
      Run as child process with 30s timeout; stream output to a drawer.
- [ ] Banner rules wired: DLX > 0, bridge disconnected, OpenRouter key
      invalid or low balance. Sticky top, single component.
- [ ] Admin-audit write happens **before** every destructive endpoint
      fires (wrap in a decorator).

**Pronto quando.** Operator purges DLX after replaying the stuck
message, and the audit row lists the before/after counts.

---

## Sprint 8 — Configuração editável + Auditoria UI

**Objetivo.** Último caminho de SSH eliminado: editar `config.json` e
`models.json` pela UI.

### 8.1 Configuração (§7.10)

- [ ] `config.json` form with sections: `display_name`, `llm`,
      `session`, `behavior`, `pix` (RO note), `bot_phone`.
- [ ] Zod validation per field; inline errors per DESIGN.md §5.4.
- [ ] Atomic write (`.tmp` + rename) + rotating `.bak` of previous.
- [ ] Publish `config_reload` on save.
- [ ] Restart-required banner per field that can't hot-reload (e.g.
      `llm.model`).
- [ ] `models.json` editor — CRUD on available-models array.
- [ ] `.env` viewer: read-only, secrets masked `••••<last4>`.
- [ ] Tenant `AGENTS.md` viewer — still read-only.

### 8.2 Auditoria (§7.11)

- [ ] Filterable view over `admin_audit`: user, target_type, target_id,
      period.
- [ ] Merge JSONL system events (MSG_IN, MSG_OUT, CMD_OUT) as a toggle.
- [ ] CSV export of current filter.
- [ ] Diff rendering of `before`/`after` JSON columns.

**Pronto quando.** Owner changes `llm.thinking` from `medium` to
`high`, sees the restart banner, and the audit row shows the diff.

---

## Sprint 9 — Catálogo avançado & detalhes de qualidade

**Objetivo.** Fechar o gap visual e funcional com o protótipo. Nada
novo arquitetural; tudo polimento e casos avançados.

- [ ] Catálogo: `Importar do products.json` runs
      `setup/seed-products.mjs` as subprocess, previews the diff
      (create / update / deactivate counts) before applying.
- [ ] Catálogo: manual CSV upload — same diff-then-apply flow.
- [ ] Catálogo: bulk actions (activate, deactivate, apply X% discount)
      over selected rows.
- [ ] Customers: `preferences` JSON editor behind "Editar como JSON"
      toggle.
- [ ] Agente: editable `pi-config/settings.json` form (thinking, TTL,
      soft/hard limits, debounce) with restart banner.
- [ ] Keyboard shortcuts: `/` focus search, `g d`/`g p`/`g c` go-to
      nav, `Esc` close drawer/modal.
- [ ] Empty / loading / error states audit — every list passes the
      four-states lint.
- [ ] Responsive audit — Dashboard, Pedidos, Operação usable on a
      phone (44×44px min targets, sheet nav, full-width drawers).
- [ ] Phone-mask toggle persisted per session cookie (DESIGN.md §8).
- [ ] Visual QA pass: screen-by-screen diff against
      `prototypes/admin-ui.html`.

**Pronto quando.** Side-by-side comparison with the prototype has no
visible drift on any screen at desktop and mobile widths.

---

## Futuro — deferido até v1 estabilizar

Não iniciar antes de Sprint 9 fechar e uso real produzir sinal.

- [ ] Multi-user with roles (`owner` / `operator` / `viewer`).
      Migration: `admin_users (email, password_hash, role, created_at)`.
- [ ] Cloudflare Access / OIDC as alternative to password auth.
- [ ] Light theme (DESIGN.md is dark-only today).
- [ ] Historical charts (30 / 90 days) with overnight aggregation.
- [ ] Outbound webhooks ("pedido pago" → external URL). Prefer
      webhook-first over SMTP.
- [ ] `AGENTS.md` editor with diff + rollback + quick canary.
- [ ] Static-analysis surface over conversations (refusal rate,
      misclassification signals) — coordinate with data science.
- [ ] Internationalization beyond pt-BR (`@fastify/i18n`).

---

## Non-admin work

Items unrelated to the admin UI that surfaced during research. Do not
bundle with admin PRs.

- [ ] Update `README.md` to match the single-tenant reality in
      `CLAUDE.md` (no `TENANT_ID`, no `tenants/`, `DATABASE_URL`
      required).

---

## Open questions

Do not start on these without agreement. Notes live in
`docs/admin-ui.md` §12.

- [ ] Internationalization beyond pt-BR.
- [ ] Admin view for operators running multiple deploys (1 UI → N
      tenants) vs. keep one deploy = one admin.
- [ ] Editing `AGENTS.md` through the UI.
- [ ] Outbound notification channel (webhook / email / push).
