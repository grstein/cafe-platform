/**
 * @fileoverview Order repository — PostgreSQL, async.
 */

/**
 * @param {import('postgres').Sql} sql
 */
export function createOrderRepo(sql) {
  return {
    /**
     * Create a new order. Cancels any existing pending orders for the same phone.
     * @returns {Promise<number>} The new order ID.
     */
    async create(phone, data) {
      const items = typeof data.items === "string" ? data.items : JSON.stringify(data.items);

      const [row] = await sql.begin(async (tx) => {
        // Cancel existing pending orders
        await tx`
          UPDATE orders SET status = 'cancelled', cancelled_at = NOW()
          WHERE phone = ${phone} AND status = 'pending'
        `;

        return tx`
          INSERT INTO orders (phone, customer_id, name, items, subtotal, discount, shipping, total, cep, notes)
          VALUES (
            ${phone}, ${data.customerId ?? null}, ${data.name ?? null},
            ${items}, ${data.subtotal}, ${data.discount ?? 0},
            ${data.shipping ?? null}, ${data.total},
            ${data.cep ?? null}, ${data.notes ?? null}
          )
          RETURNING *
        `;
      });

      return Number(row.id);
    },

    async getPending(phone) {
      const [row] = await sql`
        SELECT * FROM orders WHERE phone = ${phone} AND status = 'pending'
        ORDER BY id DESC LIMIT 1
      `;
      return row ?? null;
    },

    async confirm(phone) {
      const pending = await this.getPending(phone);
      if (!pending) return null;

      const [row] = await sql`
        UPDATE orders SET status = 'confirmed', confirmed_at = NOW()
        WHERE phone = ${phone} AND status = 'pending'
        RETURNING *
      `;
      return row ?? null;
    },

    async cancel(phone) {
      const pending = await this.getPending(phone);
      if (!pending) return null;

      const [row] = await sql`
        UPDATE orders SET status = 'cancelled', cancelled_at = NOW()
        WHERE phone = ${phone} AND status = 'pending'
        RETURNING *
      `;
      return row ?? null;
    },

    async getById(id) {
      const [row] = await sql`SELECT * FROM orders WHERE id = ${id}`;
      return row ?? null;
    },

    async getLastCompleted(phone) {
      const [row] = await sql`
        SELECT * FROM orders
        WHERE phone = ${phone} AND status IN ('confirmed', 'paid', 'shipped', 'delivered')
        ORDER BY id DESC LIMIT 1
      `;
      return row ?? null;
    },

    async updateStatus(id, status, extraFields = {}) {
      const statusTimestamps = {
        confirmed: "confirmed_at",
        paid:      "paid_at",
        shipped:   "shipped_at",
        cancelled: "cancelled_at",
      };

      // Build simple value updates (no SQL fragments)
      const updates = { status };
      const allowedExtras = ["paid_at", "shipped_at", "tracking"];
      for (const key of allowedExtras) {
        if (extraFields[key] !== undefined) updates[key] = extraFields[key];
      }

      // Determine which timestamp column to set to NOW()
      const tsCol = statusTimestamps[status];
      const setNowCol = tsCol && !extraFields[tsCol] ? tsCol : null;

      if (setNowCol === "confirmed_at") {
        const [row] = await sql`UPDATE orders SET ${sql(updates)}, confirmed_at = NOW() WHERE id = ${id} RETURNING *`;
        return row ?? null;
      } else if (setNowCol === "paid_at") {
        const [row] = await sql`UPDATE orders SET ${sql(updates)}, paid_at = NOW() WHERE id = ${id} RETURNING *`;
        return row ?? null;
      } else if (setNowCol === "shipped_at") {
        const [row] = await sql`UPDATE orders SET ${sql(updates)}, shipped_at = NOW() WHERE id = ${id} RETURNING *`;
        return row ?? null;
      } else if (setNowCol === "cancelled_at") {
        const [row] = await sql`UPDATE orders SET ${sql(updates)}, cancelled_at = NOW() WHERE id = ${id} RETURNING *`;
        return row ?? null;
      } else {
        const [row] = await sql`UPDATE orders SET ${sql(updates)} WHERE id = ${id} RETURNING *`;
        return row ?? null;
      }
    },

    async listByPhone(phone, opts = {}) {
      const { status, limit = 20 } = opts;
      return sql`
        SELECT * FROM orders
        WHERE phone = ${phone}
          ${status ? sql`AND status = ${status}` : sql``}
        ORDER BY id DESC
        LIMIT ${limit}
      `;
    },

    async getRecent(phone, limit = 3) {
      return sql`
        SELECT * FROM orders WHERE phone = ${phone}
        ORDER BY id DESC LIMIT ${limit}
      `;
    },

    async getStats(phone) {
      const [agg] = await sql`
        SELECT
          COUNT(*)::int AS "totalOrders",
          COALESCE(SUM(total), 0) AS "totalSpent",
          MAX(created_at) AS "lastOrderDate"
        FROM orders
        WHERE phone = ${phone} AND status NOT IN ('cancelled', 'pending')
      `;

      const rows = await sql`
        SELECT items FROM orders
        WHERE phone = ${phone} AND status NOT IN ('cancelled', 'pending')
      `;

      let favoriteProduct = null;
      const freq = new Map();
      for (const row of rows) {
        let items;
        try { items = typeof row.items === "string" ? JSON.parse(row.items) : row.items; }
        catch { continue; }
        if (!Array.isArray(items)) continue;
        for (const item of items) {
          const key = item.name || item.product || item.sku || null;
          if (key) freq.set(key, (freq.get(key) || 0) + (item.qty || item.quantity || 1));
        }
      }
      if (freq.size > 0) {
        let maxCount = 0;
        for (const [name, count] of freq) {
          if (count > maxCount) { maxCount = count; favoriteProduct = name; }
        }
      }

      return {
        totalOrders: Number(agg.totalOrders),
        totalSpent:  Number(agg.totalSpent),
        lastOrderDate: agg.lastOrderDate ?? null,
        favoriteProduct,
      };
    },
  };
}
