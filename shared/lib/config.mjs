/**
 * @fileoverview Single-tenant configuration loader.
 *
 * The active tenant is selected via the TENANT_ID environment variable.
 * Config is read from `${TENANTS_DIR}/${TENANT_ID}/tenant.json`, merged
 * over built-in defaults, and cached on first access.
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
 * Returns the active tenant id from the TENANT_ID env var.
 * Throws if unset — callers must ensure the variable is defined at boot.
 * @returns {string}
 */
export function getTenantId() {
  const id = process.env.TENANT_ID;
  if (!id) {
    throw new Error("TENANT_ID environment variable is required");
  }
  return id;
}

/**
 * Returns the single app config, loading and caching on first call.
 * @returns {object}
 */
export function getConfig() {
  if (_config) return _config;

  const tenantId = getTenantId();
  const tenantsDir = process.env.TENANTS_DIR || "./tenants";
  const configFile = path.join(tenantsDir, tenantId, "tenant.json");

  let raw = {};
  if (fs.existsSync(configFile)) {
    raw = JSON.parse(fs.readFileSync(configFile, "utf-8"));
  }

  _config = deepMerge(structuredClone(DEFAULTS), raw);
  _config.tenant_id = tenantId;
  _config._paths = {
    root: path.join(tenantsDir, tenantId),
    allowlist: path.join(tenantsDir, tenantId, "allowlist.txt"),
    catalog: path.join(tenantsDir, tenantId, "catalogo.csv"),
  };

  return _config;
}

/** Clears the config cache (useful in tests). */
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
