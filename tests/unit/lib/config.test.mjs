import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createTestDB } from "../../helpers/db.mjs";
import { APP_CONFIG } from "../../helpers/fixtures.mjs";

describe("config (DB-backed)", () => {
  let sql;

  before(async () => {
    sql = await createTestDB(); // seeds app_config with APP_CONFIG
  });

  after(async () => { await sql.end(); });

  beforeEach(async () => {
    // Reset cache between tests
    const { clearConfig } = await import("../../../shared/lib/config.mjs");
    clearConfig();
  });

  it("loadConfig reads from app_config table", async () => {
    const { loadConfig, clearConfig } = await import("../../../shared/lib/config.mjs");
    clearConfig();
    const cfg = await loadConfig(sql);
    assert.equal(cfg.display_name, APP_CONFIG.display_name);
    assert.equal(cfg.llm.model, APP_CONFIG.llm.model);
  });

  it("getConfig() returns cached result after loadConfig()", async () => {
    const { loadConfig, getConfig, clearConfig } = await import("../../../shared/lib/config.mjs");
    clearConfig();
    await loadConfig(sql);
    const a = getConfig();
    const b = getConfig();
    assert.equal(a, b); // same object reference
  });

  it("getConfig() throws if loadConfig() was not called", async () => {
    const { getConfig, clearConfig } = await import("../../../shared/lib/config.mjs");
    clearConfig();
    assert.throws(() => getConfig(), /loadConfig/);
  });

  it("loadConfig() is a no-op on second call (uses cache)", async () => {
    const { loadConfig, clearConfig } = await import("../../../shared/lib/config.mjs");
    clearConfig();
    const first = await loadConfig(sql);
    const second = await loadConfig(sql);
    assert.equal(first, second);
  });

  it("clearConfig() invalidates cache", async () => {
    const { loadConfig, getConfig, clearConfig } = await import("../../../shared/lib/config.mjs");
    clearConfig();
    await loadConfig(sql);
    clearConfig();
    assert.throws(() => getConfig(), /loadConfig/);
  });

  it("updateConfig() merges partial and persists to DB", async () => {
    const { loadConfig, updateConfig, clearConfig } = await import("../../../shared/lib/config.mjs");
    clearConfig();
    await loadConfig(sql);
    await updateConfig(sql, { display_name: "Updated Name" });
    const cfg = await import("../../../shared/lib/config.mjs").then(m => m.getConfig());
    assert.equal(cfg.display_name, "Updated Name");
    assert.equal(cfg.llm.model, APP_CONFIG.llm.model); // unchanged
  });

  it("loadConfig() falls back to defaults when DB row is empty", async () => {
    const { loadConfig, clearConfig } = await import("../../../shared/lib/config.mjs");
    // Clear app_config
    await sql`DELETE FROM app_config`;
    clearConfig();
    // No config.json in test CONFIG_DIR → uses defaults
    const cfg = await loadConfig(sql);
    assert.equal(cfg.session.ttl_minutes, 30);
    assert.equal(cfg.llm.provider, "openrouter");
    // Re-seed for other tests
    await sql`
      INSERT INTO app_config (id, config)
      VALUES (1, ${JSON.stringify({ display_name: APP_CONFIG.display_name, llm: APP_CONFIG.llm, session: APP_CONFIG.session, behavior: APP_CONFIG.behavior, pix: APP_CONFIG.pix, bot_phone: APP_CONFIG.bot_phone, available_models: APP_CONFIG.available_models })}::jsonb)
      ON CONFLICT (id) DO UPDATE SET config = EXCLUDED.config
    `;
  });
});
