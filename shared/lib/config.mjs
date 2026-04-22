/**
 * @fileoverview App configuration — stored in the `app_config` DB table.
 *
 * Boot flow:
 *   1. `loadConfig(sql)` is called once per consumer at startup.
 *   2. It reads the single row from `app_config`.
 *   3. If the table is empty, it falls back to `CONFIG_DIR/config.json`
 *      and auto-seeds that file's contents into the DB.
 *   4. The merged config is cached; `getConfig()` returns it synchronously.
 *
 * To update config at runtime: UPDATE app_config SET config = '...', updated_at = NOW()
 * and restart consumers (or add a hot-reload mechanism later).
 */

import fs from "fs";
import path from "path";

const DEFAULTS = {
  display_name: "",
  llm: { provider: "openrouter", model: "anthropic/claude-haiku-4.5", thinking: "medium" },
  session: { ttl_minutes: 30, soft_limit: 40, hard_limit: 60, debounce_ms: 2500 },
  behavior: { humanize_delay_min_ms: 2000, humanize_delay_max_ms: 6000, rate_limit_per_min: 8, typing_indicator: true },
  pix: { enabled: false },
  bot_phone: "",
  available_models: [],
};

let _config = null;

/**
 * Load config from the `app_config` table (once per process).
 * Falls back to `CONFIG_DIR/config.json` and auto-seeds the DB if the table
 * is empty. Safe to call multiple times — cached after first load.
 *
 * @param {import('postgres').Sql} sql
 * @returns {Promise<object>}
 */
export async function loadConfig(sql) {
  if (_config) return _config;

  // 1. Try DB
  const [row] = await sql`SELECT config FROM app_config WHERE id = 1`;
  if (row?.config) {
    // postgres.js may return JSONB as an object or string depending on transform config
    const parsed = typeof row.config === "string" ? JSON.parse(row.config) : row.config;
    if (Object.keys(parsed).length > 0) {
      _config = deepMerge(structuredClone(DEFAULTS), parsed);
      return _config;
    }
  }

  // 2. Fall back to JSON file + auto-seed DB
  const configDir = process.env.CONFIG_DIR || "/config/pi";
  const configFile = path.join(configDir, "config.json");
  let raw = {};
  if (fs.existsSync(configFile)) {
    raw = JSON.parse(fs.readFileSync(configFile, "utf-8"));
    console.log(`[config] Seeding app_config from ${configFile}`);
    try {
      await sql`
        INSERT INTO app_config (id, config)
        VALUES (1, ${JSON.stringify(raw)}::jsonb)
        ON CONFLICT (id) DO UPDATE SET config = EXCLUDED.config, updated_at = NOW()
      `;
    } catch (err) {
      console.warn("[config] Could not seed app_config:", err.message);
    }
  }

  _config = deepMerge(structuredClone(DEFAULTS), raw);
  return _config;
}

/**
 * Return the cached config. Throws if `loadConfig(sql)` has not been called yet.
 * @returns {object}
 */
export function getConfig() {
  if (!_config) throw new Error("Config not loaded. Call await loadConfig(sql) at consumer startup.");
  return _config;
}

/**
 * Update config in the DB and refresh the in-memory cache.
 *
 * @param {import('postgres').Sql} sql
 * @param {object} partial - Partial config object (deep-merged over current).
 * @returns {Promise<object>} New merged config.
 */
export async function updateConfig(sql, partial) {
  const current = _config ? structuredClone(_config) : structuredClone(DEFAULTS);
  // Remove internal fields before storing
  delete current._paths;
  const merged = deepMerge(current, partial);
  await sql`
    INSERT INTO app_config (id, config)
    VALUES (1, ${JSON.stringify(merged)}::jsonb)
    ON CONFLICT (id) DO UPDATE SET config = EXCLUDED.config, updated_at = NOW()
  `;
  _config = merged;
  return _config;
}

/** Clears the in-memory cache. Call `loadConfig(sql)` again to reload. */
export function clearConfig() {
  _config = null;
}

function deepMerge(target, source) {
  for (const key of Object.keys(source)) {
    if (
      source[key] && typeof source[key] === "object" &&
      !Array.isArray(source[key]) &&
      target[key] && typeof target[key] === "object"
    ) {
      deepMerge(target[key], source[key]);
    } else {
      target[key] = source[key];
    }
  }
  return target;
}
