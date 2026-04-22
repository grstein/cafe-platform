#!/usr/bin/env node
/**
 * Seed app_config and allowlist tables from pi-config files.
 *
 * Run once after first deploy (or whenever you want to push file-based
 * config into the DB):
 *
 *   docker compose exec gateway node setup/init-config.mjs
 *
 * This script is idempotent — safe to run multiple times.
 * It REPLACES the existing DB config with the contents of the files.
 *
 * Files read:
 *   CONFIG_DIR/config.json   → app_config table  (required)
 *   CONFIG_DIR/allowlist.txt → allowlist table    (optional)
 */

import fs from "fs";
import path from "path";
import { getDB, initDB } from "../shared/db/connection.mjs";
import { createAllowlistRepo } from "../shared/db/allowlist.mjs";

const configDir = process.env.CONFIG_DIR || "./pi-config";

// ── Config ──────────────────────────────────────────────────────────────────

const configFile = path.join(configDir, "config.json");
if (!fs.existsSync(configFile)) {
  console.error(`config.json not found at ${configFile}`);
  process.exit(1);
}

const raw = JSON.parse(fs.readFileSync(configFile, "utf-8"));

await initDB();
const sql = getDB();

await sql`
  INSERT INTO app_config (id, config)
  VALUES (1, ${JSON.stringify(raw)}::jsonb)
  ON CONFLICT (id) DO UPDATE SET config = EXCLUDED.config, updated_at = NOW()
`;
console.log("✅ app_config seeded from config.json");
console.log("   display_name:", raw.display_name || "(not set)");

// ── Allowlist ────────────────────────────────────────────────────────────────

const allowlistFile = path.join(configDir, "allowlist.txt");
if (fs.existsSync(allowlistFile)) {
  const repo = createAllowlistRepo(sql);
  const lines = fs.readFileSync(allowlistFile, "utf-8").split("\n");
  let count = 0;
  for (const line of lines) {
    const pattern = line.split("#")[0].trim();
    if (!pattern) continue;
    await repo.addPattern(pattern, "seeded from allowlist.txt");
    count++;
  }
  console.log(`✅ allowlist seeded: ${count} pattern(s) from allowlist.txt`);
} else {
  console.log("ℹ️  No allowlist.txt found — skipping allowlist seed");
}

await sql.end();
