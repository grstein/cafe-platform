# `products.json` — Catalog Seeding

**Scope**: product catalog format and the `setup/seed-products.mjs`
upsert script.
**Out of scope**: runtime search behavior of `search_catalog`
([../reference/tools.md](../reference/tools.md)), DB schema
([../reference/database.md](../reference/database.md)).

Source of truth: `setup/seed-products.mjs`, `shared/db/products.mjs`,
migration v1 in `shared/db/migrations.mjs`.

## File location

Default: `pi-config/products.json`. Pass a different path as the first
argument to the seed script.

Not required to exist — the seed script is opt-in, not run on boot.

## Shape

A JSON **array** of product objects:

```json
[
  {
    "sku":       "DEMO-001",
    "name":      "Produto Exemplo",
    "roaster":   "Torrefação XYZ",
    "sca_score": 85,
    "profile":   "Achocolatado, encorpado",
    "origin":    "Cerrado Mineiro",
    "process":   "Natural",
    "price":     49.90,
    "weight":    "250g",
    "available": true,
    "highlight": "porta de entrada"
  }
]
```

## Field reference

| Field | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| `sku` | string | yes | — | Unique identifier. Conflict key for upsert. |
| `name` | string | yes | — | Customer-facing product name. |
| `price` | number | yes | — | BRL, 2 decimal places. |
| `roaster` | string | no | `""` | Roaster/brand name. |
| `sca_score` | integer | no | `null` | SCA cupping score, typically 80–95. `search_catalog` `min_sca` filter uses this. |
| `profile` | string | no | `null` | Sensory profile ("Achocolatado, encorpado"). Searched by `search_catalog.query`. |
| `origin` | string | no | `null` | Origin region. Searched by `search_catalog.query`. |
| `process` | string | no | `null` | Processing method ("Natural", "Lavado"). |
| `cost` | number | no | `null` | Internal cost (not exposed to customer). |
| `weight` | string | no | `"250g"` | Free-form weight label. |
| `available` | boolean | no | `true` | Stored as `1`/`0` in `products.available` (INTEGER). When false, `search_catalog` hides it by default. |
| `stock` | integer | no | `0` | Informational; not enforced when ordering. |
| `highlight` | string | no | `null` | Short marketing hook. |
| `knowledge_file` | string | no | `null` | Path (relative to `CONFIG_DIR` / `pi-config/`) of a markdown ficha for the product. Consumed by the `get_product_details` tool — see [Extended product sheet](#extended-product-sheet-knowledge_file). |

## Upsert semantics

`setup/seed-products.mjs` calls `products.upsertBatch(rows)`, which calls
`products.upsert(row)` for each. The SQL is:

```sql
INSERT INTO products (...) VALUES (...)
ON CONFLICT (sku) DO UPDATE SET
  name, roaster, sca_score, profile, origin, process,
  price, cost, weight, available, stock, highlight, knowledge_file,
  updated_at = NOW()
```

Consequences:

- Re-running the script overwrites **every listed field** for matching
  SKUs. Partial updates via JSON aren't supported — always include the
  full record.
- Removing a product from `products.json` does **not** remove it from the
  DB. Flip `available: false` and re-seed, or use the repo's
  `setAvailable()` / a direct SQL `DELETE`.
- There is no transaction wrapping the batch — a mid-batch failure leaves
  earlier rows committed.

## Running the seed

```
docker compose exec gateway node setup/seed-products.mjs
# or with an explicit path:
docker compose exec gateway node setup/seed-products.mjs /config/pi/products.json
```

Prerequisites:

- `DATABASE_URL` is set (via `.env`).
- Migrations have run (the script calls `initDB()` itself).
- The file exists and is a non-empty array.

Failures: "file not found" and "not an array" exit with code `1` and a
clear error message.

## How the agent reads products

- `search_catalog` tool (see [../reference/tools.md](../reference/tools.md))
  runs `products.search({ query, maxPrice, minSca, available })` against
  ILIKE matches on `name`, `profile`, `roaster`, `origin`. The `available`
  filter defaults to `true`.
- `add_to_cart`, `create_order`, `checkout` look up by `sku` and refuse
  unavailable products.
- `knowledge_file` is consumed by the `get_product_details` tool (see
  below), not by `search_catalog`.

## Extended product sheet (`knowledge_file`)

For storytelling that doesn't fit in the DB columns (origin history,
producer notes, detailed tasting profile, brewing suggestions, pairings),
point `knowledge_file` at a markdown file relative to `CONFIG_DIR`
(typically `pi-config/`).

Convention: keep these under `pi-config/catalog/<slug>.md`.

```json
{
  "sku": "DEMO-MRCHOC-250",
  "name": "Mr. Chocolate",
  "knowledge_file": "catalog/mr-chocolate.md"
}
```

The `get_product_details(sku)` tool resolves the path against
`CONFIG_DIR`, reads the file, and inlines it in the response. Paths that
escape `CONFIG_DIR` (e.g. `../../etc/passwd`) are blocked. Missing files
produce a graceful fallback — the tool still returns the DB fields.

See `examples/pi-config/catalog/` for templates.

## Related

- [../reference/tools.md](../reference/tools.md) — `search_catalog`,
  `add_to_cart` behavior.
- [../reference/database.md](../reference/database.md) — `products` table
  schema.
- [../reference/setup-scripts.md](../reference/setup-scripts.md) —
  `seed-products.mjs` reference.
