/**
 * @fileoverview Referral repository.
 *
 * Tracks who invited whom and manages referral rewards.
 */

/** @typedef {import('better-sqlite3').Database} Database */

/**
 * @typedef {Object} Referral
 * @property {number} id
 * @property {string} referrer_phone
 * @property {string} referred_phone
 * @property {string} referral_code_used
 * @property {string} status - 'pending' | 'activated' | 'rewarded'
 * @property {string} reward_type - 'discount_percent' | 'discount_fixed'
 * @property {number} reward_value
 * @property {number|null} reward_applied_to_order
 * @property {string} created_at
 * @property {string|null} activated_at
 * @property {string|null} rewarded_at
 */

/**
 * Creates a referral repository bound to the given database instance.
 *
 * @param {Database} db
 * @returns {ReturnType<typeof _buildRepo>}
 */
export function createReferralRepo(db) {
  return _buildRepo(db);
}

/** @param {Database} db */
function _buildRepo(db) {
  const stmtInsert = db.prepare(`
    INSERT OR IGNORE INTO referrals (referrer_phone, referred_phone, referral_code_used, reward_type, reward_value)
    VALUES (?, ?, ?, ?, ?)
  `);

  const stmtGetByReferred = db.prepare(
    `SELECT * FROM referrals WHERE referred_phone = ? ORDER BY created_at DESC LIMIT 1`
  );

  const stmtGetPendingRewards = db.prepare(
    `SELECT r.*, c.name AS referred_name, c.push_name AS referred_push_name
     FROM referrals r
     LEFT JOIN customers c ON c.phone = r.referred_phone
     WHERE r.referrer_phone = ? AND r.status = 'activated'`
  );

  const stmtActivate = db.prepare(`
    UPDATE referrals
    SET status = 'activated', activated_at = datetime('now')
    WHERE referred_phone = ? AND status = 'pending'
  `);

  const stmtMarkRewarded = db.prepare(`
    UPDATE referrals
    SET status = 'rewarded', rewarded_at = datetime('now'), reward_applied_to_order = ?
    WHERE id = ?
  `);

  const stmtCountByReferrer = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status != 'pending' THEN 1 ELSE 0 END) AS active,
      SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending
    FROM referrals WHERE referrer_phone = ?
  `);

  const stmtGetById = db.prepare(`SELECT * FROM referrals WHERE id = ?`);

  return {
    /**
     * Create a referral record.
     *
     * @param {string} referrerPhone
     * @param {string} referredPhone
     * @param {string} codeUsed
     * @param {{ type?: string, value?: number }} [reward]
     * @returns {Referral|undefined}
     */
    create(referrerPhone, referredPhone, codeUsed, reward = {}) {
      stmtInsert.run(
        referrerPhone,
        referredPhone,
        codeUsed,
        reward.type || 'discount_percent',
        reward.value ?? 10
      );
      return stmtGetByReferred.get(referredPhone);
    },

    /**
     * Get the referral record for a referred customer.
     *
     * @param {string} phone - The referred customer's phone.
     * @returns {Referral|undefined}
     */
    getByReferred(phone) {
      return stmtGetByReferred.get(phone);
    },

    /**
     * Get pending rewards for a referrer (referred customers who bought
     * but the referrer hasn't used the discount yet).
     *
     * @param {string} referrerPhone
     * @returns {Array<Referral & { referred_name?: string, referred_push_name?: string }>}
     */
    getPendingRewards(referrerPhone) {
      return stmtGetPendingRewards.all(referrerPhone);
    },

    /**
     * Activate a referral when the referred customer makes their first purchase.
     *
     * @param {string} referredPhone
     * @returns {number} Number of rows updated.
     */
    activate(referredPhone) {
      return stmtActivate.run(referredPhone).changes;
    },

    /**
     * Mark a referral reward as used.
     *
     * @param {number} referralId
     * @param {number} orderId - The order where the discount was applied.
     */
    markRewarded(referralId, orderId) {
      stmtMarkRewarded.run(orderId, referralId);
    },

    /**
     * Count referrals made by a referrer.
     *
     * @param {string} referrerPhone
     * @returns {{ total: number, active: number, pending: number }}
     */
    countByReferrer(referrerPhone) {
      return stmtCountByReferrer.get(referrerPhone);
    },

    /**
     * Get a referral by ID.
     *
     * @param {number} id
     * @returns {Referral|undefined}
     */
    getById(id) {
      return stmtGetById.get(id);
    },
  };
}
