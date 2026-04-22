/**
 * @fileoverview Order repository.
 *
 * Factory pattern — call createOrderRepo(db) with a better-sqlite3 instance.
 */

/** @typedef {import('better-sqlite3').Database} Database */

/**
 * @typedef {Object} Order
 * @property {number} id
 * @property {string} phone
 * @property {number|null} customer_id
 * @property {string|null} name
 * @property {string} status
 * @property {string} items - JSON array
 * @property {number} subtotal
 * @property {number} discount
 * @property {number|null} shipping
 * @property {number} total
 * @property {string|null} cep
 * @property {string|null} notes
 * @property {string} created_at
 * @property {string|null} confirmed_at
 * @property {string|null} paid_at
 * @property {string|null} shipped_at
 * @property {string|null} tracking
 * @property {string|null} cancelled_at
 */

/**
 * Creates an order repository bound to the given database instance.
 *
 * @param {Database} db - better-sqlite3 database instance
 * @returns {ReturnType<typeof _buildRepo>}
 */
export function createOrderRepo(db) {
  return _buildRepo(db);
}

/**
 * @param {Database} db
 */
function _buildRepo(db) {
  // ── Prepared statements ──────────────────────────────────────────────

  const stmtCancelPending = db.prepare(`
    UPDATE orders
    SET status = 'cancelled', cancelled_at = datetime('now')
    WHERE phone = ? AND status = 'pending'
  `);

  const stmtInsert = db.prepare(`
    INSERT INTO orders (phone, customer_id, name, items, subtotal, discount, shipping, total, cep, notes)
    VALUES (@phone, @customer_id, @name, @items, @subtotal, @discount, @shipping, @total, @cep, @notes)
  `);

  const stmtGetPending = db.prepare(`
    SELECT * FROM orders
    WHERE phone = ? AND status = 'pending'
    ORDER BY id DESC
    LIMIT 1
  `);

  const stmtConfirm = db.prepare(`
    UPDATE orders
    SET status = 'confirmed', confirmed_at = datetime('now')
    WHERE phone = ? AND status = 'pending'
  `);

  const stmtCancel = db.prepare(`
    UPDATE orders
    SET status = 'cancelled', cancelled_at = datetime('now')
    WHERE phone = ? AND status = 'pending'
  `);

  const stmtGetById = db.prepare(`SELECT * FROM orders WHERE id = ?`);

  const stmtGetLastCompleted = db.prepare(`
    SELECT * FROM orders
    WHERE phone = ? AND status IN ('confirmed', 'paid', 'shipped', 'delivered')
    ORDER BY id DESC
    LIMIT 1
  `);

  // ── Public API ───────────────────────────────────────────────────────

  return {
    /**
     * Create a new order. Cancels any existing pending orders for the same phone.
     *
     * @param {string} phone
     * @param {{ customerId?: number|null, name?: string|null, items: string|Array, subtotal: number, discount?: number, shipping?: number|null, total: number, cep?: string|null, notes?: string|null }} data
     * @returns {number} The new order ID.
     */
    create(phone, data) {
      const run = db.transaction(() => {
        // Cancel existing pending orders for this phone
        stmtCancelPending.run(phone);

        const items =
          typeof data.items === 'string'
            ? data.items
            : JSON.stringify(data.items);

        const result = stmtInsert.run({
          phone,
          customer_id: data.customerId ?? null,
          name: data.name ?? null,
          items,
          subtotal: data.subtotal,
          discount: data.discount ?? 0,
          shipping: data.shipping ?? null,
          total: data.total,
          cep: data.cep ?? null,
          notes: data.notes ?? null,
        });

        return Number(result.lastInsertRowid);
      });

      return run();
    },

    /**
     * Get the most recent pending order for a phone.
     *
     * @param {string} phone
     * @returns {Order|undefined}
     */
    getPending(phone) {
      return stmtGetPending.get(phone);
    },

    /**
     * Confirm the pending order for a phone.
     *
     * @param {string} phone
     * @returns {Order|undefined} The confirmed order, or undefined if none was pending.
     */
    confirm(phone) {
      const pending = stmtGetPending.get(phone);
      if (!pending) return undefined;

      stmtConfirm.run(phone);
      return stmtGetById.get(pending.id);
    },

    /**
     * Cancel the pending order for a phone.
     *
     * @param {string} phone
     * @returns {Order|undefined} The cancelled order, or undefined if none was pending.
     */
    cancel(phone) {
      const pending = stmtGetPending.get(phone);
      if (!pending) return undefined;

      stmtCancel.run(phone);
      return stmtGetById.get(pending.id);
    },

    /**
     * Get an order by its ID.
     *
     * @param {number} id
     * @returns {Order|undefined}
     */
    getById(id) {
      return stmtGetById.get(id);
    },

    /**
     * Generic status update with optional extra fields.
     *
     * @param {number} id
     * @param {string} status
     * @param {{ paid_at?: string, shipped_at?: string, tracking?: string }} [extraFields]
     * @returns {Order|undefined}
     */
    updateStatus(id, status, extraFields = {}) {
      const sets = ['status = ?'];
      const params = [status];

      // Add timestamp for known status transitions
      const statusTimestamps = {
        confirmed: 'confirmed_at',
        paid: 'paid_at',
        shipped: 'shipped_at',
        cancelled: 'cancelled_at',
      };

      const tsCol = statusTimestamps[status];
      if (tsCol && !extraFields[tsCol]) {
        sets.push(`${tsCol} = datetime('now')`);
      }

      // Apply extra fields
      const allowedExtras = ['paid_at', 'shipped_at', 'tracking'];
      for (const key of allowedExtras) {
        if (extraFields[key] !== undefined) {
          sets.push(`${key} = ?`);
          params.push(extraFields[key]);
        }
      }

      params.push(id);

      const sql = `UPDATE orders SET ${sets.join(', ')} WHERE id = ?`;
      db.prepare(sql).run(...params);

      return stmtGetById.get(id);
    },

    /**
     * List orders for a phone with optional filters.
     *
     * @param {string} phone
     * @param {{ status?: string, limit?: number }} [opts]
     * @returns {Order[]}
     */
    listByPhone(phone, opts = {}) {
      const { status, limit = 20 } = opts;

      const conditions = ['phone = ?'];
      const params = [phone];

      if (status) {
        conditions.push('status = ?');
        params.push(status);
      }

      const sql = `SELECT * FROM orders WHERE ${conditions.join(' AND ')} ORDER BY id DESC LIMIT ?`;
      params.push(limit);

      return db.prepare(sql).all(...params);
    },

    /**
     * Get the last completed order for a phone.
     * "Completed" means status IN ('confirmed', 'paid', 'shipped', 'delivered').
     *
     * @param {string} phone
     * @returns {Order|undefined}
     */
    getLastCompleted(phone) {
      return stmtGetLastCompleted.get(phone);
    },

    /**
     * Get aggregate stats for a phone.
     *
     * @param {string} phone
     * @returns {{ totalOrders: number, totalSpent: number, lastOrderDate: string|null, favoriteProduct: string|null }}
     */
    getStats(phone) {
      const agg = db
        .prepare(
          `SELECT
            COUNT(*) AS totalOrders,
            COALESCE(SUM(total), 0) AS totalSpent,
            MAX(created_at) AS lastOrderDate
          FROM orders
          WHERE phone = ? AND status NOT IN ('cancelled', 'pending')`
        )
        .get(phone);

      // Favorite product: parse items JSON from all non-cancelled orders,
      // count occurrences, return the most frequent.
      const rows = db
        .prepare(
          `SELECT items FROM orders
           WHERE phone = ? AND status NOT IN ('cancelled', 'pending')`
        )
        .all(phone);

      let favoriteProduct = null;

      if (rows.length > 0) {
        /** @type {Map<string, number>} */
        const freq = new Map();

        for (const row of rows) {
          let items;
          try {
            items = JSON.parse(row.items);
          } catch {
            continue;
          }

          if (!Array.isArray(items)) continue;

          for (const item of items) {
            const key = item.name || item.product || item.sku || null;
            if (key) {
              freq.set(key, (freq.get(key) || 0) + (item.qty || item.quantity || 1));
            }
          }
        }

        if (freq.size > 0) {
          let maxCount = 0;
          for (const [name, count] of freq) {
            if (count > maxCount) {
              maxCount = count;
              favoriteProduct = name;
            }
          }
        }
      }

      return {
        totalOrders: agg.totalOrders,
        totalSpent: agg.totalSpent,
        lastOrderDate: agg.lastOrderDate,
        favoriteProduct,
      };
    },
  };
}
