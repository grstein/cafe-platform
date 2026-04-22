# TODO

Active and planned work. Keep items in imperative mood ("Add X", not
"X added"). When a phase finishes, either delete its block or collapse
it to a one-line reference to the git tag that completed it.

Design contract lives in [`DESIGN.md`](./DESIGN.md). Functional spec
for the admin UI lives in [`docs/admin-ui.md`](./docs/admin-ui.md).

---

## Upstream changes (prerequisites for admin UI)

Additive changes in existing services. Each ships in its own PR.

- [ ] Add `GET /sessions` to `consumers/agent.mjs` on internal port
      `:3013` — returns `sessionCache` snapshot.
- [ ] Add `GET /rate-limits` and `POST /rate-limits/:phone/reset` to
      `consumers/gateway.mjs` on internal port `:3010`.
- [ ] Make `consumers/gateway.mjs` consume a new `allowlist_reload`
      event and re-read `pi-config/allowlist.txt` immediately.
- [ ] Add `POST /reconnect` to `services/whatsapp-bridge.mjs`.
- [ ] Append connection events to `data/bridge-events.jsonl` in the
      bridge (`{ ts, type, reason }`).
- [ ] Add `config_reload` event consumers in every service that calls
      `getConfig()` (calls `clearConfig()` on receipt).
- [ ] Migration: add `orders.cancellation_reason TEXT NULL`.
- [ ] Migration: add `admin_audit` table
      `(id, admin_user, action, target_type, target_id, before, after, at)`.
- [ ] Accept `referrals.status = 'cancelled'` (no DDL — `TEXT`; add
      docstring in `shared/db/migrations.mjs`).

---

## Phase 1 — Admin MVP (target: 2 weeks)

Minimum the shop owner can operate the bot from the phone without SSH.

- [ ] Scaffold `services/admin.mjs` with Fastify + EJS + HTMX + Tailwind.
- [ ] Add the `admin` service block to `docker-compose.yml` (see
      `docs/admin-ui.md` §4.1).
- [ ] Implement auth: `ADMIN_PASSWORD_HASH` in `.env`, bcrypt(12),
      `setup/admin-set-password.mjs`, login/logout, signed session
      cookie, CSRF, login rate limit.
- [ ] Ship the DESIGN.md tokens as a `tailwind.config.js` and compile
      `services/admin/public/admin.css`.
- [ ] Ship the component partials in `services/admin/views/partials/`:
      `table.ejs`, `drawer.ejs`, `confirm.ejs`, `badge.ejs`, `field.ejs`,
      `empty.ejs`, `skeleton.ejs`, `error.ejs`.
- [ ] Dashboard (admin-ui.md §7.1): 4 health cards, today's KPIs, 24h
      chart, two short lists. No chart history yet.
- [ ] Orders screen (§7.2): list with filters, drawer, status
      transitions, tracking, PIX reprint, cancel with reason.
- [ ] Customers screen (§7.3): list + detail page read-only; editable
      tags and notes only.
- [ ] Catalog screen (§7.4): CRUD with inline edits on price/stock/
      availability. No CSV diff yet.
- [ ] Conversations screen (§7.5): history mode only (no live tail in
      Phase 1).
- [ ] Operação (§7.9): status of bridge / RabbitMQ / DB. No purge, no
      replay yet.
- [ ] Configuração (§7.10): read-only view of `config.json` and masked
      `.env`.
- [ ] Audit log: record every mutation to `admin_audit` before
      executing. No UI yet — SQL-only for Phase 1.
- [ ] Document the admin in `README.md` (quickstart + tunnel note).

---

## Phase 2 — Operational complete (target: +3 weeks after MVP)

The technical operator no longer needs SSH for routine incidents.

- [ ] Customers: full profile edit, `preferences` JSON editor (behind
      "Editar como JSON" toggle), `Recalcular contadores` button.
- [ ] Catalog: CSV / `products.json` import with diff preview; bulk
      actions (activate, deactivate, % discount).
- [ ] Indicações (§7.6): metrics, list, `Marcar recompensado`,
      `Ajustar recompensa`, `Revogar` once `cancelled` status is
      accepted.
- [ ] Agente (§7.7): active sessions table, simulator, models.json
      editor, settings editor with restart banner.
- [ ] Acesso (§7.8): allowlist editor (exact + prefix groups),
      rate-limit snapshot and reset, access-status dropdown.
- [ ] Operação: purge queue (Level 3 confirmation), replay DLX.
- [ ] Operação: live logs tail via SSE; filter by stage and phone;
      download.
- [ ] Operação: one-click runs for `setup/rabbitmq-init.mjs`,
      `setup/seed-products.mjs`, `setup/send-test-message.mjs`, and an
      OpenRouter key check.
- [ ] Configuração: editable `config.json` form with Zod validation,
      `.bak` on every save, restart-banner per affected consumer.
- [ ] Configuração: editable `models.json`.
- [ ] Auditoria (§7.11): filterable view over `admin_audit` + JSONL
      events; CSV export.
- [ ] Customer detail: PII masking toggle in the global header
      (DESIGN.md §8).

---

## Phase 3 — Polish & scale

Deferred until v1/v2 settle and real usage produces signal.

- [ ] Multi-user with roles (`owner` / `operator` / `viewer`).
      Migration `admin_users (email, password_hash, role, created_at)`.
- [ ] Cloudflare Access / OIDC integration as an alternative to
      password auth.
- [ ] Light theme (DESIGN.md today is dark-only).
- [ ] Historical charts (30 / 90 days) with overnight aggregation.
- [ ] Outbound webhooks ("pedido pago" → external URL). Prefer
      webhooks over SMTP.
- [ ] `AGENTS.md` editor with diff + rollback + quick canary.
- [ ] Static-analysis surface over conversations (refusal rate,
      misclassification signals) — coordinate with data science.

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
