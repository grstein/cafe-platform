/**
 * @fileoverview PostgreSQL migration runner.
 *
 * Each migration is { version, description, up(sql) }.
 * `sql` is a postgres.js tagged-template client.
 * Migrations run in order and are idempotent (skipped if already applied).
 */

/** @type {Array<{ version: number, description: string, up: (sql: import('postgres').Sql) => Promise<void> }>} */
export const migrations = [
  {
    version: 1,
    description: "Initial schema — customers, products, orders, cart_items",
    async up(sql) {
      await sql`
        CREATE TABLE IF NOT EXISTS customers (
          id               SERIAL PRIMARY KEY,
          phone            TEXT UNIQUE NOT NULL,
          push_name        TEXT,
          name             TEXT,
          cpf              TEXT,
          email            TEXT,
          cep              TEXT,
          address          TEXT,
          city             TEXT,
          state            TEXT,
          tags             TEXT NOT NULL DEFAULT '[]',
          preferences      TEXT NOT NULL DEFAULT '{}',
          notes            TEXT,
          referral_code    TEXT UNIQUE,
          referred_by_phone TEXT,
          access_status    TEXT NOT NULL DEFAULT 'active',
          first_seen_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          last_seen_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          total_orders     INTEGER NOT NULL DEFAULT 0,
          total_spent      NUMERIC(10,2) NOT NULL DEFAULT 0,
          nps_score        INTEGER,
          nps_date         TIMESTAMPTZ,
          created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
      await sql`CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_customers_referral_code ON customers(referral_code) WHERE referral_code IS NOT NULL`;
      await sql`CREATE INDEX IF NOT EXISTS idx_customers_access_status ON customers(access_status)`;

      await sql`
        CREATE TABLE IF NOT EXISTS products (
          id             SERIAL PRIMARY KEY,
          sku            TEXT UNIQUE NOT NULL,
          name           TEXT NOT NULL,
          roaster        TEXT NOT NULL DEFAULT '',
          sca_score      INTEGER,
          profile        TEXT,
          origin         TEXT,
          process        TEXT,
          price          NUMERIC(10,2) NOT NULL,
          cost           NUMERIC(10,2),
          weight         TEXT NOT NULL DEFAULT '250g',
          available      INTEGER NOT NULL DEFAULT 1,
          stock          INTEGER NOT NULL DEFAULT 0,
          highlight      TEXT,
          knowledge_file TEXT,
          created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
      await sql`CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_products_available ON products(available)`;

      await sql`
        CREATE TABLE IF NOT EXISTS orders (
          id           SERIAL PRIMARY KEY,
          phone        TEXT NOT NULL,
          customer_id  INTEGER,
          name         TEXT,
          status       TEXT NOT NULL DEFAULT 'pending',
          items        TEXT NOT NULL,
          subtotal     NUMERIC(10,2) NOT NULL,
          discount     NUMERIC(10,2) NOT NULL DEFAULT 0,
          shipping     NUMERIC(10,2),
          total        NUMERIC(10,2) NOT NULL,
          cep          TEXT,
          notes        TEXT,
          created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          confirmed_at TIMESTAMPTZ,
          paid_at      TIMESTAMPTZ,
          shipped_at   TIMESTAMPTZ,
          tracking     TEXT,
          cancelled_at TIMESTAMPTZ
        )
      `;
      await sql`CREATE INDEX IF NOT EXISTS idx_orders_phone ON orders(phone)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status)`;

      await sql`
        CREATE TABLE IF NOT EXISTS cart_items (
          id          SERIAL PRIMARY KEY,
          phone       TEXT NOT NULL,
          product_sku TEXT NOT NULL,
          qty         INTEGER NOT NULL DEFAULT 1,
          unit_price  NUMERIC(10,2) NOT NULL,
          added_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE(phone, product_sku)
        )
      `;
      await sql`CREATE INDEX IF NOT EXISTS idx_cart_phone ON cart_items(phone)`;
    },
  },

  {
    version: 2,
    description: "Conversations and referrals tables",
    async up(sql) {
      await sql`
        CREATE TABLE IF NOT EXISTS conversations (
          id         SERIAL PRIMARY KEY,
          phone      TEXT NOT NULL,
          role       TEXT NOT NULL,
          content    TEXT NOT NULL,
          tool_name  TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
      await sql`CREATE INDEX IF NOT EXISTS idx_conversations_phone_date ON conversations(phone, created_at)`;

      await sql`
        CREATE TABLE IF NOT EXISTS referrals (
          id                      SERIAL PRIMARY KEY,
          referrer_phone          TEXT NOT NULL,
          referred_phone          TEXT NOT NULL,
          referral_code_used      TEXT NOT NULL,
          status                  TEXT NOT NULL DEFAULT 'pending',
          reward_type             TEXT DEFAULT 'discount_percent',
          reward_value            NUMERIC(10,2) DEFAULT 10,
          reward_applied_to_order INTEGER,
          created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          activated_at            TIMESTAMPTZ,
          rewarded_at             TIMESTAMPTZ,
          UNIQUE(referrer_phone, referred_phone)
        )
      `;
      await sql`CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_phone)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_referrals_referred ON referrals(referred_phone)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_referrals_code ON referrals(referral_code_used)`;
    },
  },

  {
    version: 3,
    description: "App config (single JSONB row) + allowlist table",
    async up(sql) {
      await sql`
        CREATE TABLE IF NOT EXISTS app_config (
          id         INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
          config     JSONB NOT NULL DEFAULT '{}',
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;

      await sql`
        CREATE TABLE IF NOT EXISTS allowlist (
          pattern    TEXT PRIMARY KEY,
          note       TEXT,
          active     BOOLEAN NOT NULL DEFAULT true,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
    },
  },
];

/**
 * Run all pending migrations against the given postgres.js client.
 *
 * @param {import('postgres').Sql} sql
 * @returns {Promise<void>}
 */
export async function runMigrations(sql) {
  // Ensure version tracking table exists
  await sql`
    CREATE TABLE IF NOT EXISTS schema_version (
      version    INTEGER PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  const [row] = await sql`SELECT COALESCE(MAX(version), 0) AS current FROM schema_version`;
  const currentVersion = Number(row.current);

  const pending = migrations
    .filter((m) => m.version > currentVersion)
    .sort((a, b) => a.version - b.version);

  if (pending.length === 0) return;

  for (const migration of pending) {
    console.log(`[db] Applying migration v${migration.version}: ${migration.description}`);
    await sql.begin(async (tx) => {
      await migration.up(tx);
      await tx`INSERT INTO schema_version (version) VALUES (${migration.version})`;
    });
  }

  console.log(`[db] Migrations complete (applied ${pending.length})`);
}
