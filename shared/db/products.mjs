/**
 * @fileoverview Product repository — PostgreSQL, async.
 */

/**
 * @param {import('postgres').Sql} sql
 */
export function createProductRepo(sql) {
  return {
    async search(opts = {}) {
      const { query, available = true, maxPrice, minSca, roaster } = opts;
      const pattern = query ? `%${query}%` : null;

      return sql`
        SELECT * FROM products
        WHERE 1=1
          ${available !== undefined && available !== null
            ? sql`AND available = ${available ? 1 : 0}`
            : sql``}
          ${pattern
            ? sql`AND (name ILIKE ${pattern} OR profile ILIKE ${pattern} OR roaster ILIKE ${pattern} OR origin ILIKE ${pattern})`
            : sql``}
          ${maxPrice != null ? sql`AND price <= ${maxPrice}` : sql``}
          ${minSca != null ? sql`AND sca_score >= ${minSca}` : sql``}
          ${roaster ? sql`AND roaster = ${roaster}` : sql``}
        ORDER BY name
      `;
    },

    async getBySku(sku) {
      const [row] = await sql`SELECT * FROM products WHERE sku = ${sku}`;
      return row ?? null;
    },

    async getAvailable() {
      return sql`SELECT * FROM products WHERE available = 1 ORDER BY name`;
    },

    async upsert(product) {
      const [row] = await sql`
        INSERT INTO products
          (sku, name, roaster, sca_score, profile, origin, process, price, cost, weight, available, stock, highlight, knowledge_file)
        VALUES
          (${product.sku}, ${product.name}, ${product.roaster ?? ""}, ${product.sca_score ?? null},
           ${product.profile ?? null}, ${product.origin ?? null}, ${product.process ?? null},
           ${product.price}, ${product.cost ?? null}, ${product.weight ?? "250g"},
           ${product.available !== false ? 1 : 0}, ${product.stock ?? 0},
           ${product.highlight ?? null}, ${product.knowledge_file ?? null})
        ON CONFLICT (sku) DO UPDATE SET
          name           = EXCLUDED.name,
          roaster        = EXCLUDED.roaster,
          sca_score      = EXCLUDED.sca_score,
          profile        = EXCLUDED.profile,
          origin         = EXCLUDED.origin,
          process        = EXCLUDED.process,
          price          = EXCLUDED.price,
          cost           = EXCLUDED.cost,
          weight         = EXCLUDED.weight,
          available      = EXCLUDED.available,
          stock          = EXCLUDED.stock,
          highlight      = EXCLUDED.highlight,
          knowledge_file = EXCLUDED.knowledge_file,
          updated_at     = NOW()
        RETURNING *
      `;
      return row;
    },

    async upsertBatch(rows) {
      let inserted = 0;
      for (const row of rows) {
        await this.upsert(row);
        inserted++;
      }
      return { inserted };
    },

    async updateStock(sku, delta) {
      const [row] = await sql`
        UPDATE products SET stock = stock + ${delta}, updated_at = NOW()
        WHERE sku = ${sku}
        RETURNING stock
      `;
      return row?.stock ?? 0;
    },

    async setAvailable(sku, available) {
      await sql`
        UPDATE products SET available = ${available ? 1 : 0}, updated_at = NOW()
        WHERE sku = ${sku}
      `;
    },
  };
}
