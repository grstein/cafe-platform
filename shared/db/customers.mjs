/**
 * @fileoverview Customer repository (mini CRM).
 *
 * Factory pattern — call createCustomerRepo(db) with a better-sqlite3 instance.
 */

/** @typedef {import('better-sqlite3').Database} Database */

/**
 * @typedef {Object} Customer
 * @property {number} id
 * @property {string} phone
 * @property {string|null} push_name
 * @property {string|null} name
 * @property {string|null} cpf
 * @property {string|null} email
 * @property {string|null} cep
 * @property {string|null} address
 * @property {string|null} city
 * @property {string|null} state
 * @property {string} tags - JSON array
 * @property {string} preferences - JSON object
 * @property {string|null} notes
 * @property {string} first_seen_at
 * @property {string} last_seen_at
 * @property {number} total_orders
 * @property {number} total_spent
 * @property {number|null} nps_score
 * @property {string|null} nps_date
 * @property {string} created_at
 * @property {string} updated_at
 */

/** Characters for referral code generation (no 0/O/1/I/L ambiguity) */
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Fields allowed in updateInfo */
const UPDATABLE_FIELDS = new Set([
  'name',
  'cep',
  'email',
  'cpf',
  'city',
  'state',
  'address',
  'preferences',
  'notes',
  'referred_by_phone',
]);

/**
 * Creates a customer repository bound to the given database instance.
 *
 * @param {Database} db - better-sqlite3 database instance
 * @returns {ReturnType<typeof _buildRepo>}
 */
export function createCustomerRepo(db) {
  return _buildRepo(db);
}

/**
 * @param {Database} db
 */
