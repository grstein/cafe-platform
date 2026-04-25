/**
 * @fileoverview Customer repository (mini CRM) — PostgreSQL, async.
 */

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function genCode(prefix) {
  let code = prefix;
  for (let i = 0; i < 4; i++) {
    code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return code;
}

const UPDATABLE_FIELDS = new Set([
  "name", "cep", "email", "cpf", "city", "state", "address",
  "preferences", "notes", "referred_by_phone",
]);

/**
 * @param {import('postgres').Sql} sql
 */
export function createCustomerRepo(sql) {
  return {
    /**
     * Upsert: create or touch last_seen_at. Optionally set access_status
     * and referred_by_phone on first insert or explicitly on update.
     */
    async upsert(phone, data = {}) {
      const pushName = data.push_name ?? null;
      const accessStatus = data.access_status ?? null;
      const referredBy = data.referred_by_phone ?? null;

      // COALESCE(EXCLUDED.col, table.col) keeps existing value when NULL
      // ::TEXT cast tells PG the type of the null literal
      const [row] = await sql`
        INSERT INTO customers (phone, push_name, access_status, referred_by_phone)
        VALUES (
          ${phone},
          ${pushName},
          ${accessStatus ?? "active"},
          ${referredBy}
        )
        ON CONFLICT (phone) DO UPDATE SET
          last_seen_at      = NOW(),
          push_name         = COALESCE(EXCLUDED.push_name, customers.push_name),
          access_status     = COALESCE(${accessStatus}::TEXT, customers.access_status),
          referred_by_phone = COALESCE(${referredBy}::TEXT, customers.referred_by_phone),
          updated_at        = NOW()
        RETURNING *
      `;

      // Auto-generate referral code for new customers (or any without one)
      if (!row.referral_code) {
        const prefix = process.env.REFERRAL_CODE_PREFIX || "REF-";
        let code, attempts = 0;
        do {
          code = genCode(prefix);
          const [existing] = await sql`SELECT 1 FROM customers WHERE referral_code = ${code}`;
          if (!existing) break;
          attempts++;
        } while (attempts < 100);
        await sql`UPDATE customers SET referral_code = ${code} WHERE phone = ${phone}`;
        row.referral_code = code;
      }

      return row;
    },

    async getByPhone(phone) {
      const [row] = await sql`SELECT * FROM customers WHERE phone = ${phone}`;
      return row ?? null;
    },

    async updateInfo(phone, fields) {
      const entries = Object.entries(fields).filter(([k]) => UPDATABLE_FIELDS.has(k));
      if (entries.length === 0) return this.getByPhone(phone);

      // Build update object with serialized values (no sql fragments)
      const updates = {};
      for (const [k, v] of entries) {
        updates[k] = typeof v === "object" && v !== null ? JSON.stringify(v) : v;
      }

      // sql(updates) builds "key = $N, ..." — add updated_at literally
      const [row] = await sql`
        UPDATE customers
        SET ${sql(updates)}, updated_at = NOW()
        WHERE phone = ${phone}
        RETURNING *
      `;
      return row ?? null;
    },

    async updateCounters(phone) {
      const [row] = await sql`
        UPDATE customers SET
          total_orders = (
            SELECT COUNT(*) FROM orders
            WHERE orders.phone = ${phone} AND orders.status NOT IN ('cancelled', 'pending')
          ),
          total_spent = (
            SELECT COALESCE(SUM(total), 0) FROM orders
            WHERE orders.phone = ${phone} AND orders.status NOT IN ('cancelled', 'pending')
          ),
          updated_at = NOW()
        WHERE phone = ${phone}
        RETURNING *
      `;
      return row ?? null;
    },

    async setNPS(phone, score) {
      const [row] = await sql`
        UPDATE customers
        SET nps_score = ${score}, nps_date = NOW(), updated_at = NOW()
        WHERE phone = ${phone}
        RETURNING *
      `;
      return row ?? null;
    },

    async addTag(phone, tag) {
      const customer = await this.getByPhone(phone);
      if (!customer) return null;
      let tags = [];
      try { tags = JSON.parse(customer.tags); } catch {}
      if (!tags.includes(tag)) {
        tags.push(tag);
        await sql`UPDATE customers SET tags = ${JSON.stringify(tags)}, updated_at = NOW() WHERE phone = ${phone}`;
      }
      return this.getByPhone(phone);
    },

    async removeTag(phone, tag) {
      const customer = await this.getByPhone(phone);
      if (!customer) return null;
      let tags = [];
      try { tags = JSON.parse(customer.tags); } catch {}
      const filtered = tags.filter((t) => t !== tag);
      if (filtered.length !== tags.length) {
        await sql`UPDATE customers SET tags = ${JSON.stringify(filtered)}, updated_at = NOW() WHERE phone = ${phone}`;
      }
      return this.getByPhone(phone);
    },

    async list(opts = {}) {
      const { limit = 50, offset = 0, tag, hasOrders } = opts;
      return sql`
        SELECT * FROM customers
        WHERE 1=1
          ${tag ? sql`AND tags LIKE ${"%" + JSON.stringify(tag) + "%"}` : sql``}
          ${hasOrders === true  ? sql`AND total_orders > 0` : sql``}
          ${hasOrders === false ? sql`AND total_orders = 0` : sql``}
        ORDER BY last_seen_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `;
    },

    async getByReferralCode(code) {
      const [row] = await sql`SELECT * FROM customers WHERE referral_code = ${code}`;
      return row ?? null;
    },

    async setAccessStatus(phone, status) {
      await sql`
        UPDATE customers SET access_status = ${status}, updated_at = NOW()
        WHERE phone = ${phone}
      `;
    },

    async findByAccessStatus(status) {
      return sql`
        SELECT * FROM customers WHERE access_status = ${status}
        ORDER BY last_seen_at DESC
      `;
    },

    /**
     * Authorize a phone via admin command. Idempotent: marks access_status='active'
     * and stamps referred_by_phone='admin' only if no referrer was already recorded
     * (preserving an existing referral chain). Returns { wasNew, alreadyActive }.
     */
    async adminAuthorize(phone) {
      const before = await this.getByPhone(phone);
      const wasNew = !before;
      const alreadyActive = before?.access_status === "active";

      if (!before) {
        await sql`
          INSERT INTO customers (phone, access_status, referred_by_phone)
          VALUES (${phone}, 'active', 'admin')
        `;
        // Generate referral code for the new customer
        await this.upsert(phone, {});
      } else {
        await sql`
          UPDATE customers SET
            access_status     = 'active',
            referred_by_phone = COALESCE(referred_by_phone, 'admin'),
            updated_at        = NOW()
          WHERE phone = ${phone}
        `;
      }
      return { wasNew, alreadyActive };
    },

    async ensureReferralCode(phone) {
      const customer = await this.getByPhone(phone);
      if (customer?.referral_code) return customer.referral_code;

      const prefix = process.env.REFERRAL_CODE_PREFIX || "REF-";
      let code, attempts = 0;
      do {
        code = genCode(prefix);
        const [existing] = await sql`SELECT 1 FROM customers WHERE referral_code = ${code}`;
        if (!existing) break;
        attempts++;
      } while (attempts < 100);

      await sql`UPDATE customers SET referral_code = ${code}, updated_at = NOW() WHERE phone = ${phone}`;
      return code;
    },
  };
}
