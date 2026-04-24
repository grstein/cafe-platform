# Database Schema Reference

**Scope**: PostgreSQL schema, lifecycle rules, and migration conventions.
**Out of scope**: env vars ([../config/env-vars.md](../config/env-vars.md)),
tool internals ([tools.md](./tools.md)).

Source of truth: `shared/db/migrations.mjs` and repos in `shared/db/*.mjs`.

## Connection

- Env: `DATABASE_URL` (see [../config/env-vars.md](../config/env-vars.md)).
- Driver: [`postgres`](https://github.com/porsager/postgres) v3 (tagged
  templates). Singleton `getDB()` from `shared/db/connection.mjs`.
- Migrations run via `runMigrations(sql)` inside `initDB()` at every
  consumer startup. Uses advisory lock `7462218743` to serialize
  concurrent starters.

## Tables

### `schema_version`

`(version INTEGER PK, applied_at TIMESTAMPTZ)`. Tracks applied
migrations. Managed by `runMigrations`.

### `customers`

| Column | Type | Notes |
|--------|------|-------|
| `id` | SERIAL PK | |
| `phone` | TEXT UNIQUE NOT NULL | Digits only, with country+area code. |
| `push_name` | TEXT | WhatsApp push name at first contact. |
| `name`, `cpf`, `email`, `cep`, `address`, `city`, `state` | TEXT | Contact info, populated by `save_customer_info`. |
| `tags` | TEXT (JSON) | Default `'[]'`. |
| `preferences` | TEXT (JSON) | Default `'{}'`. Holds `{ modelo, perfil, metodo, moagem, intensidade }`. |
| `notes` | TEXT | Freeform ops notes. |
| `referral_code` | TEXT UNIQUE | `<REFERRAL_CODE_PREFIX><4 chars>`. |
| `referred_by_phone` | TEXT | Phone of referrer, if invited via code. |
| `access_status` | TEXT NOT NULL DEFAULT `'active'` | See transitions below. |
| `first_seen_at`, `last_seen_at` | TIMESTAMPTZ | |
| `total_orders` | INTEGER DEFAULT 0 | Updated by `updateCounters(phone)` after `/confirma`. |
| `total_spent` | NUMERIC(10,2) DEFAULT 0 | |
| `nps_score`, `nps_date` | INTEGER / TIMESTAMPTZ | Reserved. |
| `created_at`, `updated_at` | TIMESTAMPTZ | |

Indexes: `phone`, `referral_code` (partial WHERE NOT NULL),
`access_status`.

**`access_status` transitions** (see
[../config/allowlist.md](../config/allowlist.md)):

```
(none) --first message, allowlisted--> active
(none) --valid referral code in msg--> invited
(none) --invite_customer tool------->  invited
invited --first /confirma----------->  active
*      --manual admin action------->   blocked
```

### `products`

| Column | Type | Notes |
|--------|------|-------|
| `id` | SERIAL PK | |
| `sku` | TEXT UNIQUE NOT NULL | Upsert conflict key. |
| `name` | TEXT NOT NULL | |
| `roaster` | TEXT DEFAULT `''` | |
| `sca_score` | INTEGER | 80–95 typical. |
| `profile`, `origin`, `process` | TEXT | Searched by `search_catalog`. |
| `price` | NUMERIC(10,2) NOT NULL | BRL. |
| `cost` | NUMERIC(10,2) | Internal. |
| `weight` | TEXT DEFAULT `'250g'` | Free-form. |
| `available` | INTEGER DEFAULT 1 | `1` or `0`. `search_catalog` filters on this. |
| `stock` | INTEGER DEFAULT 0 | Informational; not enforced. |
| `highlight`, `knowledge_file` | TEXT | |
| `created_at`, `updated_at` | TIMESTAMPTZ | |

Indexes: `sku`, `available`.

See [../config/products.md](../config/products.md) for seeding.

### `orders`