function _buildRepo(db) {
  // ── Prepared statements ──────────────────────────────────────────────

  const stmtInsertIgnore = db.prepare(`
    INSERT OR IGNORE INTO customers (phone, push_name)
    VALUES (?, ?)
  `);

  const stmtUpdateSeen = db.prepare(`
    UPDATE customers
    SET last_seen_at = datetime('now'),
        push_name = COALESCE(?, push_name),
        updated_at = datetime('now')
    WHERE phone = ?
  `);

  const stmtGetByPhone = db.prepare(
    `SELECT * FROM customers WHERE phone = ?`
  );

  const stmtSetNPS = db.prepare(`
    UPDATE customers
    SET nps_score = ?, nps_date = datetime('now'), updated_at = datetime('now')
    WHERE phone = ?
  `);

  const stmtGetTags = db.prepare(
    `SELECT tags FROM customers WHERE phone = ?`
  );

  const stmtSetTags = db.prepare(`
    UPDATE customers SET tags = ?, updated_at = datetime('now') WHERE phone = ?
  `);

  const stmtGetByReferralCode = db.prepare(
    `SELECT * FROM customers WHERE referral_code = ?`
  );

  const stmtSetAccessStatus = db.prepare(`
    UPDATE customers SET access_status = ?, updated_at = datetime('now') WHERE phone = ?
  `);

  const stmtSetReferralCode = db.prepare(`
    UPDATE customers SET referral_code = ?, updated_at = datetime('now') WHERE phone = ?
  `);

  const stmtCheckCode = db.prepare(
    `SELECT 1 FROM customers WHERE referral_code = ?`
  );

  const stmtFindByAccessStatus = db.prepare(
    `SELECT * FROM customers WHERE access_status = ? ORDER BY last_seen_at DESC`
  );

  const stmtRecalcCounters = db.prepare(`
    UPDATE customers SET
      total_orders = (
        SELECT COUNT(*) FROM orders
        WHERE orders.phone = ? AND orders.status NOT IN ('cancelled', 'pending')
      ),
      total_spent = (
        SELECT COALESCE(SUM(total), 0) FROM orders
        WHERE orders.phone = ? AND orders.status NOT IN ('cancelled', 'pending')
      ),
      updated_at = datetime('now')
    WHERE phone = ?
  `);

  // ── Public API ───────────────────────────────────────────────────────

  return {
    /**
     * Upsert a customer: create if new, update last_seen_at and push_name if existing.
     *
     * @param {string} phone
     * @param {{ push_name?: string|null }} [data]
     * @returns {Customer}
     */
    upsert(phone, data = {}) {
      const pushName = data.push_name ?? null;
      // Check if this is a brand-new customer (doesn't exist yet)
      const existed = !!stmtGetByPhone.get(phone);
      stmtInsertIgnore.run(phone, pushName);
      stmtUpdateSeen.run(pushName, phone);
      // Auto-generate referral code for new customers
      if (!existed) {
        const customer = stmtGetByPhone.get(phone);
        if (customer && !customer.referral_code) {
          let code;
          let attempts = 0;
          do {
            code = process.env.REFERRAL_CODE_PREFIX || 'REF-';
            for (let i = 0; i < 4; i++) {
              code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
            }
            attempts++;
          } while (stmtCheckCode.get(code) && attempts < 100);
          stmtSetReferralCode.run(code, phone);
        }
      }
      return stmtGetByPhone.get(phone);
    },

    /**
     * Get a customer by phone number.
     *
     * @param {string} phone
     * @returns {Customer|undefined}
     */
    getByPhone(phone) {
      return stmtGetByPhone.get(phone);
    },

    /**
     * Partially update customer info fields.
     * Only the fields present in `fields` are updated.
     *
     * @param {string} phone
     * @param {Partial<Pick<Customer, 'name'|'cep'|'email'|'cpf'|'city'|'state'|'address'|'preferences'|'notes'>>} fields
     * @returns {Customer|undefined}
     */
    updateInfo(phone, fields) {
      const entries = Object.entries(fields).filter(([k]) =>
        UPDATABLE_FIELDS.has(k)
      );
      if (entries.length === 0) return stmtGetByPhone.get(phone);

      const setClauses = entries.map(([k]) => `${k} = ?`);
      setClauses.push(`updated_at = datetime('now')`);

      const sql = `UPDATE customers SET ${setClauses.join(', ')} WHERE phone = ?`;
      const values = entries.map(([, v]) =>
        typeof v === 'object' && v !== null ? JSON.stringify(v) : v
      );
      values.push(phone);

      db.prepare(sql).run(...values);
      return stmtGetByPhone.get(phone);
    },

    /**
     * Recalculate total_orders and total_spent from the orders table.
     *
     * @param {string} phone
     * @returns {Customer|undefined}
     */
    updateCounters(phone) {
      stmtRecalcCounters.run(phone, phone, phone);
      return stmtGetByPhone.get(phone);
    },

    /**
     * Set NPS score for a customer.
     *
     * @param {string} phone
     * @param {number} score - NPS score (0-10)
     * @returns {Customer|undefined}
     */
    setNPS(phone, score) {
      stmtSetNPS.run(score, phone);
      return stmtGetByPhone.get(phone);
    },

    /**
     * Add a tag to the customer's tag array (no duplicates).
     *
     * @param {string} phone
     * @param {string} tag
     * @returns {Customer|undefined}
     */
    addTag(phone, tag) {
      const row = stmtGetTags.get(phone);
      if (!row) return undefined;

      const tags = JSON.parse(row.tags);
      if (!tags.includes(tag)) {
        tags.push(tag);
        stmtSetTags.run(JSON.stringify(tags), phone);
      }
      return stmtGetByPhone.get(phone);
    },

    /**
     * Remove a tag from the customer's tag array.
     *
     * @param {string} phone
     * @param {string} tag
     * @returns {Customer|undefined}
     */
    removeTag(phone, tag) {
      const row = stmtGetTags.get(phone);
      if (!row) return undefined;

      const tags = JSON.parse(row.tags);
      const filtered = tags.filter((t) => t !== tag);
      if (filtered.length !== tags.length) {
        stmtSetTags.run(JSON.stringify(filtered), phone);
      }
      return stmtGetByPhone.get(phone);
    },

    /**
     * List customers with optional filters.
     *
     * @param {{ limit?: number, offset?: number, tag?: string, hasOrders?: boolean }} [opts]
     * @returns {Customer[]}
     */
    list(opts = {}) {
      const { limit = 50, offset = 0, tag, hasOrders } = opts;

      const conditions = [];
      const params = [];

      if (tag) {
        // JSON array contains check: tags LIKE '%"vip"%'
        conditions.push(`tags LIKE ?`);
        params.push(`%${JSON.stringify(tag)}%`);
      }

      if (hasOrders === true) {
        conditions.push(`total_orders > 0`);
      } else if (hasOrders === false) {
        conditions.push(`total_orders = 0`);
      }

      const where =
        conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      const sql = `SELECT * FROM customers ${where} ORDER BY last_seen_at DESC LIMIT ? OFFSET ?`;
      params.push(limit, offset);

      return db.prepare(sql).all(...params);
    },

    // ── Referral methods ─────────────────────────────────────────────

    /**
     * Get a customer by their referral code.
     *
     * @param {string} code - Referral code (e.g., 'REF-G7K2').
     * @returns {Customer|undefined}
     */
    getByReferralCode(code) {
      return stmtGetByReferralCode.get(code);
    },

    /**
     * Set access status for a customer.
     *
     * @param {string} phone
     * @param {'seed'|'invited'|'active'|'blocked'} status
     */
    setAccessStatus(phone, status) {
      stmtSetAccessStatus.run(status, phone);
    },

    /**
     * Find customers by access status.
     *
     * @param {'seed'|'invited'|'active'|'blocked'} status
     * @returns {Customer[]}
     */
    findByAccessStatus(status) {
      return stmtFindByAccessStatus.all(status);
    },

    /**
     * Generate a unique referral code and save it for a customer.
     * If the customer already has a code, returns the existing one.
     *
     * @param {string} phone
     * @returns {string} The referral code.
     */
    ensureReferralCode(phone) {
      const customer = stmtGetByPhone.get(phone);
      if (customer?.referral_code) return customer.referral_code;

      let code;
      let attempts = 0;
      do {
        code = process.env.REFERRAL_CODE_PREFIX || 'REF-';
        for (let i = 0; i < 4; i++) {
          code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
        }
        attempts++;
      } while (stmtCheckCode.get(code) && attempts < 100);

      stmtSetReferralCode.run(code, phone);
      return code;
    },
  };
}
