/**
 * @fileoverview Product repository (catálogo).
 *
 * Factory pattern — call createProductRepo(db) with a better-sqlite3 instance.
 */

/** @typedef {import('better-sqlite3').Database} Database */

/**
 * @typedef {Object} Product
 * @property {number} id
 * @property {string} sku
 * @property {string} name
 * @property {string} roaster
 * @property {number|null} sca_score
 * @property {string|null} profile
 * @property {string|null} origin
 * @property {string|null} process
 * @property {number} price
 * @property {number|null} cost
 * @property {string} weight
 * @property {number} available
 * @property {number} stock
 * @property {string|null} highlight
 * @property {string|null} knowledge_file
 * @property {string} created_at
 * @property {string} updated_at
 */

/**
 * Creates a product repository bound to the given database instance.
 *
 * @param {Database} db - better-sqlite3 database instance
 * @returns {ReturnType<typeof _buildRepo>}
 */
export function createProductRepo(db) {
  return _buildRepo(db);
}

/**
 * @param {Database} db
 */
function _buildRepo(db) {
  // ── Prepared statements ──────────────────────────────────────────────

  const stmtGetBySku = db.prepare(`SELECT * FROM products WHERE sku = ?`);

  const stmtGetAvailable = db.prepare(
    `SELECT * FROM products WHERE available = 1 ORDER BY name`
  );

  const stmtUpsert = db.prepare(`
    INSERT INTO products (sku, name, roaster, sca_score, profile, origin, process, price, cost, weight, available, stock, highlight, knowledge_file)
    VALUES (@sku, @name, @roaster, @sca_score, @profile, @origin, @process, @price, @cost, @weight, @available, @stock, @highlight, @knowledge_file)
    ON CONFLICT(sku) DO UPDATE SET
      name           = excluded.name,
      roaster        = excluded.roaster,
      sca_score      = excluded.sca_score,
      profile        = excluded.profile,
      origin         = excluded.origin,
      process        = excluded.process,
      price          = excluded.price,
      cost           = excluded.cost,
      weight         = excluded.weight,
      available      = excluded.available,
      stock          = excluded.stock,
      highlight      = excluded.highlight,
      knowledge_file = excluded.knowledge_file,
      updated_at     = datetime('now')
  `);

  const stmtUpdateStock = db.prepare(`
    UPDATE products
    SET stock = stock + ?, updated_at = datetime('now')
    WHERE sku = ?
  `);

  const stmtSetAvailable = db.prepare(`
    UPDATE products
    SET available = ?, updated_at = datetime('now')
    WHERE sku = ?
  `);

  // ── Public API ───────────────────────────────────────────────────────

  return {
    /**
     * Flexible product search with multiple optional filters.
     * `query` does LIKE matching against name, profile, roaster, and origin.
     *
     * @param {{ query?: string, available?: boolean, maxPrice?: number, minSca?: number, roaster?: string }} [opts]
     * @returns {Product[]}
     */
    search(opts = {}) {
      const {
        query,
        available = true,
        maxPrice,
        minSca,
        roaster,
      } = opts;

      const conditions = [];
      const params = [];

      if (available !== undefined && available !== null) {
        conditions.push(`available = ?`);
        params.push(available ? 1 : 0);
      }

      if (query) {
        const pattern = `%${query}%`;
        conditions.push(
          `(name LIKE ? OR profile LIKE ? OR roaster LIKE ? OR origin LIKE ?)`
        );
        params.push(pattern, pattern, pattern, pattern);
      }

      if (maxPrice !== undefined && maxPrice !== null) {
        conditions.push(`price <= ?`);
        params.push(maxPrice);
      }

      if (minSca !== undefined && minSca !== null) {
        conditions.push(`sca_score >= ?`);
        params.push(minSca);
      }

      if (roaster) {
        conditions.push(`roaster = ?`);
        params.push(roaster);
      }

      const where =
        conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      const sql = `SELECT * FROM products ${where} ORDER BY name`;
      return db.prepare(sql).all(...params);
    },

    /**
     * Get a single product by SKU.
     *
     * @param {string} sku
     * @returns {Product|undefined}
     */
    getBySku(sku) {
      return stmtGetBySku.get(sku);
    },

    /**
     * Get all available products (available=1).
     *
     * @returns {Product[]}
     */
    getAvailable() {
      return stmtGetAvailable.all();
    },

    /**
     * Upsert products from a CSV import (array of row objects).
     * Uses INSERT OR REPLACE (ON CONFLICT) for each row.
     *
     * @param {Array<Record<string, any>>} rows
     * @returns {{ inserted: number }}
     */
    upsertFromCSV(rows) {
      const runAll = db.transaction((items) => {
        let inserted = 0;
        for (const row of items) {
          stmtUpsert.run({
            sku: row.sku,
            name: row.name,
            roaster: row.roaster,
            sca_score: row.sca_score ?? null,
            profile: row.profile ?? null,
            origin: row.origin ?? null,
            process: row.process ?? null,
            price: row.price,
            cost: row.cost ?? null,
            weight: row.weight ?? '250g',
            available: row.available !== undefined ? (row.available ? 1 : 0) : 1,
            stock: row.stock ?? 0,
            highlight: row.highlight ?? null,
            knowledge_file: row.knowledge_file ?? null,
          });
          inserted++;
        }
        return { inserted };
      });
      return runAll(rows);
    },

    /**
     * Increment or decrement stock by delta. Returns new stock value.
     *
     * @param {string} sku
     * @param {number} delta - Positive to add, negative to subtract.
     * @returns {number} New stock value.
     */
    updateStock(sku, delta) {
      stmtUpdateStock.run(delta, sku);
      const product = stmtGetBySku.get(sku);
      return product ? product.stock : 0;
    },

    /**
     * Set product availability.
     *
     * @param {string} sku
     * @param {boolean} available
     */
    setAvailable(sku, available) {
      stmtSetAvailable.run(available ? 1 : 0, sku);
    },
  };
}
