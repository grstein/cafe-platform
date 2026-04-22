/**
 * @fileoverview Cart repository.
 *
 * Manages incremental shopping cart per phone number.
 * Cart items persist across sessions (survive session expiry).
 */

/** @typedef {import('better-sqlite3').Database} Database */

/**
 * @typedef {Object} CartItem
 * @property {number} id
 * @property {string} phone
 * @property {string} product_sku
 * @property {number} qty
 * @property {number} unit_price
 * @property {string} added_at
 * @property {string} [product_name] - Joined from products table.
 */

/**
 * Creates a cart repository bound to the given database instance.
 *
 * @param {Database} db
 * @returns {ReturnType<typeof _buildRepo>}
 */
export function createCartRepo(db) {
  return _buildRepo(db);
}

/**
 * @param {Database} db
 */
function _buildRepo(db) {
  // ── Prepared statements ──────────────────────────────────────────────

  const stmtUpsert = db.prepare(`
    INSERT INTO cart_items (phone, product_sku, qty, unit_price)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(phone, product_sku) DO UPDATE SET
      qty = excluded.qty,
      unit_price = excluded.unit_price,
      added_at = datetime('now')
  `);

  const stmtUpdateQty = db.prepare(`
    UPDATE cart_items SET qty = ?, added_at = datetime('now')
    WHERE phone = ? AND product_sku = ?
  `);

  const stmtRemove = db.prepare(`
    DELETE FROM cart_items WHERE phone = ? AND product_sku = ?
  `);

  const stmtClear = db.prepare(`
    DELETE FROM cart_items WHERE phone = ?
  `);

  const stmtGetByPhone = db.prepare(`
    SELECT ci.*, p.name AS product_name
    FROM cart_items ci
    LEFT JOIN products p ON p.sku = ci.product_sku
    WHERE ci.phone = ?
    ORDER BY ci.added_at ASC
  `);

  const stmtGetItem = db.prepare(`
    SELECT ci.*, p.name AS product_name
    FROM cart_items ci
    LEFT JOIN products p ON p.sku = ci.product_sku
    WHERE ci.phone = ? AND ci.product_sku = ?
  `);

  const stmtCleanupOld = db.prepare(`
    DELETE FROM cart_items WHERE phone IN (
      SELECT DISTINCT phone FROM cart_items
      WHERE added_at < datetime('now', ? || ' days')
    )
  `);

  // ── Public API ───────────────────────────────────────────────────────

  return {
    /**
     * Add or update an item in the cart. If the SKU already exists
     * for this phone, the qty and price are replaced (upsert).
     *
     * @param {string} phone
     * @param {string} sku
     * @param {number} qty
     * @param {number} unitPrice
     */
    addItem(phone, sku, qty, unitPrice) {
      stmtUpsert.run(phone, sku, qty, unitPrice);
    },

    /**
     * Update the quantity of an existing cart item.
     *
     * @param {string} phone
     * @param {string} sku
     * @param {number} qty
     * @returns {boolean} True if a row was updated.
     */
    updateQty(phone, sku, qty) {
      const result = stmtUpdateQty.run(qty, phone, sku);
      return result.changes > 0;
    },

    /**
     * Remove a specific item from the cart.
     *
     * @param {string} phone
     * @param {string} sku
     * @returns {boolean} True if a row was deleted.
     */
    removeItem(phone, sku) {
      const result = stmtRemove.run(phone, sku);
      return result.changes > 0;
    },

    /**
     * Clear the entire cart for a phone.
     *
     * @param {string} phone
     * @returns {number} Number of items removed.
     */
    clear(phone) {
      const result = stmtClear.run(phone);
      return result.changes;
    },

    /**
     * Get all items in the cart for a phone (with product name joined).
     *
     * @param {string} phone
     * @returns {CartItem[]}
     */
    getItems(phone) {
      return stmtGetByPhone.all(phone);
    },

    /**
     * Get a specific item in the cart.
     *
     * @param {string} phone
     * @param {string} sku
     * @returns {CartItem|undefined}
     */
    getItem(phone, sku) {
      return stmtGetItem.get(phone, sku);
    },

    /**
     * Calculate cart subtotal.
     *
     * @param {string} phone
     * @returns {{ items: CartItem[], subtotal: number, count: number }}
     */
    getSummary(phone) {
      const items = stmtGetByPhone.all(phone);
      const subtotal = items.reduce((s, i) => s + i.qty * i.unit_price, 0);
      const count = items.reduce((c, i) => c + i.qty, 0);
      return { items, subtotal, count };
    },

    /**
     * Remove carts older than the given number of days.
     *
     * @param {number} [days=7]
     * @returns {number} Number of items cleaned up.
     */
    cleanupOld(days = 7) {
      const result = stmtCleanupOld.run(`-${days}`);
      return result.changes;
    },
  };
}
