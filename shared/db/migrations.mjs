/**
 * @fileoverview Migration definitions.
 *
 * Each migration is { version: number, description: string, up(db): void }.
 * The `db` parameter is a raw better-sqlite3 instance.
 */

/** @type {Array<{ version: number, description: string, up: (db: import('better-sqlite3').Database) => void }>} */
export const migrations = [
  {
    version: 1,
    description: 'Register pre-existing orders table from v5',
    up(db) {
      // A tabela orders já existe em produção.
      // Esta migration apenas valida a existência e registra v1.
      const row = db
        .prepare(
          `SELECT name FROM sqlite_master WHERE type='table' AND name='orders'`
        )
        .get();

      if (!row) {
        // Ambiente novo (dev/test) — criar a tabela orders do zero
        db.exec(`
          CREATE TABLE orders (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            phone        TEXT NOT NULL,
            name         TEXT,
            status       TEXT NOT NULL DEFAULT 'pending',
            items        TEXT NOT NULL,
            subtotal     REAL NOT NULL,
            discount     REAL NOT NULL DEFAULT 0,
            shipping     REAL,
            total        REAL NOT NULL,
            cep          TEXT,
            notes        TEXT,
            created_at   TEXT NOT NULL DEFAULT (datetime('now')),
            confirmed_at TEXT,
            paid_at      TEXT,
            shipped_at   TEXT,
            tracking     TEXT,
            cancelled_at TEXT
          );
          CREATE INDEX idx_orders_phone  ON orders(phone);
          CREATE INDEX idx_orders_status ON orders(status);
        `);
      }
    },
  },

  {
    version: 2,
    description: 'Create customers, products, cart_items tables + backfill',
    up(db) {
      // --- customers ---
      db.exec(`
        CREATE TABLE IF NOT EXISTS customers (
          id             INTEGER PRIMARY KEY AUTOINCREMENT,
          phone          TEXT UNIQUE NOT NULL,
          push_name      TEXT,
          name           TEXT,
          cpf            TEXT,
          email          TEXT,
          cep            TEXT,
          address        TEXT,
          city           TEXT,
          state          TEXT,
          tags           TEXT NOT NULL DEFAULT '[]',
          preferences    TEXT NOT NULL DEFAULT '{}',
          notes          TEXT,
          first_seen_at  TEXT NOT NULL DEFAULT (datetime('now')),
          last_seen_at   TEXT NOT NULL DEFAULT (datetime('now')),
          total_orders   INTEGER NOT NULL DEFAULT 0,
          total_spent    REAL NOT NULL DEFAULT 0,
          nps_score      INTEGER,
          nps_date       TEXT,
          created_at     TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);
      `);

      // --- products ---
      db.exec(`
        CREATE TABLE IF NOT EXISTS products (
          id             INTEGER PRIMARY KEY AUTOINCREMENT,
          sku            TEXT UNIQUE NOT NULL,
          name           TEXT NOT NULL,
          roaster        TEXT NOT NULL,
          sca_score      INTEGER,
          profile        TEXT,
          origin         TEXT,
          process        TEXT,
          price          REAL NOT NULL,
          cost           REAL,
          weight         TEXT NOT NULL DEFAULT '250g',
          available      INTEGER NOT NULL DEFAULT 1,
          stock          INTEGER NOT NULL DEFAULT 0,
          highlight      TEXT,
          knowledge_file TEXT,
          created_at     TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku);
        CREATE INDEX IF NOT EXISTS idx_products_available ON products(available);
      `);

      // --- cart_items ---
      db.exec(`
        CREATE TABLE IF NOT EXISTS cart_items (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          phone       TEXT NOT NULL,
          product_sku TEXT NOT NULL,
          qty         INTEGER NOT NULL DEFAULT 1,
          unit_price  REAL NOT NULL,
          added_at    TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY (product_sku) REFERENCES products(sku),
          UNIQUE(phone, product_sku)
        );
        CREATE INDEX IF NOT EXISTS idx_cart_phone ON cart_items(phone);
      `);

      // --- customer_id em orders ---
      // Verificar se a coluna já existe antes de adicionar
      const cols = db.pragma('table_info(orders)');
      const hasCustomerId = cols.some((c) => c.name === 'customer_id');
      if (!hasCustomerId) {
        db.exec(`ALTER TABLE orders ADD COLUMN customer_id INTEGER;`);
      }

      // --- Backfill: criar customers a partir de orders existentes ---
      const distinctPhones = db
        .prepare(
          `SELECT DISTINCT phone, name FROM orders ORDER BY id ASC`
        )
        .all();

      const insertCustomer = db.prepare(`
        INSERT OR IGNORE INTO customers (phone, name)
        VALUES (?, ?)
      `);

      const getCustomerId = db.prepare(
        `SELECT id FROM customers WHERE phone = ?`
      );

      const updateOrderCustomerId = db.prepare(
        `UPDATE orders SET customer_id = ? WHERE phone = ? AND customer_id IS NULL`
      );

      for (const { phone, name } of distinctPhones) {
        insertCustomer.run(phone, name);
        const customer = getCustomerId.get(phone);
        if (customer) {
          updateOrderCustomerId.run(customer.id, phone);
        }
      }

      // Recalcular contadores para cada customer recém-criado
      const recalc = db.prepare(`
        UPDATE customers SET
          total_orders = (
            SELECT COUNT(*) FROM orders
            WHERE orders.phone = customers.phone
              AND orders.status NOT IN ('cancelled', 'pending')
          ),
          total_spent = (
            SELECT COALESCE(SUM(total), 0) FROM orders
            WHERE orders.phone = customers.phone
              AND orders.status NOT IN ('cancelled', 'pending')
          )
        WHERE phone = ?
      `);

      for (const { phone } of distinctPhones) {
        recalc.run(phone);
      }
    },
  },

  {
    version: 3,
    description: 'Referral system + access control',
    up(db) {
      // ── New columns on customers ────────────────────────
      const cols = db.pragma('table_info(customers)');
      const colNames = new Set(cols.map(c => c.name));

      if (!colNames.has('referral_code')) {
        db.exec(`ALTER TABLE customers ADD COLUMN referral_code TEXT;`);
      }
      if (!colNames.has('referred_by_phone')) {
        db.exec(`ALTER TABLE customers ADD COLUMN referred_by_phone TEXT;`);
      }
      if (!colNames.has('access_status')) {
        db.exec(`ALTER TABLE customers ADD COLUMN access_status TEXT DEFAULT 'active';`);
      }

      // Unique index on referral_code (partial — only non-NULL)
      db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_referral_code
               ON customers(referral_code) WHERE referral_code IS NOT NULL;`);

      // ── Mark existing customers as 'seed' ──────────────
      db.exec(`UPDATE customers SET access_status = 'seed' WHERE access_status = 'active';`);

      // ── Generate referral codes for existing customers ──
      const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      function genCode() {
        let code = process.env.REFERRAL_CODE_PREFIX || 'REF-';
        for (let i = 0; i < 4; i++) {
          code += CHARS[Math.floor(Math.random() * CHARS.length)];
        }
        return code;
      }

      const existing = db.prepare(`SELECT phone FROM customers WHERE referral_code IS NULL`).all();
      const setCode = db.prepare(`UPDATE customers SET referral_code = ? WHERE phone = ?`);
      const checkCode = db.prepare(`SELECT 1 FROM customers WHERE referral_code = ?`);

      for (const { phone } of existing) {
        let code;
        let attempts = 0;
        do {
          code = genCode();
          attempts++;
        } while (checkCode.get(code) && attempts < 100);
        setCode.run(code, phone);
      }

      // ── Referrals table ────────────────────────────────
      db.exec(`
        CREATE TABLE IF NOT EXISTS referrals (
          id                      INTEGER PRIMARY KEY AUTOINCREMENT,
          referrer_phone          TEXT NOT NULL,
          referred_phone          TEXT NOT NULL,
          referral_code_used      TEXT NOT NULL,
          status                  TEXT NOT NULL DEFAULT 'pending',
          reward_type             TEXT DEFAULT 'discount_percent',
          reward_value            REAL DEFAULT 10,
          reward_applied_to_order INTEGER,
          created_at              TEXT NOT NULL DEFAULT (datetime('now')),
          activated_at            TEXT,
          rewarded_at             TEXT,
          UNIQUE(referrer_phone, referred_phone)
        );
        CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_phone);
        CREATE INDEX IF NOT EXISTS idx_referrals_referred ON referrals(referred_phone);
        CREATE INDEX IF NOT EXISTS idx_referrals_code ON referrals(referral_code_used);
      `);
    },
  },


  {
    version: 4,
    description: 'Conversation history table',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS conversations (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          phone      TEXT NOT NULL,
          role       TEXT NOT NULL,
          content    TEXT NOT NULL,
          tool_name  TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_conversations_phone_date
          ON conversations(phone, created_at);
      `);
    },
  },
];