| Column | Type | Notes |
|--------|------|-------|
| `id` | SERIAL PK | Prefixed with `ORDER_PREFIX` in display (`#CDA-123`). |
| `phone` | TEXT NOT NULL | |
| `customer_id` | INTEGER | May be null if customer row was created later. |
| `name` | TEXT | Captured at order time. |
| `status` | TEXT DEFAULT `'pending'` | See lifecycle below. |
| `items` | TEXT (JSON) NOT NULL | Array of `{ sku, name, qty, unit_price }`. |
| `subtotal`, `discount`, `shipping`, `total` | NUMERIC(10,2) | `discount` default 0. |
| `cep`, `notes`, `tracking` | TEXT | |
| `created_at`, `confirmed_at`, `paid_at`, `shipped_at`, `cancelled_at` | TIMESTAMPTZ | Set by status transitions. |

Indexes: `phone`, `status`.

**Status lifecycle** (driven by `shared/db/orders.mjs`):

```
pending ──/confirma──> confirmed ──admin──> paid ──admin──> shipped ──admin──> delivered
   │
   └──/cancelar, checkout precondition failure──> cancelled
```

- `confirm(phone)`, `cancel(phone)` act on the single pending order for a
  phone.
- `getConfirmedOrders(phone)` returns `confirmed|paid|shipped|delivered`.
- `updateStatus(id, status, extra)` is the general-purpose mutator; sets
  the matching `*_at` timestamp. Allowed extras: `paid_at`, `shipped_at`,
  `tracking`.

### `cart_items`

| Column | Type | Notes |
|--------|------|-------|
| `id` | SERIAL PK | |
| `phone` | TEXT NOT NULL | |
| `product_sku` | TEXT NOT NULL | |
| `qty` | INTEGER DEFAULT 1 | |
| `unit_price` | NUMERIC(10,2) NOT NULL | Snapshot at add time. |
| `added_at` | TIMESTAMPTZ | |

Unique `(phone, product_sku)`. `add_to_cart` upserts — `qty` is **added**
to existing. `checkout` clears all rows for a phone after creating the
order.

### `conversations`

| Column | Type | Notes |
|--------|------|-------|
| `id` | SERIAL PK | |
| `phone` | TEXT NOT NULL | |
| `role` | TEXT NOT NULL | `user` or `assistant`. |
| `content` | TEXT NOT NULL | |
| `tool_name` | TEXT | Populated when the turn was a tool call. |
| `created_at` | TIMESTAMPTZ | |

Index: `(phone, created_at)`. Written by the `agent` consumer after every
turn. Enricher reads recent history for context.

### `referrals`

| Column | Type | Notes |
|--------|------|-------|
| `id` | SERIAL PK | |
| `referrer_phone`, `referred_phone` | TEXT NOT NULL | UNIQUE`(referrer, referred)`. |
| `referral_code_used` | TEXT NOT NULL | |
| `status` | TEXT DEFAULT `'pending'` | `pending` → `active` → `rewarded`. |
| `reward_type` | TEXT DEFAULT `'discount_percent'` | |
| `reward_value` | NUMERIC(10,2) DEFAULT `10` | |
| `reward_applied_to_order` | INTEGER | FK to `orders.id`, nullable. |
| `created_at`, `activated_at`, `rewarded_at` | TIMESTAMPTZ | |

Indexes: `referrer_phone`, `referred_phone`, `referral_code_used`.

### `app_config`

Single-row JSONB config. See
[../config/app-config.md](../config/app-config.md).

### `allowlist`

`(pattern TEXT PK, note TEXT, active BOOLEAN DEFAULT true, created_at TIMESTAMPTZ)`.
See [../config/allowlist.md](../config/allowlist.md).

## Migration rules

- Each migration: `{ version, description, up(sql) }` in
  `shared/db/migrations.mjs::migrations` array.
- Versions are integers, monotonically increasing. Gaps allowed; sort
  order is by `version`.
- Use `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS` so a
  re-run on a pre-existing DB is a no-op.
- Each migration runs inside a transaction; the `schema_version` insert
  is in the same tx.
- **Never edit a merged migration**. Always add a new one.
- Large data backfills should be chunked — a single transaction for
  millions of rows will lock too long.

## JSONB values

Use `sql.json(obj)` when inserting/updating JSONB (as `app_config` does).
`JSON.stringify(obj) + ::jsonb` silently stores values as JSON string
literals, not objects.

## Related

- [../config/app-config.md](../config/app-config.md) — `app_config`
  field-level schema.
- [../config/products.md](../config/products.md) — seeding the products
  table.
- [../config/allowlist.md](../config/allowlist.md) — `allowlist` and
  `customers.access_status` transitions.
