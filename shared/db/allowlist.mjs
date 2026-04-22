/**
 * @fileoverview Allowlist repository — PostgreSQL, async.
 *
 * Stores phone number patterns that bypass the referral requirement.
 * Patterns are exact phone numbers or prefixes ending in `*` (e.g. `5541*`).
 *
 * On first gateway startup, if the table is empty, it auto-seeds from
 * `CONFIG_DIR/allowlist.txt` (one pattern per line, `#` comments).
 */

import fs from "fs";
import path from "path";

/**
 * @param {import('postgres').Sql} sql
 */
export function createAllowlistRepo(sql) {
  return {
    /** Return all active patterns as { pattern } rows. */
    async getPatterns() {
      return sql`SELECT pattern FROM allowlist WHERE active = true ORDER BY pattern`;
    },

    /** Add or re-activate a pattern. */
    async addPattern(pattern, note = null) {
      await sql`
        INSERT INTO allowlist (pattern, note)
        VALUES (${pattern.trim()}, ${note})
        ON CONFLICT (pattern) DO UPDATE
          SET active = true,
              note   = COALESCE(${note}, allowlist.note)
      `;
    },

    /** Deactivate (soft-delete) a pattern. */
    async removePattern(pattern) {
      await sql`UPDATE allowlist SET active = false WHERE pattern = ${pattern}`;
    },

    /** Hard-delete a pattern. */
    async deletePattern(pattern) {
      await sql`DELETE FROM allowlist WHERE pattern = ${pattern}`;
    },

    /** List all patterns (active and inactive). */
    async listAll() {
      return sql`SELECT * FROM allowlist ORDER BY pattern`;
    },

    /**
     * Seed from `CONFIG_DIR/allowlist.txt` if the table is empty.
     * Called once at gateway startup.
     */
    async seedFromFile() {
      const [row] = await sql`SELECT COUNT(*)::int AS c FROM allowlist`;
      if (row.c > 0) return; // already seeded

      const configDir = process.env.CONFIG_DIR || "/config/pi";
      const file = path.join(configDir, "allowlist.txt");
      if (!fs.existsSync(file)) return;

      const lines = fs.readFileSync(file, "utf-8").split("\n");
      let count = 0;
      for (const line of lines) {
        const pattern = line.split("#")[0].trim();
        if (!pattern) continue;
        await this.addPattern(pattern, "seeded from allowlist.txt");
        count++;
      }
      if (count > 0) console.log(`[allowlist] Seeded ${count} patterns from ${file}`);
    },
  };
}
