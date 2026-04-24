# `setup/` Scripts Reference

**Scope**: the maintenance scripts under `setup/`. Each is a one-shot
Node.js ESM entrypoint; none run automatically.
**Out of scope**: consumer startup migration flow (handled by `initDB()`
in every consumer).

Source of truth: `setup/rabbitmq-init.mjs`, `setup/init-config.mjs`,
`setup/seed-products.mjs`, `setup/send-test-message.mjs`.

All scripts expect to run inside a container that has `.env` loaded:

```
docker compose exec gateway node setup/<script>.mjs [args]
```

## `rabbitmq-init.mjs`

Create exchanges, queues, and bindings.

- Prerequisites: `RABBITMQ_URI` set; RabbitMQ reachable.
- Invocation: `node setup/rabbitmq-init.mjs`
- What it does: connects, calls `setupExchangesAndQueues(channel)`
  (`shared/lib/rabbitmq.mjs`), closes.
- Idempotency: **yes** — `assertExchange` / `assertQueue` are no-ops when
  the objects exist with the same arguments.
- Failure modes: mismatched queue arguments (e.g. you changed DLX target)
  → you must delete the queue first via `rabbitmqctl`.
- Re-run safety: safe unless queue args changed.

See [rabbitmq.md](./rabbitmq.md) for the topology it creates.

## `init-config.mjs`

Push `pi-config/config.json` + `allowlist.txt` into the DB.

- Prerequisites: `DATABASE_URL`, `CONFIG_DIR` set; `config.json` exists.
- Invocation: `node setup/init-config.mjs`
- What it does:
  1. `initDB()` (ensures migrations applied).
  2. Reads `CONFIG_DIR/config.json`, does
     `INSERT INTO app_config … ON CONFLICT DO UPDATE` (replaces the row).
  3. Reads `CONFIG_DIR/allowlist.txt` if present, calls
     `addPattern(pattern, "seeded from allowlist.txt")` for each non-comment
     line. `addPattern` is
     `INSERT … ON CONFLICT DO UPDATE SET active=true`.
- Idempotency: **yes** for `app_config` (full overwrite) and for adding
  allowlist patterns (re-activates + keeps note).
  **Not destructive**: patterns removed from the file are **not** removed
  from the DB.
- Prints: `display_name` from the new config, and the count of allowlist
  patterns inserted.
- Re-run safety: safe. Run it whenever you edit `config.json` or
  `allowlist.txt`.

After running, **restart consumers** — the in-memory config cache
(`shared/lib/config.mjs`) is per-process and there's no hot reload.

## `seed-products.mjs`

Load `products.json` into the `products` table.

- Prerequisites: `DATABASE_URL`, `CONFIG_DIR` set (or pass a full path);
  the JSON file exists and is a non-empty array.
- Invocation:
  - `node setup/seed-products.mjs` → reads `CONFIG_DIR/products.json`
  - `node setup/seed-products.mjs path/to/products.json`
- What it does: reads the file, calls `products.upsertBatch(rows)` →
  per-row `INSERT … ON CONFLICT (sku) DO UPDATE`.
- Idempotency: **yes** — rows upsert by SKU, unconditionally overwriting
  every field.
- **Not destructive**: products present in the DB but absent from the
  file are left alone. Flip `available: false` + re-seed, or DELETE
  manually, to remove them.
- Re-run safety: safe. The upsert is not wrapped in a transaction — a
  mid-batch error leaves earlier rows committed.

See [../config/products.md](../config/products.md) for the file schema.

## `send-test-message.mjs`

Inject a synthetic WhatsApp message into the pipeline for testing —
bypasses the WhatsApp bridge.

- Prerequisites: `RABBITMQ_URI` set; RabbitMQ reachable; consumers
  running to observe the flow.
- Invocation patterns:
  - `node setup/send-test-message.mjs "Hello"` — sends to
    `msg.flow incoming`, phone `5500000000001`.
  - `node setup/send-test-message.mjs "/ajuda" --phone 5541999990001`
  - `node setup/send-test-message.mjs "Oi" --stage validated` — skip
    gateway, publish directly as an envelope at the given stage
    (`validated`, `ready`, `enriched`, `response`, `outgoing`).
  - `node setup/send-test-message.mjs "Hi" --name "Test User"` — set
    pushName.
  - `node setup/send-test-message.mjs --listen` — subscribe to `events #`,
    `msg.flow outgoing`, and `msg.flow response` and print every message.
- For `--stage incoming` (default), it builds a raw Baileys-shaped
  payload (`data.key.remoteJid`, `data.message.conversation`, etc.) so
  the gateway's parser treats it like a real WhatsApp event.
- For other stages, it builds a platform `envelope` directly via
  `createEnvelope`.
- Side effects: depends on what the downstream consumers do with the
  message. A test message will write to `customers`, `conversations`,
  possibly `cart_items` / `orders`. Use a dedicated test phone.

## Related

- [../config/app-config.md](../config/app-config.md) — what
  `init-config.mjs` writes.
- [../config/products.md](../config/products.md) — what
  `seed-products.mjs` writes.
- [rabbitmq.md](./rabbitmq.md) — topology + dead-letter ops.
