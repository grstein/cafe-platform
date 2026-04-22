/**
 * @fileoverview Cart repository — PostgreSQL, async.
 */

/**
 * @param {import('postgres').Sql} sql
 */
export function createCartRepo(sql) {
  return {
    async addItem(phone, sku, qty, unitPrice) {
      await sql`
        INSERT INTO cart_items (phone, product_sku, qty, unit_price)
        VALUES (${phone}, ${sku}, ${qty}, ${unitPrice})
        ON CONFLICT (phone, product_sku) DO UPDATE SET
          qty        = EXCLUDED.qty,
          unit_price = EXCLUDED.unit_price,
          added_at   = NOW()
      `;
    },

    async updateQty(phone, sku, qty) {
      const result = await sql`
        UPDATE cart_items SET qty = ${qty}, added_at = NOW()
        WHERE phone = ${phone} AND product_sku = ${sku}
      `;
      return result.count > 0;
    },

    async removeItem(phone, sku) {
      const result = await sql`
        DELETE FROM cart_items WHERE phone = ${phone} AND product_sku = ${sku}
      `;
      return result.count > 0;
    },

    async clear(phone) {
      const result = await sql`DELETE FROM cart_items WHERE phone = ${phone}`;
      return result.count;
    },

    async getItems(phone) {
      return sql`
        SELECT ci.*, p.name AS product_name
        FROM cart_items ci
        LEFT JOIN products p ON p.sku = ci.product_sku
        WHERE ci.phone = ${phone}
        ORDER BY ci.added_at ASC
      `;
    },

    async getItem(phone, sku) {
      const [row] = await sql`
        SELECT ci.*, p.name AS product_name
        FROM cart_items ci
        LEFT JOIN products p ON p.sku = ci.product_sku
        WHERE ci.phone = ${phone} AND ci.product_sku = ${sku}
      `;
      return row ?? null;
    },

    async getSummary(phone) {
      const items = await this.getItems(phone);
      const subtotal = items.reduce((s, i) => s + Number(i.qty) * Number(i.unit_price), 0);
      const count = items.reduce((c, i) => c + Number(i.qty), 0);
      return { items, subtotal, count };
    },

    async cleanupOld(days = 7) {
      const result = await sql`
        DELETE FROM cart_items
        WHERE phone IN (
          SELECT DISTINCT phone FROM cart_items
          WHERE added_at < NOW() - (${days} || ' days')::INTERVAL
        )
      `;
      return result.count;
    },
  };
}
