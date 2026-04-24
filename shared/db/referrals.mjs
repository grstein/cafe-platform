/**
 * @fileoverview Referral repository — PostgreSQL, async.
 */

/**
 * @param {import('postgres').Sql} sql
 */
export function createReferralRepo(sql) {
  return {
    async create(referrerPhone, referredPhone, codeUsed, reward = {}) {
      await sql`
        INSERT INTO referrals (referrer_phone, referred_phone, referral_code_used, reward_type, reward_value)
        VALUES (${referrerPhone}, ${referredPhone}, ${codeUsed},
                ${reward.type || "none"}, ${reward.value ?? 0})
        ON CONFLICT (referrer_phone, referred_phone) DO NOTHING
      `;
      const [row] = await sql`
        SELECT * FROM referrals WHERE referred_phone = ${referredPhone}
        ORDER BY created_at DESC LIMIT 1
      `;
      return row ?? null;
    },

    /**
     * Validate a referral code: look up the customer who owns it and
     * return { referrer_phone } so the gateway can register the referred customer.
     */
    async validate(code) {
      const [row] = await sql`
        SELECT phone AS referrer_phone FROM customers
        WHERE referral_code = ${code} AND referral_code IS NOT NULL
      `;
      return row ?? null;
    },

    async getByReferred(phone) {
      const [row] = await sql`
        SELECT * FROM referrals WHERE referred_phone = ${phone}
        ORDER BY created_at DESC LIMIT 1
      `;
      return row ?? null;
    },

    async getPendingRewards(referrerPhone) {
      return sql`
        SELECT r.*, c.name AS referred_name, c.push_name AS referred_push_name
        FROM referrals r
        LEFT JOIN customers c ON c.phone = r.referred_phone
        WHERE r.referrer_phone = ${referrerPhone} AND r.status = 'activated'
      `;
    },

    async activate(referredPhone) {
      const result = await sql`
        UPDATE referrals SET status = 'activated', activated_at = NOW()
        WHERE referred_phone = ${referredPhone} AND status = 'pending'
      `;
      return result.count;
    },

    async markRewarded(referralId, orderId) {
      await sql`
        UPDATE referrals
        SET status = 'rewarded', rewarded_at = NOW(), reward_applied_to_order = ${orderId}
        WHERE id = ${referralId}
      `;
    },

    async countByReferrer(referrerPhone) {
      const [row] = await sql`
        SELECT
          COUNT(*)::int AS total,
          SUM(CASE WHEN status != 'pending' THEN 1 ELSE 0 END)::int AS active,
          SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END)::int AS pending
        FROM referrals WHERE referrer_phone = ${referrerPhone}
      `;
      return row ?? { total: 0, active: 0, pending: 0 };
    },

    async getById(id) {
      const [row] = await sql`SELECT * FROM referrals WHERE id = ${id}`;
      return row ?? null;
    },
  };
}
